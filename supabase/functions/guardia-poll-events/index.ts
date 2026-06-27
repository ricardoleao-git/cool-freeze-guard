// guardia-poll-events: poller + backfill + connection test for GuardIA.
// Modes:
//   - { tenant_id }                       -> poll one tenant
//   - { all_active: true } (cron)         -> iterate every tenant with active integration
//   - { tenant_id, from, to }             -> backfill window (does NOT advance cursor)
//   - { tenant_id, test_only: true }      -> probe auth + events_endpoint, write audit log
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

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * fetch with exponential backoff for timeout/unreachable.
 * Retries: attempt 1 (0ms), 2 (500ms), 3 (1500ms), 4 (3500ms). Auth/HTTP errors are NOT retried.
 */
async function fetchWithBackoff(
  url: string, init: RequestInit, timeoutMs = 20000, maxAttempts = 4,
): Promise<{ resp?: Response; error?: { code: "timeout" | "unreachable"; message: string; attempts: number } }> {
  let lastErr: { code: "timeout" | "unreachable"; message: string } | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { ...init, signal: ctrl.signal });
      clearTimeout(t);
      return { resp };
    } catch (e) {
      clearTimeout(t);
      const aborted = (e as Error).name === "AbortError";
      lastErr = aborted
        ? { code: "timeout", message: `Timeout (${timeoutMs}ms) ao chamar GuardIA` }
        : { code: "unreachable", message: `Falha de rede: ${(e as Error).message}` };
      if (attempt < maxAttempts) await sleep(500 * Math.pow(2, attempt - 1));
    }
  }
  return { error: { ...(lastErr ?? { code: "unreachable", message: "unknown" }), attempts: maxAttempts } };
}

async function pollTenant(
  // deno-lint-ignore no-explicit-any
  admin: any,
  cfg: Cfg,
  opts: { from?: string; to?: string; max?: number; source: string },
): Promise<{ ok: boolean; fetched: number; dispatched: number; skipped: number; deduped: number; staged: number; cursor: string | null; error?: string; code?: string; status?: number }> {
  const started = Date.now();
  const tenantId = cfg.tenant_id;
  const isBackfill = !!(opts.from || opts.to);

  if (!cfg.guardia_url || !cfg.guardia_token) {
    await logAudit(admin, { tenant_id: tenantId, source: opts.source, severity: "error", code: "not_configured", message: "URL/token ausentes" });
    return { ok: false, fetched: 0, dispatched: 0, skipped: 0, deduped: 0, staged: 0, cursor: cfg.last_event_cursor, error: "not_configured" };
  }
  if (!cfg.events_endpoint) {
    return { ok: false, fetched: 0, dispatched: 0, skipped: 0, deduped: 0, staged: 0, cursor: cfg.last_event_cursor, error: "no_events_endpoint" };
  }

  const base = cfg.guardia_url.replace(/\/+$/, "");
  const ep = cfg.events_endpoint.startsWith("/") ? cfg.events_endpoint : `/${cfg.events_endpoint}`;
  const qs = new URLSearchParams();
  const since = opts.from ?? cfg.last_event_cursor;
  if (since) qs.set("since", since);
  if (opts.to) qs.set("until", opts.to);
  const capped = Math.min(opts.max ?? 200, 1000);
  qs.set("limit", String(capped));
  const fullUrl = `${base}${ep}?${qs.toString()}`;

  const { resp, error: netErr } = await fetchWithBackoff(
    fullUrl, { headers: { ...authHeaders(cfg), Accept: "application/json" } },
  );

  if (netErr) {
    await logAudit(admin, {
      tenant_id: tenantId, source: opts.source, severity: "error", code: netErr.code, message: netErr.message,
      details: { url: fullUrl, attempts: netErr.attempts }, cursor_used: since, duration_ms: Date.now() - started,
    });
    await admin.from("integration_config").update({
      last_event_error: `${netErr.message} (após ${netErr.attempts} tentativas)`,
      last_event_error_at: new Date().toISOString(),
    }).eq("tenant_id", tenantId);
    return { ok: false, fetched: 0, dispatched: 0, skipped: 0, deduped: 0, staged: 0, cursor: cfg.last_event_cursor, error: netErr.code };
  }

  if (resp!.status === 401 || resp!.status === 403) {
    const msg = `Autenticação recusada pelo GuardIA (HTTP ${resp!.status})`;
    await logAudit(admin, {
      tenant_id: tenantId, source: opts.source, severity: "error", code: "auth_failed", message: msg,
      details: { status: resp!.status }, cursor_used: since, duration_ms: Date.now() - started,
    });
    await admin.from("integration_config").update({
      last_event_error: msg, last_event_error_at: new Date().toISOString(),
    }).eq("tenant_id", tenantId);
    return { ok: false, fetched: 0, dispatched: 0, skipped: 0, deduped: 0, staged: 0, cursor: cfg.last_event_cursor, error: "auth_failed", status: resp!.status };
  }
  if (!resp!.ok) {
    const msg = `GuardIA respondeu HTTP ${resp!.status}`;
    await logAudit(admin, {
      tenant_id: tenantId, source: opts.source, severity: "error", code: "http_error", message: msg,
      details: { status: resp!.status }, cursor_used: since, duration_ms: Date.now() - started,
    });
    await admin.from("integration_config").update({
      last_event_error: msg, last_event_error_at: new Date().toISOString(),
    }).eq("tenant_id", tenantId);
    return { ok: false, fetched: 0, dispatched: 0, skipped: 0, deduped: 0, staged: 0, cursor: cfg.last_event_cursor, error: "http_error", status: resp!.status };
  }

  let payload: unknown;
  try { payload = await resp!.json(); } catch {
    const msg = "Resposta inválida (não-JSON)";
    await logAudit(admin, {
      tenant_id: tenantId, source: opts.source, severity: "error", code: "invalid_response", message: msg,
      cursor_used: since, duration_ms: Date.now() - started,
    });
    await admin.from("integration_config").update({
      last_event_error: msg, last_event_error_at: new Date().toISOString(),
    }).eq("tenant_id", tenantId);
    return { ok: false, fetched: 0, dispatched: 0, skipped: 0, deduped: 0, staged: 0, cursor: cfg.last_event_cursor, error: "invalid_response" };
  }
  const list: RawEvent[] = Array.isArray(payload)
    ? payload as RawEvent[]
    : (payload as { events?: RawEvent[] })?.events ?? [];

  // --- Idempotent dedup: discover which evento_ids already exist for this tenant ---
  const incomingIds = Array.from(new Set(
    list.map(r => r.id || r.event_id || "").filter(Boolean) as string[]
  ));
  const knownIds = new Set<string>();
  if (incomingIds.length) {
    // chunk to avoid extremely long IN-lists
    const chunkSize = 200;
    for (let i = 0; i < incomingIds.length; i += chunkSize) {
      const chunk = incomingIds.slice(i, i + chunkSize);
      const { data: existing } = await admin
        .from("guardia_events")
        .select("evento_id")
        .eq("tenant_id", tenantId)
        .in("evento_id", chunk);
      (existing ?? []).forEach((r: { evento_id: string }) => knownIds.add(r.evento_id));
    }
  }

  let staged = 0, dispatched = 0, skipped = 0, deduped = 0;
  let latestTs = cfg.last_event_cursor;
  const normalizeErrors: Array<{ raw: unknown; reason: string }> = [];
  const dedupSamples: Array<{ evento_id: string; remoteid: string; dispositivo_id: string; reason: string }> = [];
  const dedupReasonCounts: Record<string, number> = {};

  for (const raw of list) {
    const ev = normalizeEvent(raw);
    if (!ev) {
      skipped++;
      normalizeErrors.push({ raw, reason: "missing_required_field" });
      continue;
    }
    if (!latestTs || ev.event_timestamp > latestTs) latestTs = ev.event_timestamp;

    // Idempotent: skip events we've already ingested (dedup by tenant_id+evento_id).
    if (knownIds.has(ev.evento_id)) {
      deduped++;
      const reason = "already_ingested";
      dedupReasonCounts[reason] = (dedupReasonCounts[reason] ?? 0) + 1;
      if (dedupSamples.length < 25) {
        dedupSamples.push({
          evento_id: ev.evento_id,
          remoteid: ev.colaborador_id,
          dispositivo_id: ev.dispositivo_id,
          reason,
        });
      }
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
    }, { onConflict: "tenant_id,evento_id", ignoreDuplicates: false });
    if (insErr) { skipped++; normalizeErrors.push({ raw, reason: insErr.message }); continue; }
    staged++;

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
      details: { errors: normalizeErrors.slice(0, 20), deduped, capped, dedup_samples: dedupSamples, dedup_reason_counts: dedupReasonCounts },
      cursor_used: since, fetched_count: list.length, processed_count: dispatched,
      duration_ms: Date.now() - started,
    });
  } else {
    await logAudit(admin, {
      tenant_id: tenantId, source: opts.source, severity: "info", code: "ok",
      message: `OK · ${list.length} recebidos · ${dispatched} processados · ${deduped} duplicados ignorados${isBackfill ? " (backfill)" : ""}`,
      details: { deduped, capped, dedup_samples: dedupSamples, dedup_reason_counts: dedupReasonCounts },
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
    const cur = (await admin.from("integration_config")
      .select("events_processed_total").eq("tenant_id", tenantId).maybeSingle())
      .data?.events_processed_total ?? 0;
    update.events_processed_total = cur + dispatched;
  }
  await admin.from("integration_config").update(update).eq("tenant_id", tenantId);

  return { ok: true, fetched: list.length, staged, dispatched, skipped, deduped, cursor: latestTs };
}

// --- Connection test: probe auth + events_endpoint, audit-log result ---
async function testConnection(
  // deno-lint-ignore no-explicit-any
  admin: any, cfg: Cfg, source: string,
) {
  const started = Date.now();
  const tenantId = cfg.tenant_id;
  const base = cfg.guardia_url.replace(/\/+$/, "");
  const apiPath = (cfg.api_base_path || "/guardiaapi").replace(/\/+$/, "");

  const result: {
    auth: { ok: boolean; status?: number; code?: string; message?: string };
    events: { ok: boolean; configured: boolean; status?: number; code?: string; message?: string };
  } = {
    auth: { ok: false },
    events: { ok: false, configured: !!cfg.events_endpoint },
  };

  // 1) Auth probe via /person/__connectivity_probe__
  if (!cfg.guardia_url || !cfg.guardia_token) {
    result.auth = { ok: false, code: "not_configured", message: "URL/token ausentes" };
  } else {
    const probeUrl = `${base}${apiPath}/person/__connectivity_probe__`;
    const { resp, error } = await fetchWithBackoff(probeUrl, {
      method: "GET", headers: { ...authHeaders(cfg), Accept: "application/json" },
    }, 10000, 2);
    if (error) result.auth = { ok: false, code: error.code, message: error.message };
    else if (resp!.status === 401 || resp!.status === 403)
      result.auth = { ok: false, status: resp!.status, code: "auth_failed", message: `Auth recusada (HTTP ${resp!.status})` };
    else if (resp!.status >= 200 && resp!.status < 500)
      result.auth = { ok: true, status: resp!.status, message: `Conexão OK (HTTP ${resp!.status})` };
    else
      result.auth = { ok: false, status: resp!.status, code: "http_error", message: `HTTP ${resp!.status}` };
  }

  // 2) Events endpoint probe (HEAD-ish GET with limit=1)
  if (cfg.events_endpoint) {
    const ep = cfg.events_endpoint.startsWith("/") ? cfg.events_endpoint : `/${cfg.events_endpoint}`;
    const evUrl = `${base}${ep}?limit=1`;
    const { resp, error } = await fetchWithBackoff(evUrl, {
      method: "GET", headers: { ...authHeaders(cfg), Accept: "application/json" },
    }, 10000, 2);
    if (error) result.events = { ...result.events, ok: false, code: error.code, message: error.message };
    else if (resp!.status === 401 || resp!.status === 403)
      result.events = { ...result.events, ok: false, status: resp!.status, code: "auth_failed", message: `Auth recusada no events_endpoint (HTTP ${resp!.status})` };
    else if (resp!.status >= 200 && resp!.status < 300)
      result.events = { ...result.events, ok: true, status: resp!.status, message: `events_endpoint OK (HTTP ${resp!.status})` };
    else if (resp!.status === 404)
      result.events = { ...result.events, ok: false, status: 404, code: "http_error", message: "events_endpoint não encontrado (HTTP 404)" };
    else
      result.events = { ...result.events, ok: false, status: resp!.status, code: "http_error", message: `events_endpoint HTTP ${resp!.status}` };
  }

  const overallOk = result.auth.ok && (!result.events.configured || result.events.ok);
  await logAudit(admin, {
    tenant_id: tenantId, source, severity: overallOk ? "info" : "warn",
    code: overallOk ? "ok" : (result.auth.code || result.events.code || "test_failed"),
    message: `Teste de conexão · auth: ${result.auth.message || "—"} · eventos: ${result.events.configured ? (result.events.message || "—") : "não configurado"}`,
    details: result, duration_ms: Date.now() - started,
  });

  return { ok: overallOk, ...result };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const cronKey = Deno.env.get("GUARDIA_CRON_KEY") || Deno.env.get("PURGE_RETENTION_SECRET") || "";
  const admin = createClient(url, serviceKey);

  let body: { tenant_id?: string; max?: number; all_active?: boolean; from?: string; to?: string; test_only?: boolean } = {};
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
    const results: Array<{ tenant_id: string; ok: boolean; fetched: number; dispatched: number; deduped: number; error?: string }> = [];
    for (const c of (configs ?? []) as Cfg[]) {
      const r = await pollTenant(admin, c, { max: body.max, source: "cron" });
      results.push({ tenant_id: c.tenant_id, ok: r.ok, fetched: r.fetched, dispatched: r.dispatched, deduped: r.deduped, error: r.error });
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

  // Test-only mode (no polling, no cursor change)
  if (body.test_only) {
    const r = await testConnection(admin, config as Cfg, "test_connection");
    return json({ test: true, ...r });
  }

  const isBackfill = !!(body.from || body.to);
  const r = await pollTenant(admin, config as Cfg, {
    max: body.max, from: body.from, to: body.to,
    source: isBackfill ? "backfill" : (isCron ? "cron" : "poll"),
  });
  if (!r.ok && r.error === "no_events_endpoint") {
    return json({ polled: false, reason: "no_events_endpoint", message: "Configure events_endpoint para habilitar o polling." });
  }
  return json({
    polled: r.ok, fetched: r.fetched, staged: r.staged, dispatched: r.dispatched,
    deduped: r.deduped, skipped: r.skipped, cursor: r.cursor, error: r.error, status: r.status,
  });
});
