// guardia-sync-employees: PUSHES local employees to GuardIA via POST/PUT/DELETE /guardiaapi/person.
// Inverted vs. legacy pull: per OpenAPI 1.0.0, external systems own person data; GuardIA receives it.
// remoteid = CPF (our canonical employee key). statusid: 1 ativo, 2 inativo, 3 bloqueado.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Cfg = {
  guardia_url: string; guardia_token: string;
  auth_header_name: string; auth_scheme: string; api_base_path: string;
};
type Employee = {
  id: string; name: string; registration_number: string | null;
  status: string; avatar: string | null; position: string | null;
};

function buildAuthHeaders(cfg: Cfg): Record<string, string> {
  const scheme = (cfg.auth_scheme || "header").toLowerCase();
  if (scheme === "bearer") return { Authorization: `Bearer ${cfg.guardia_token}` };
  return { [cfg.auth_header_name || "X-GuardIA-Token"]: cfg.guardia_token };
}

function mapStatusId(status: string): number {
  if (status === "blocked") return 3;
  if (status === "inactive") return 2;
  return 1;
}

async function guardiaPerson(
  method: "POST" | "PUT" | "DELETE",
  cfg: Cfg, remoteid: string, body?: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; text: string }> {
  const base = cfg.guardia_url.replace(/\/+$/, "");
  const path = (cfg.api_base_path || "/guardiaapi").replace(/\/+$/, "");
  const url = `${base}${path}/person/${encodeURIComponent(remoteid)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const resp = await fetch(url, {
      method,
      headers: { ...buildAuthHeaders(cfg), "Content-Type": "application/json", Accept: "application/json" },
      body: method === "DELETE" ? undefined : JSON.stringify(body ?? {}),
      signal: ctrl.signal,
    });
    const text = await resp.text().catch(() => "");
    return { ok: resp.ok, status: resp.status, text };
  } finally { clearTimeout(t); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const token = authHeader.replace("Bearer ", "");
  const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
  if (claimsErr || !claims?.claims?.sub) return json({ error: "unauthorized" }, 401);
  const userId = claims.claims.sub as string;

  let body: { tenant_id?: string; only_active?: boolean; dry_run?: boolean } = {};
  try { body = await req.json(); } catch { /* empty ok */ }
  const admin = createClient(url, serviceKey);

  let tenantId = body.tenant_id ?? "";
  if (!tenantId) {
    const { data: prof } = await admin.from("profiles").select("tenant_id").eq("user_id", userId).maybeSingle();
    tenantId = prof?.tenant_id ?? "";
  }
  if (!tenantId) return json({ error: "tenant_required" }, 400);

  const { data: canManage, error: permErr } = await admin.rpc("can_manage_tenant", {
    _user_id: userId, _tenant_id: tenantId,
  });
  if (permErr) return json({ error: "server_error" }, 500);
  if (!canManage) return json({ error: "forbidden" }, 403);

  const { data: config } = await admin
    .from("integration_config")
    .select("guardia_url, guardia_token, auth_header_name, auth_scheme, api_base_path, active")
    .eq("tenant_id", tenantId).maybeSingle();
  if (!config?.guardia_url || !config?.guardia_token)
    return json({ error: "integration_not_configured" }, 400);
  const cfg = config as Cfg & { active: boolean };

  const empQuery = admin.from("employees").select("id, name, registration_number, status, avatar, position").eq("tenant_id", tenantId);
  if (body.only_active !== false) empQuery.in("status", ["active"]);
  const { data: employees, error: empErr } = await empQuery;
  if (empErr) return json({ error: "employees_load_failed", message: empErr.message }, 500);

  const normalizeCpf = (v?: string | null) => String(v ?? "").replace(/\D/g, "");
  let created = 0, updated = 0, deleted = 0, skipped = 0;
  const errors: Array<{ remoteid: string; status: number; message: string }> = [];

  for (const e of (employees as Employee[] ?? [])) {
    const remoteid = normalizeCpf(e.registration_number) || normalizeCpf(e.id);
    if (!remoteid || !e.name) { skipped++; continue; }

    const payload = {
      person_name: e.name,
      document: remoteid,
      statusid: mapStatusId(e.status),
      persontypeidintegration: 2,
    };

    if (body.dry_run) { created++; continue; }

    // Try POST; on 409/duplicate, fall back to PUT.
    let r = await guardiaPerson("POST", cfg, remoteid, payload);
    if (r.status === 409 || r.status === 422) {
      r = await guardiaPerson("PUT", cfg, remoteid, payload);
      if (r.ok) updated++;
      else errors.push({ remoteid, status: r.status, message: r.text.slice(0, 300) });
    } else if (r.ok) {
      created++;
    } else if (r.status === 401 || r.status === 403) {
      // auth failure: stop early — credentials wrong
      return json({ error: "guardia_unauthorized", status: r.status, message: "Verifique credenciais/header de autenticação." }, 502);
    } else {
      errors.push({ remoteid, status: r.status, message: r.text.slice(0, 300) });
    }
  }

  // Soft-delete: employees marked inactive in local DB → DELETE in GuardIA (best-effort, behind flag).
  if (body.only_active === false) {
    const inactive = (employees as Employee[] ?? []).filter((e) => e.status !== "active");
    for (const e of inactive) {
      const remoteid = normalizeCpf(e.registration_number) || normalizeCpf(e.id);
      if (!remoteid) continue;
      const r = await guardiaPerson("DELETE", cfg, remoteid);
      if (r.ok || r.status === 404) deleted++;
      else errors.push({ remoteid, status: r.status, message: r.text.slice(0, 300) });
    }
  }

  const nowIso = new Date().toISOString();
  await admin.from("integration_config").update({
    last_push_at: nowIso, last_push_count: created + updated,
  }).eq("tenant_id", tenantId);

  try {
    await admin.from("integration_audit_log").insert({
      tenant_id: tenantId, source: "push",
      severity: errors.length ? "warn" : "info",
      code: errors.length ? "partial_failure" : "ok",
      message: `Push: ${created} criados · ${updated} atualizados · ${deleted} removidos · ${errors.length} erros`,
      details: errors.length ? { errors: errors.slice(0, 20) } : null,
      fetched_count: (employees ?? []).length, processed_count: created + updated + deleted,
    });
  } catch { /* never block */ }

  return json({ pushed: true, created, updated, deleted, skipped, errors, atualizado_em: nowIso });
});
