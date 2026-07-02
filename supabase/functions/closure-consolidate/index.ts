// closure-consolidate: builds the consolidated snapshot of a tenant period
// (week or month) and returns the canonical consolidated_hash plus any existing
// period_closure with its signatures. Does NOT create the closure.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { consolidatePeriod, fetchClosureWithSignatures } from "../_shared/closure.ts";
import { isDemoBypassAllowed, logDemoBypass, DEMO_TENANT_ID } from "../_shared/demo-bypass.ts";

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

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const { tenant_id, period_type, reference_date } = body ?? {};
  if (!tenant_id || !period_type || !reference_date) return json({ error: "missing_fields" }, 400);
  if (!["week", "month"].includes(period_type)) return json({ error: "invalid_period" }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reference_date)) return json({ error: "invalid_date" }, 400);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const isDemo = tenant_id === "demo-tenant";

  if (!isDemo) {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) return json({ error: "unauthorized" }, 401);
    const supabaseCheck = createClient(url, service);
    const { data: canRead } = await supabaseCheck.rpc("can_read_tenant", { _user_id: userRes.user.id, _tenant_id: tenant_id });
    if (!canRead) return json({ error: "forbidden" }, 403);
  }

  const supabase = createClient(url, service);

  try {
    const { consolidated, consolidated_hash, startDate } = await consolidatePeriod(supabase, tenant_id, period_type, reference_date);
    const { closure, signatures } = await fetchClosureWithSignatures(supabase, tenant_id, period_type, startDate);
    return json({ consolidated, consolidated_hash, closure, signatures }, 200);
  } catch (e) {
    console.error("consolidate_failed", (e as Error).message);
    return json({ error: "server_error" }, 500);
  }
});
