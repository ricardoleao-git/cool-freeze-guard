// employee-statement: computes an individual collaborator's exposure statement
// for a given day/week/month period, returning canonical content_hash and
// information about any existing confirmation for the reference_date (day mode).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Period = "day" | "week" | "month";

function rangeFor(period: Period, refDate: string): { start: Date; end: Date } {
  const [y, m, d] = refDate.split("-").map(Number);
  const ref = new Date(Date.UTC(y, m - 1, d));
  if (period === "day") {
    const start = new Date(ref);
    const end = new Date(ref); end.setUTCDate(end.getUTCDate() + 1);
    return { start, end };
  }
  if (period === "week") {
    // ISO week starting Monday
    const day = ref.getUTCDay(); // 0..6 (Sun..Sat)
    const diff = (day === 0 ? -6 : 1 - day);
    const start = new Date(ref); start.setUTCDate(start.getUTCDate() + diff);
    const end = new Date(start); end.setUTCDate(end.getUTCDate() + 7);
    return { start, end };
  }
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { start, end };
}

// Canonical JSON stringify (keys sorted recursively) for deterministic hashing.
function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalStringify).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalStringify(obj[k])).join(",") + "}";
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildStatement(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  employeeId: string,
  period: Period,
  referenceDate: string,
) {
  const { start, end } = rangeFor(period, referenceDate);

  const { data: emp, error: empErr } = await supabase
    .from("employees")
    .select("id, name, tenant_id")
    .eq("id", employeeId).eq("tenant_id", tenantId).maybeSingle();
  if (empErr) throw new Error("employee_query_failed");
  if (!emp) throw new Error("employee_not_found");

  const { data: events, error: evErr } = await supabase
    .from("access_events")
    .select("id, event_type, occurred_at, cold_area_id, status_before, status_after, accumulated_at_event")
    .eq("tenant_id", tenantId).eq("employee_id", employeeId)
    .gte("occurred_at", start.toISOString())
    .lt("occurred_at", end.toISOString())
    .order("occurred_at", { ascending: true });
  if (evErr) throw new Error("events_query_failed");

  const areaIds = Array.from(new Set((events ?? []).map((e: any) => e.cold_area_id).filter(Boolean)));
  const areasMap: Record<string, any> = {};
  if (areaIds.length) {
    const { data: areas } = await supabase
      .from("cold_areas")
      .select("id, name, exposure_limit_minutes, break_minutes, warning_yellow_minutes, warning_orange_minutes")
      .in("id", areaIds);
    for (const a of areas ?? []) areasMap[(a as any).id] = a;
  }

  const { data: breaks } = await supabase
    .from("thermal_breaks")
    .select("id, started_at, ended_at, completed, interrupted")
    .eq("tenant_id", tenantId).eq("employee_id", employeeId)
    .gte("started_at", start.toISOString())
    .lt("started_at", end.toISOString())
    .order("started_at", { ascending: true });

  // Reconstruct sessions: pair entry -> next exit.
  type Session = {
    entry_at: string; exit_at: string | null; duration_minutes: number;
    cold_area_id: string | null; cold_area_name: string | null; open: boolean;
  };
  const sessions: Session[] = [];
  let openEntry: any = null;
  for (const ev of events ?? []) {
    if (ev.event_type === "entry") {
      if (openEntry) {
        // Unclosed previous entry — close as open with current time of next entry.
        sessions.push({
          entry_at: openEntry.occurred_at, exit_at: null,
          duration_minutes: Math.max(0, Math.round((new Date(ev.occurred_at).getTime() - new Date(openEntry.occurred_at).getTime()) / 60000)),
          cold_area_id: openEntry.cold_area_id,
          cold_area_name: areasMap[openEntry.cold_area_id]?.name ?? null,
          open: true,
        });
      }
      openEntry = ev;
    } else if (ev.event_type === "exit") {
      if (openEntry) {
        const dur = Math.max(0, Math.round((new Date(ev.occurred_at).getTime() - new Date(openEntry.occurred_at).getTime()) / 60000));
        sessions.push({
          entry_at: openEntry.occurred_at, exit_at: ev.occurred_at,
          duration_minutes: dur,
          cold_area_id: openEntry.cold_area_id,
          cold_area_name: areasMap[openEntry.cold_area_id]?.name ?? null,
          open: false,
        });
        openEntry = null;
      }
      // exit with no prior entry: ignored for session pairing (still counted in totals)
    }
  }
  if (openEntry) {
    const now = new Date();
    const cap = now < end ? now : end;
    sessions.push({
      entry_at: openEntry.occurred_at, exit_at: null,
      duration_minutes: Math.max(0, Math.round((cap.getTime() - new Date(openEntry.occurred_at).getTime()) / 60000)),
      cold_area_id: openEntry.cold_area_id,
      cold_area_name: areasMap[openEntry.cold_area_id]?.name ?? null,
      open: true,
    });
  }

  const totalExposureMinutes = sessions.reduce((s, x) => s + x.duration_minutes, 0);
  const entriesCount = (events ?? []).filter((e: any) => e.event_type === "entry").length;
  const externalReadsCount = (events ?? []).filter((e: any) => e.event_type === "exit").length;
  const breaksCompleted = (breaks ?? []).filter((b: any) => b.completed).length;
  const breaksInterrupted = (breaks ?? []).filter((b: any) => b.interrupted).length;

  // Detect inconsistencies
  const inconsistencies: Array<{ type: string; message: string; session_index?: number }> = [];
  sessions.forEach((s, i) => {
    if (s.open) inconsistencies.push({ type: "open_session", message: "Sessão sem saída registrada", session_index: i });
    const limit = s.cold_area_id ? areasMap[s.cold_area_id]?.exposure_limit_minutes : null;
    if (limit && s.duration_minutes > limit) {
      inconsistencies.push({
        type: "exposure_exceeded",
        message: `Exposição (${s.duration_minutes} min) acima do limite (${limit} min)`,
        session_index: i,
      });
    }
  });
  if (breaksInterrupted > 0) inconsistencies.push({ type: "break_interrupted", message: `${breaksInterrupted} pausa(s) térmica(s) interrompida(s)` });

  const areasUsed = Object.values(areasMap).map((a: any) => ({
    id: a.id, name: a.name,
    exposure_limit_minutes: a.exposure_limit_minutes,
    break_minutes: a.break_minutes,
  }));

  const snapshot = {
    period, range: { start: start.toISOString(), end: end.toISOString() },
    employee: { id: emp.id, name: emp.name },
    totals: {
      total_exposure_minutes: totalExposureMinutes,
      entries_count: entriesCount,
      external_reads_count: externalReadsCount,
      breaks_completed: breaksCompleted,
      breaks_interrupted: breaksInterrupted,
    },
    sessions,
    breaks: (breaks ?? []).map((b: any) => ({
      id: b.id, started_at: b.started_at, ended_at: b.ended_at,
      completed: !!b.completed, interrupted: !!b.interrupted,
    })),
    areas_used: areasUsed,
    inconsistencies,
  };

  const contentHash = await sha256Hex(canonicalStringify(snapshot));

  // Confirmation lookup (day mode only)
  let confirmation: { exists: boolean; confirmed_at?: string; matches_current_hash?: boolean; record_hash?: string } = { exists: false };
  if (period === "day") {
    const { data: conf } = await supabase
      .from("daily_statement_confirmations")
      .select("confirmed_at, content_hash, record_hash")
      .eq("tenant_id", tenantId).eq("employee_id", employeeId).eq("reference_date", referenceDate)
      .maybeSingle();
    if (conf) {
      confirmation = {
        exists: true,
        confirmed_at: (conf as any).confirmed_at,
        record_hash: (conf as any).record_hash,
        matches_current_hash: (conf as any).content_hash === contentHash,
      };
    }
  }

  return { ...snapshot, content_hash: contentHash, confirmation };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const { tenant_id, employee_id, period, reference_date } = body ?? {};
  if (!tenant_id || !employee_id || !period || !reference_date) return json({ error: "missing_fields" }, 400);
  if (!["day", "week", "month"].includes(period)) return json({ error: "invalid_period" }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reference_date)) return json({ error: "invalid_date" }, 400);

  const supabase = createClient(url, service);

  // Demo tenant bypass: rotas /demo não têm sessão real.
  if (tenant_id !== "demo-tenant") {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) return json({ error: "unauthorized" }, 401);
    const { data: canRead } = await supabase.rpc("can_read_tenant", { _user_id: userRes.user.id, _tenant_id: tenant_id });
    if (!canRead) return json({ error: "forbidden" }, 403);
  }


  try {
    const result = await buildStatement(supabase, tenant_id, employee_id, period as Period, reference_date);
    return json(result, 200);
  } catch (e) {
    console.error("statement_failed", (e as Error).message);
    const msg = (e as Error).message;
    if (msg === "employee_not_found") return json({ error: msg }, 404);
    return json({ error: "server_error" }, 500);
  }
});
