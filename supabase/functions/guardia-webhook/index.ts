// guardia-webhook: receives access events from GuardIA facial recognition system.
// Public endpoint, authenticated via X-GuardIA-Token per tenant.
// Modelo de presença: o leitor mapeado tem FUNÇÃO (entrada/externo) que é a autoridade do estado.
// guardia_events é append-only (nada se apaga). access_events é imutável (só INSERT).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-guardia-token, x-tenant-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function normalizeCpf(v?: string | null): string {
  return String(v ?? "").replace(/\D/g, "");
}

type Payload = {
  evento_id?: string;
  colaborador_id?: string;
  colaborador_nome?: string;
  local_id?: string;
  local_nome?: string;
  tipo?: "entrada" | "saida";
  timestamp?: string;
  dispositivo_id?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const tenantId = req.headers.get("x-tenant-id") ?? req.headers.get("X-Tenant-Id") ?? "";
  const providedToken = req.headers.get("x-guardia-token") ?? req.headers.get("X-GuardIA-Token") ?? "";
  if (!tenantId) return json({ error: "missing_tenant" }, 400);
  if (!providedToken) return json({ error: "unauthorized" }, 401);

  let payload: Payload;
  try { payload = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const required = ["evento_id", "colaborador_id", "local_id", "tipo", "timestamp"] as const;
  for (const k of required) {
    if (!payload[k]) return json({ error: "validation_failed", field: k }, 400);
  }
  if (!["entrada", "saida"].includes(payload.tipo!)) {
    return json({ error: "invalid_tipo" }, 400);
  }

  const colaboradorCpf = normalizeCpf(payload.colaborador_id);
  if (!colaboradorCpf) return json({ error: "invalid_colaborador_id" }, 400);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(url, serviceKey);

  // Load integration config (token, active, debounce, sessao_longa)
  const { data: config, error: cfgErr } = await supabase
    .from("integration_config")
    .select("guardia_token, active, janela_tolerancia_segundos, sessao_longa_alerta_minutos")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (cfgErr) { console.error("config_load_error", cfgErr.message); return json({ error: "server_error" }, 500); }
  if (!config || !config.guardia_token) return json({ error: "unauthorized" }, 401);
  if (!safeEqual(providedToken, config.guardia_token)) return json({ error: "unauthorized" }, 401);
  if (!config.active) return json({ error: "integration_disabled" }, 403);

  const globalDebounceSec: number = config.janela_tolerancia_segundos ?? 180;

  // Idempotency by (tenant_id, evento_id) — preserves raw record regardless.
  const { data: existing } = await supabase
    .from("guardia_events")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("evento_id", payload.evento_id!)
    .maybeSingle();
  if (existing) {
    return json({ recebido: true, evento_id: payload.evento_id, duplicate: true }, 200);
  }

  const occurredAt = new Date(payload.timestamp!).toISOString();

  // Always persist raw event first (append-only).
  const { data: rawRow, error: rawErr } = await supabase
    .from("guardia_events")
    .insert({
      tenant_id: tenantId,
      evento_id: payload.evento_id,
      colaborador_id: colaboradorCpf,
      colaborador_nome: payload.colaborador_nome ?? null,
      local_id: payload.local_id,
      local_nome: payload.local_nome ?? null,
      tipo: payload.tipo, // sugestão do dispositivo — só auditoria
      event_timestamp: occurredAt,
      dispositivo_id: payload.dispositivo_id ?? null,
      processed: false,
    })
    .select("id")
    .single();
  if (rawErr) {
    console.error("guardia_events_insert_failed", rawErr.message);
    return json({ error: "server_error" }, 500);
  }

  const markRaw = async (processed: boolean, note: string | null) => {
    await supabase.from("guardia_events")
      .update({ processed, process_note: note })
      .eq("id", rawRow.id);
  };

  // (b) Resolve device map — AUTHORITY for cold_area + função.
  if (!payload.dispositivo_id) {
    await markRaw(false, "missing_dispositivo_id");
    return json({ recebido: true, evento_id: payload.evento_id, processed: false, reason: "missing_dispositivo_id" }, 200);
  }

  const { data: mapping } = await supabase
    .from("guardia_device_map")
    .select("cold_area_id, funcao, janela_tolerancia_segundos")
    .eq("tenant_id", tenantId)
    .eq("guardia_device_id", payload.dispositivo_id)
    .eq("active", true)
    .maybeSingle();

  if (!mapping) {
    await markRaw(false, `device_not_mapped:${payload.dispositivo_id}`);
    console.warn(`guardia ${payload.evento_id} device_not_mapped dispositivo_id=${payload.dispositivo_id}`);
    return json({
      recebido: true, evento_id: payload.evento_id, processed: false,
      reason: "device_not_mapped", dispositivo_id: payload.dispositivo_id,
    }, 200);
  }

  const funcao: "entrada" | "externo" = mapping.funcao;

  // Resolve cold_area (for unit_id)
  const { data: coldArea } = await supabase.from("cold_areas")
    .select("id, unit_id")
    .eq("tenant_id", tenantId).eq("id", mapping.cold_area_id).maybeSingle();
  if (!coldArea) {
    await markRaw(false, "cold_area_not_found");
    return json({ recebido: true, evento_id: payload.evento_id, processed: false, reason: "cold_area_not_found" }, 200);
  }

  // Resolve employee
  const { data: employee } = await supabase.from("employees")
    .select("id, current_status, current_area_id, accumulated_minutes, inside_since")
    .eq("tenant_id", tenantId).eq("id", colaboradorCpf).maybeSingle();
  if (!employee) {
    await markRaw(false, `employee_not_found:${colaboradorCpf}`);
    return json({ recebido: true, evento_id: payload.evento_id, processed: false, reason: "employee_not_found" }, 200);
  }

  // Optional device record (for last_seen_at)
  const { data: device } = await supabase.from("devices")
    .select("id").eq("tenant_id", tenantId)
    .or(`external_device_id.eq.${payload.dispositivo_id},id.eq.${payload.dispositivo_id}`)
    .maybeSingle();

  // (d) DE-BOUNCE: last processed access_event for same employee on same device.
  const debounceSec: number = mapping.janela_tolerancia_segundos ?? globalDebounceSec;
  if (debounceSec > 0 && device?.id) {
    const since = new Date(new Date(occurredAt).getTime() - debounceSec * 1000).toISOString();
    const { data: lastEv } = await supabase.from("access_events")
      .select("id, occurred_at")
      .eq("tenant_id", tenantId)
      .eq("employee_id", employee.id)
      .eq("device_id", device.id)
      .gte("occurred_at", since)
      .order("occurred_at", { ascending: false })
      .limit(1).maybeSingle();
    if (lastEv) {
      await markRaw(true, `debounced:${debounceSec}s:prev=${lastEv.id}`);
      return json({
        recebido: true, evento_id: payload.evento_id, processed: true,
        debounced: true, window_seconds: debounceSec,
      }, 200);
    }
  }

  // (e) State machine driven by FUNÇÃO of the reader.
  const statusBefore = employee.current_status as string;
  let statusAfter: "inside" | "outside";
  let eventType: "entry" | "exit";
  let newAccumulated: number = Number(employee.accumulated_minutes ?? 0);
  let employeeUpdate: Record<string, unknown> = {};
  const nowIso = new Date().toISOString();
  let sessionFlag: string | null = null;

  if (funcao === "entrada") {
    eventType = "entry";
    statusAfter = "inside";
    if (statusBefore !== "inside") {
      employeeUpdate = {
        current_area_id: coldArea.id,
        current_status: "inside",
        inside_since: occurredAt,
        updated_at: nowIso,
      };
    } else {
      // already inside — just refresh area if changed; do not reset inside_since.
      if (employee.current_area_id !== coldArea.id) {
        employeeUpdate = { current_area_id: coldArea.id, updated_at: nowIso };
      }
    }
  } else {
    // funcao === 'externo'
    eventType = "exit";
    statusAfter = "outside";
    if (statusBefore === "inside" && employee.inside_since) {
      const minutes = (new Date(occurredAt).getTime() - new Date(employee.inside_since).getTime()) / 60000;
      const safeMinutes = Math.max(0, minutes);
      newAccumulated = Number(employee.accumulated_minutes ?? 0) + safeMinutes;
      const sessaoLonga = config.sessao_longa_alerta_minutos ?? 240;
      if (safeMinutes >= sessaoLonga) {
        sessionFlag = `long_session:${safeMinutes.toFixed(1)}min>=${sessaoLonga}`;
      }
      employeeUpdate = {
        current_status: "outside",
        inside_since: null,
        current_area_id: null,
        accumulated_minutes: newAccumulated,
        updated_at: nowIso,
      };
    } else if (statusBefore !== "outside") {
      employeeUpdate = {
        current_status: "outside",
        inside_since: null,
        current_area_id: null,
        updated_at: nowIso,
      };
    }
    // se já 'outside': ainda inserimos access_events (prova de não-exposição), sem alterar contadores.
  }

  const { error: aeErr } = await supabase.from("access_events").insert({
    tenant_id: tenantId,
    unit_id: coldArea.unit_id,
    cold_area_id: coldArea.id,
    device_id: device?.id ?? null,
    employee_id: employee.id,
    event_type: eventType,
    source: "guardia",
    occurred_at: occurredAt,
    validation_status: "valid",
    confidence_score: 0.95,
    status_before: statusBefore,
    status_after: statusAfter,
    accumulated_at_event: newAccumulated,
  });

  if (aeErr) {
    console.error("access_events_insert_failed", aeErr.message);
    await markRaw(false, `access_event_insert_failed:${aeErr.message.slice(0, 200)}`);
    return json({ recebido: true, evento_id: payload.evento_id, processed: false, reason: "access_event_insert_failed" }, 200);
  }

  if (Object.keys(employeeUpdate).length > 0) {
    const { error: empErr } = await supabase.from("employees").update(employeeUpdate).eq("id", employee.id);
    if (empErr) console.error("employee_update_failed", empErr.message);
  }

  if (device) {
    await supabase.from("devices").update({ last_seen_at: nowIso }).eq("id", device.id);
  }

  const note = [
    `funcao=${funcao}`,
    `${statusBefore}->${statusAfter}`,
    sessionFlag,
  ].filter(Boolean).join("|");
  await markRaw(true, note);

  return json({
    recebido: true,
    evento_id: payload.evento_id,
    processed: true,
    funcao,
    status_before: statusBefore,
    status_after: statusAfter,
    accumulated_minutes: newAccumulated,
    long_session: !!sessionFlag,
  }, 200);
});
