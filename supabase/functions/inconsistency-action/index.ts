// inconsistency-action: act on items from the inconsistency queue.
// Actions: 'create_occurrence' | 'create_alert' | 'dismiss'.
//
// 'dismiss' uses the same signature_key formula documented in inconsistency-scan:
//   `${type}:${employee_id || '-'}:${reference_date}:${context_id || ''}`
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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
  const user = userRes.user;

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const { tenant_id, action, payload } = body ?? {};
  if (!tenant_id || !action) return json({ error: "missing_fields" }, 400);

  const supabase = createClient(url, service);
  const { data: canManage } = await supabase.rpc("can_manage_tenant", { _user_id: user.id, _tenant_id: tenant_id });
  if (!canManage) return json({ error: "forbidden" }, 403);

  // Resolve actor name from profiles
  const { data: profile } = await supabase
    .from("profiles").select("full_name, email").eq("user_id", user.id).maybeSingle();
  const actorName = (profile as any)?.full_name || (profile as any)?.email || user.email || user.id;

  try {
    if (action === "create_occurrence") {
      const { category, priority, title, description, employee_id, related_event_id } = payload ?? {};
      if (!category || !priority || !title || !employee_id) return json({ error: "missing_payload" }, 400);
      const { data, error } = await supabase.from("occurrences").insert({
        tenant_id, employee_id, category, priority, title,
        description: description ?? null,
        related_event_id: related_event_id ?? null,
        status: "open", created_by: actorName,
      }).select().single();
      if (error) throw error;
      return json({ ok: true, occurrence: data });
    }

    if (action === "create_alert") {
      const { employee_id, alert_type, severity, message } = payload ?? {};
      if (!employee_id || !alert_type || !severity || !message) return json({ error: "missing_payload" }, 400);
      const { data, error } = await supabase.from("alerts").insert({
        tenant_id, employee_id, alert_type, severity, message,
        triggered_at: new Date().toISOString(), status: "open",
      }).select().single();
      if (error) throw error;
      return json({ ok: true, alert: data });
    }

    if (action === "dismiss") {
      const { signature_key, note } = payload ?? {};
      if (!signature_key) return json({ error: "missing_signature_key" }, 400);
      const { data, error } = await supabase.from("inconsistency_reviews").upsert({
        tenant_id, signature_key,
        reviewed_by_user_id: user.id,
        reviewed_by_name: actorName,
        note: note ?? null,
        reviewed_at: new Date().toISOString(),
      }, { onConflict: "tenant_id,signature_key" }).select().single();
      if (error) throw error;
      return json({ ok: true, review: data });
    }

    return json({ error: "invalid_action" }, 400);
  } catch (e) {
    console.error("action_failed", (e as Error).message);
    return json({ error: "server_error", detail: (e as Error).message }, 500);
  }
});
