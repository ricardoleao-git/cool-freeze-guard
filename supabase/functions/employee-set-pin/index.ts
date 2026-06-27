// employee-set-pin: defines/resets an employee's PIN.
// Auth: requires tenant admin (can_manage_tenant).
// Hashing: PBKDF2-SHA256 via _shared/pin.ts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { hashPin, validatePinFormat } from "../_shared/pin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes?.user) return json({ error: "unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const { tenant_id, employee_id, pin } = body ?? {};
  if (!tenant_id || !employee_id) return json({ error: "missing_fields" }, 400);
  if (!validatePinFormat(pin)) return json({ error: "invalid_pin_format", message: "PIN deve conter de 4 a 8 dígitos numéricos" }, 400);

  const supabase = createClient(url, service);
  const { data: canManage } = await supabase.rpc("can_manage_tenant", { _user_id: userRes.user.id, _tenant_id: tenant_id });
  if (!canManage) return json({ error: "forbidden" }, 403);

  const { data: emp } = await supabase.from("employees").select("id").eq("id", employee_id).eq("tenant_id", tenant_id).maybeSingle();
  if (!emp) return json({ error: "employee_not_found" }, 404);

  try {
    const pin_hash = await hashPin(pin);
    const { error } = await supabase.from("employees").update({
      pin_hash, pin_set_at: new Date().toISOString(),
      pin_failed_attempts: 0, pin_locked_until: null,
    }).eq("id", employee_id).eq("tenant_id", tenant_id);
    if (error) { console.error("set_pin_update_failed", error.message); return json({ error: "server_error" }, 500); }
    return json({ ok: true }, 200);
  } catch (e) {
    console.error("set_pin_failed", (e as Error).message);
    return json({ error: "server_error" }, 500);
  }
});
