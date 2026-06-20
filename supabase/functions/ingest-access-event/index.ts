// Simulated webhook/API ingestion for facial reader devices.
// Accepts a POST payload, validates it against the registered devices/employees/areas,
// inserts an access_event, and updates the employee's current status accordingly.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Payload = {
  tenant_id?: string;
  device_id?: string;            // external_device_id OR id
  employee_external_id?: string; // matches employees.registration_number OR employees.id
  event_type?: "entry" | "exit";
  timestamp?: string;            // ISO
  confidence_score?: number;
  api_key?: string;              // optional for demo
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Helper de comparação resistente a timing attacks.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Autenticação obrigatória: a chave do dispositivo deve corresponder ao segredo
  // configurado em DEVICE_INGEST_API_KEY. Sem isso, qualquer pessoa poderia
  // injetar eventos biométricos falsos no audit trail.
  const expectedKey = Deno.env.get("DEVICE_INGEST_API_KEY") ?? "";
  if (!expectedKey) {
    console.error("DEVICE_INGEST_API_KEY não configurado; rejeitando requisição");
    return json({ error: "server_misconfigured" }, 503);
  }
  const providedKey =
    req.headers.get("x-api-key") ??
    req.headers.get("X-Api-Key") ??
    "";
  if (!providedKey || !safeEqual(providedKey, expectedKey)) {
    return json({ error: "unauthorized" }, 401);
  }

  let payload: Payload;
  try { payload = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const errors: string[] = [];
  if (!payload.tenant_id) errors.push("tenant_id required");
  if (!payload.device_id) errors.push("device_id required");
  if (!payload.employee_external_id) errors.push("employee_external_id required");
  if (!payload.event_type || !["entry", "exit"].includes(payload.event_type)) errors.push("event_type must be entry|exit");
  if (errors.length) return json({ error: "validation_failed", details: errors }, 400);

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(url, key);

  // Resolve device (by external_device_id or id) scoped to tenant.
  const { data: devices } = await supabase
    .from("devices")
    .select("id, tenant_id, unit_id, cold_area_id, external_device_id, status")
    .eq("tenant_id", payload.tenant_id!)
    .or(`external_device_id.eq.${payload.device_id},id.eq.${payload.device_id}`)
    .limit(1);
  const device = devices?.[0];
  if (!device) return json({ error: "device_not_found", device_id: payload.device_id }, 404);
  if (device.status !== "online") return json({ error: "device_offline" }, 409);

  // Resolve employee.
  const { data: emps } = await supabase
    .from("employees")
    .select("id, tenant_id, unit_id, current_status, current_area_id, accumulated_minutes")
    .eq("tenant_id", payload.tenant_id!)
    .or(`registration_number.eq.${payload.employee_external_id},id.eq.${payload.employee_external_id}`)
    .limit(1);
  const employee = emps?.[0];
  if (!employee) return json({ error: "employee_not_found", employee_external_id: payload.employee_external_id }, 404);

  // LGPD: bloqueia captura biométrica quando consentimento estiver pendente, desatualizado ou revogado.
  if (payload.event_type === "entry") {
    const { data: settingsRow } = await supabase
      .from("tenant_settings")
      .select("require_consent_before_capture, consent_version")
      .eq("tenant_id", payload.tenant_id!)
      .maybeSingle();
    const requireConsent = settingsRow?.require_consent_before_capture !== false;
    const currentVersion = Number(settingsRow?.consent_version ?? 1);
    if (requireConsent) {
      const { data: consentRows } = await supabase
        .from("employee_consents")
        .select("status, consent_version, accepted_at")
        .eq("tenant_id", payload.tenant_id!)
        .eq("employee_id", employee.id)
        .order("accepted_at", { ascending: false })
        .limit(1);
      const latest = consentRows?.[0];
      let consent_status: "missing" | "outdated" | "revoked" | "ok" = "ok";
      if (!latest) consent_status = "missing";
      else if (latest.status === "revoked") consent_status = "revoked";
      else if (Number(latest.consent_version) < currentVersion) consent_status = "outdated";
      if (consent_status !== "ok") {
        // Registra evento rejeitado para trilha forense, mas não altera estado do colaborador.
        await supabase.from("access_events").insert({
          tenant_id: payload.tenant_id,
          unit_id: device.unit_id,
          cold_area_id: device.cold_area_id,
          device_id: device.id,
          employee_id: employee.id,
          event_type: payload.event_type,
          source: "device_api",
          occurred_at: payload.timestamp ? new Date(payload.timestamp).toISOString() : new Date().toISOString(),
          validation_status: "rejected",
          confidence_score: typeof payload.confidence_score === "number" ? payload.confidence_score : 0.95,
          status_before: employee.current_status,
          status_after: employee.current_status,
          accumulated_at_event: employee.accumulated_minutes,
        });
        return json({
          error: "consent_required",
          consent_status,
          message: `Captura bloqueada por LGPD: ${consent_status}.`,
        }, 451); // 451 Unavailable For Legal Reasons
      }
    }
  }


  const conf = typeof payload.confidence_score === "number" ? payload.confidence_score : 0.95;
  const occurredAt = payload.timestamp ? new Date(payload.timestamp).toISOString() : new Date().toISOString();

  // Business validation: block re-entry while on thermal break or blocked.
  let validation_status: "valid" | "rejected" | "needs_review" = "valid";
  let reject_reason: string | undefined;
  if (payload.event_type === "entry") {
    if (employee.current_status === "blocked" || employee.current_status === "thermal_break") {
      validation_status = "rejected";
      reject_reason = `employee in status ${employee.current_status}`;
    }
  } else if (payload.event_type === "exit" && !employee.current_area_id) {
    validation_status = "needs_review";
    reject_reason = "exit without active entry";
  }
  if (conf < 0.6) { validation_status = "needs_review"; reject_reason = reject_reason || "low confidence"; }

  // Insert event.
  const { data: evRow, error: evErr } = await supabase.from("access_events").insert({
    tenant_id: payload.tenant_id,
    unit_id: device.unit_id,
    cold_area_id: device.cold_area_id,
    device_id: device.id,
    employee_id: employee.id,
    event_type: payload.event_type,
    source: "device_api",
    occurred_at: occurredAt,
    validation_status,
    confidence_score: conf,
  }).select().single();
  if (evErr) return json({ error: "insert_failed", message: evErr.message }, 500);

  // Apply employee state when accepted.
  if (validation_status === "valid") {
    if (payload.event_type === "entry") {
      await supabase.from("employees").update({
        current_area_id: device.cold_area_id,
        current_status: "inside",
        inside_since: occurredAt,
        updated_at: new Date().toISOString(),
      }).eq("id", employee.id);
    } else {
      await supabase.from("employees").update({
        current_status: "outside",
        inside_since: null,
        updated_at: new Date().toISOString(),
      }).eq("id", employee.id);
    }
  }

  // Touch device last_seen.
  await supabase.from("devices").update({ last_seen_at: new Date().toISOString() }).eq("id", device.id);

  return json({
    ok: true,
    event: evRow,
    validation_status,
    reject_reason,
    resolved: {
      device_id: device.id,
      employee_id: employee.id,
      cold_area_id: device.cold_area_id,
      unit_id: device.unit_id,
    },
  }, validation_status === "rejected" ? 422 : 201);
});
