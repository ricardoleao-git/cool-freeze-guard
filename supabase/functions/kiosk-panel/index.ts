// Public endpoint — kiosk panel for TVs. Validates a token (no JWT).
// LGPD: returns only first name + avatar + area + inside_since for people inside.
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

function firstName(name: string | null | undefined): string {
  if (!name) return "—";
  const trimmed = String(name).trim();
  if (!trimmed) return "—";
  const part = trimmed.split(/\s+/)[0];
  return part || "—";
}

function riskBucket(
  minutes: number,
  yellow: number | null,
  orange: number | null,
  limit: number | null,
): "ok" | "yellow" | "orange" | "red" {
  const lim = Number(limit) || 0;
  const yel = Number(yellow) || 0;
  const ora = Number(orange) || 0;
  if (lim > 0 && minutes >= lim) return "red";
  if (ora > 0 && minutes >= ora) return "orange";
  if (yel > 0 && minutes >= yel) return "yellow";
  return "ok";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail(405, "method_not_allowed");

  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return fail(400, "invalid_body");
  }
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token || token.length < 16 || token.length > 512) return fail(401, "invalid_token");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { data: tok, error: tokErr } = await supabase
      .from("kiosk_tokens")
      .select("id, tenant_id, active, revoked_at")
      .eq("token", token)
      .maybeSingle();

    if (tokErr || !tok || !tok.active || tok.revoked_at) return fail(401, "invalid_token");

    const tenantId = tok.tenant_id as string;

    // best-effort touch
    supabase.from("kiosk_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", tok.id).then(() => {});

    const [{ data: tenant }, { data: areas }, { data: insideRaw }] = await Promise.all([
      supabase.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
      supabase
        .from("cold_areas")
        .select("id, name, exposure_limit_minutes, warning_yellow_minutes, warning_orange_minutes")
        .eq("tenant_id", tenantId),
      supabase
        .from("employees")
        .select("name, avatar, current_area_id, inside_since, current_status")
        .eq("tenant_id", tenantId)
        // "inside" cobre exposição normal; yellow/orange/blocked são estados
        // de exposição prolongada — o colaborador continua dentro da câmara.
        .in("current_status", ["inside", "yellow", "orange", "blocked"]),
    ]);

    const areaMap = new Map<string, any>();
    for (const a of areas ?? []) areaMap.set(a.id as string, a);

    const now = Date.now();
    const summary = { total: 0, ok: 0, yellow: 0, orange: 0, red: 0 };
    const inside = (insideRaw ?? []).map((e: any) => {
      const area = e.current_area_id ? areaMap.get(e.current_area_id) : null;
      const since = e.inside_since ? new Date(e.inside_since).getTime() : now;
      const minutes = Math.max(0, Math.floor((now - since) / 60000));
      const bucket = riskBucket(
        minutes,
        area?.warning_yellow_minutes ?? null,
        area?.warning_orange_minutes ?? null,
        area?.exposure_limit_minutes ?? null,
      );
      summary.total += 1;
      summary[bucket] += 1;
      return {
        primeiro_nome: firstName(e.name),
        avatar: e.avatar ?? null,
        area_id: e.current_area_id ?? null,
        area_nome: area?.name ?? null,
        inside_since: e.inside_since,
      };
    });

    // Daily pride: thermal breaks completed today + external readings today
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startIso = startOfDay.toISOString();

    const [{ count: breaksCount }, { count: externalCount }] = await Promise.all([
      supabase
        .from("thermal_breaks")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("completed", true)
        .gte("started_at", startIso),
      supabase
        .from("access_events")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("event_type", "exit")
        .gte("occurred_at", startIso),
    ]);

    return new Response(
      JSON.stringify({
        tenant_id: tenantId,
        tenant_nome: tenant?.name ?? null,
        server_time: new Date().toISOString(),
        areas: (areas ?? []).map((a: any) => ({
          id: a.id,
          name: a.name,
          exposure_limit_minutes: a.exposure_limit_minutes,
          warning_yellow_minutes: a.warning_yellow_minutes,
          warning_orange_minutes: a.warning_orange_minutes,
        })),
        inside,
        summary,
        daily_pride: {
          thermal_breaks_today: breaksCount ?? 0,
          external_readings_today: externalCount ?? 0,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (_err) {
    return fail(500, "internal_error");
  }
});
