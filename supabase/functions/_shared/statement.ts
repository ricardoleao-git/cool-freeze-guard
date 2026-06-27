// Shared builder for an employee's exposure statement. Used by both
// `employee-statement` and `employee-confirm-statement`. Edge function
// bundler cannot cross-import other functions, so this lives in _shared.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export type StatementPeriod = "day" | "week" | "month";

export function rangeFor(period: StatementPeriod, refDate: string): { start: Date; end: Date } {
  const [y, m, d] = refDate.split("-").map(Number);
  const ref = new Date(Date.UTC(y, m - 1, d));
  if (period === "day") {
    const start = new Date(ref);
    const end = new Date(ref); end.setUTCDate(end.getUTCDate() + 1);
    return { start, end };
  }
  if (period === "week") {
    const day = ref.getUTCDay();
    const diff = (day === 0 ? -6 : 1 - day);
    const start = new Date(ref); start.setUTCDate(start.getUTCDate() + diff);
    const end = new Date(start); end.setUTCDate(end.getUTCDate() + 7);
    return { start, end };
  }
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { start, end };
}

export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalStringify).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalStringify(obj[k])).join(",") + "}";
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildStatement(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  employeeId: string,
  period: StatementPeriod,
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

  type Session = {
    entry_at: string; exit_at: string | null; duration_minutes: number;
    cold_area_id: string | null; cold_area_name: string | null; open: boolean;
  };
  const sessions: Session[] = [];
  let openEntry: any = null;
  for (const ev of events ?? []) {
    if (ev.event_type === "entry") {
      if (openEntry) {
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
