// Purga agendada por tenant respeitando as políticas de retenção (LGPD).
// Roda com service_role para conseguir remover registros imutáveis de access_events
// (o trigger access_events_immutable libera DELETE para service_role).
//
// Evidência auditável: cada execução grava uma linha em retention_purge_log
// com contagens, janelas de corte e snapshot das políticas aplicadas.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type TenantSettings = {
  tenant_id: string;
  biometric_retention_days: number;
  logs_retention_days: number;
  occurrences_retention_days: number;
};

function cutoff(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

async function purgeForTenant(
  admin: ReturnType<typeof createClient>,
  s: TenantSettings,
  triggeredBy: string,
) {
  const cutoffLogs = cutoff(s.logs_retention_days);
  const cutoffBio = cutoff(s.biometric_retention_days);
  const cutoffOcc = cutoff(s.occurrences_retention_days);

  const result = {
    tenant_id: s.tenant_id,
    triggered_by: triggeredBy,
    cutoff_logs: cutoffLogs,
    cutoff_biometric: cutoffBio,
    cutoff_occurrences: cutoffOcc,
    policy: {
      biometric_retention_days: s.biometric_retention_days,
      logs_retention_days: s.logs_retention_days,
      occurrences_retention_days: s.occurrences_retention_days,
    },
    deleted_access_events: 0,
    deleted_alerts: 0,
    deleted_thermal_breaks: 0,
    deleted_occurrences: 0,
    deleted_consents: 0,
    status: "ok" as "ok" | "partial" | "error",
    notes: {} as Record<string, unknown>,
    errors: [] as string[],
  };

  // 1) access_events (imutáveis; service_role bypass via trigger)
  {
    const { data, error } = await admin
      .from("access_events")
      .delete({ count: "exact" })
      .eq("tenant_id", s.tenant_id)
      .lt("occurred_at", cutoffLogs)
      .select("id");
    if (error) result.errors.push(`access_events: ${error.message}`);
    else result.deleted_access_events = data?.length ?? 0;
  }

  // 2) alerts
  {
    const { data, error } = await admin
      .from("alerts")
      .delete({ count: "exact" })
      .eq("tenant_id", s.tenant_id)
      .lt("triggered_at", cutoffLogs)
      .in("status", ["acknowledged", "resolved"])
      .select("id");
    if (error) result.errors.push(`alerts: ${error.message}`);
    else result.deleted_alerts = data?.length ?? 0;
  }

  // 3) thermal_breaks
  {
    const { data, error } = await admin
      .from("thermal_breaks")
      .delete({ count: "exact" })
      .eq("tenant_id", s.tenant_id)
      .lt("started_at", cutoffLogs)
      .select("id");
    if (error) result.errors.push(`thermal_breaks: ${error.message}`);
    else result.deleted_thermal_breaks = data?.length ?? 0;
  }

  // 4) occurrences resolvidas (mantém ocorrências abertas para auditoria)
  {
    const { data, error } = await admin
      .from("occurrences")
      .delete({ count: "exact" })
      .eq("tenant_id", s.tenant_id)
      .lt("created_at", cutoffOcc)
      .eq("status", "resolved")
      .select("id");
    if (error) result.errors.push(`occurrences: ${error.message}`);
    else result.deleted_occurrences = data?.length ?? 0;
  }

  // 5) employee_consents revogados (apenas revogados antigos; ativos permanecem como base legal)
  {
    const { data, error } = await admin
      .from("employee_consents")
      .delete({ count: "exact" })
      .eq("tenant_id", s.tenant_id)
      .eq("status", "revoked")
      .lt("revoked_at", cutoffBio)
      .select("id");
    if (error) result.errors.push(`employee_consents: ${error.message}`);
    else result.deleted_consents = data?.length ?? 0;
  }

  if (result.errors.length > 0) {
    result.status = (
      result.deleted_access_events +
        result.deleted_alerts +
        result.deleted_thermal_breaks +
        result.deleted_occurrences +
        result.deleted_consents >
        0
        ? "partial"
        : "error"
    );
    result.notes = { errors: result.errors };
  }

  // Grava trilha auditável
  const { error: logErr } = await admin.from("retention_purge_log").insert({
    tenant_id: result.tenant_id,
    triggered_by: result.triggered_by,
    cutoff_logs: result.cutoff_logs,
    cutoff_biometric: result.cutoff_biometric,
    cutoff_occurrences: result.cutoff_occurrences,
    policy: result.policy,
    deleted_access_events: result.deleted_access_events,
    deleted_alerts: result.deleted_alerts,
    deleted_thermal_breaks: result.deleted_thermal_breaks,
    deleted_occurrences: result.deleted_occurrences,
    deleted_consents: result.deleted_consents,
    status: result.status,
    notes: result.notes,
  });
  if (logErr) console.error("retention_purge_log insert failed", logErr);

  return result;
}

function unauthorized(msg = "unauthorized") {
  return new Response(JSON.stringify({ error: msg }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  let body: { tenant_id?: string; triggered_by?: string; dry_run?: boolean } =
    {};
  try {
    if (req.method === "POST") body = await req.json().catch(() => ({}));
  } catch (_) { /* ignore */ }

  // Autorização: aceita (a) header X-Purge-Secret para chamadas de cron
  // OU (b) JWT válido de um usuário com papel super_admin. Em ambos os casos
  // o campo triggered_by é derivado da identidade, nunca do corpo.
  const cronSecret = Deno.env.get("PURGE_RETENTION_SECRET") ?? "";
  const providedSecret =
    req.headers.get("x-purge-secret") ?? req.headers.get("X-Purge-Secret") ?? "";
  let triggeredBy: string;
  if (cronSecret && providedSecret && safeEqual(providedSecret, cronSecret)) {
    triggeredBy = "cron";
  } else {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return unauthorized();
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authed = createClient(SUPABASE_URL, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await authed.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) return unauthorized();
    const userId = claims.claims.sub as string;
    const { data: isSuper, error: roleErr } = await admin.rpc("is_super_admin", {
      _user_id: userId,
    });
    if (roleErr || !isSuper) return unauthorized("forbidden");
    triggeredBy = `user:${userId}`;
  }

  // Lista tenants alvo
  let query = admin
    .from("tenant_settings")
    .select(
      "tenant_id, biometric_retention_days, logs_retention_days, occurrences_retention_days",
    );
  if (body.tenant_id) query = query.eq("tenant_id", body.tenant_id);
  const { data: tenants, error } = await query;

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (body.dry_run) {
    return new Response(
      JSON.stringify({
        dry_run: true,
        tenants_targeted: (tenants ?? []).length,
        cutoffs: (tenants ?? []).map((t) => ({
          tenant_id: t.tenant_id,
          cutoff_logs: cutoff(t.logs_retention_days),
          cutoff_biometric: cutoff(t.biometric_retention_days),
          cutoff_occurrences: cutoff(t.occurrences_retention_days),
        })),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const results = [];
  for (const t of tenants ?? []) {
    try {
      results.push(await purgeForTenant(admin, t as TenantSettings, triggeredBy));
    } catch (e) {
      results.push({
        tenant_id: (t as TenantSettings).tenant_id,
        status: "error",
        error: (e as Error).message,
      });
    }
  }

  return new Response(
    JSON.stringify({ ok: true, processed: results.length, results }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
