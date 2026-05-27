import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessEvent, Alert, ColdArea, COLD_AREAS, DEPARTMENTS, DEVICES, EMPLOYEES, Employee, EmployeeStatus, Occurrence, TENANTS, ThermalBreak, UNITS,
} from "./demo-data";

type State = {
  tenants: typeof TENANTS;
  units: typeof UNITS;
  departments: typeof DEPARTMENTS;
  coldAreas: ColdArea[];
  employees: Employee[];
  devices: typeof DEVICES;
  events: AccessEvent[];
  alerts: Alert[];
  breaks: ThermalBreak[];
  occurrences: Occurrence[];
  activeTenantId: string;
  timeScale: number; // minutes per real-second
  soundEnabled: boolean;
};

type Ctx = State & {
  setActiveTenantId: (id: string) => void;
  setTimeScale: (n: number) => void;
  setSoundEnabled: (b: boolean) => void;
  simulateEntry: (employeeId: string, areaId?: string) => void;
  simulateExit: (employeeId: string) => void;
  advanceMinutes: (minutes: number) => void;
  forceStatus: (employeeId: string, target: "yellow" | "orange" | "blocked") => void;
  resetDemo: () => void;
  acknowledgeAlert: (id: string) => void;
  addOccurrence: (o: Partial<Occurrence> & { tenant_id: string; employee_id: string; category: Occurrence["category"]; description: string; }) => string;
  updateOccurrence: (id: string, patch: Partial<Occurrence>) => void;
  resolveOccurrence: (id: string, resolution: string, resolvedBy?: string) => void;
  addOccurrenceNote: (id: string, text: string, author?: string) => void;
  addOccurrenceAttachment: (id: string, file: File) => Promise<void>;
};

const DemoContext = createContext<Ctx | null>(null);

const uid = () => Math.random().toString(36).slice(2, 10);

function pickAreaForEmployee(emp: Employee, areas: ColdArea[]): ColdArea | undefined {
  return areas.find(a => a.unit_id === emp.unit_id && a.department_id === emp.department_id) || areas.find(a => a.unit_id === emp.unit_id);
}

export const DemoProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<State>(() => ({
    tenants: TENANTS,
    units: UNITS,
    departments: DEPARTMENTS,
    coldAreas: COLD_AREAS,
    employees: EMPLOYEES.map(e => ({ ...e })),
    devices: DEVICES,
    events: [],
    alerts: [],
    breaks: [],
    occurrences: [],
    activeTenantId: "t1",
    timeScale: 1, // 1 sim-minute per real-second
    soundEnabled: false,
  }));

  const audioCtxRef = useRef<AudioContext | null>(null);
  const ensureAudio = () => {
    if (!audioCtxRef.current && typeof window !== "undefined") {
      try { audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)(); } catch {}
    }
    return audioCtxRef.current;
  };
  const beep = useCallback((freq: number, dur = 0.18) => {
    if (!state.soundEnabled) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = freq; o.type = "sine";
    g.gain.value = 0.08; o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + dur);
  }, [state.soundEnabled]);

  const applyTick = useCallback((deltaMinutes: number) => {
    setState(prev => {
      const employees = prev.employees.map(e => ({ ...e }));
      const newAlerts: Alert[] = [];
      const newBreaks: ThermalBreak[] = [];
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
            if (emp.current_status === "yellow") { newAlerts.push(mkAlert(emp, "yellow", "warning", `Atenção: ${emp.name} atingiu 80 min de exposição.`)); beep(660); }
            if (emp.current_status === "orange") { newAlerts.push(mkAlert(emp, "orange", "warning", `Crítico: ${emp.name} atingiu 90 min de exposição.`)); beep(880); }
            if (emp.current_status === "blocked") {
              newAlerts.push(mkAlert(emp, "red_block", "critical", `BLOQUEIO PREVENTIVO: ${emp.name} atingiu 100 min. Pausa térmica obrigatória.`));
              beep(1200, 0.4);
              // force exit + start break
              newEvents.push(mkEvent(emp, area.id, "exit", "demo_simulation"));
              emp.inside_since = null;
              emp.current_status = "thermal_break";
              emp.break_started_at = Date.now();
              newBreaks.push({ id: uid(), tenant_id: emp.tenant_id, employee_id: emp.id, started_at: Date.now(), ended_at: null, completed: false, source: "automatic" });
            }
          }
        } else if (emp.current_status === "blocked") {
          // shouldn't linger; ensure break started
          if (!emp.break_started_at) {
            emp.current_status = "thermal_break"; emp.break_started_at = Date.now();
            newBreaks.push({ id: uid(), tenant_id: emp.tenant_id, employee_id: emp.id, started_at: Date.now(), ended_at: null, completed: false, source: "automatic" });
          }
        } else if (emp.current_status === "thermal_break") {
          // count down (using deltaMinutes against break_minutes)
          // We store break_started_at as ms timestamp; we'll add deltaMinutes by adjusting started_at backwards.
          if (emp.break_started_at) emp.break_started_at -= deltaMinutes * 60_000;
          const elapsedMin = emp.break_started_at ? (Date.now() - emp.break_started_at) / 60_000 : 0;
          if (elapsedMin >= area.break_minutes) {
            // complete break
            emp.current_status = "outside";
            emp.accumulated_minutes = 0;
            emp.current_area_id = null;
            emp.break_started_at = null;
            newAlerts.push(mkAlert(emp, "break_completed", "info", `Pausa térmica concluída: ${emp.name} está apto a retornar.`));
          }
        }
      });

      // complete breaks log
      const breaks = prev.breaks.map(b => {
        const emp = employees.find(e => e.id === b.employee_id);
        if (!b.completed && emp && emp.current_status === "outside" && emp.break_started_at === null) {
          return { ...b, ended_at: Date.now(), completed: true };
        }
        return b;
      });

      return {
        ...prev,
        employees,
        breaks: [...breaks, ...newBreaks],
        alerts: [...newAlerts, ...prev.alerts].slice(0, 200),
        events: [...newEvents, ...prev.events].slice(0, 300),
      };
    });
  }, [beep]);

  // realtime loop
  useEffect(() => {
    const id = setInterval(() => applyTick(state.timeScale / 4), 250);
    return () => clearInterval(id);
  }, [state.timeScale, applyTick]);

  const simulateEntry = useCallback((employeeId: string, areaId?: string) => {
    setState(prev => {
      const employees = prev.employees.map(e => ({ ...e }));
      const emp = employees.find(e => e.id === employeeId); if (!emp) return prev;
      if (emp.current_status === "blocked" || emp.current_status === "thermal_break") return prev;
      const area = prev.coldAreas.find(a => a.id === (areaId || emp.current_area_id || "")) || pickAreaForEmployee(emp, prev.coldAreas);
      if (!area) return prev;
      emp.current_area_id = area.id;
      emp.current_status = emp.accumulated_minutes >= area.warning_orange_minutes ? "orange" : emp.accumulated_minutes >= area.warning_yellow_minutes ? "yellow" : "inside";
      emp.inside_since = Date.now();
      const ev = mkEvent(emp, area.id, "entry", "demo_simulation");
      return { ...prev, employees, events: [ev, ...prev.events].slice(0, 300) };
    });
  }, []);

  const simulateExit = useCallback((employeeId: string) => {
    setState(prev => {
      const employees = prev.employees.map(e => ({ ...e }));
      const emp = employees.find(e => e.id === employeeId); if (!emp) return prev;
      if (!emp.current_area_id) return prev;
      const ev = mkEvent(emp, emp.current_area_id, "exit", "demo_simulation");
      emp.inside_since = null;
      emp.current_status = "outside";
      return { ...prev, employees, events: [ev, ...prev.events].slice(0, 300) };
    });
  }, []);

  const advanceMinutes = useCallback((minutes: number) => applyTick(minutes), [applyTick]);

  const forceStatus = useCallback((employeeId: string, target: "yellow" | "orange" | "blocked") => {
    setState(prev => {
      const employees = prev.employees.map(e => ({ ...e }));
      const emp = employees.find(e => e.id === employeeId); if (!emp) return prev;
      const area = pickAreaForEmployee(emp, prev.coldAreas); if (!area) return prev;
      emp.current_area_id = area.id;
      emp.inside_since = Date.now();
      if (target === "yellow") { emp.accumulated_minutes = area.warning_yellow_minutes; emp.current_status = "yellow"; }
      if (target === "orange") { emp.accumulated_minutes = area.warning_orange_minutes; emp.current_status = "orange"; }
      if (target === "blocked") { emp.accumulated_minutes = area.exposure_limit_minutes; emp.current_status = "blocked"; }
      return { ...prev, employees };
    });
  }, []);

  const resetDemo = useCallback(() => {
    setState(prev => ({
      ...prev,
      employees: EMPLOYEES.map(e => ({ ...e })),
      events: [], alerts: [], breaks: [], occurrences: [],
    }));
  }, []);

  const acknowledgeAlert = useCallback((id: string) => {
    setState(prev => ({ ...prev, alerts: prev.alerts.map(a => a.id === id ? { ...a, status: "acknowledged" } : a) }));
  }, []);

  const CATEGORY_TITLES: Record<Occurrence["category"], string> = {
    missing_exit: "Saída não registrada",
    missing_entry: "Entrada não registrada",
    device_failure: "Falha no leitor facial",
    manual_correction: "Correção manual de evento",
    false_reading: "Leitura inválida / falsa",
    other: "Ocorrência diversa",
  };

  const addOccurrence: Ctx["addOccurrence"] = useCallback((o) => {
    const id = uid();
    const occ: Occurrence = {
      id,
      tenant_id: o.tenant_id,
      employee_id: o.employee_id,
      category: o.category,
      priority: o.priority ?? "medium",
      title: o.title ?? CATEGORY_TITLES[o.category],
      description: o.description,
      status: o.status ?? "open",
      created_at: Date.now(),
      created_by: o.created_by ?? "gestor.demo",
      related_event_id: o.related_event_id,
      attachments: o.attachments ?? [],
      notes: o.notes ?? [],
    };
    setState(prev => ({ ...prev, occurrences: [occ, ...prev.occurrences] }));
    return id;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateOccurrence: Ctx["updateOccurrence"] = useCallback((id, patch) => {
    setState(prev => ({ ...prev, occurrences: prev.occurrences.map(o => o.id === id ? { ...o, ...patch } : o) }));
  }, []);

  const resolveOccurrence: Ctx["resolveOccurrence"] = useCallback((id, resolution, resolvedBy = "gestor.demo") => {
    setState(prev => ({
      ...prev,
      occurrences: prev.occurrences.map(o => o.id === id
        ? { ...o, status: "resolved", resolution, resolved_by: resolvedBy, resolved_at: Date.now() }
        : o),
    }));
  }, []);

  const addOccurrenceNote: Ctx["addOccurrenceNote"] = useCallback((id, text, author = "gestor.demo") => {
    setState(prev => ({
      ...prev,
      occurrences: prev.occurrences.map(o => o.id === id
        ? { ...o, notes: [...o.notes, { id: uid(), author, created_at: Date.now(), text }] }
        : o),
    }));
  }, []);

  const addOccurrenceAttachment: Ctx["addOccurrenceAttachment"] = useCallback(async (id, file) => {
    const data_url = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    setState(prev => ({
      ...prev,
      occurrences: prev.occurrences.map(o => o.id === id
        ? { ...o, attachments: [...o.attachments, { id: uid(), name: file.name, size: file.size, mime: file.type, data_url }] }
        : o),
    }));
  }, []);

  // seed: place a few inside on mount to make demo lively
  useEffect(() => {
    setState(prev => {
      if (prev.events.length > 0) return prev;
      const employees = prev.employees.map(e => ({ ...e }));
      const seeds: Array<[string, number]> = [
        ["e1", 35], ["e2", 78], ["e3", 88], ["e6", 22], ["e11", 55], ["e12", 92], ["e14", 12],
      ];
      const events: AccessEvent[] = [];
      seeds.forEach(([id, minutes]) => {
        const emp = employees.find(e => e.id === id); if (!emp) return;
        const area = pickAreaForEmployee(emp, prev.coldAreas); if (!area) return;
        emp.current_area_id = area.id;
        emp.accumulated_minutes = minutes;
        emp.inside_since = Date.now() - minutes * 60_000;
        emp.current_status = minutes >= 90 ? "orange" : minutes >= 80 ? "yellow" : "inside";
        events.push(mkEvent(emp, area.id, "entry", "facial_reader"));
      });
      return { ...prev, employees, events };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: Ctx = useMemo(() => ({
    ...state,
    setActiveTenantId: (id) => setState(p => ({ ...p, activeTenantId: id })),
    setTimeScale: (n) => setState(p => ({ ...p, timeScale: n })),
    setSoundEnabled: (b) => setState(p => ({ ...p, soundEnabled: b })),
    simulateEntry, simulateExit, advanceMinutes, forceStatus, resetDemo, acknowledgeAlert,
    addOccurrence, updateOccurrence, resolveOccurrence, addOccurrenceNote, addOccurrenceAttachment,
  }), [state, simulateEntry, simulateExit, advanceMinutes, forceStatus, resetDemo, acknowledgeAlert, addOccurrence, updateOccurrence, resolveOccurrence, addOccurrenceNote, addOccurrenceAttachment]);

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
};

function mkAlert(emp: Employee, type: Alert["alert_type"], severity: Alert["severity"], message: string): Alert {
  return { id: uid(), tenant_id: emp.tenant_id, employee_id: emp.id, alert_type: type, severity, message, triggered_at: Date.now(), status: "open" };
}
function mkEvent(emp: Employee, areaId: string, eventType: "entry" | "exit", source: AccessEvent["source"]): AccessEvent {
  const device = DEVICES.find(d => d.cold_area_id === areaId && d.device_type === eventType);
  return {
    id: uid(), tenant_id: emp.tenant_id, unit_id: emp.unit_id, cold_area_id: areaId,
    device_id: device?.id || "manual", employee_id: emp.id, event_type: eventType,
    source, occurred_at: Date.now(), validation_status: "valid", confidence_score: 0.92 + Math.random() * 0.07,
  };
}

export const useDemo = () => {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error("useDemo must be used within DemoProvider");
  return ctx;
};

// helpers for filtering by active tenant
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
