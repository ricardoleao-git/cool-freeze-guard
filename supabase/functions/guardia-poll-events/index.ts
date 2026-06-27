// guardia-poll-events: opportunistic poller for an access-events endpoint.
// Modes:
//   - { tenant_id }                       -> poll one tenant (interactive or single-tenant cron)
//   - { all_active: true }                -> iterate every tenant with active integration (cron fan-out)
//   - { tenant_id, from, to }             -> backfill window (overrides cursor; does NOT advance cursor)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Cfg = {
  tenant_id: string;
  guardia_url: string; guardia_token: string;
  auth_header_name: string; auth_scheme: string;
  api_base_path: string; events_endpoint: string | null;
  last_event_cursor: string | null;
  active: boolean;
};

function authHeaders(cfg: Cfg): Record<string, string> {
  const scheme = (cfg.auth_scheme || "header").toLowerCase();
  if (scheme === "bearer") return { Authorization: `Bearer ${cfg.guardia_token}` };
  return { [cfg.auth_header_name || "X-GuardIA-Token"]: cfg.guardia_token };
}

type RawEvent = {
  id?: string; event_id?: string;
  remoteid?: string; document?: string; cpf?: string;
  person_name?: string; nome?: string;
  device_id?: string; reader_id?: string; dispositivo_id?: string;
  local_id?: string; local_nome?: string;
  type?: string; direction?: string; tipo?: string;
  timestamp?: string; occurred_at?: string; event_timestamp?: string;
};

function normalizeEvent(raw: RawEvent): {
  evento_id: string; colaborador_id: string; tipo: string;
  event_timestamp: string; dispositivo_id: string;
  colaborador_nome: string | null; local_id: string | null; local_nome: string | null;
} | null {
  const evento_id = raw.id || raw.event_id || "";
  const cpf = String(raw.remoteid || raw.document || raw.cpf || "").replace(/\D/g, "");
  const dispositivo_id = raw.device_id || raw.reader_id || raw.dispositivo_id || "";
  const ts = raw.timestamp || raw.occurred_at || raw.event_timestamp || "";
  if (!evento_id || !cpf || !dispositivo_id || !ts) return null;
  const t = String(raw.type || raw.direction || raw.tipo || "").toLowerCase();
  const tipo = t.startsWith("ex") || t === "saida" || t === "out" ? "exit" : "entry";
  return {
    evento_id, colaborador_id: cpf, tipo, event_timestamp: new Date(ts).toISOString(),
    dispositivo_id, colaborador_nome: raw.person_name || raw.nome || null,
    local_id: raw.local_id || null, local_nome: raw.local_nome || null,
  };
}

// deno-lint-ignore no-explicit-any
async function logAudit(admin: any, row: Record<string, unknown>) {
  try { await admin.from("integration_audit_log").insert(row); } catch { /* never block */ }
}

async function pollTenant(
  // deno-lint-ignore no-explicit-any
  admin: any,
  cfg: Cfg,
  opts: { from?: string; to?: string; max?: number; source: string },
): Promise<{ ok: boolean; fetched: number; dispatched: number; skipped: number; staged: number; cursor: string | null; error?: string; code?: string; status?: number }> {
  const started = Date.now();
  const tenantId = cfg.tenant_id;
  const isBackfill = !!(opts.from || opts.to);

  if (!cfg.guardia_url || !cfg.guardia_token) {
    await logAudit(admin, { tenant_id: tenantId, source: opts.source, severity: "error", code: "not_configured", message: "URL/token ausentes" });
    return { ok: false, fetched: 0, dispatched: 0, skipped: 0, staged: 0, cursor: cfg.last_event_cursor, error: "not_configured" };
  }
  if (!cfg.events_endpoint) {
    return { ok: false, fetched: 0, dispatched: 0, skipped: 0, staged: 0, cursor: cfg.last_event_cursor, error: "no_events_endpoint" };
  }

  const base = cfg.guardia_url.replace(/\/+$/, "");
  const ep = cfg.events_endpoint.startsWith("/") ? cfg.events_endpoint : `/${cfg.events_endpoint}`;
  const qs = new URLSearchParams();
  const since = opts.from ?? cfg.last_event_cursor;
  if (since) qs.set("since", since);
  if (opts.to) qs.set("until", opts.to);
  qs.set("limit", String(Math.min(opts.max ?? 200, 1000)));
  const fullUrl = `${base}${ep}?${qs.toString()}`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  let resp: Response;
  try {
    resp = await fetch(fullUrl, { headers: { ...authHeaders(cfg), Accept: "application/json" }, signal: ctrl.signal });
  } catch (e) {
    clearTimeout(t);
    const aborted = (e as Error).name === "AbortError";
    const code = aborted ? "timeout" : "unreachable";
    const msg = aborted ? "Timeout (20s) ao chamar GuardIA" : `Falha de rede: ${(e as Error).message}`;
    await logAudit(admin, {
      tenant_id: tenantId, source: opts.source, severity: "error", code, message: msg,
      details: { url: fullUrl }, cursor_used: since, duration_ms: Date.now() - started,
    });
    await admin.from("integration_config").update({
      last_event_error: msg, last_event_error_at: new Date().toISOString(),
    }).eq("tenant_id", tenantId);
    return { ok: false, fetched: 0, dispatched: 0, skipped: 0, staged: 0, cursor: cfg.last_event_cursor, error: code };
  }
  clearTimeout(t);

  if (resp.status === 401 || resp.status === 403) {
    const msg = `Autenticação recusada pelo GuardIA (HTTP ${resp.status})`;
    await logAudit(admin, {
      tenant_id: tenantId, source: opts.source, severity: "error", code: "auth_failed", message: msg,
      details: { status: resp.status }, cursor_used: since, duration_ms: Date.now() - started,
    });
    await admin.from("integration_config").update({
      last_event_error: msg, last_event_error_at: new Date().toISOString(),
    }).eq("tenant_id", tenantId);
    return { ok: false, fetched: 0, dispatched: 0, skipped: 0, staged: 0, cursor: cfg.last_event_cursor, error: "auth_failed", status: resp.status };
  }
  if (!resp.ok) {
    const msg = `GuardIA respondeu HTTP ${resp.status}`;
    await logAudit(admin, {
      tenant_id: tenantId, source: opts.source, severity: "error", code: "http_error", message: msg,
      details: { status: resp.status }, cursor_used: since, duration_ms: Date.now() - started,
    });
    await admin.from("integration_config").update({
      last_event_error: msg, last_event_error_at: new Date().toISOString(),
    }).eq("tenant_id", tenantId);
    return { ok: false, fetched: 0, dispatched: 0, skipped: 0, staged: 0, cursor: cfg.last_event_cursor, error: "http_error", status: resp.status };
  }

  let payload: unknown;
  try { payload = await resp.json(); } catch {
    const msg = "Resposta inválida (não-JSON)";
    await logAudit(admin, {
      tenant_id: tenantId, source: opts.source, severity: "error", code: "invalid_response", message: msg,
      cursor_used: since, duration_ms: Date.now() - started,
    });
    await admin.from("integration_config").update({
      last_event_error: msg, last_event_error_at: new Date().toISOString(),
    }).eq("tenant_id", tenantId);
    return { ok: false, fetched: 0, dispatched: 0, skipped: 0, staged: 0, cursor: cfg.last_event_cursor, error: "invalid_response" };
  }
  const list: RawEvent[] = Array.isArray(payload)
    ? payload as RawEvent[]
    : (payload as { events?: RawEvent[] })?.events ?? [];

  let staged = 0, dispatched = 0, skipped = 0;
  let latestTs = cfg.last_event_cursor;
  const normalizeErrors: Array<{ raw: unknown; reason: string }> = [];

  for (const raw of list) {
    const ev = normalizeEvent(raw);
    if (!ev) {
      skipped++;
      normalizeErrors.push({ raw, reason: "missing_required_field" });
      continue;
    }
    const { error: insErr } = await admin.from("guardia_events").upsert({
      tenant_id: tenantId,
      evento_id: ev.evento_id,
      colaborador_id: ev.colaborador_id,
      colaborador_nome: ev.colaborador_nome,
      local_id: ev.local_id, local_nome: ev.local_nome,
      tipo: ev.tipo, event_timestamp: ev.event_timestamp,
      dispositivo_id: ev.dispositivo_id, processed: false,
    }, { onConflict: "tenant_id,evento_id" });
    if (insErr) { skipped++; normalizeErrors.push({ raw, reason: insErr.message }); continue; }
    staged++;
    if (!latestTs || ev.event_timestamp > latestTs) latestTs = ev.event_timestamp;

    try {
      const whResp = await admin.functions.invoke("guardia-webhook", {
        body: {
          tenant_id: tenantId,
          evento_id: ev.evento_id,
          colaborador_id: ev.colaborador_id,
          tipo: ev.tipo,
          timestamp: ev.event_timestamp,
          dispositivo_id: ev.dispositivo_id,
        },
      });
      if (!whResp.error) dispatched++;
      else normalizeErrors.push({ raw: ev, reason: `dispatch_failed: ${whResp.error.message ?? "unknown"}` });
    } catch (e) {
      normalizeErrors.push({ raw: ev, reason: `dispatch_exception: ${(e as Error).message}` });
    }
  }

  if (normalizeErrors.length) {
    await logAudit(admin, {
      tenant_id: tenantId, source: opts.source,
      severity: "warn", code: "normalize_or_dispatch_failed",
      message: `${normalizeErrors.length} evento(s) descartado(s) durante normalização/despacho`,
      details: { errors: normalizeErrors.slice(0, 20) },
      cursor_used: since, fetched_count: list.length, processed_count: dispatched,
      duration_ms: Date.now() - started,
    });
  } else {
    await logAudit(admin, {
      tenant_id: tenantId, source: opts.source, severity: "info", code: "ok",
      message: `OK · ${list.length} recebidos · ${dispatched} processados${isBackfill ? " (backfill)" : ""}`,
      cursor_used: since, fetched_count: list.length, processed_count: dispatched,
      duration_ms: Date.now() - started,
    });
  }

  // Backfill does NOT advance the cursor (otherwise it would skip current real-time events).
  const update: Record<string, unknown> = {
    last_event_poll_at: new Date().toISOString(),
    last_event_error: null, last_event_error_at: null,
  };
  if (!isBackfill && latestTs) update.last_event_cursor = latestTs;
  if (dispatched > 0) {
    // increment counter
    update.events_processed_total = (await admin.from("integration_config")
      .select("events_processed_total").eq("tenant_id", tenantId).maybeSingle())
      .data?.events_processed_total ?? 0;
    update.events_processed_total = (update.events_processed_total as number) + dispatched;
  }
  await admin.from("integration_config").update(update).eq("tenant_id", tenantId);

  return { ok: true, fetched: list.length, staged, dispatched, skipped, cursor: latestTs };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const cronKey = Deno.env.get("PURGE_RETENTION_SECRET") || "";
  const admin = createClient(url, serviceKey);

  let body: { tenant_id?: string; max?: number; all_active?: boolean; from?: string; to?: string } = {};
  try { body = await req.json(); } catch { /* */ }

  const cronHeader = req.headers.get("x-cron-key") || "";
  const isCron = cronKey && cronHeader === cronKey;

  // Auth
  if (!isCron) {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: claims } = await userClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    const userId = claims?.claims?.sub as string | undefined;
    if (!userId) return json({ error: "unauthorized" }, 401);
    if (body.all_active) return json({ error: "forbidden_fanout" }, 403);
    const tenantId = body.tenant_id ?? "";
    if (!tenantId) return json({ error: "tenant_required" }, 400);
    const { data: canManage } = await admin.rpc("can_manage_tenant", { _user_id: userId, _tenant_id: tenantId });
    if (!canManage) return json({ error: "forbidden" }, 403);
  }

  // Fan-out (cron)
  if (isCron && body.all_active) {
    const { data: configs } = await admin
      .from("integration_config")
      .select("tenant_id, guardia_url, guardia_token, auth_header_name, auth_scheme, api_base_path, events_endpoint, last_event_cursor, active")
      .eq("active", true)
      .not("events_endpoint", "is", null);
    const results: Array<{ tenant_id: string; ok: boolean; fetched: number; dispatched: number; error?: string }> = [];
    for (const c of (configs ?? []) as Cfg[]) {
      const r = await pollTenant(admin, c, { max: body.max, source: "cron" });
      results.push({ tenant_id: c.tenant_id, ok: r.ok, fetched: r.fetched, dispatched: r.dispatched, error: r.error });
    }
    return json({ fanout: true, tenants: results.length, results });
  }

  // Single tenant
  const tenantId = body.tenant_id!;
  const { data: config } = await admin
    .from("integration_config")
    .select("tenant_id, guardia_url, guardia_token, auth_header_name, auth_scheme, api_base_path, events_endpoint, last_event_cursor, active")
    .eq("tenant_id", tenantId).maybeSingle();
  if (!config) return json({ error: "integration_not_configured" }, 400);

  const isBackfill = !!(body.from || body.to);
  const r = await pollTenant(admin, config as Cfg, {
    max: body.max, from: body.from, to: body.to,
    source: isBackfill ? "backfill" : (isCron ? "cron" : "poll"),
  });
  if (!r.ok && r.error === "no_events_endpoint") {
    return json({ polled: false, reason: "no_events_endpoint", message: "Configure events_endpoint para habilitar o polling." });
  }
  return json({ polled: r.ok, fetched: r.fetched, staged: r.staged, dispatched: r.dispatched, skipped: r.skipped, cursor: r.cursor, error: r.error, status: r.status });
});
