// closure-sign: applies one stage signature (supervisor → rh → legal) to a
// period_closure. Enforces chain order, recomputes consolidated server-side to
// reject stale snapshots, upserts the closure, and inserts an append-only
// signature. DB trigger seals the chained record_hash.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { consolidatePeriod, type PeriodType } from "../_shared/closure.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const STAGE_ORDER: Record<string, string> = {
  supervisor: "open",
  rh: "supervisor_signed",
  legal: "rh_signed",
};
const NEXT_STATUS: Record<string, string> = {
  supervisor: "supervisor_signed",
  rh: "rh_signed",
  legal: "legal_sealed",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const { tenant_id, period_type, reference_date, stage, clickwrap_text, content_hash, signature_method } = body ?? {};
  if (!tenant_id || !period_type || !reference_date || !stage || !clickwrap_text || !content_hash) {
    return json({ error: "missing_fields" }, 400);
  }
  if (!["week", "month"].includes(period_type)) return json({ error: "invalid_period" }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reference_date)) return json({ error: "invalid_date" }, 400);
  if (!["supervisor", "rh", "legal"].includes(stage)) return json({ error: "invalid_stage" }, 400);
  const sigMethod = signature_method === "icp" ? "icp" : "clickwrap";

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const isDemo = tenant_id === "demo-tenant";

  let userId: string | null = null;
  let userEmail: string | null = null;

  if (!isDemo) {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) return json({ error: "unauthorized" }, 401);
    userId = userRes.user.id;
    userEmail = userRes.user.email ?? null;
  }

  const supabase = createClient(url, service);

  if (!isDemo) {
    const { data: canManage } = await supabase.rpc("can_manage_tenant", {
      _user_id: userId, _tenant_id: tenant_id,
    });
    if (!canManage) return json({ error: "forbidden" }, 403);
  }

  // Recompute consolidated server-side & validate snapshot freshness.
  let consolidated, consolidated_hash, startDate, endDate;
  try {
    const r = await consolidatePeriod(supabase, tenant_id, period_type as PeriodType, reference_date);
    consolidated = r.consolidated;
    consolidated_hash = r.consolidated_hash;
    startDate = r.startDate;
    endDate = r.endDate;
  } catch (e) {
    console.error("consolidate_failed", (e as Error).message);
    return json({ error: "server_error" }, 500);
  }
  if (consolidated_hash !== content_hash) {
    return json({
      error: "statement_changed",
      message: "O consolidado mudou desde que foi exibido. Revise antes de assinar.",
      current_content_hash: consolidated_hash,
    }, 409);
  }

  // Upsert period_closure
  const { data: existing } = await supabase
    .from("period_closures")
    .select("id, status")
    .eq("tenant_id", tenant_id).eq("period_type", period_type).eq("reference_start", startDate)
    .maybeSingle();

  let closureId: string;
  let currentStatus: string;
  if (!existing) {
    const { data: ins, error: insErr } = await supabase
      .from("period_closures")
      .insert({
        tenant_id, period_type, reference_start: startDate, reference_end: endDate,
        status: "open", consolidated, consolidated_hash,
      })
      .select("id, status").single();
    if (insErr) { console.error("closure_insert_failed", insErr.message); return json({ error: "server_error" }, 500); }
    closureId = (ins as any).id;
    currentStatus = (ins as any).status;
  } else {
    closureId = (existing as any).id;
    currentStatus = (existing as any).status;
    // Refresh consolidated snapshot when still mutable (not yet legally sealed).
    if (currentStatus !== "legal_sealed") {
      await supabase
        .from("period_closures")
        .update({ consolidated, consolidated_hash })
        .eq("id", closureId);
    }
  }

  // Enforce stage order.
  const required = STAGE_ORDER[stage];
  if (currentStatus !== required) {
    return json({ error: "wrong_stage", current_status: currentStatus, required_status: required }, 409);
  }

  // Resolve signer identity.
  const { data: prof } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("user_id", userRes.user.id).maybeSingle();
  const signed_by_name = (prof?.full_name && prof.full_name.trim().length > 0)
    ? prof.full_name
    : (prof?.email ?? userRes.user.email ?? "Usuário");

  const { data: roleRow } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userRes.user.id)
    .or(`tenant_id.eq.${tenant_id},tenant_id.is.null`)
    .limit(1).maybeSingle();
  const signed_by_role = (roleRow as any)?.role ?? null;

  const clickwrap_text_hash = await sha256Hex(clickwrap_text);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;

  // Insert signature (idempotent by unique closure+stage)
  const { data: sig, error: sigErr } = await supabase
    .from("closure_signatures")
    .insert({
      tenant_id, closure_id: closureId, stage,
      signed_by_user_id: userRes.user.id, signed_by_name, signed_by_role,
      clickwrap_text, clickwrap_text_hash,
      content_hash: consolidated_hash, signature_method: sigMethod,
      ip_origin: ip, user_agent: ua,
    })
    .select("record_hash, signed_at, previous_hash")
    .single();

  if (sigErr) {
    if ((sigErr as any).code === "23505") {
      const { data: again } = await supabase
        .from("closure_signatures")
        .select("record_hash, signed_at, previous_hash")
        .eq("closure_id", closureId).eq("stage", stage).maybeSingle();
      return json({ ok: true, already: true, stage, status: currentStatus, ...(again ?? {}) }, 200);
    }
    console.error("signature_insert_failed", sigErr.message);
    return json({ error: "server_error" }, 500);
  }

  // Advance status
  const nextStatus = NEXT_STATUS[stage];
  const { error: upErr } = await supabase
    .from("period_closures")
    .update({ status: nextStatus })
    .eq("id", closureId);
  if (upErr) console.error("closure_status_update_failed", upErr.message);

  return json({
    ok: true, stage, status: nextStatus,
    closure_id: closureId,
    record_hash: (sig as any).record_hash,
    previous_hash: (sig as any).previous_hash,
    signed_at: (sig as any).signed_at,
  }, 200);
});
