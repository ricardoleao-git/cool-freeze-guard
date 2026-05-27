import { useEffect, useMemo, useState } from "react";
import { useTenantScoped } from "@/lib/demo-store";
import { EmployeeStatusCard } from "@/components/EmployeeStatusCard";
import { Button } from "@/components/ui/button";
import { Maximize2, Minimize2, Snowflake, AlertTriangle, ShieldAlert, Timer } from "lucide-react";
import { Employee, EmployeeStatus, STATUS_LABEL } from "@/lib/demo-data";
import { cn } from "@/lib/utils";

const GROUPS: Array<{ key: EmployeeStatus[]; title: string; accent: string; icon: JSX.Element }> = [
  { key: ["blocked"], title: "Bloqueados — Pausa Obrigatória", accent: "border-status-red/60 bg-status-red/10", icon: <ShieldAlert className="h-4 w-4 text-status-red" /> },
  { key: ["thermal_break"], title: "Em Pausa Térmica", accent: "border-status-break/60 bg-status-break/10", icon: <Timer className="h-4 w-4 text-status-break" /> },
  { key: ["orange"], title: "Crítico (90 min)", accent: "border-status-orange/60 bg-status-orange/10", icon: <AlertTriangle className="h-4 w-4 text-status-orange" /> },
  { key: ["yellow"], title: "Atenção (80 min)", accent: "border-status-yellow/60 bg-status-yellow/10", icon: <AlertTriangle className="h-4 w-4 text-status-yellow" /> },
  { key: ["inside"], title: "Dentro — OK", accent: "border-status-ok/60 bg-status-ok/10", icon: <Snowflake className="h-4 w-4 text-status-ok" /> },
  { key: ["outside"], title: "Fora da área fria", accent: "border-border bg-muted/20", icon: <Snowflake className="h-4 w-4 text-status-outside" /> },
];

export default function OperationalPanel() {
  const { employees, units } = useTenantScoped();
  const [kiosk, setKiosk] = useState(false);
  const [unitFilter, setUnitFilter] = useState<string>("all");

  const list = useMemo(
    () => employees.filter(e => unitFilter === "all" || e.unit_id === unitFilter),
    [employees, unitFilter]
  );

  const grouped = useMemo(() => GROUPS.map(g => ({
    ...g, employees: list.filter(e => g.key.includes(e.current_status)),
  })), [list]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
    setKiosk(k => !k);
  };

  useEffect(() => {
    const onFs = () => setKiosk(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  return (
    <div className={cn("min-h-full bg-background", kiosk ? "p-6" : "container py-6 md:py-8")}>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-primary/90 font-semibold mb-1">Painel Operacional · Tempo Real</div>
          <h1 className="font-display text-2xl md:text-4xl font-bold">Monitoramento de Exposição ao Frio</h1>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={unitFilter}
            onChange={(e) => setUnitFilter(e.target.value)}
            className="h-9 rounded-md border border-border bg-card px-3 text-sm"
          >
            <option value="all">Todas as unidades</option>
            {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <Button variant="outline" onClick={toggleFullscreen}>
            {kiosk ? <Minimize2 className="h-4 w-4 mr-2" /> : <Maximize2 className="h-4 w-4 mr-2" />}
            {kiosk ? "Sair do modo kiosk" : "Modo TV / Kiosk"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        {GROUPS.map(g => {
          const count = list.filter(e => g.key.includes(e.current_status)).length;
          return (
            <div key={g.title} className={cn("rounded-xl border p-4 backdrop-blur-sm", g.accent)}>
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider font-medium">{g.icon}{g.title}</div>
              <div className="text-3xl font-display font-bold mt-1">{count}</div>
            </div>
          );
        })}
      </div>

      <div className="space-y-6">
        {grouped.map(g => g.employees.length === 0 ? null : (
          <section key={g.title}>
            <div className="flex items-center gap-2 mb-3">
              {g.icon}
              <h2 className="font-display text-lg font-semibold">{g.title}</h2>
              <span className="text-xs text-muted-foreground">({g.employees.length})</span>
            </div>
            <div className={cn(
              "grid gap-3",
              kiosk ? "grid-cols-2 md:grid-cols-3 xl:grid-cols-4" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            )}>
              {g.employees.map(e => <EmployeeStatusCard key={e.id} employee={e} size={kiosk ? "lg" : "md"} />)}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
