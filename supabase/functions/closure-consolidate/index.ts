// closure-consolidate: builds the consolidated snapshot of a tenant period
// (week or month), returning canonical content/consolidated_hash and the
// current period_closure (if any) with its signatures. Does NOT create the
// closure — used by both the UI preview and the closure-sign function.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export type PeriodType = "week" | "month";

export function rangeFor(period: PeriodType, refDate: string): { start: Date; end: Date; startDate: string; endDate: string } {
  const [y, m, d] = refDate.split("-").map(Number);
  const ref = new Date(Date.UTC(y, m - 1, d));
  let start: Date, end: Date;
  if (period === "week") {
    const day = ref.getUTCDay(); // 0..6 Sun..Sat
    const diff = day === 0 ? -6 : 1 - day;
    start = new Date(ref); start.setUTCDate(start.getUTCDate() + diff);
    end = new Date(start); end.setUTCDate(end.getUTCDate() + 7);
  } else {
    start = new Date(Date.UTC(y, m - 1, 1));
    end = new Date(Date.UTC(y, m, 1));
  }
  const fmt = (dt: Date) => dt.toISOString().slice(0, 10);
  // reference_end is INCLUSIVE last day of period
  const last = new Date(end); last.setUTCDate(last.getUTCDate() - 1);
  return { start, end, startDate: fmt(start), endDate: fmt(last) };
}

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

type AnyClient = ReturnType<typeof createClient>;

export async function consolidatePeriod(
  supabase: AnyClient,
  tenantId: string,
  period: PeriodType,
  referenceDate: string,
) {
  const { start, end, startDate, endDate } = rangeFor(period, referenceDate);

  // Pull events in range for tenant
  const { data: events, error: evErr } = await supabase
    .from("access_events")
    .select("id, employee_id, event_type, occurred_at, cold_area_id")
    .eq("tenant_id", tenantId)
    .gte("occurred_at", start.toISOString())
    .lt("occurred_at", end.toISOString())
    .order("employee_id", { ascending: true })
    .order("occurred_at", { ascending: true });
  if (evErr) throw new Error("events_query_failed");

  // Cold areas (limits)
  const areaIds = Array.from(new Set((events ?? []).map((e: any) => e.cold_area_id).filter(Boolean)));
  const areasMap: Record<string, any> = {};
  if (areaIds.length) {
    const { data: areas } = await supabase
      .from("cold_areas")
      .select("id, name, exposure_limit_minutes")
      .in("id", areaIds);
    for (const a of areas ?? []) areasMap[(a as any).id] = a;
  }

  // Thermal breaks
  const { data: breaks } = await supabase
    .from("thermal_breaks")
    .select("id, employee_id, completed, interrupted, started_at")
    .eq("tenant_id", tenantId)
    .gte("started_at", start.toISOString())
    .lt("started_at", end.toISOString());

  // Daily confirmations in range
  const { data: confs } = await supabase
    .from("daily_statement_confirmations")
    .select("employee_id, reference_date")
    .eq("tenant_id", tenantId)
    .gte("reference_date", startDate)
    .lte("reference_date", endDate);

  // Build per-employee summary
  type EmpSummary = {
    employee_id: string;
    total_exposure_minutes: number;
    sessions_count: number;
    open_sessions_count: number;
    breaks_completed: number;
    breaks_interrupted: number;
    inconsistencies_count: number;
    inconsistencies_by_type: Record<string, number>;
    daily_confirmations: number;
  };
  const byEmp: Record<string, EmpSummary> = {};
  const ensure = (eid: string): EmpSummary => {
    if (!byEmp[eid]) {
      byEmp[eid] = {
        employee_id: eid,
        total_exposure_minutes: 0,
        sessions_count: 0,
        open_sessions_count: 0,
        breaks_completed: 0,
        breaks_interrupted: 0,
        inconsistencies_count: 0,
        inconsistencies_by_type: {},
        daily_confirmations: 0,
      };
    }
    return byEmp[eid];
  };
  const bumpInc = (s: EmpSummary, type: string) => {
    s.inconsistencies_count++;
    s.inconsistencies_by_type[type] = (s.inconsistencies_by_type[type] ?? 0) + 1;
  };

  // Pair entry/exit per employee (events already sorted)
  const eventsByEmp: Record<string, any[]> = {};
  for (const ev of events ?? []) {
    (eventsByEmp[ev.employee_id] = eventsByEmp[ev.employee_id] ?? []).push(ev);
  }
  for (const [eid, list] of Object.entries(eventsByEmp)) {
    const s = ensure(eid);
    let openEntry: any = null;
    for (const ev of list) {
      if (ev.event_type === "entry") {
        if (openEntry) {
          // previous entry without exit
          const dur = Math.max(0, Math.round((new Date(ev.occurred_at).getTime() - new Date(openEntry.occurred_at).getTime()) / 60000));
          s.sessions_count++;
          s.open_sessions_count++;
          s.total_exposure_minutes += dur;
          bumpInc(s, "entry_without_exit_in_period");
          const limit = openEntry.cold_area_id ? areasMap[openEntry.cold_area_id]?.exposure_limit_minutes : null;
          if (limit && dur > limit) bumpInc(s, "exposure_exceeded");
        }
        openEntry = ev;
      } else if (ev.event_type === "exit") {
        if (openEntry) {
          const dur = Math.max(0, Math.round((new Date(ev.occurred_at).getTime() - new Date(openEntry.occurred_at).getTime()) / 60000));
          s.sessions_count++;
          s.total_exposure_minutes += dur;
          const limit = openEntry.cold_area_id ? areasMap[openEntry.cold_area_id]?.exposure_limit_minutes : null;
          if (limit && dur > limit) bumpInc(s, "exposure_exceeded");
          openEntry = null;
        }
      }
    }
    if (openEntry) {
      const cap = new Date(Math.min(Date.now(), end.getTime()));
      const dur = Math.max(0, Math.round((cap.getTime() - new Date(openEntry.occurred_at).getTime()) / 60000));
      s.sessions_count++;
      s.open_sessions_count++;
      s.total_exposure_minutes += dur;
      bumpInc(s, "open_session");
      const limit = openEntry.cold_area_id ? areasMap[openEntry.cold_area_id]?.exposure_limit_minutes : null;
      if (limit && dur > limit) bumpInc(s, "exposure_exceeded");
    }
  }

  for (const b of breaks ?? []) {
    const s = ensure((b as any).employee_id);
    if ((b as any).completed) s.breaks_completed++;
    if ((b as any).interrupted) { s.breaks_interrupted++; bumpInc(s, "break_interrupted"); }
  }
  for (const c of confs ?? []) {
    const s = ensure((c as any).employee_id);
    s.daily_confirmations++;
  }

  const employees = Object.values(byEmp).sort((a, b) => a.employee_id.localeCompare(b.employee_id));

  // Totals
  const totals = {
    employees_count: employees.length,
    total_exposure_minutes: employees.reduce((a, x) => a + x.total_exposure_minutes, 0),
    sessions_count: employees.reduce((a, x) => a + x.sessions_count, 0),
    open_sessions_count: employees.reduce((a, x) => a + x.open_sessions_count, 0),
    breaks_completed: employees.reduce((a, x) => a + x.breaks_completed, 0),
    breaks_interrupted: employees.reduce((a, x) => a + x.breaks_interrupted, 0),
    inconsistencies_count: employees.reduce((a, x) => a + x.inconsistencies_count, 0),
    daily_confirmations: employees.reduce((a, x) => a + x.daily_confirmations, 0),
  };
  const inconsistencies_by_type: Record<string, number> = {};
  for (const e of employees) {
    for (const [k, v] of Object.entries(e.inconsistencies_by_type)) {
      inconsistencies_by_type[k] = (inconsistencies_by_type[k] ?? 0) + v;
    }
  }

  const consolidated = {
    tenant_id: tenantId,
    period_type: period,
    reference_start: startDate,
    reference_end: endDate,
    totals,
    inconsistencies_by_type,
    employees,
  };

  const consolidated_hash = await sha256Hex(canonicalStringify(consolidated));

  return { consolidated, consolidated_hash, startDate, endDate };
}

export async function fetchClosureWithSignatures(
  supabase: AnyClient,
  tenantId: string,
  period: PeriodType,
  startDate: string,
) {
  const { data: closure } = await supabase
    .from("period_closures")
    .select("id, status, consolidated_hash, reference_start, reference_end, created_at, updated_at")
    .eq("tenant_id", tenantId).eq("period_type", period).eq("reference_start", startDate)
    .maybeSingle();
  if (!closure) return { closure: null, signatures: [] };
  const { data: sigs } = await supabase
    .from("closure_signatures")
    .select("stage, signed_by_name, signed_by_role, signed_at, record_hash, previous_hash, signature_method, content_hash")
    .eq("closure_id", (closure as any).id)
    .order("signed_at", { ascending: true });
  return { closure, signatures: sigs ?? [] };
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
  const { tenant_id, period_type, reference_date } = body ?? {};
  if (!tenant_id || !period_type || !reference_date) return json({ error: "missing_fields" }, 400);
  if (!["week", "month"].includes(period_type)) return json({ error: "invalid_period" }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reference_date)) return json({ error: "invalid_date" }, 400);

  const supabase = createClient(url, service);
  const { data: canRead } = await supabase.rpc("can_read_tenant", { _user_id: userRes.user.id, _tenant_id: tenant_id });
  if (!canRead) return json({ error: "forbidden" }, 403);

  try {
    const { consolidated, consolidated_hash, startDate } = await consolidatePeriod(supabase, tenant_id, period_type, reference_date);
    const { closure, signatures } = await fetchClosureWithSignatures(supabase, tenant_id, period_type, startDate);
    return json({ consolidated, consolidated_hash, closure, signatures }, 200);
  } catch (e) {
    console.error("consolidate_failed", (e as Error).message);
    return json({ error: "server_error" }, 500);
  }
});
