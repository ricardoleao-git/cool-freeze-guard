// Public endpoint — consumes a 6-digit pairing code and returns the long-lived
// kiosk token. Used by /loginpainel to bootstrap a TV/Fully Kiosk device.
// LGPD/segurança: código expira em 15min, uso único, rate-limit por IP.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function fail(status: number, code: string) {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Rate limit em memória por instância. Basta para dificultar brute-force de
// 1M códigos possíveis — a linha extra de defesa é a expiração de 15min.
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || rec.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_ATTEMPTS;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail(405, "method_not_allowed");

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("cf-connecting-ip") ||
    "unknown";
  const ua = req.headers.get("user-agent")?.slice(0, 512) ?? null;

  if (rateLimited(ip)) return fail(429, "rate_limited");

  let body: { code?: string };
  try {
    body = await req.json();
  } catch {
    return fail(400, "invalid_body");
  }
  const code = typeof body?.code === "string" ? body.code.replace(/\D/g, "") : "";
  if (code.length !== 6) return fail(400, "invalid_code");

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { data: row, error } = await admin
      .from("kiosk_tokens")
      .select("id, token, active, revoked_at, pairing_expires_at, paired_at")
      .eq("pairing_code", code)
      .maybeSingle();

    if (error) return fail(500, "internal_error");
    if (!row || !row.active || row.revoked_at) return fail(404, "invalid_code");
    if (row.paired_at) return fail(410, "code_already_used");
    if (
      row.pairing_expires_at &&
      new Date(row.pairing_expires_at).getTime() < Date.now()
    ) {
      return fail(410, "code_expired");
    }

    const nowIso = new Date().toISOString();
    const { error: updErr } = await admin
      .from("kiosk_tokens")
      .update({
        pairing_code: null,
        pairing_expires_at: null,
        paired_at: nowIso,
        paired_ip: ip === "unknown" ? null : ip,
        paired_user_agent: ua,
        last_used_at: nowIso,
      })
      .eq("id", row.id);
    if (updErr) return fail(500, "internal_error");

    return new Response(
      JSON.stringify({ ok: true, token: row.token }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (_err) {
    return fail(500, "internal_error");
  }
});
