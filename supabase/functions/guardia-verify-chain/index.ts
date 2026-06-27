// guardia-verify-chain: verifies forensic hash-chain integrity of access_events for a tenant.
// Only validates LINKING (previous_hash[n] == record_hash[n-1]) per (tenant, employee) chain.
// Does NOT recompute content sha256 client- or function-side (server trigger seal is authoritative).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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

  let body: { tenant_id?: string } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  const supabase = createClient(url, service);
  let tenantId = body.tenant_id;
  if (!tenantId) {
    const { data: p } = await supabase.from("profiles").select("tenant_id").eq("user_id", userRes.user.id).maybeSingle();
    tenantId = p?.tenant_id ?? undefined;
  }
  if (!tenantId) return json({ error: "missing_tenant" }, 400);

  const { data: canManage } = await supabase.rpc("can_manage_tenant", { _user_id: userRes.user.id, _tenant_id: tenantId });
  if (!canManage) return json({ error: "forbidden" }, 403);

  // Stream events in batches.
  const pageSize = 1000;
  let from = 0;
  const lastHashByEmployee = new Map<string, string | null>();
  const breaks: Array<{
    employee_id: string;
    event_id: string;
    occurred_at: string;
    expected_previous_hash: string | null;
    actual_previous_hash: string | null;
    reason: string;
  }> = [];
  const validationCounts: Record<string, number> = {};
  let total = 0;

  while (true) {
    const { data, error } = await supabase
      .from("access_events")
      .select("id, employee_id, occurred_at, created_at, record_hash, previous_hash, validation_status")
      .eq("tenant_id", tenantId)
      .order("employee_id", { ascending: true })
      .order("occurred_at", { ascending: true })
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) { console.error("verify_chain_query_failed", error.message); return json({ error: "server_error" }, 500); }
    if (!data || data.length === 0) break;

    for (const ev of data) {
      total++;
      validationCounts[ev.validation_status] = (validationCounts[ev.validation_status] ?? 0) + 1;
      const prevHash = lastHashByEmployee.has(ev.employee_id) ? lastHashByEmployee.get(ev.employee_id)! : null;
      const expected = prevHash; // null for first event of the chain
      if ((ev.previous_hash ?? null) !== (expected ?? null)) {
        breaks.push({
          employee_id: ev.employee_id,
          event_id: ev.id,
          occurred_at: ev.occurred_at,
          expected_previous_hash: expected,
          actual_previous_hash: ev.previous_hash ?? null,
          reason: expected === null
            ? "first_event_has_previous_hash"
            : ev.previous_hash == null
              ? "missing_previous_hash"
              : "previous_hash_mismatch",
        });
      }
      if (!ev.record_hash) {
        breaks.push({
          employee_id: ev.employee_id,
          event_id: ev.id,
          occurred_at: ev.occurred_at,
          expected_previous_hash: expected,
          actual_previous_hash: ev.previous_hash ?? null,
          reason: "missing_record_hash",
        });
      }
      lastHashByEmployee.set(ev.employee_id, ev.record_hash ?? null);
    }

    if (data.length < pageSize) break;
    from += pageSize;
  }

  return json({
    ok: breaks.length === 0,
    total_events: total,
    total_employees: lastHashByEmployee.size,
    validation_status_counts: validationCounts,
    breaks,
    verified_at: new Date().toISOString(),
  }, 200);
});
