import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  AccessEvent, Alert, ColdArea, Department, Device, Employee, EmployeeStatus,
  Occurrence, OccurrenceAttachment, OccurrenceCategory, OccurrenceNote, OccurrencePriority,
  Tenant, ThermalBreak, Unit,
} from "./demo-data";

type State = {
  tenants: Tenant[];
  units: Unit[];
  departments: Department[];
  coldAreas: ColdArea[];
  employees: Employee[];
  devices: Device[];
  events: AccessEvent[];
  alerts: Alert[];
  breaks: ThermalBreak[];
  occurrences: Occurrence[];
  activeTenantId: string;
  timeScale: number;
  soundEnabled: boolean;
  loading: boolean;
};

type Ctx = State & {
  setActiveTenantId: (id: string) => void;
  setTimeScale: (n: number) => void;
  setSoundEnabled: (b: boolean) => void;
  simulateEntry: (employeeId: string, areaId?: string) => Promise<void>;
  simulateExit: (employeeId: string) => Promise<void>;
  advanceMinutes: (minutes: number) => void;
  forceStatus: (employeeId: string, target: "yellow" | "orange" | "blocked") => Promise<void>;
  resetDemo: () => Promise<void>;
  acknowledgeAlert: (id: string) => Promise<void>;
  addOccurrence: (o: Partial<Occurrence> & { tenant_id: string; employee_id: string; category: OccurrenceCategory; description: string; }) => Promise<string | null>;
  updateOccurrence: (id: string, patch: Partial<Occurrence>) => Promise<void>;
  resolveOccurrence: (id: string, resolution: string, resolvedBy?: string) => Promise<void>;
  addOccurrenceNote: (id: string, text: string, author?: string) => Promise<void>;
  addOccurrenceAttachment: (id: string, file: File) => Promise<void>;
  createEmployee: (data: Omit<Employee, "id" | "current_status" | "accumulated_minutes" | "inside_since" | "current_area_id" | "break_started_at">) => Promise<Employee>;
  updateEmployee: (id: string, patch: Partial<Employee>) => Promise<void>;
  deleteEmployee: (id: string) => Promise<void>;
  uploadEmployeeAvatar: (employeeId: string, file: File) => Promise<string>;
};

const DemoContext = createContext<Ctx | null>(null);

const ATTACHMENT_BUCKET = "occurrence-attachments";
const AVATAR_BUCKET = "employee-avatars";

// ---------- mapping helpers (DB row <-> client) ----------
const toMs = (s?: string | null) => (s ? new Date(s).getTime() : null);
const toIso = (ms?: number | null) => (ms ? new Date(ms).toISOString() : null);

const mapEmployee = (r: any): Employee => ({
  id: r.id, tenant_id: r.tenant_id, unit_id: r.unit_id, department_id: r.department_id,
  name: r.name, registration_number: r.registration_number, position: r.position,
  avatar: r.avatar, status: r.status,
  current_status: r.current_status as EmployeeStatus,
  accumulated_minutes: Number(r.accumulated_minutes) || 0,
  inside_since: toMs(r.inside_since),
  current_area_id: r.current_area_id,
  break_started_at: toMs(r.break_started_at),
});
const mapEvent = (r: any): AccessEvent => ({
  id: r.id, tenant_id: r.tenant_id, unit_id: r.unit_id, cold_area_id: r.cold_area_id,
  device_id: r.device_id || "manual", employee_id: r.employee_id,
  event_type: r.event_type, source: r.source,
  occurred_at: toMs(r.occurred_at) || Date.now(),
  validation_status: r.validation_status,
  confidence_score: Number(r.confidence_score) || 0.95,
});
const mapAlert = (r: any): Alert => ({
  id: r.id, tenant_id: r.tenant_id, employee_id: r.employee_id,
  alert_type: r.alert_type, severity: r.severity, message: r.message,
  triggered_at: toMs(r.triggered_at) || Date.now(),
  status: r.status,
});
const mapBreak = (r: any): ThermalBreak => ({
  id: r.id, tenant_id: r.tenant_id, employee_id: r.employee_id,
  started_at: toMs(r.started_at) || Date.now(),
  ended_at: toMs(r.ended_at), completed: r.completed, source: r.source,
});
const mapOccurrence = (r: any, notes: OccurrenceNote[], attachments: OccurrenceAttachment[]): Occurrence => ({
  id: r.id, tenant_id: r.tenant_id, employee_id: r.employee_id,
  category: r.category as OccurrenceCategory,
  priority: r.priority as OccurrencePriority,
  title: r.title, description: r.description, status: r.status,
  created_at: toMs(r.created_at) || Date.now(),
  created_by: r.created_by, related_event_id: r.related_event_id || undefined,
  resolved_at: toMs(r.resolved_at) || undefined, resolved_by: r.resolved_by || undefined,
  resolution: r.resolution || undefined,
  attachments, notes,
});
const mapNote = (r: any): OccurrenceNote => ({
  id: r.id, author: r.author, text: r.text, created_at: toMs(r.created_at) || Date.now(),
});
const mapAttachment = (r: any): OccurrenceAttachment => {
  const { data } = supabase.storage.from(ATTACHMENT_BUCKET).getPublicUrl(r.storage_path);
  return {
    id: r.id, name: r.name, size: Number(r.size) || 0, mime: r.mime,
    data_url: data.publicUrl,
  };
};

function pickAreaForEmployee(emp: Employee, areas: ColdArea[]): ColdArea | undefined {
  return areas.find(a => a.unit_id === emp.unit_id && a.department_id === emp.department_id)
      || areas.find(a => a.unit_id === emp.unit_id);
}

const CATEGORY_TITLES: Record<OccurrenceCategory, string> = {
  missing_exit: "Saída não registrada",
  missing_entry: "Entrada não registrada",
  device_failure: "Falha no leitor facial",
  manual_correction: "Correção manual de evento",
  false_reading: "Leitura inválida / falsa",
  other: "Ocorrência diversa",
};

export const DemoProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<State>({
    tenants: [], units: [], departments: [], coldAreas: [], employees: [], devices: [],
    events: [], alerts: [], breaks: [], occurrences: [],
    activeTenantId: "t1", timeScale: 1, soundEnabled: false, loading: true,
  });

  // dirty employees to flush periodically
  const dirtyEmployeesRef = useRef<Set<string>>(new Set());
  const employeesRef = useRef<Employee[]>([]);
  useEffect(() => { employeesRef.current = state.employees; }, [state.employees]);

  // ---------- audio ----------
  const audioCtxRef = useRef<AudioContext | null>(null);
  const soundRef = useRef(state.soundEnabled);
  useEffect(() => { soundRef.current = state.soundEnabled; }, [state.soundEnabled]);
  const beep = useCallback((freq: number, dur = 0.18) => {
    if (!soundRef.current) return;
    if (!audioCtxRef.current) {
      try { audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)(); } catch { return; }
    }
    const ctx = audioCtxRef.current!;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = freq; o.type = "sine"; g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + dur);
  }, []);

  // ---------- initial load ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [tenants, units, departments, coldAreas, employees, devices, events, alerts, breaks, occurrences, notes, attachments] = await Promise.all([
        supabase.from("tenants").select("*").order("name"),
        supabase.from("units").select("*").order("name"),
        supabase.from("departments").select("*").order("name"),
        supabase.from("cold_areas").select("*").order("name"),
        supabase.from("employees").select("*").order("name"),
        supabase.from("devices").select("*").order("name"),
        supabase.from("access_events").select("*").order("occurred_at", { ascending: false }).limit(500),
        supabase.from("alerts").select("*").order("triggered_at", { ascending: false }).limit(300),
        supabase.from("thermal_breaks").select("*").order("started_at", { ascending: false }).limit(300),
        supabase.from("occurrences").select("*").order("created_at", { ascending: false }),
        supabase.from("occurrence_notes").select("*").order("created_at", { ascending: true }),
        supabase.from("occurrence_attachments").select("*").order("created_at", { ascending: true }),
      ]);
      if (cancelled) return;
      const notesByOcc = new Map<string, OccurrenceNote[]>();
      (notes.data || []).forEach(n => {
        const arr = notesByOcc.get(n.occurrence_id) || [];
        arr.push(mapNote(n)); notesByOcc.set(n.occurrence_id, arr);
      });
      const attByOcc = new Map<string, OccurrenceAttachment[]>();
      (attachments.data || []).forEach(a => {
        const arr = attByOcc.get(a.occurrence_id) || [];
        arr.push(mapAttachment(a)); attByOcc.set(a.occurrence_id, arr);
      });
      setState(s => ({
        ...s,
        tenants: (tenants.data || []) as Tenant[],
        units: (units.data || []) as Unit[],
        departments: (departments.data || []) as Department[],
        coldAreas: (coldAreas.data || []) as ColdArea[],
        employees: (employees.data || []).map(mapEmployee),
        devices: (devices.data || []).map((d: any) => ({ ...d, last_seen_at: toMs(d.last_seen_at) || Date.now() })) as Device[],
        events: (events.data || []).map(mapEvent),
        alerts: (alerts.data || []).map(mapAlert),
        breaks: (breaks.data || []).map(mapBreak),
        occurrences: (occurrences.data || []).map(o => mapOccurrence(o, notesByOcc.get(o.id) || [], attByOcc.get(o.id) || [])),
        loading: false,
      }));
    })();
    return () => { cancelled = true; };
  }, []);

  // ---------- realtime ----------
  useEffect(() => {
    const channel = supabase.channel("friosafe-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "employees" }, (p) => {
        setState(s => {
          if (p.eventType === "DELETE") return { ...s, employees: s.employees.filter(e => e.id !== (p.old as any).id) };
          const mapped = mapEmployee(p.new);
          const exists = s.employees.some(e => e.id === mapped.id);
          return { ...s, employees: exists ? s.employees.map(e => e.id === mapped.id ? mapped : e) : [...s.employees, mapped] };
        });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "access_events" }, (p) => {
        const ev = mapEvent(p.new);
        setState(s => s.events.some(e => e.id === ev.id) ? s : { ...s, events: [ev, ...s.events].slice(0, 500) });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, (p) => {
        if (p.eventType === "DELETE") {
          setState(s => ({ ...s, alerts: s.alerts.filter(a => a.id !== (p.old as any).id) }));
          return;
        }
        const a = mapAlert(p.new);
        setState(s => {
          const exists = s.alerts.some(x => x.id === a.id);
          return { ...s, alerts: exists ? s.alerts.map(x => x.id === a.id ? a : x) : [a, ...s.alerts].slice(0, 300) };
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "thermal_breaks" }, (p) => {
        if (p.eventType === "DELETE") {
          setState(s => ({ ...s, breaks: s.breaks.filter(b => b.id !== (p.old as any).id) }));
          return;
        }
        const b = mapBreak(p.new);
        setState(s => {
          const exists = s.breaks.some(x => x.id === b.id);
          return { ...s, breaks: exists ? s.breaks.map(x => x.id === b.id ? b : x) : [b, ...s.breaks].slice(0, 300) };
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "occurrences" }, (p) => {
        if (p.eventType === "DELETE") {
          setState(s => ({ ...s, occurrences: s.occurrences.filter(o => o.id !== (p.old as any).id) }));
          return;
        }
        setState(s => {
          const existing = s.occurrences.find(o => o.id === (p.new as any).id);
          const o = mapOccurrence(p.new, existing?.notes || [], existing?.attachments || []);
          return existing
            ? { ...s, occurrences: s.occurrences.map(x => x.id === o.id ? o : x) }
            : { ...s, occurrences: [o, ...s.occurrences] };
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "occurrence_notes" }, (p) => {
        setState(s => ({
          ...s,
          occurrences: s.occurrences.map(o => {
            if (p.eventType === "DELETE") {
              return o.id === (p.old as any).occurrence_id
                ? { ...o, notes: o.notes.filter(n => n.id !== (p.old as any).id) } : o;
            }
            const n = mapNote(p.new);
            if (o.id !== (p.new as any).occurrence_id) return o;
            return o.notes.some(x => x.id === n.id)
              ? { ...o, notes: o.notes.map(x => x.id === n.id ? n : x) }
              : { ...o, notes: [...o.notes, n] };
          }),
        }));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "occurrence_attachments" }, (p) => {
        setState(s => ({
          ...s,
          occurrences: s.occurrences.map(o => {
            if (p.eventType === "DELETE") {
              return o.id === (p.old as any).occurrence_id
                ? { ...o, attachments: o.attachments.filter(a => a.id !== (p.old as any).id) } : o;
            }
            const a = mapAttachment(p.new);
            if (o.id !== (p.new as any).occurrence_id) return o;
            return o.attachments.some(x => x.id === a.id)
              ? { ...o, attachments: o.attachments.map(x => x.id === a.id ? a : x) }
              : { ...o, attachments: [...o.attachments, a] };
          }),
        }));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // ---------- DB writers (fire-and-forget) ----------
  const persistAlert = async (a: Alert) => {
    await supabase.from("alerts").insert({
      id: a.id, tenant_id: a.tenant_id, employee_id: a.employee_id,
      alert_type: a.alert_type, severity: a.severity, message: a.message,
      triggered_at: toIso(a.triggered_at), status: a.status,
    });
  };
  const persistEvent = async (e: AccessEvent) => {
    await supabase.from("access_events").insert({
      id: e.id, tenant_id: e.tenant_id, unit_id: e.unit_id, cold_area_id: e.cold_area_id,
      device_id: e.device_id === "manual" ? null : e.device_id,
      employee_id: e.employee_id, event_type: e.event_type, source: e.source,
      occurred_at: toIso(e.occurred_at), validation_status: e.validation_status,
      confidence_score: e.confidence_score,
    });
  };
  const persistBreak = async (b: ThermalBreak) => {
    await supabase.from("thermal_breaks").insert({
      id: b.id, tenant_id: b.tenant_id, employee_id: b.employee_id,
      started_at: toIso(b.started_at), ended_at: toIso(b.ended_at),
      completed: b.completed, source: b.source,
    });
  };
  const updateBreakById = async (id: string, patch: Partial<ThermalBreak>) => {
    await supabase.from("thermal_breaks").update({
      ended_at: patch.ended_at ? toIso(patch.ended_at) : undefined,
      completed: patch.completed,
    }).eq("id", id);
  };
  const flushEmployee = async (emp: Employee) => {
    await supabase.from("employees").update({
      current_status: emp.current_status,
      accumulated_minutes: emp.accumulated_minutes,
      inside_since: toIso(emp.inside_since),
      current_area_id: emp.current_area_id,
      break_started_at: toIso(emp.break_started_at),
      updated_at: new Date().toISOString(),
    }).eq("id", emp.id);
  };

  // ---------- tick (local) ----------
  const uid = () => crypto.randomUUID();

  const applyTick = useCallback((deltaMinutes: number) => {
    setState(prev => {
      const employees = prev.employees.map(e => ({ ...e }));
      const newAlerts: Alert[] = [];
      const newBreaks: ThermalBreak[] = [];
      const completedBreakIds: string[] = [];
      const newEvents: AccessEvent[] = [];

      employees.forEach(emp => {
        const area = prev.coldAreas.find(a => a.id === emp.current_area_id) || pickAreaForEmployee(emp, prev.coldAreas);
        if (!area) return;

        if (emp.current_status === "inside" || emp.current_status === "yellow" || emp.current_status === "orange") {
          emp.accumulated_minutes = Math.min(area.exposure_limit_minutes, emp.accumulated_minutes + deltaMinutes);
          const prevStatus = emp.current_status;
          if (emp.accumulated_minutes >= area.exposure_limit_minutes) emp.current_status = "blocked";
          else if (emp.accumulated_minutes >= area.warning_orange_minutes) emp.current_status = "orange";
          else if (emp.accumulated_minutes >= area.warning_yellow_minutes) emp.current_status = "yellow";

          if (prevStatus !== emp.current_status) {
            dirtyEmployeesRef.current.add(emp.id);
            if (emp.current_status === "yellow") { newAlerts.push(mkAlert(emp, "yellow", "warning", `Atenção: ${emp.name} atingiu 80 min de exposição.`)); beep(660); }
            if (emp.current_status === "orange") { newAlerts.push(mkAlert(emp, "orange", "warning", `Crítico: ${emp.name} atingiu 90 min de exposição.`)); beep(880); }
            if (emp.current_status === "blocked") {
              newAlerts.push(mkAlert(emp, "red_block", "critical", `BLOQUEIO PREVENTIVO: ${emp.name} atingiu 100 min. Pausa térmica obrigatória.`));
              beep(1200, 0.4);
              const ev = mkEvent(emp, area.id, "exit", "demo_simulation", prev.devices);
              newEvents.push(ev);
              emp.inside_since = null;
              emp.current_status = "thermal_break";
              emp.break_started_at = Date.now();
              newBreaks.push({ id: uid(), tenant_id: emp.tenant_id, employee_id: emp.id, started_at: Date.now(), ended_at: null, completed: false, source: "automatic" });
            }
          } else if (Math.random() < 0.05) {
            dirtyEmployeesRef.current.add(emp.id);
          }
        } else if (emp.current_status === "thermal_break") {
          if (emp.break_started_at) emp.break_started_at -= deltaMinutes * 60_000;
          const elapsedMin = emp.break_started_at ? (Date.now() - emp.break_started_at) / 60_000 : 0;
          if (elapsedMin >= area.break_minutes) {
            emp.current_status = "outside";
            emp.accumulated_minutes = 0;
            emp.current_area_id = null;
            emp.break_started_at = null;
            dirtyEmployeesRef.current.add(emp.id);
            newAlerts.push(mkAlert(emp, "break_completed", "info", `Pausa térmica concluída: ${emp.name} está apto a retornar.`));
            const ongoing = prev.breaks.find(b => b.employee_id === emp.id && !b.completed);
            if (ongoing) completedBreakIds.push(ongoing.id);
          }
        }
      });

      // persist async
      newAlerts.forEach(a => { persistAlert(a).catch(() => {}); });
      newEvents.forEach(e => { persistEvent(e).catch(() => {}); });
      newBreaks.forEach(b => { persistBreak(b).catch(() => {}); });
      completedBreakIds.forEach(id => { updateBreakById(id, { ended_at: Date.now(), completed: true }).catch(() => {}); });

      const breaks = prev.breaks.map(b =>
        completedBreakIds.includes(b.id) ? { ...b, ended_at: Date.now(), completed: true } : b,
      );

      return {
        ...prev,
        employees,
        breaks: [...breaks, ...newBreaks],
        alerts: [...newAlerts, ...prev.alerts].slice(0, 300),
        events: [...newEvents, ...prev.events].slice(0, 500),
      };
    });
  }, [beep]);

  // tick loop
  useEffect(() => {
    if (state.loading) return;
    const id = setInterval(() => applyTick(state.timeScale / 4), 250);
    return () => clearInterval(id);
  }, [state.timeScale, state.loading, applyTick]);

  // flush dirty employees every 5s
  useEffect(() => {
    const id = setInterval(() => {
      const dirty = Array.from(dirtyEmployeesRef.current);
      if (dirty.length === 0) return;
      dirtyEmployeesRef.current.clear();
      const map = new Map(employeesRef.current.map(e => [e.id, e]));
      dirty.forEach(id => { const e = map.get(id); if (e) flushEmployee(e).catch(() => {}); });
    }, 5000);
    return () => clearInterval(id);
  }, []);

  // ---------- mutations ----------
  const simulateEntry = useCallback(async (employeeId: string, areaId?: string) => {
    const emp = employeesRef.current.find(e => e.id === employeeId); if (!emp) return;
    if (emp.current_status === "blocked" || emp.current_status === "thermal_break") return;
    let area: ColdArea | undefined;
    setState(prev => {
      area = prev.coldAreas.find(a => a.id === (areaId || emp.current_area_id || "")) || pickAreaForEmployee(emp, prev.coldAreas);
      if (!area) return prev;
      const employees = prev.employees.map(x => x.id === emp.id ? {
        ...x,
        current_area_id: area!.id,
        current_status: x.accumulated_minutes >= area!.warning_orange_minutes ? "orange" as const
          : x.accumulated_minutes >= area!.warning_yellow_minutes ? "yellow" as const
            : "inside" as const,
        inside_since: Date.now(),
      } : x);
      return { ...prev, employees };
    });
    if (!area) return;
    const updated = employeesRef.current.find(e => e.id === employeeId)!;
    await flushEmployee(updated);
    await persistEvent(mkEvent(updated, area.id, "entry", "demo_simulation"));
  }, []);

  const simulateExit = useCallback(async (employeeId: string) => {
    const emp = employeesRef.current.find(e => e.id === employeeId); if (!emp || !emp.current_area_id) return;
    const areaId = emp.current_area_id;
    setState(prev => ({
      ...prev,
      employees: prev.employees.map(x => x.id === emp.id ? { ...x, inside_since: null, current_status: "outside" as const } : x),
    }));
    const updated = employeesRef.current.find(e => e.id === employeeId)!;
    await flushEmployee(updated);
    await persistEvent(mkEvent(updated, areaId, "exit", "demo_simulation"));
  }, []);

  const advanceMinutes = useCallback((minutes: number) => applyTick(minutes), [applyTick]);

  const forceStatus = useCallback(async (employeeId: string, target: "yellow" | "orange" | "blocked") => {
    setState(prev => {
      const emp = prev.employees.find(e => e.id === employeeId); if (!emp) return prev;
      const area = pickAreaForEmployee(emp, prev.coldAreas); if (!area) return prev;
      const next: Employee = {
        ...emp, current_area_id: area.id, inside_since: Date.now(),
        accumulated_minutes:
          target === "yellow" ? area.warning_yellow_minutes :
          target === "orange" ? area.warning_orange_minutes : area.exposure_limit_minutes,
        current_status: target,
      };
      dirtyEmployeesRef.current.add(emp.id);
      return { ...prev, employees: prev.employees.map(e => e.id === emp.id ? next : e) };
    });
    const updated = employeesRef.current.find(e => e.id === employeeId);
    if (updated) await flushEmployee(updated);
  }, []);

  const resetDemo = useCallback(async () => {
    // wipe ephemeral data and reset employees
    await Promise.all([
      supabase.from("access_events").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
      supabase.from("alerts").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
      supabase.from("thermal_breaks").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
    ]);
    await supabase.from("employees").update({
      current_status: "outside", accumulated_minutes: 0,
      inside_since: null, current_area_id: null, break_started_at: null,
    }).neq("id", "");
    setState(s => ({
      ...s,
      employees: s.employees.map(e => ({ ...e, current_status: "outside" as const, accumulated_minutes: 0, inside_since: null, current_area_id: null, break_started_at: null })),
      events: [], alerts: [], breaks: [],
    }));
  }, []);

  const acknowledgeAlert = useCallback(async (id: string) => {
    setState(prev => ({ ...prev, alerts: prev.alerts.map(a => a.id === id ? { ...a, status: "acknowledged" } : a) }));
    await supabase.from("alerts").update({ status: "acknowledged" }).eq("id", id);
  }, []);

  const addOccurrence: Ctx["addOccurrence"] = useCallback(async (o) => {
    const payload = {
      tenant_id: o.tenant_id, employee_id: o.employee_id,
      category: o.category, priority: o.priority ?? "medium",
      title: o.title ?? CATEGORY_TITLES[o.category],
      description: o.description, status: o.status ?? "open",
      created_by: o.created_by ?? "gestor.demo",
      related_event_id: o.related_event_id ?? null,
    };
    const { data, error } = await supabase.from("occurrences").insert(payload).select("*").single();
    if (error || !data) return null;
    setState(s => s.occurrences.some(x => x.id === data.id) ? s
      : { ...s, occurrences: [mapOccurrence(data, [], []), ...s.occurrences] });
    return data.id;
  }, []);

  const updateOccurrence: Ctx["updateOccurrence"] = useCallback(async (id, patch) => {
    setState(prev => ({ ...prev, occurrences: prev.occurrences.map(o => o.id === id ? { ...o, ...patch } : o) }));
    const dbPatch: any = {};
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.priority !== undefined) dbPatch.priority = patch.priority;
    if (patch.title !== undefined) dbPatch.title = patch.title;
    if (patch.description !== undefined) dbPatch.description = patch.description;
    if (Object.keys(dbPatch).length > 0) {
      await supabase.from("occurrences").update(dbPatch).eq("id", id);
    }
    // handle attachment removal locally (server side)
    if (patch.attachments) {
      const current = state.occurrences.find(o => o.id === id);
      const removed = (current?.attachments || []).filter(a => !patch.attachments!.some(p => p.id === a.id));
      for (const a of removed) {
        await supabase.from("occurrence_attachments").delete().eq("id", a.id);
      }
    }
  }, [state.occurrences]);

  const resolveOccurrence: Ctx["resolveOccurrence"] = useCallback(async (id, resolution, resolvedBy = "gestor.demo") => {
    const resolved_at = new Date().toISOString();
    setState(prev => ({
      ...prev,
      occurrences: prev.occurrences.map(o => o.id === id
        ? { ...o, status: "resolved", resolution, resolved_by: resolvedBy, resolved_at: Date.now() } : o),
    }));
    await supabase.from("occurrences").update({
      status: "resolved", resolution, resolved_by: resolvedBy, resolved_at,
    }).eq("id", id);
  }, []);

  const addOccurrenceNote: Ctx["addOccurrenceNote"] = useCallback(async (id, text, author = "gestor.demo") => {
    const { data } = await supabase.from("occurrence_notes")
      .insert({ occurrence_id: id, author, text }).select("*").single();
    if (data) {
      const note = mapNote(data);
      setState(prev => ({
        ...prev,
        occurrences: prev.occurrences.map(o => o.id === id && !o.notes.some(n => n.id === note.id)
          ? { ...o, notes: [...o.notes, note] } : o),
      }));
    }
  }, []);

  const addOccurrenceAttachment: Ctx["addOccurrenceAttachment"] = useCallback(async (id, file) => {
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storage_path = `${id}/${Date.now()}_${safe}`;
    const up = await supabase.storage.from(ATTACHMENT_BUCKET).upload(storage_path, file, {
      contentType: file.type || "application/octet-stream",
    });
    if (up.error) throw up.error;
    const { data } = await supabase.from("occurrence_attachments").insert({
      occurrence_id: id, name: file.name, size: file.size, mime: file.type, storage_path,
    }).select("*").single();
    if (data) {
      const att = mapAttachment(data);
      setState(prev => ({
        ...prev,
        occurrences: prev.occurrences.map(o => o.id === id && !o.attachments.some(a => a.id === att.id)
          ? { ...o, attachments: [...o.attachments, att] } : o),
      }));
    }
  }, []);

  const uploadEmployeeAvatar: Ctx["uploadEmployeeAvatar"] = useCallback(async (employeeId, file) => {
    const ext = file.name.split(".").pop()?.toLowerCase() || "png";
    const storage_path = `${employeeId}/${Date.now()}.${ext}`;
    const up = await supabase.storage.from(AVATAR_BUCKET).upload(storage_path, file, {
      contentType: file.type || "image/png",
      upsert: true,
    });
    if (up.error) throw up.error;
    const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(storage_path);
    return data.publicUrl;
  }, []);

  const createEmployee: Ctx["createEmployee"] = useCallback(async (data) => {
    const id = `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const row = {
      id, tenant_id: data.tenant_id, unit_id: data.unit_id, department_id: data.department_id,
      name: data.name, registration_number: data.registration_number, position: data.position,
      avatar: data.avatar || "", status: data.status,
      current_status: "outside", accumulated_minutes: 0,
      inside_since: null, current_area_id: null, break_started_at: null,
    };
    const { data: inserted, error } = await supabase.from("employees").insert(row).select("*").single();
    if (error) throw error;
    const emp = mapEmployee(inserted);
    setState(prev => prev.employees.some(e => e.id === emp.id) ? prev : { ...prev, employees: [...prev.employees, emp] });
    return emp;
  }, []);

  const updateEmployee: Ctx["updateEmployee"] = useCallback(async (id, patch) => {
    const payload: any = { updated_at: new Date().toISOString() };
    ["name", "registration_number", "position", "avatar", "status", "unit_id", "department_id", "tenant_id"].forEach(k => {
      if ((patch as any)[k] !== undefined) payload[k] = (patch as any)[k];
    });
    const { error } = await supabase.from("employees").update(payload).eq("id", id);
    if (error) throw error;
    setState(prev => ({ ...prev, employees: prev.employees.map(e => e.id === id ? { ...e, ...patch } : e) }));
  }, []);

  const deleteEmployee: Ctx["deleteEmployee"] = useCallback(async (id) => {
    const { error } = await supabase.from("employees").delete().eq("id", id);
    if (error) throw error;
    setState(prev => ({ ...prev, employees: prev.employees.filter(e => e.id !== id) }));
  }, []);

  const value: Ctx = useMemo(() => ({
    ...state,
    setActiveTenantId: (id) => setState(p => ({ ...p, activeTenantId: id })),
    setTimeScale: (n) => setState(p => ({ ...p, timeScale: n })),
    setSoundEnabled: (b) => setState(p => ({ ...p, soundEnabled: b })),
    simulateEntry, simulateExit, advanceMinutes, forceStatus, resetDemo, acknowledgeAlert,
    addOccurrence, updateOccurrence, resolveOccurrence, addOccurrenceNote, addOccurrenceAttachment,
    createEmployee, updateEmployee, deleteEmployee, uploadEmployeeAvatar,
  }), [state, simulateEntry, simulateExit, advanceMinutes, forceStatus, resetDemo, acknowledgeAlert,
       addOccurrence, updateOccurrence, resolveOccurrence, addOccurrenceNote, addOccurrenceAttachment,
       createEmployee, updateEmployee, deleteEmployee, uploadEmployeeAvatar]);

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
};

function mkAlert(emp: Employee, type: Alert["alert_type"], severity: Alert["severity"], message: string): Alert {
  return { id: crypto.randomUUID(), tenant_id: emp.tenant_id, employee_id: emp.id, alert_type: type, severity, message, triggered_at: Date.now(), status: "open" };
}
function mkEvent(emp: Employee, areaId: string, eventType: "entry" | "exit", source: AccessEvent["source"], devices?: Device[]): AccessEvent {
  const device = devices?.find(d => d.cold_area_id === areaId && d.device_type === eventType);
  return {
    id: crypto.randomUUID(), tenant_id: emp.tenant_id, unit_id: emp.unit_id, cold_area_id: areaId,
    device_id: device?.id || "manual", employee_id: emp.id, event_type: eventType,
    source, occurred_at: Date.now(), validation_status: "valid", confidence_score: 0.92 + Math.random() * 0.07,
  };
}

export const useDemo = () => {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error("useDemo must be used within DemoProvider");
  return ctx;
};

export const useTenantScoped = () => {
  const s = useDemo();
  const t = s.activeTenantId;
  return {
    units: s.units.filter(u => u.tenant_id === t),
    departments: s.departments.filter(d => d.tenant_id === t),
    coldAreas: s.coldAreas.filter(c => c.tenant_id === t),
    employees: s.employees.filter(e => e.tenant_id === t),
    devices: s.devices.filter(d => d.tenant_id === t),
    events: s.events.filter(e => e.tenant_id === t),
    alerts: s.alerts.filter(a => a.tenant_id === t),
    breaks: s.breaks.filter(b => b.tenant_id === t),
    occurrences: s.occurrences.filter(o => o.tenant_id === t),
  };
};

export const employeeStatusKey = (e: Employee): EmployeeStatus => e.current_status;
