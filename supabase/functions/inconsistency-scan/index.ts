// inconsistency-scan: tenant-wide detection of inconsistencies / exposure issues.
// Returns a deterministic list of items with a stable signature_key, cross-referenced
// against `inconsistency_reviews` so already-reviewed items are marked reviewed=true.
//
// SIGNATURE KEY FORMULA (must match inconsistency-action's `dismiss`):
//   `${type}:${employee_id || '-'}:${reference_date}:${context_id || ''}`
// where context_id is:
//   - open_session              -> inside_since ISO
//   - entry_without_exit_in_period -> entry event_id
//   - exposure_exceeded         -> entry event_id
//   - break_not_taken           -> entry event_id
//   - break_interrupted         -> thermal_break id
//   - unmapped_reader           -> dispositivo_id
//   - pending_event             -> guardia_event id
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Period = "day" | "week";
type Severity = "info" | "warning" | "critical";

interface Item {
  type: string;
  severity: Severity;
  employee_id: string | null;
  employee_nome: string | null;
  description: string;
  cold_area?: { id: string; name: string } | null;
  related_event_id?: string | null;
  context?: Record<string, unknown>;
  signature_key: string;
  reviewed?: boolean;
  reviewed_at?: string | null;
  reviewed_by_name?: string | null;
}

function rangeFor(period: Period, refDate: string): { start: Date; end: Date } {
  const [y, m, d] = refDate.split("-").map(Number);
  const ref = new Date(Date.UTC(y, m - 1, d));
  if (period === "day") {
    const start = new Date(ref);
    const end = new Date(ref); end.setUTCDate(end.getUTCDate() + 1);
    return { start, end };
  }
  // week: Monday..Sunday
  const day = ref.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const start = new Date(ref); start.setUTCDate(start.getUTCDate() + diff);
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 7);
  return { start, end };
}

const sig = (type: string, employeeId: string | null, refDate: string, ctx: string | null = null) =>
  `${type}:${employeeId ?? "-"}:${refDate}:${ctx ?? ""}`;

async function scan(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  period: Period,
  refDate: string,
) {
  const { start, end } = rangeFor(period, refDate);
  const now = new Date();

  // Config
  const { data: cfg } = await supabase
    .from("integration_config")
    .select("sessao_longa_alerta_minutos, janela_tolerancia_segundos")
    .eq("tenant_id", tenantId).maybeSingle();
  const longSessionMin = (cfg as any)?.sessao_longa_alerta_minutos ?? 120;

  // Employees (used as a name lookup table)
  const { data: emps } = await supabase
    .from("employees")
    .select("id, name, current_status, inside_since, current_area_id, accumulated_minutes")
    .eq("tenant_id", tenantId);
  const empMap: Record<string, any> = {};
  for (const e of emps ?? []) empMap[(e as any).id] = e;

  // Areas
  const { data: areas } = await supabase
    .from("cold_areas")
    .select("id, name, exposure_limit_minutes, break_minutes")
    .eq("tenant_id", tenantId);
  const areaMap: Record<string, any> = {};
  for (const a of areas ?? []) areaMap[(a as any).id] = a;

  // Access events in period (chronological)
  const { data: events } = await supabase
    .from("access_events")
    .select("id, employee_id, event_type, occurred_at, cold_area_id")
    .eq("tenant_id", tenantId)
    .gte("occurred_at", start.toISOString())
    .lt("occurred_at", end.toISOString())
    .order("occurred_at", { ascending: true });

  // Thermal breaks in period
  const { data: breaks } = await supabase
    .from("thermal_breaks")
    .select("id, employee_id, started_at, ended_at, completed, interrupted")
    .eq("tenant_id", tenantId)
    .gte("started_at", start.toISOString())
    .lt("started_at", end.toISOString());

  // Guardia events in period
  const { data: gevents } = await supabase
    .from("guardia_events")
    .select("id, dispositivo_id, processed, process_note, event_timestamp")
    .eq("tenant_id", tenantId)
    .gte("event_timestamp", start.toISOString())
    .lt("event_timestamp", end.toISOString());

  const { data: deviceMap } = await supabase
    .from("guardia_device_map")
    .select("guardia_device_id")
    .eq("tenant_id", tenantId);
  const mappedDevices = new Set((deviceMap ?? []).map((r: any) => r.guardia_device_id));

  const items: Item[] = [];

  // 1) open_session: currently inside with inside_since beyond long-session threshold
  for (const e of emps ?? []) {
    const emp = e as any;
    if (emp.current_status === "inside" && emp.inside_since) {
      const minutes = Math.floor((now.getTime() - new Date(emp.inside_since).getTime()) / 60000);
      if (minutes >= longSessionMin) {
        const severity: Severity = minutes >= longSessionMin * 2 ? "critical" : "warning";
        const area = emp.current_area_id ? areaMap[emp.current_area_id] : null;
        items.push({
          type: "open_session",
          severity,
          employee_id: emp.id,
          employee_nome: emp.name,
          description: `Sessão aberta há ${minutes} min (limite alerta ${longSessionMin} min)`,
          cold_area: area ? { id: area.id, name: area.name } : null,
          context: { inside_since: emp.inside_since, minutes },
          signature_key: sig("open_session", emp.id, refDate, emp.inside_since),
        });
      }
    }
  }

  // Build per-employee chronological list for session pairing
  const byEmp: Record<string, any[]> = {};
  for (const ev of events ?? []) {
    const k = (ev as any).employee_id;
    if (!k) continue;
    (byEmp[k] ||= []).push(ev);
  }

  for (const [empId, evs] of Object.entries(byEmp)) {
    let openEntry: any = null;
    for (const ev of evs) {
      if (ev.event_type === "entry") {
        if (openEntry) {
          // 2) entry_without_exit_in_period: previous entry never closed inside period
          const emp = empMap[empId];
          const area = openEntry.cold_area_id ? areaMap[openEntry.cold_area_id] : null;
          items.push({
            type: "entry_without_exit_in_period",
            severity: "warning",
            employee_id: empId,
            employee_nome: emp?.name ?? null,
            description: `Entrada em ${openEntry.occurred_at} sem saída subsequente no período`,
            cold_area: area ? { id: area.id, name: area.name } : null,
            related_event_id: openEntry.id,
            context: { entry_at: openEntry.occurred_at },
            signature_key: sig("entry_without_exit_in_period", empId, refDate, openEntry.id),
          });
        }
        openEntry = ev;
      } else if (ev.event_type === "exit") {
        if (openEntry) {
          const dur = Math.max(0, Math.round((new Date(ev.occurred_at).getTime() - new Date(openEntry.occurred_at).getTime()) / 60000));
          const area = openEntry.cold_area_id ? areaMap[openEntry.cold_area_id] : null;
          const limit = area?.exposure_limit_minutes ?? null;
          const breakMin = area?.break_minutes ?? null;
          const emp = empMap[empId];

          if (limit && dur > limit) {
            items.push({
              type: "exposure_exceeded",
              severity: "critical",
              employee_id: empId,
              employee_nome: emp?.name ?? null,
              description: `Exposição de ${dur} min na ${area.name} (limite ${limit} min)`,
              cold_area: { id: area.id, name: area.name },
              related_event_id: openEntry.id,
              context: { entry_at: openEntry.occurred_at, exit_at: ev.occurred_at, duration_minutes: dur, limit_minutes: limit },
              signature_key: sig("exposure_exceeded", empId, refDate, openEntry.id),
            });
          }

          // 4) break_not_taken: session demanded a break but no completed thermal_break overlapping exit window
          if (breakMin && dur >= breakMin) {
            const exitTs = new Date(ev.occurred_at).getTime();
            const hasBreak = (breaks ?? []).some((b: any) => {
              if (b.employee_id !== empId || !b.completed) return false;
              const st = new Date(b.started_at).getTime();
              return st >= exitTs - 30 * 60000 && st <= exitTs + 4 * 60 * 60000;
            });
            if (!hasBreak) {
              items.push({
                type: "break_not_taken",
                severity: "warning",
                employee_id: empId,
                employee_nome: emp?.name ?? null,
                description: `Sessão de ${dur} min sem pausa térmica registrada (mínimo ${breakMin} min)`,
                cold_area: { id: area.id, name: area.name },
                related_event_id: openEntry.id,
                context: { entry_at: openEntry.occurred_at, exit_at: ev.occurred_at, duration_minutes: dur, break_required_minutes: breakMin },
                signature_key: sig("break_not_taken", empId, refDate, openEntry.id),
              });
            }
          }
          openEntry = null;
        }
      }
    }
    // Trailing unclosed entry inside period → entry_without_exit_in_period
    if (openEntry) {
      const emp = empMap[empId];
      const area = openEntry.cold_area_id ? areaMap[openEntry.cold_area_id] : null;
      items.push({
        type: "entry_without_exit_in_period",
        severity: "warning",
        employee_id: empId,
        employee_nome: emp?.name ?? null,
        description: `Entrada em ${openEntry.occurred_at} sem saída no período`,
        cold_area: area ? { id: area.id, name: area.name } : null,
        related_event_id: openEntry.id,
        context: { entry_at: openEntry.occurred_at },
        signature_key: sig("entry_without_exit_in_period", empId, refDate, openEntry.id),
      });
    }
  }

  // 5) break_interrupted
  for (const b of breaks ?? []) {
    const br = b as any;
    if (!br.interrupted) continue;
    const emp = empMap[br.employee_id];
    items.push({
      type: "break_interrupted",
      severity: "warning",
      employee_id: br.employee_id,
      employee_nome: emp?.name ?? null,
      description: `Pausa térmica interrompida em ${br.started_at}`,
      context: { thermal_break_id: br.id, started_at: br.started_at },
      signature_key: sig("break_interrupted", br.employee_id, refDate, br.id),
    });
  }

  // 6) unmapped_reader (tenant-level)
  const seenDevices = new Map<string, number>();
  for (const g of gevents ?? []) {
    const dev = (g as any).dispositivo_id;
    if (!dev) continue;
    if (!mappedDevices.has(dev)) seenDevices.set(dev, (seenDevices.get(dev) ?? 0) + 1);
  }
  for (const [dev, count] of seenDevices) {
    items.push({
      type: "unmapped_reader",
      severity: "warning",
      employee_id: null,
      employee_nome: null,
      description: `Leitor não mapeado: ${dev} (${count} evento(s) no período)`,
      context: { dispositivo_id: dev, count },
      signature_key: sig("unmapped_reader", null, refDate, dev),
    });
  }

  // 7) pending_event (grouped by process_note)
  const pendingByReason = new Map<string, { ids: string[]; count: number }>();
  for (const g of gevents ?? []) {
    const ge = g as any;
    if (ge.processed) continue;
    const reason = ge.process_note ?? "sem_motivo";
    const acc = pendingByReason.get(reason) ?? { ids: [], count: 0 };
    acc.count += 1;
    if (acc.ids.length < 20) acc.ids.push(ge.id);
    pendingByReason.set(reason, acc);
  }
  for (const [reason, info] of pendingByReason) {
    items.push({
      type: "pending_event",
      severity: "warning",
      employee_id: null,
      employee_nome: null,
      description: `${info.count} evento(s) pendentes — motivo: ${reason}`,
      context: { reason, count: info.count, sample_ids: info.ids },
      signature_key: sig("pending_event", null, refDate, reason),
    });
  }

  // Cross-reference reviews
  const sigs = Array.from(new Set(items.map((i) => i.signature_key)));
  let reviewMap: Record<string, any> = {};
  if (sigs.length) {
    const { data: reviews } = await supabase
      .from("inconsistency_reviews")
      .select("signature_key, reviewed_at, reviewed_by_name")
      .eq("tenant_id", tenantId).in("signature_key", sigs);
    for (const r of reviews ?? []) reviewMap[(r as any).signature_key] = r;
  }
  for (const it of items) {
    const r = reviewMap[it.signature_key];
    it.reviewed = !!r;
    it.reviewed_at = r?.reviewed_at ?? null;
    it.reviewed_by_name = r?.reviewed_by_name ?? null;
  }

  // Summary
  const byType: Record<string, number> = {};
  const bySeverity: Record<string, number> = { info: 0, warning: 0, critical: 0 };
  const affectedEmployees = new Set<string>();
  for (const it of items) {
    byType[it.type] = (byType[it.type] ?? 0) + 1;
    bySeverity[it.severity] = (bySeverity[it.severity] ?? 0) + 1;
    if (it.employee_id) affectedEmployees.add(it.employee_id);
  }

  return {
    range: { start: start.toISOString(), end: end.toISOString() },
    period, reference_date: refDate,
    summary: {
      total: items.length,
      by_type: byType,
      by_severity: bySeverity,
      affected_employees: affectedEmployees.size,
    },
    items,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const { tenant_id, period, reference_date } = body ?? {};
  if (!tenant_id || !period || !reference_date) return json({ error: "missing_fields" }, 400);
  if (!["day", "week"].includes(period)) return json({ error: "invalid_period" }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reference_date)) return json({ error: "invalid_date" }, 400);

  // Demo tenant is public (read-only via RLS demo policies).
  const isDemo = tenant_id === "demo-tenant";

  if (!isDemo) {
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) return json({ error: "unauthorized" }, 401);

    const supabaseAuthCheck = createClient(url, service);
    const { data: canRead } = await supabaseAuthCheck.rpc("can_read_tenant", { _user_id: userRes.user.id, _tenant_id: tenant_id });
    if (!canRead) return json({ error: "forbidden" }, 403);
  }

  const supabase = createClient(url, service);
  try {
    const result = await scan(supabase, tenant_id, period as Period, reference_date);
    return json(result, 200);
  } catch (e) {
    console.error("scan_failed", (e as Error).message);
    return json({ error: "server_error" }, 500);
  }
});
