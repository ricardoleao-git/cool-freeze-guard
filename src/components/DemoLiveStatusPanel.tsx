import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useTenantScoped } from "@/lib/demo-store";
import { STATUS_LABEL, STATUS_COLOR, type EmployeeStatus } from "@/lib/demo-data";
import { Snowflake, Timer, Activity, Thermometer, AlertTriangle, ShieldAlert, CheckCircle2, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { StorageImage } from "@/components/StorageImage";

const fmt = (min: number) => {
  const m = Math.floor(min);
  const s = Math.floor((min - m) * 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
};

const phaseFor = (status: EmployeeStatus, pct: number) => {
  if (status === "blocked") return { label: "Bloqueio preventivo disparado", icon: ShieldAlert, tone: "text-status-red", phase: 4 };
  if (status === "thermal_break") return { label: "Em pausa térmica obrigatória", icon: Timer, tone: "text-status-break", phase: 5 };
  if (status === "orange") return { label: "Crítico — próximo do limite", icon: AlertTriangle, tone: "text-status-orange", phase: 3 };
  if (status === "yellow") return { label: "Atenção — exposição prolongada", icon: AlertTriangle, tone: "text-status-yellow", phase: 2 };
  if (status === "inside") return { label: pct > 0 ? "Exposição em curso" : "Recém entrou na câmara", icon: Snowflake, tone: "text-status-ok", phase: 1 };
  return { label: "Fora da câmara fria — apto", icon: CheckCircle2, tone: "text-muted-foreground", phase: 0 };
};

export function DemoLiveStatusPanel({ employeeId }: { employeeId: string }) {
  const { employees, coldAreas, units } = useTenantScoped();
  const [now, setNow] = useState(Date.now());

  // tick a cada segundo para atualizar contadores em tempo real
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const emp = employees.find(e => e.id === employeeId);

  if (!emp) {
    return (
      <Card className="glass-card">
        <CardHeader><CardTitle className="font-display flex items-center gap-2"><Activity className="h-5 w-5" /> Status em tempo real</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground py-6">Selecione um colaborador acima para acompanhar o ciclo em tempo real.</CardContent>
      </Card>
    );
  }

  const area = coldAreas.find(a => a.id === emp.current_area_id) ?? coldAreas[0];
  const unit = units.find(u => u.id === emp.unit_id);
  const limit = area?.exposure_limit_minutes ?? 100;
  const yellow = area?.warning_yellow_minutes ?? 80;
  const orange = area?.warning_orange_minutes ?? 90;
  const breakLen = area?.break_minutes ?? 20;

  const acc = Math.min(limit, emp.accumulated_minutes);
  const pct = Math.min(100, (acc / limit) * 100);
  const insideMin = emp.inside_since ? (now - emp.inside_since) / 60_000 : 0;
  const breakElapsed = emp.break_started_at ? Math.max(0, (now - emp.break_started_at) / 60_000) : 0;
  const breakRemaining = Math.max(0, breakLen - breakElapsed);
  const breakPct = Math.min(100, (breakElapsed / breakLen) * 100);
  const remainingToLimit = Math.max(0, limit - acc);

  const phase = phaseFor(emp.current_status, pct);
  const PhaseIcon = phase.icon;

  return (
    <Card className={cn("glass-card transition-colors",
      emp.current_status === "blocked" && "ring-2 ring-status-red/60",
      emp.current_status === "thermal_break" && "ring-2 ring-status-break/50",
    )}>
      <CardHeader className="pb-3">
        <CardTitle className="font-display flex items-center justify-between gap-2">
          <span className="flex items-center gap-2"><Activity className="h-5 w-5" /> Status em tempo real</span>
          <Badge variant="outline" className="gap-1.5 text-[11px]">
            <span className={`status-dot ${STATUS_COLOR[emp.current_status]}`} />
            {STATUS_LABEL[emp.current_status]}
          </Badge>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Cabeçalho colaborador */}
        <div className="flex items-center gap-3">
          {emp.avatar
            ? <StorageImage bucket="employee-avatars" path={emp.avatar} alt={emp.name} className="h-12 w-12 rounded-full ring-2 ring-primary/40 object-cover" fallback={<div className="h-12 w-12 rounded-full bg-muted grid place-items-center font-semibold">{emp.name.split(" ").map(s => s[0]).slice(0, 2).join("")}</div>} />
            : <div className="h-12 w-12 rounded-full bg-muted grid place-items-center font-semibold">{emp.name.split(" ").map(s => s[0]).slice(0, 2).join("")}</div>
          }
          <div className="min-w-0">
            <div className="font-display font-semibold truncate">{emp.name}</div>
            <div className="text-xs text-muted-foreground truncate">
              #{emp.registration_number} · {unit?.name ?? "—"} · {area?.name ?? "—"} ({area?.average_temperature ?? "—"}°C)
            </div>
          </div>
        </div>

        {/* Fase atual */}
        <div className={cn("rounded-xl border p-3 flex items-center gap-3 bg-card/40", "border-border/60")}>
          <PhaseIcon className={cn("h-6 w-6 shrink-0", phase.tone)} />
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Fase do ciclo</div>
            <div className={cn("font-display font-semibold", phase.tone)}>{phase.label}</div>
          </div>
        </div>

        {/* Tempo acumulado de exposição */}
        <div>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="font-medium inline-flex items-center gap-1.5"><Thermometer className="h-3.5 w-3.5" /> Exposição acumulada</span>
            <span className="tabular-nums text-muted-foreground">{fmt(acc)} / {limit} min</span>
          </div>
          <div className="relative">
            <Progress value={pct} className="h-3" />
            {/* marcadores 80 / 90 */}
            <span className="absolute top-0 h-3 w-px bg-status-yellow/70" style={{ left: `${(yellow / limit) * 100}%` }} title={`${yellow} min`} />
            <span className="absolute top-0 h-3 w-px bg-status-orange/80" style={{ left: `${(orange / limit) * 100}%` }} title={`${orange} min`} />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1 tabular-nums">
            <span>0</span>
            <span className="text-status-yellow">{yellow}</span>
            <span className="text-status-orange">{orange}</span>
            <span className="text-status-red">{limit}</span>
          </div>
        </div>

        {/* Grid de métricas */}
        <div className="grid grid-cols-3 gap-2">
          <MetricTile
            label="Dentro há"
            value={emp.inside_since ? fmt(insideMin) : "—"}
            sub="min:seg"
            icon={<Snowflake className="h-3.5 w-3.5" />}
            active={!!emp.inside_since && emp.current_status !== "thermal_break"}
          />
          <MetricTile
            label="Falta p/ limite"
            value={emp.current_status === "thermal_break" ? "—" : `${remainingToLimit.toFixed(0)} min`}
            sub={`limite ${limit} min`}
            icon={<LogOut className="h-3.5 w-3.5" />}
            active={remainingToLimit > 0 && emp.current_status !== "outside" && emp.current_status !== "thermal_break"}
          />
          <MetricTile
            label="Pausa térmica"
            value={emp.break_started_at ? fmt(breakRemaining) : "—"}
            sub={emp.break_started_at ? `de ${breakLen} min` : "não iniciada"}
            icon={<Timer className="h-3.5 w-3.5" />}
            active={!!emp.break_started_at}
            tone="break"
          />
        </div>

        {/* Progresso da pausa térmica */}
        {emp.current_status === "thermal_break" && emp.break_started_at && (
          <div className="rounded-xl border border-status-break/40 bg-status-break/5 p-3">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="inline-flex items-center gap-1.5 font-medium text-status-break"><Timer className="h-3.5 w-3.5" /> Pausa térmica em andamento</span>
              <span className="tabular-nums text-status-break font-semibold">{fmt(breakElapsed)} / {breakLen} min</span>
            </div>
            <Progress value={breakPct} className="h-2.5" />
            <div className="text-[11px] text-muted-foreground mt-1.5">
              Restam <strong className="text-foreground tabular-nums">{breakRemaining.toFixed(1)} min</strong> para liberar retorno à câmara. Exposição acumulada será zerada ao concluir.
            </div>
          </div>
        )}

        {emp.current_status === "blocked" && (
          <div className="rounded-xl border border-status-red bg-status-red/10 p-3 text-xs font-semibold uppercase tracking-wider text-status-red text-center">
            Bloqueio preventivo — pausa térmica obrigatória será iniciada
          </div>
        )}

        {/* Indicador do ciclo */}
        <div className="pt-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Ciclo do colaborador</div>
          <CycleSteps phase={phase.phase} />
        </div>
      </CardContent>
    </Card>
  );
}

function MetricTile({
  label, value, sub, icon, active, tone = "primary",
}: {
  label: string; value: string; sub: string; icon: React.ReactNode; active: boolean; tone?: "primary" | "break";
}) {
  return (
    <div className={cn(
      "rounded-xl border p-2.5 bg-card/40 transition-colors",
      active && tone === "primary" && "border-primary/50 bg-primary/5",
      active && tone === "break" && "border-status-break/50 bg-status-break/5",
      !active && "border-border/60 opacity-70",
    )}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">{icon}{label}</div>
      <div className={cn("font-display font-bold text-lg tabular-nums mt-0.5",
        active && tone === "primary" && "text-primary",
        active && tone === "break" && "text-status-break",
      )}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{sub}</div>
    </div>
  );
}

const CYCLE = [
  { label: "Fora" },
  { label: "Dentro" },
  { label: "80 min" },
  { label: "90 min" },
  { label: "Bloqueio" },
  { label: "Pausa" },
];

function CycleSteps({ phase }: { phase: number }) {
  return (
    <div className="flex items-center gap-1">
      {CYCLE.map((s, i) => {
        const reached = i <= phase;
        const current = i === phase;
        return (
          <div key={s.label} className="flex-1 flex flex-col items-center">
            <div className={cn(
              "h-1.5 w-full rounded-full transition-colors",
              !reached && "bg-muted",
              reached && i < 2 && "bg-status-ok",
              reached && i === 2 && "bg-status-yellow",
              reached && i === 3 && "bg-status-orange",
              reached && i === 4 && "bg-status-red",
              reached && i === 5 && "bg-status-break",
              current && "ring-2 ring-offset-1 ring-offset-background",
              current && i === 2 && "ring-status-yellow",
              current && i === 3 && "ring-status-orange",
              current && i === 4 && "ring-status-red",
              current && i === 5 && "ring-status-break",
              current && i < 2 && "ring-status-ok",
            )} />
            <span className={cn("text-[9px] mt-1 uppercase tracking-wider", current ? "text-foreground font-semibold" : "text-muted-foreground")}>{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}
