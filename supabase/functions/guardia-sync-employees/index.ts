// guardia-sync-employees: pulls collaborators from GuardIA and upserts into employees.
// Authenticated: only admins of the tenant can trigger.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type Colaborador = {
  id?: string;
  nome?: string;
  cpf?: string;
  cargo?: string;
  setor?: string;
  foto_url?: string;
  ativo?: boolean;
};

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

  let body: { tenant_id?: string } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  const admin = createClient(url, serviceKey);

  // Resolve tenant_id: body wins, else user's profile.
  let tenantId = body.tenant_id ?? "";
  if (!tenantId) {
    const { data: prof } = await admin.from("profiles").select("tenant_id").eq("user_id", userId).maybeSingle();
    tenantId = prof?.tenant_id ?? "";
  }
  if (!tenantId) return json({ error: "tenant_required" }, 400);

  // Permission check: must be admin of tenant (or super admin).
  const { data: canManage, error: permErr } = await admin.rpc("can_manage_tenant", {
    _user_id: userId, _tenant_id: tenantId,
  });
  if (permErr) { console.error("perm_check_failed", permErr.message); return json({ error: "server_error" }, 500); }
  if (!canManage) return json({ error: "forbidden" }, 403);

  const { data: config, error: cfgErr } = await admin
    .from("integration_config")
    .select("guardia_url, guardia_token, active")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (cfgErr) { console.error("config_load_error", cfgErr.message); return json({ error: "server_error" }, 500); }
  if (!config?.guardia_url || !config?.guardia_token) {
    return json({ error: "integration_not_configured" }, 400);
  }

  // Fetch from GuardIA with timeout.
  const base = config.guardia_url.replace(/\/+$/, "");
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 15000);
  let resp: Response;
  try {
    resp = await fetch(`${base}/api/v1/colaboradores`, {
      method: "GET",
      headers: { "X-GuardIA-Token": config.guardia_token, "Accept": "application/json" },
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timeout);
    const msg = (e as Error).name === "AbortError" ? "guardia_timeout" : "guardia_unreachable";
    return json({ error: msg, message: "Não foi possível conectar ao GuardIA. Verifique URL e disponibilidade." }, 502);
  }
  clearTimeout(timeout);

  if (!resp.ok) {
    return json({ error: "guardia_http_error", status: resp.status, message: `GuardIA respondeu ${resp.status}` }, 502);
  }

  let data: { colaboradores?: Colaborador[]; total?: number };
  try { data = await resp.json(); } catch { return json({ error: "guardia_invalid_response" }, 502); }
  const list = Array.isArray(data?.colaboradores) ? data.colaboradores : [];

  // Defaults for required NOT NULL fields on first import.
  const [{ data: unit }, { data: dept }] = await Promise.all([
    admin.from("units").select("id").eq("tenant_id", tenantId).limit(1).maybeSingle(),
    admin.from("departments").select("id").eq("tenant_id", tenantId).limit(1).maybeSingle(),
  ]);
  if (!unit || !dept) {
    return json({ error: "missing_defaults", message: "Cadastre ao menos uma unidade e um departamento antes de sincronizar." }, 400);
  }

  let imported = 0, updated = 0, skipped = 0;
  const errors: Array<{ id?: string; message: string }> = [];

  for (const c of list) {
    if (!c?.id || !c?.nome) { skipped++; continue; }
    const { data: existing } = await admin
      .from("employees").select("id").eq("tenant_id", tenantId).eq("id", c.id).maybeSingle();

    if (existing) {
      const { error } = await admin.from("employees").update({
        name: c.nome,
        position: c.cargo ?? "",
        avatar: c.foto_url ?? "",
        status: c.ativo === false ? "inactive" : "active",
        origem: "guardia",
        updated_at: new Date().toISOString(),
      }).eq("id", c.id).eq("tenant_id", tenantId);
      if (error) errors.push({ id: c.id, message: error.message }); else updated++;
    } else {
      const { error } = await admin.from("employees").insert({
        id: c.id,
        tenant_id: tenantId,
        unit_id: unit.id,
        department_id: dept.id,
        name: c.nome,
        registration_number: c.cpf ?? c.id,
        position: c.cargo ?? "",
        avatar: c.foto_url ?? "",
        status: c.ativo === false ? "inactive" : "active",
        origem: "guardia",
      });
      if (error) errors.push({ id: c.id, message: error.message }); else imported++;
    }
  }

  const total = imported + updated;
  const nowIso = new Date().toISOString();
  await admin.from("integration_config").update({
    last_sync_at: nowIso,
    last_sync_count: total,
  }).eq("tenant_id", tenantId);

  return json({
    sincronizado: true,
    total,
    imported,
    updated,
    skipped,
    errors,
    atualizado_em: nowIso,
  }, 200);
});
