import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Snowflake, Timer, CalendarDays, AlertTriangle, ChevronRight, LogOut, Coffee } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePortal, fmtMinutes, fmtTime, statusTone, PortalError } from "@/lib/portal";
import PageHead from "@/components/PageHead";
import { cn } from "@/lib/utils";

export default function PortalHome() {
  const { call, link } = usePortal();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const res = await call<any>("home");
      setData(res); setErr(null);
    } catch (e) {
      setErr(e instanceof PortalError ? e.code : "network_error");
    } finally { setLoading(false); }
  }, [call]);

  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const emp = data?.employee;
  const inside = emp && ["inside", "yellow", "orange", "blocked"].includes(emp.current_status);
  const onBreak = emp?.current_status === "on_break";
  const tone = statusTone(emp?.current_status);
  const liveMinutes = inside && emp?.inside_since
    ? Math.max(0, Math.floor((now - new Date(emp.inside_since).getTime()) / 60000))
    : 0;
  const liveSeconds = inside && emp?.inside_since
    ? Math.max(0, Math.floor((now - new Date(emp.inside_since).getTime()) / 1000)) % 60
    : 0;

  return (
    <div className="space-y-4">
      <PageHead title="Início — Portal do colaborador FrioSafe" description="Resumo do seu dia: exposição ao frio, pausas térmicas e ocorrências." />
      <h1 className="sr-only">Início</h1>

      {loading && !data ? (
        <div className="space-y-4">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
      ) : err && !data ? (
        <Card className="p-5 text-sm text-muted-foreground">
          Não foi possível carregar seus dados agora.{" "}
          <button className="text-primary underline" onClick={load}>Tentar novamente</button>
        </Card>
      ) : (
        <>
          {/* Status agora */}
          <Card className={cn("p-5 border", tone.bg)}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide">
                {onBreak ? <Coffee className={cn("h-4 w-4", tone.cls)} /> : inside ? <Snowflake className={cn("h-4 w-4", tone.cls)} /> : <LogOut className="h-4 w-4 text-muted-foreground" />}
                <span className={tone.cls}>{tone.label}</span>
              </div>
              {data?.area?.name && <span className="text-[12px] text-muted-foreground truncate max-w-[45%]">{data.area.name}</span>}
            </div>

            {inside ? (
              <>
                <div className="mt-3 font-display text-5xl font-bold tabular-nums leading-none">
                  {fmtMinutes(liveMinutes)}<span className="text-xl text-muted-foreground ml-1">{String(liveSeconds).padStart(2, "0")}s</span>
                </div>
                <p className="mt-2 text-[13px] text-muted-foreground">
                  Dentro desde {fmtTime(emp.inside_since)}
                  {data?.area?.exposure_limit_minutes ? ` · limite ${data.area.exposure_limit_minutes} min` : ""}
                </p>
              </>
            ) : onBreak ? (
              <p className="mt-3 text-[15px]">Pausa térmica iniciada às {fmtTime(emp?.break_started_at)}</p>
            ) : (
              <p className="mt-3 text-[15px]">
                Última saída registrada: <strong>{fmtTime(data?.today?.last_exit_at)}</strong>
              </p>
            )}
          </Card>

          {/* Hoje */}
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Timer className="h-4 w-4" /> Hoje
              </div>
              {data?.today?.has_alert && (
                <span className="inline-flex items-center gap-1 text-[12px] text-status-yellow">
                  <AlertTriangle className="h-3.5 w-3.5" /> Limite cruzado
                </span>
              )}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-center">
              <div>
                <div className="font-display text-2xl font-bold tabular-nums">{fmtMinutes(data?.today?.total_exposure_minutes ?? 0)}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">Exposição</div>
              </div>
              <div>
                <div className="font-display text-2xl font-bold tabular-nums">{data?.today?.entries_count ?? 0}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">Entradas</div>
              </div>
              <div>
                <div className="font-display text-2xl font-bold tabular-nums">{data?.today?.breaks_completed ?? 0}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">Pausas</div>
              </div>
            </div>
          </Card>

          {/* Este mês */}
          <Card className="p-5">
            <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
              <CalendarDays className="h-4 w-4" /> Este mês
            </div>
            <div className="mt-3 flex items-end justify-between gap-3">
              <div>
                <div className="font-display text-3xl font-bold tabular-nums">{fmtMinutes(data?.month?.total_exposure_minutes ?? 0)}</div>
                <div className="text-[12px] text-muted-foreground mt-1">{data?.month?.entries_count ?? 0} entradas · {data?.month?.breaks_completed ?? 0} pausas</div>
              </div>
              <Link to="/colaborador/extrato" className="inline-flex items-center gap-1 text-[13px] font-medium text-primary">
                Ver extrato completo <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </Card>

          {/* Ocorrência aberta */}
          {(data?.open_occurrences ?? 0) > 0 && (
            <Link to="/colaborador/ocorrencias" className="block">
              <Card className="p-4 border border-status-orange/40 bg-status-orange/10 flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-status-orange shrink-0" />
                <div className="flex-1 text-[14px] font-medium">
                  Você tem {data.open_occurrences} ocorrência{data.open_occurrences > 1 ? "s" : ""} em aberto
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Card>
            </Link>
          )}

          <p className="text-[11px] text-muted-foreground text-center px-4 pt-2">
            {link?.name} · estes dados registram exposição ao frio e pausas térmicas. Não é registro de ponto.
          </p>
        </>
      )}
    </div>
  );
}
