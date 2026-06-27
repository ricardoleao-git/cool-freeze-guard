// employee-confirm-statement: collaborator confirms their daily statement with PIN.
// Validates PIN (with lockout), recomputes content_hash server-side to prevent
// confirming an outdated snapshot, then writes an append-only confirmation.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { verifyPin, validatePinFormat } from "../_shared/pin.ts";
import { buildStatement } from "../_shared/statement.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

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
  const { tenant_id, employee_id, reference_date, pin, clickwrap_text, content_hash } = body ?? {};
  if (!tenant_id || !employee_id || !reference_date || !pin || !clickwrap_text || !content_hash) {
    return json({ error: "missing_fields" }, 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reference_date)) return json({ error: "invalid_date" }, 400);
  if (!validatePinFormat(pin)) return json({ error: "invalid_pin_format" }, 400);

  const supabase = createClient(url, service);

  const { data: canRead } = await supabase.rpc("can_read_tenant", { _user_id: userRes.user.id, _tenant_id: tenant_id });
  if (!canRead) return json({ error: "forbidden" }, 403);

  const { data: emp, error: empErr } = await supabase
    .from("employees")
    .select("id, name, pin_hash, pin_failed_attempts, pin_locked_until")
    .eq("id", employee_id).eq("tenant_id", tenant_id).maybeSingle();
  if (empErr) { console.error("emp_fetch_failed", empErr.message); return json({ error: "server_error" }, 500); }
  if (!emp) return json({ error: "employee_not_found" }, 404);

  if (!emp.pin_hash) return json({ error: "pin_not_set", message: "PIN não cadastrado para este colaborador" }, 412);

  if (emp.pin_locked_until && new Date(emp.pin_locked_until as string).getTime() > Date.now()) {
    return json({ error: "pin_locked", locked_until: emp.pin_locked_until }, 423);
  }

  const ok = await verifyPin(pin, emp.pin_hash as string);
  if (!ok) {
    const attempts = (emp.pin_failed_attempts ?? 0) + 1;
    const patch: Record<string, unknown> = { pin_failed_attempts: attempts };
    if (attempts >= MAX_ATTEMPTS) {
      patch.pin_locked_until = new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString();
      patch.pin_failed_attempts = 0;
    }
    await supabase.from("employees").update(patch).eq("id", employee_id).eq("tenant_id", tenant_id);
    return json({ error: "invalid_pin", attempts_remaining: Math.max(0, MAX_ATTEMPTS - attempts) }, 401);
  }

  // Reset attempts on success
  await supabase.from("employees").update({ pin_failed_attempts: 0, pin_locked_until: null })
    .eq("id", employee_id).eq("tenant_id", tenant_id);

  // Recompute statement to ensure the snapshot the user confirmed matches DB now.
  let computed;
  try {
    computed = await buildStatement(supabase, tenant_id, employee_id, "day", reference_date);
  } catch (e) {
    console.error("recompute_failed", (e as Error).message);
    return json({ error: "server_error" }, 500);
  }
  if (computed.content_hash !== content_hash) {
    return json({
      error: "statement_changed",
      message: "O extrato mudou desde que foi exibido. Revise novamente antes de confirmar.",
      current_content_hash: computed.content_hash,
    }, 409);
  }

  // Idempotency: already exists?
  const { data: existing } = await supabase
    .from("daily_statement_confirmations")
    .select("confirmed_at, record_hash")
    .eq("tenant_id", tenant_id).eq("employee_id", employee_id).eq("reference_date", reference_date)
    .maybeSingle();
  if (existing) {
    return json({ confirmado: true, already: true, confirmed_at: existing.confirmed_at, record_hash: existing.record_hash }, 200);
  }

  const clickwrap_text_hash = await sha256Hex(clickwrap_text);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent") || null;

  // Strip volatile field 'confirmation' from snapshot persisted (it's about the prior confirmation state).
  const snapshotToStore = { ...computed } as any;
  delete snapshotToStore.confirmation;

  const { data: inserted, error: insErr } = await supabase
    .from("daily_statement_confirmations")
    .insert({
      tenant_id, employee_id, reference_date,
      content_hash, content_snapshot: snapshotToStore,
      clickwrap_text, clickwrap_text_hash,
      signature_method: "pin",
      ip_origin: ip, user_agent: ua,
    })
    .select("confirmed_at, record_hash")
    .single();
  if (insErr) {
    // unique violation race
    if ((insErr as any).code === "23505") {
      const { data: again } = await supabase
        .from("daily_statement_confirmations")
        .select("confirmed_at, record_hash")
        .eq("tenant_id", tenant_id).eq("employee_id", employee_id).eq("reference_date", reference_date)
        .maybeSingle();
      if (again) return json({ confirmado: true, already: true, confirmed_at: again.confirmed_at, record_hash: again.record_hash }, 200);
    }
    console.error("confirm_insert_failed", insErr.message);
    return json({ error: "server_error" }, 500);
  }

  return json({ confirmado: true, confirmed_at: inserted.confirmed_at, record_hash: inserted.record_hash }, 200);
});
