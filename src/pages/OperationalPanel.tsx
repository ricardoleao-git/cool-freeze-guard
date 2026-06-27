import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTenantScoped } from "@/lib/demo-store";
import { EmployeeStatusCard } from "@/components/EmployeeStatusCard";
import { Button } from "@/components/ui/button";
import {
  Maximize2, Minimize2, Snowflake, AlertTriangle, ShieldAlert, Timer,
  Volume2, VolumeX, Play, Pause, Clock,
} from "lucide-react";
import { EmployeeStatus, STATUS_LABEL } from "@/lib/demo-data";
import { cn } from "@/lib/utils";

const GROUPS: Array<{ key: EmployeeStatus[]; title: string; accent: string; tile: string; icon: JSX.Element }> = [
  { key: ["blocked"], title: "Bloqueados — Pausa Obrigatória", accent: "border-status-red/60 bg-status-red/10", tile: "from-status-red/30 to-status-red/5 border-status-red/60", icon: <ShieldAlert className="h-4 w-4 text-status-red" /> },
  { key: ["thermal_break"], title: "Em Pausa Térmica", accent: "border-status-break/60 bg-status-break/10", tile: "from-status-break/30 to-status-break/5 border-status-break/60", icon: <Timer className="h-4 w-4 text-status-break" /> },
  { key: ["orange"], title: "Crítico (90 min)", accent: "border-status-orange/60 bg-status-orange/10", tile: "from-status-orange/30 to-status-orange/5 border-status-orange/60", icon: <AlertTriangle className="h-4 w-4 text-status-orange" /> },
  { key: ["yellow"], title: "Atenção (80 min)", accent: "border-status-yellow/60 bg-status-yellow/10", tile: "from-status-yellow/30 to-status-yellow/5 border-status-yellow/60", icon: <AlertTriangle className="h-4 w-4 text-status-yellow" /> },
  { key: ["inside"], title: "Dentro — OK", accent: "border-status-ok/60 bg-status-ok/10", tile: "from-status-ok/30 to-status-ok/5 border-status-ok/60", icon: <Snowflake className="h-4 w-4 text-status-ok" /> },
  { key: ["outside"], title: "Fora da área fria", accent: "border-border bg-muted/20", tile: "from-muted/40 to-muted/5 border-border", icon: <Snowflake className="h-4 w-4 text-status-outside" /> },
];

const VIEWS = [
  { id: "focus", label: "Foco em alertas" },
  { id: "all", label: "Visão geral" },
  { id: "units", label: "Por unidade" },
] as const;
type ViewId = typeof VIEWS[number]["id"];
const ROTATE_SECONDS = 12;

export default function OperationalPanel() {
  const { employees, units } = useTenantScoped();
  const [kiosk, setKiosk] = useState(false);
  const [unitFilter, setUnitFilter] = useState<string>("all");
  const [view, setView] = useState<ViewId>("focus");
  const [autoRotate, setAutoRotate] = useState(true);
  const [audio, setAudio] = useState(true);
  const [rotateTick, setRotateTick] = useState(0);
  const [now, setNow] = useState(Date.now());

  // clock + rotate ticker
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      setRotateTick(t => (t + 1) % ROTATE_SECONDS);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!autoRotate || !kiosk) return;
    if (rotateTick !== 0) return;
    setView(v => VIEWS[(VIEWS.findIndex(x => x.id === v) + 1) % VIEWS.length].id);
  }, [rotateTick, autoRotate, kiosk]);

  const list = useMemo(
    () => employees.filter(e => unitFilter === "all" || e.unit_id === unitFilter),
    [employees, unitFilter]
  );

  const counts = useMemo(() => {
    const c: Record<EmployeeStatus, number> = { outside: 0, inside: 0, yellow: 0, orange: 0, blocked: 0, thermal_break: 0 };
    list.forEach(e => { c[e.current_status]++; });
    return c;
  }, [list]);

  const criticalEmployees = useMemo(
    () => list.filter(e => e.current_status === "blocked" || e.current_status === "orange" || e.current_status === "thermal_break"),
    [list]
  );

  // Persistent audio alarm while critical present (independent from global sound toggle).
  const audioCtxRef = useRef<AudioContext | null>(null);
  const lastBeepRef = useRef(0);
  const playAlarm = useCallback((freq: number, dur = 0.35) => {
    try {
      if (!audioCtxRef.current) {
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtxRef.current = new Ctor();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.value = 0.001;
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + dur);
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    if (!kiosk || !audio) return;
    const blocked = counts.blocked;
    const orange = counts.orange;
    if (!blocked && !orange) return;
    const intervalMs = blocked > 0 ? 6000 : 12000;
    if (now - lastBeepRef.current < intervalMs) return;
    lastBeepRef.current = now;
    if (blocked > 0) { playAlarm(1200, 0.4); setTimeout(() => playAlarm(900, 0.25), 450); }
    else playAlarm(880, 0.3);
  }, [now, kiosk, audio, counts.blocked, counts.orange, playAlarm]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  };

  useEffect(() => {
    const onFs = () => setKiosk(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Unlock audio on the user's fullscreen click (browsers require gesture).
  const handleKioskClick = () => {
    if (!audioCtxRef.current) {
      try {
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtxRef.current = new Ctor();
      } catch { /* noop */ }
    }
    audioCtxRef.current?.resume?.();
    toggleFullscreen();
  };

  const timeStr = new Date(now).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dateStr = new Date(now).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });

  // -------------- NON-KIOSK (compact) --------------
  if (!kiosk) {
    const grouped = GROUPS.map(g => ({ ...g, employees: list.filter(e => g.key.includes(e.current_status)) }));
    return (
      <div className="container py-6 md:py-8">
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-primary/90 font-semibold mb-1">Painel Operacional · Tempo Real</div>
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
            <Button variant="outline" onClick={handleKioskClick}>
              <Maximize2 className="h-4 w-4 mr-2" /> Modo TV / Kiosk
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
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {g.employees.map(e => <EmployeeStatusCard key={e.id} employee={e} size="md" />)}
              </div>
            </section>
          ))}
        </div>
      </div>
    );
  }

  // -------------- KIOSK / TV --------------
  return (
    <div className="fixed inset-0 bg-gradient-to-br from-background via-background to-primary/5 text-foreground flex flex-col z-50">
      {/* Header bar */}
      <header className="flex items-center justify-between gap-3 px-3 sm:px-5 md:px-8 py-2.5 md:py-4 border-b border-border/60 backdrop-blur-sm bg-background/60">
        <div className="flex items-center gap-2 md:gap-4 min-w-0">
          <div className="h-9 w-9 md:h-12 md:w-12 rounded-xl bg-primary/15 border border-primary/40 flex items-center justify-center shrink-0">
            <Snowflake className="h-4 w-4 md:h-6 md:w-6 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="text-xs md:text-xs uppercase tracking-[0.2em] md:tracking-[0.25em] text-primary font-semibold">Painel · Tempo Real</div>
            <h1 className="font-display text-base sm:text-xl md:text-2xl xl:text-3xl font-bold leading-tight truncate">Exposição ao Frio</h1>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-6 shrink-0">
          <div className="text-right hidden sm:block">
            <div className="font-display text-xl md:text-3xl xl:text-4xl font-bold tabular-nums leading-none">{timeStr}</div>
            <div className="text-xs md:text-xs uppercase tracking-wider text-muted-foreground mt-1 capitalize hidden md:block">{dateStr}</div>
          </div>
          <div className="h-8 md:h-10 w-px bg-border hidden sm:block" />
          <div className="flex items-center gap-1.5 md:gap-2">
            <select
              value={unitFilter}
              onChange={(e) => setUnitFilter(e.target.value)}
              className="h-8 md:h-9 rounded-md border border-border bg-card px-2 md:px-3 text-xs md:text-sm max-w-[120px] md:max-w-none"
            >
              <option value="all">Todas</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <Button variant={audio ? "default" : "outline"} size="sm" onClick={() => setAudio(a => !a)} title="Alarme sonoro persistente" className="h-8 w-8 md:h-9 md:w-auto md:px-3 p-0 md:p-2">
              {audio ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </Button>
            <Button variant={autoRotate ? "default" : "outline"} size="sm" onClick={() => setAutoRotate(r => !r)} title="Auto-rotacionar visões" className="h-8 w-8 md:h-9 md:w-auto md:px-3 p-0 md:p-2">
              {autoRotate ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Button variant="outline" size="sm" onClick={toggleFullscreen} className="h-8 w-8 md:h-9 md:w-auto md:px-3 p-0 md:p-2">
              <Minimize2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Mobile clock row */}
      <div className="sm:hidden px-3 py-1.5 flex items-center justify-between border-b border-border/40 bg-background/40">
        <span className="font-display text-lg font-bold tabular-nums">{timeStr}</span>
        <span className="text-xs uppercase tracking-wider text-muted-foreground capitalize">{dateStr}</span>
      </div>

      {/* View tabs + rotation progress */}
      <div className="px-3 sm:px-5 md:px-8 pt-2 md:pt-3 pb-1.5 md:pb-2 flex items-center gap-2 md:gap-3 overflow-x-auto">
        {VIEWS.map(v => (
          <button
            key={v.id}
            onClick={() => { setView(v.id); setRotateTick(0); }}
            className={cn(
              "shrink-0 px-3 md:px-4 py-1 md:py-1.5 rounded-full text-xs md:text-xs uppercase tracking-wider font-medium border transition-colors",
              view === v.id ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {v.label}
          </button>
        ))}
        {autoRotate && (
          <div className="flex-1 hidden sm:flex items-center gap-2 ml-2 min-w-[120px]">
            <Clock className="h-3 w-3 text-muted-foreground" />
            <div className="flex-1 h-1 rounded-full bg-muted/50 overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-1000 ease-linear"
                style={{ width: `${((rotateTick + 1) / ROTATE_SECONDS) * 100}%` }}
              />
            </div>
            <span className="text-xs tabular-nums text-muted-foreground w-10 text-right">{ROTATE_SECONDS - rotateTick}s</span>
          </div>
        )}
      </div>

      {/* KPI strip — 3 cols mobile, 6 cols desktop */}
      <div className="px-3 sm:px-5 md:px-8 py-2 md:py-3 grid grid-cols-3 md:grid-cols-6 gap-2 md:gap-3">
        {GROUPS.map(g => {
          const count = g.key.reduce((acc, k) => acc + counts[k], 0);
          const isAlert = g.key.includes("blocked") || g.key.includes("orange");
          return (
            <div
              key={g.title}
              className={cn(
                "rounded-xl md:rounded-2xl border bg-gradient-to-br p-2.5 md:p-4 backdrop-blur-sm flex flex-col",
                g.tile,
                isAlert && count > 0 && "pulse-ring",
              )}
            >
              <div className="flex items-center gap-1.5 md:gap-2 text-xs md:text-xs uppercase tracking-wider font-semibold">
                {g.icon}<span className="truncate">{g.title}</span>
              </div>
              <div className="font-display text-2xl md:text-5xl xl:text-6xl font-black mt-1 md:mt-2 tabular-nums">{count}</div>
            </div>
          );
        })}
      </div>


      {/* Main content area — large status layout */}
      <main className="flex-1 overflow-auto px-3 sm:px-5 md:px-8 pb-4 md:pb-6">
        {view === "focus" && (
          <FocusView counts={counts} criticalEmployees={criticalEmployees} />
        )}

        {view === "all" && (
          <div className="space-y-5">
            {GROUPS.map(g => {
              const items = list.filter(e => g.key.includes(e.current_status));
              if (items.length === 0) return null;
              return (
                <section key={g.title}>
                  <div className="flex items-center gap-2 mb-2">
                    {g.icon}
                    <h2 className="font-display text-xl font-semibold">{g.title}</h2>
                    <span className="text-sm text-muted-foreground">({items.length})</span>
                  </div>
                  <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
                    {items.map(e => <EmployeeStatusCard key={e.id} employee={e} size="lg" />)}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {view === "units" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
            {units.filter(u => unitFilter === "all" || u.id === unitFilter).map(u => {
              const ulist = list.filter(e => e.unit_id === u.id);
              const uc: Record<EmployeeStatus, number> = { outside: 0, inside: 0, yellow: 0, orange: 0, blocked: 0, thermal_break: 0 };
              ulist.forEach(e => { uc[e.current_status]++; });
              return (
                <div key={u.id} className="rounded-2xl border border-border/70 bg-card/40 backdrop-blur p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="font-display text-lg font-bold">{u.name}</div>
                      <div className="text-xs text-muted-foreground">{u.city} · {ulist.length} colaboradores</div>
                    </div>
                    <div className="flex gap-1.5">
                      {GROUPS.map(g => {
                        const c = g.key.reduce((a, k) => a + uc[k], 0);
                        if (c === 0) return null;
                        return (
                          <div key={g.title} className={cn("min-w-[44px] text-center rounded-md border px-2 py-1", g.accent)}>
                            <div className="text-xs uppercase tracking-wider font-semibold">{STATUS_LABEL[g.key[0]]}</div>
                            <div className="font-display font-bold text-lg tabular-nums leading-none">{c}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 xl:grid-cols-3 gap-2">
                    {ulist
                      .sort((a, b) => statusWeight(b.current_status) - statusWeight(a.current_status))
                      .slice(0, 6)
                      .map(e => <EmployeeStatusCard key={e.id} employee={e} size="md" />)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

function statusWeight(s: EmployeeStatus): number {
  return { blocked: 5, orange: 4, thermal_break: 3, yellow: 2, inside: 1, outside: 0 }[s];
}

function FocusView({
  counts, criticalEmployees,
}: {
  counts: Record<EmployeeStatus, number>;
  criticalEmployees: ReturnType<typeof useTenantScoped>["employees"];
}) {
  const blocked = criticalEmployees.filter(e => e.current_status === "blocked");
  const orange = criticalEmployees.filter(e => e.current_status === "orange");
  const onBreak = criticalEmployees.filter(e => e.current_status === "thermal_break");

  if (criticalEmployees.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center py-20">
        <div className="h-32 w-32 rounded-full bg-status-ok/15 border-2 border-status-ok/60 flex items-center justify-center mb-6">
          <Snowflake className="h-16 w-16 text-status-ok" />
        </div>
        <div className="font-display text-5xl xl:text-6xl font-black mb-3">Operação sob controle</div>
        <div className="text-lg text-muted-foreground">
          Nenhum colaborador em estado crítico no momento.
        </div>
        <div className="mt-8 grid grid-cols-3 gap-6 text-center">
          <div>
            <div className="font-display text-4xl font-bold text-status-ok">{counts.inside}</div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mt-1">Dentro · OK</div>
          </div>
          <div>
            <div className="font-display text-4xl font-bold text-status-yellow">{counts.yellow}</div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mt-1">Atenção</div>
          </div>
          <div>
            <div className="font-display text-4xl font-bold text-status-outside">{counts.outside}</div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mt-1">Fora</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {blocked.length > 0 && (
        <FocusSection
          title="Bloqueio preventivo — pausa obrigatória"
          subtitle={`${blocked.length} colaborador(es) atingiram 100 min de exposição`}
          icon={<ShieldAlert className="h-6 w-6 text-status-red" />}
          color="border-status-red/70 bg-status-red/10"
        >
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {blocked.map(e => <EmployeeStatusCard key={e.id} employee={e} size="lg" />)}
          </div>
        </FocusSection>
      )}

      {orange.length > 0 && (
        <FocusSection
          title="Crítico — 90 minutos"
          subtitle={`${orange.length} colaborador(es) próximos do bloqueio`}
          icon={<AlertTriangle className="h-6 w-6 text-status-orange" />}
          color="border-status-orange/70 bg-status-orange/10"
        >
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {orange.map(e => <EmployeeStatusCard key={e.id} employee={e} size="lg" />)}
          </div>
        </FocusSection>
      )}

      {onBreak.length > 0 && (
        <FocusSection
          title="Em pausa térmica"
          subtitle={`${onBreak.length} aguardando liberação para retorno`}
          icon={<Timer className="h-6 w-6 text-status-break" />}
          color="border-status-break/70 bg-status-break/10"
        >
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {onBreak.map(e => <EmployeeStatusCard key={e.id} employee={e} size="md" />)}
          </div>
        </FocusSection>
      )}
    </div>
  );
}

function FocusSection({
  title, subtitle, icon, color, children,
}: { title: string; subtitle: string; icon: JSX.Element; color: string; children: React.ReactNode }) {
  return (
    <section className={cn("rounded-2xl border-2 backdrop-blur-sm p-5", color)}>
      <div className="flex items-center gap-3 mb-4">
        {icon}
        <div>
          <h2 className="font-display text-2xl font-bold leading-tight">{title}</h2>
          <div className="text-sm text-muted-foreground">{subtitle}</div>
        </div>
      </div>
      {children}
    </section>
  );
}
