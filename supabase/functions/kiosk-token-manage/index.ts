// Manage kiosk tokens (admin/manager only). Actions: create | revoke | list.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function fail(status: number, code: string, detail?: unknown) {
  return new Response(JSON.stringify({ error: code, detail }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function randomToken(): string {
  const bytes = new Uint8Array(36);
  crypto.getRandomValues(bytes);
  // base64url
  let b64 = btoa(String.fromCharCode(...bytes));
  b64 = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return b64;
}

function randomPairingCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 1_000_000).padStart(6, "0");
}

const PAIRING_TTL_MS = 15 * 60 * 1000;

async function generateUniquePairingCode(
  admin: ReturnType<typeof createClient>,
  tenantId: string,
): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = randomPairingCode();
    const { data } = await admin
      .from("kiosk_tokens")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("pairing_code", code)
      .maybeSingle();
    if (!data) return code;
  }
  throw new Error("could_not_allocate_code");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail(405, "method_not_allowed");

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return fail(401, "unauthorized");

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const jwt = authHeader.replace("Bearer ", "");
  const { data: claims, error: claimsErr } = await userClient.auth.getClaims(jwt);
  if (claimsErr || !claims?.claims) return fail(401, "unauthorized");
  const userId = claims.claims.sub as string;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail(400, "invalid_body");
  }
  const tenantId = typeof body?.tenant_id === "string" ? body.tenant_id : "";
  const action = typeof body?.action === "string" ? body.action : "";
  if (!tenantId || !action) return fail(400, "missing_params");

  const { data: canManage, error: permErr } = await admin.rpc("can_manage_tenant", {
    _user_id: userId,
    _tenant_id: tenantId,
  });
  if (permErr || !canManage) return fail(403, "forbidden");

  try {
    if (action === "create") {
      const label =
        typeof body?.payload?.label === "string" && body.payload.label.trim()
          ? body.payload.label.trim().slice(0, 120)
          : null;
      const token = randomToken();
      const { data, error } = await admin
        .from("kiosk_tokens")
        .insert({ tenant_id: tenantId, token, label, created_by_user_id: userId })
        .select("id, label, active, created_at")
        .single();
      if (error) return fail(500, "create_failed", error.message);
      return new Response(
        JSON.stringify({ ok: true, id: data.id, token, label: data.label, created_at: data.created_at }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "revoke") {
      const tokenId = body?.payload?.token_id;
      if (!tokenId) return fail(400, "missing_token_id");
      const { error } = await admin
        .from("kiosk_tokens")
        .update({ active: false, revoked_at: new Date().toISOString() })
        .eq("id", tokenId)
        .eq("tenant_id", tenantId);
      if (error) return fail(500, "revoke_failed", error.message);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "list") {
      const { data, error } = await admin
        .from("kiosk_tokens")
        .select("id, label, active, last_used_at, created_at, revoked_at, created_by_user_id, token")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (error) return fail(500, "list_failed", error.message);

      const userIds = Array.from(
        new Set((data ?? []).map((r: any) => r.created_by_user_id).filter(Boolean)),
      );
      let nameMap = new Map<string, string>();
      if (userIds.length) {
        const { data: profs } = await admin
          .from("profiles")
          .select("user_id, full_name, email")
          .in("user_id", userIds);
        for (const p of profs ?? []) {
          nameMap.set(p.user_id as string, (p.full_name || p.email || "") as string);
        }
      }

      const items = (data ?? []).map((r: any) => ({
        id: r.id,
        label: r.label,
        active: r.active,
        last_used_at: r.last_used_at,
        created_at: r.created_at,
        revoked_at: r.revoked_at,
        created_by: r.created_by_user_id ? nameMap.get(r.created_by_user_id) ?? null : null,
        token_hint: r.token ? `…${String(r.token).slice(-6)}` : null,
      }));
      return new Response(JSON.stringify({ ok: true, items }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return fail(400, "unknown_action");
  } catch (_err) {
    return fail(500, "internal_error");
  }
});
