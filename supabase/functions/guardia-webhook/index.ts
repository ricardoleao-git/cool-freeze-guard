// guardia-webhook: receives access events from GuardIA facial recognition system.
// Public endpoint, but authenticated via X-GuardIA-Token per tenant.
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

// CPF é a chave do colaborador em todo o sistema. Remove pontos, traços e espaços.
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

  // Normaliza CPF do colaborador (chave do sistema).
  const colaboradorCpf = normalizeCpf(payload.colaborador_id);
  if (!colaboradorCpf) return json({ error: "invalid_colaborador_id" }, 400);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(url, serviceKey);

  // Load integration config for tenant and validate token + active flag.
  const { data: config, error: cfgErr } = await supabase
    .from("integration_config")
    .select("guardia_token, active")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (cfgErr) { console.error("config_load_error", cfgErr.message); return json({ error: "server_error" }, 500); }
  if (!config || !config.guardia_token) return json({ error: "unauthorized" }, 401);
  if (!safeEqual(providedToken, config.guardia_token)) return json({ error: "unauthorized" }, 401);
  if (!config.active) return json({ error: "integration_disabled" }, 403);

  // Idempotency: skip if (tenant_id, evento_id) already exists.
  const { data: existing } = await supabase
    .from("guardia_events")
    .select("id, processed")
    .eq("tenant_id", tenantId)
    .eq("evento_id", payload.evento_id!)
    .maybeSingle();

  if (existing) {
    return json({ recebido: true, evento_id: payload.evento_id, duplicate: true }, 200);
  }

  const occurredAt = new Date(payload.timestamp!).toISOString();

  // Insert raw guardia_events row first.
  const { data: rawRow, error: rawErr } = await supabase
    .from("guardia_events")
    .insert({
      tenant_id: tenantId,
      evento_id: payload.evento_id,
      colaborador_id: colaboradorCpf,
      colaborador_nome: payload.colaborador_nome ?? null,
      local_id: payload.local_id,
      local_nome: payload.local_nome ?? null,
      tipo: payload.tipo,
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

  // Resolve employee, cold_area, optional device — all within tenant.
  const [empRes, areaRes, devRes] = await Promise.all([
    supabase.from("employees")
      .select("id, unit_id, current_status, current_area_id, accumulated_minutes")
      .eq("tenant_id", tenantId).eq("id", payload.colaborador_id!).maybeSingle(),
    supabase.from("cold_areas")
      .select("id, unit_id")
      .eq("tenant_id", tenantId).eq("id", payload.local_id!).maybeSingle(),
    payload.dispositivo_id
      ? supabase.from("devices").select("id").eq("tenant_id", tenantId)
          .or(`external_device_id.eq.${payload.dispositivo_id},id.eq.${payload.dispositivo_id}`).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const employee = empRes.data;
  const coldArea = areaRes.data;
  const device = devRes.data;

  if (!employee || !coldArea) {
    const reason = !employee ? "employee_not_found" : "cold_area_not_found";
    console.warn(`guardia event ${payload.evento_id} unmapped: ${reason}`);
    return json({ recebido: true, evento_id: payload.evento_id, processed: false, reason }, 200);
  }

  const eventType = payload.tipo === "entrada" ? "entry" : "exit";

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
    status_before: employee.current_status,
    accumulated_at_event: employee.accumulated_minutes,
  });

  if (aeErr) {
    console.error("access_events_insert_failed", aeErr.message);
    return json({ recebido: true, evento_id: payload.evento_id, processed: false, reason: "access_event_insert_failed" }, 200);
  }

  // Update employee state mirroring ingest-access-event semantics.
  const nowIso = new Date().toISOString();
  if (eventType === "entry") {
    await supabase.from("employees").update({
      current_area_id: coldArea.id,
      current_status: "inside",
      inside_since: occurredAt,
      updated_at: nowIso,
    }).eq("id", employee.id);
  } else {
    await supabase.from("employees").update({
      current_status: "outside",
      inside_since: null,
      updated_at: nowIso,
    }).eq("id", employee.id);
  }

  if (device) {
    await supabase.from("devices").update({ last_seen_at: nowIso }).eq("id", device.id);
  }

  await supabase.from("guardia_events").update({ processed: true }).eq("id", rawRow.id);

  return json({ recebido: true, evento_id: payload.evento_id, processed: true }, 200);
});
