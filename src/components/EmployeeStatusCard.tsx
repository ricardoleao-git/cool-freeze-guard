import { cn } from "@/lib/utils";
import { Employee, EmployeeStatus, STATUS_LABEL } from "@/lib/demo-data";
import { useTenantScoped } from "@/lib/demo-store";
import { Snowflake, Timer, MapPin } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { StorageImage } from "@/components/StorageImage";

const statusStyles: Record<EmployeeStatus, string> = {
  outside: "bg-muted/40 border-border text-foreground",
  inside: "bg-gradient-ok/10 border-status-ok/40",
  yellow: "bg-status-yellow/15 border-status-yellow/60",
  orange: "bg-status-orange/20 border-status-orange/70",
  blocked: "bg-status-red/20 border-status-red text-foreground pulse-ring",
  thermal_break: "bg-status-break/15 border-status-break/60",
};

const ringStyles: Record<EmployeeStatus, string> = {
  outside: "ring-status-outside/30",
  inside: "ring-status-ok/60",
  yellow: "ring-status-yellow/70",
  orange: "ring-status-orange/80",
  blocked: "ring-status-red",
  thermal_break: "ring-status-break/70",
};

export function EmployeeStatusCard({ employee, size = "md" }: { employee: Employee; size?: "md" | "lg" }) {
  const { coldAreas, units, departments } = useTenantScoped();
  const area = coldAreas.find(a => a.id === employee.current_area_id);
  const unit = units.find(u => u.id === employee.unit_id);
  const dept = departments.find(d => d.id === employee.department_id);
  const limit = area?.exposure_limit_minutes ?? 100;
  const pct = Math.min(100, (employee.accumulated_minutes / limit) * 100);
  const insideMin = employee.inside_since ? Math.floor((Date.now() - employee.inside_since) / 60_000) : 0;
  const breakRemaining = employee.break_started_at ? Math.max(0, (area?.break_minutes ?? 20) - (Date.now() - employee.break_started_at) / 60_000) : 0;

  return (
    <div className={cn("rounded-2xl border p-4 transition-all backdrop-blur-sm animate-fade-in", statusStyles[employee.current_status], size === "lg" && "p-5")}>
      <div className="flex items-start gap-3">
        <img src={employee.avatar} alt={employee.name} className={cn("h-12 w-12 rounded-full ring-2", ringStyles[employee.current_status], size === "lg" && "h-14 w-14")} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className={cn("font-display font-semibold truncate", size === "lg" ? "text-lg" : "text-sm")}>{employee.name}</div>
          </div>
          <div className="text-xs text-muted-foreground truncate">{employee.position} · #{employee.registration_number}</div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
            <MapPin className="h-3 w-3" /> <span className="truncate">{unit?.name} · {dept?.name}</span>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Snowflake className="h-3.5 w-3.5" /> {STATUS_LABEL[employee.current_status]}
        </span>
        <span className="text-muted-foreground">{employee.accumulated_minutes.toFixed(0)} / {limit} min</span>
      </div>
      <Progress value={pct} className="mt-1.5 h-2" />

      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{area ? area.name : "Fora do ambiente frio"}</span>
        {employee.current_status === "thermal_break" ? (
          <span className="inline-flex items-center gap-1 text-status-break font-medium">
            <Timer className="h-3 w-3" /> Pausa: {breakRemaining.toFixed(1)} min restantes
          </span>
        ) : insideMin > 0 ? (
          <span>Dentro há {insideMin} min</span>
        ) : null}
      </div>

      {employee.current_status === "blocked" && (
        <div className="mt-3 rounded-lg bg-status-red/90 text-white text-[11px] font-bold uppercase tracking-wider text-center py-1.5">
          Bloqueio preventivo — pausa térmica obrigatória
        </div>
      )}
    </div>
  );
}
