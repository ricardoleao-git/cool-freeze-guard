// closure-get: returns the period_closure for (tenant, period, reference_date)
// if any, with its signatures ordered along the chain, plus the consolidated
// snapshot stored at the closure (NOT recomputed — for an up-to-date snapshot
// call closure-consolidate).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { rangeFor, type PeriodType } from "../closure-consolidate/index.ts";

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
  const { tenant_id, period_type, reference_date } = body ?? {};
  if (!tenant_id || !period_type || !reference_date) return json({ error: "missing_fields" }, 400);
  if (!["week", "month"].includes(period_type)) return json({ error: "invalid_period" }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reference_date)) return json({ error: "invalid_date" }, 400);

  const supabase = createClient(url, service);
  const { data: canRead } = await supabase.rpc("can_read_tenant", { _user_id: userRes.user.id, _tenant_id: tenant_id });
  if (!canRead) return json({ error: "forbidden" }, 403);

  const { startDate } = rangeFor(period_type as PeriodType, reference_date);

  const { data: closure, error: cErr } = await supabase
    .from("period_closures")
    .select("id, tenant_id, period_type, reference_start, reference_end, status, consolidated, consolidated_hash, created_at, updated_at")
    .eq("tenant_id", tenant_id).eq("period_type", period_type).eq("reference_start", startDate)
    .maybeSingle();
  if (cErr) { console.error("closure_query_failed", cErr.message); return json({ error: "server_error" }, 500); }
  if (!closure) return json({ closure: null, signatures: [] }, 200);

  const { data: sigs, error: sErr } = await supabase
    .from("closure_signatures")
    .select("stage, signed_by_user_id, signed_by_name, signed_by_role, signed_at, signature_method, content_hash, clickwrap_text_hash, previous_hash, record_hash")
    .eq("closure_id", (closure as any).id)
    .order("signed_at", { ascending: true });
  if (sErr) { console.error("sigs_query_failed", sErr.message); return json({ error: "server_error" }, 500); }

  return json({ closure, signatures: sigs ?? [] }, 200);
});
