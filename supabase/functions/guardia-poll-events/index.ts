// guardia-poll-events: opportunistic poller for an access-events endpoint.
// The published GuardIA OpenAPI 1.0.0 does NOT document an events history endpoint —
// this function calls a configurable `events_endpoint` (per-tenant) and degrades gracefully
// when absent. Each fetched event is staged into guardia_events and then mapped into
// access_events through the existing webhook ingestion logic (state machine in guardia-webhook).
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const cronKey = Deno.env.get("PURGE_RETENTION_SECRET") || "";
  const admin = createClient(url, serviceKey);

  // Two callers allowed: scheduled cron (x-cron-key header) OR an authenticated tenant admin.
  let tenantId = "";
  let body: { tenant_id?: string; max?: number } = {};
  try { body = await req.json(); } catch { /* */ }

  const cronHeader = req.headers.get("x-cron-key") || "";
  const isCron = cronKey && cronHeader === cronKey;

  if (!isCron) {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: claims } = await userClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    const userId = claims?.claims?.sub as string | undefined;
    if (!userId) return json({ error: "unauthorized" }, 401);
    tenantId = body.tenant_id ?? "";
    if (!tenantId) {
      const { data: prof } = await admin.from("profiles").select("tenant_id").eq("user_id", userId).maybeSingle();
      tenantId = prof?.tenant_id ?? "";
    }
    const { data: canManage } = await admin.rpc("can_manage_tenant", { _user_id: userId, _tenant_id: tenantId });
    if (!canManage) return json({ error: "forbidden" }, 403);
  } else {
    tenantId = body.tenant_id ?? "";
    if (!tenantId) return json({ error: "tenant_required" }, 400);
  }

  const { data: config } = await admin
    .from("integration_config")
    .select("tenant_id, guardia_url, guardia_token, auth_header_name, auth_scheme, api_base_path, events_endpoint, last_event_cursor, active")
    .eq("tenant_id", tenantId).maybeSingle();
  if (!config?.guardia_url || !config?.guardia_token) return json({ error: "integration_not_configured" }, 400);
  if (!config.events_endpoint) {
    return json({
      polled: false, reason: "no_events_endpoint",
      message: "OpenAPI 1.0.0 não documenta endpoint de histórico de eventos. Configure events_endpoint se a sua instância expõe uma extensão.",
    }, 200);
  }
  const cfg = config as Cfg & { active: boolean };

  const base = cfg.guardia_url.replace(/\/+$/, "");
  const ep = cfg.events_endpoint.startsWith("/") ? cfg.events_endpoint : `/${cfg.events_endpoint}`;
  const qs = new URLSearchParams();
  if (cfg.last_event_cursor) qs.set("since", cfg.last_event_cursor);
  qs.set("limit", String(Math.min(body.max ?? 200, 1000)));
  const fullUrl = `${base}${ep}?${qs.toString()}`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  let resp: Response;
  try {
    resp = await fetch(fullUrl, { headers: { ...authHeaders(cfg), Accept: "application/json" }, signal: ctrl.signal });
  } catch (e) {
    clearTimeout(t);
    return json({ error: (e as Error).name === "AbortError" ? "guardia_timeout" : "guardia_unreachable" }, 502);
  }
  clearTimeout(t);
  if (!resp.ok) return json({ error: "guardia_http_error", status: resp.status }, 502);

  let payload: unknown;
  try { payload = await resp.json(); } catch { return json({ error: "guardia_invalid_response" }, 502); }
  const list: RawEvent[] = Array.isArray(payload)
    ? payload as RawEvent[]
    : (payload as { events?: RawEvent[] })?.events ?? [];

  let staged = 0, dispatched = 0, skipped = 0;
  let latestTs = cfg.last_event_cursor;

  for (const raw of list) {
    const ev = normalizeEvent(raw);
    if (!ev) { skipped++; continue; }
    // Upsert into staging table (evento_id unique per tenant).
    const { error: insErr } = await admin.from("guardia_events").upsert({
      tenant_id: tenantId,
      evento_id: ev.evento_id,
      colaborador_id: ev.colaborador_id,
      colaborador_nome: ev.colaborador_nome,
      local_id: ev.local_id, local_nome: ev.local_nome,
      tipo: ev.tipo, event_timestamp: ev.event_timestamp,
      dispositivo_id: ev.dispositivo_id, processed: false,
    }, { onConflict: "tenant_id,evento_id" });
    if (insErr) { skipped++; continue; }
    staged++;
    if (!latestTs || ev.event_timestamp > latestTs) latestTs = ev.event_timestamp;

    // Dispatch through existing webhook to reuse state-machine + forensic chain.
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
    } catch { /* leave processed=false; next poll retries */ }
  }

  await admin.from("integration_config").update({
    last_event_poll_at: new Date().toISOString(),
    last_event_cursor: latestTs,
  }).eq("tenant_id", tenantId);

  return json({ polled: true, fetched: list.length, staged, dispatched, skipped, cursor: latestTs });
});
