import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, Clock, ShieldCheck, Snowflake, AlertTriangle, Check, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import PageHead from "@/components/PageHead";
import { usePortal, fmtMinutes, fmtTime, fmtDateTime, fmtDayHeader, PortalError } from "@/lib/portal";
import { cn } from "@/lib/utils";

type Period = "day" | "week" | "month";
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function PortalStatement() {
  const { call } = usePortal();
  const [period, setPeriod] = useState<Period>("month");
  const [refDate, setRefDate] = useState(todayISO());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await call<any>("statement", { period, reference_date: refDate });
      setData(res); setErr(null);
    } catch (e) {
      setErr(e instanceof PortalError ? e.code : "network_error");
    } finally { setLoading(false); }
  }, [call, period, refDate]);

  useEffect(() => { load(); }, [load]);

  const shiftMonth = (delta: number) => {
    const [y, m] = refDate.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setPeriod("month");
    setRefDate(d.toISOString().slice(0, 10));
  };

  const periodLabel = useMemo(() => {
    const [y, m, d] = refDate.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (period === "day") return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });
    if (period === "week") return "Semana de " + date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" });
    return date.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  }, [period, refDate]);

  const groups = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const ev of data?.events ?? []) {
      const key = new Date(ev.occurred_at).toISOString().slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [data]);

  const correctionsByEvent = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const c of data?.corrections ?? []) {
      if (!map.has(c.event_id)) map.set(c.event_id, []);
      map.get(c.event_id)!.push(c);
    }
    return map;
  }, [data]);

  const isDay = period === "day";
  const confirmed = !!data?.confirmation?.exists;
  const clickwrap = `Declaro que revisei os registros de exposição ao frio e pausas térmicas do dia ${periodLabel} apresentados neste extrato.`;

  const respond = async (correctionId: string, response: "accepted" | "contested") => {
    try {
      await call("respond_correction", { correction_id: correctionId, response });
      toast.success(response === "accepted" ? "Correção confirmada" : "Correção contestada");
      load();
    } catch { toast.error("Não foi possível registrar sua resposta"); }
  };

  const confirmStatement = async () => {
    setSaving(true);
    try {
      await call("confirm_statement", { reference_date: refDate, clickwrap_text: clickwrap, content_hash: data?.content_hash });
      toast.success("Extrato confirmado");
      setConfirmOpen(false);
      load();
    } catch (e) {
      const code = e instanceof PortalError ? e.code : "network_error";
      if (code === "statement_changed") { toast.message("O extrato mudou. Recarregando…"); setConfirmOpen(false); load(); }
      else if (code === "already_confirmed") { toast.message("Este extrato já foi confirmado."); setConfirmOpen(false); load(); }
      else toast.error("Não foi possível confirmar agora");
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <PageHead title="Extrato — Portal do colaborador FrioSafe" description="Seu extrato de acessos às câmaras frias, com entradas, saídas e pausas térmicas." />
      <h1 className="font-display text-xl font-bold">Meu extrato</h1>

      {/* Seletor de período */}
      <div className="sticky top-[57px] z-10 -mx-4 px-4 py-2 bg-background/95 backdrop-blur space-y-2">
        <div className="flex gap-2">
          {([["day", "Hoje"], ["week", "Esta semana"], ["month", "Este mês"]] as const).map(([p, label]) => (
            <button
              key={p}
              onClick={() => { setPeriod(p); setRefDate(todayISO()); }}
              className={cn(
                "flex-1 h-9 rounded-full text-[13px] font-medium border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                period === p ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground",
              )}
            >{label}</button>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="icon" aria-label="Mês anterior" onClick={() => shiftMonth(-1)}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <span className="text-[13px] font-medium capitalize">{periodLabel}</span>
          <Button variant="ghost" size="icon" aria-label="Mês seguinte" onClick={() => shiftMonth(1)}>
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Resumo */}
      {loading && !data ? (
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Card className="p-3">
            <div className="text-[11px] uppercase text-muted-foreground">Tempo exposto</div>
            <div className="font-display text-xl font-bold tabular-nums mt-1">{fmtMinutes(data?.totals?.total_exposure_minutes ?? 0)}</div>
          </Card>
          <Card className="p-3">
            <div className="text-[11px] uppercase text-muted-foreground">Entradas</div>
            <div className="font-display text-xl font-bold tabular-nums mt-1">{data?.totals?.entries_count ?? 0}</div>
          </Card>
          <Card className="p-3">
            <div className="text-[11px] uppercase text-muted-foreground">Pausas térmicas</div>
            <div className="font-display text-xl font-bold tabular-nums mt-1">{data?.totals?.breaks_completed ?? 0}</div>
          </Card>
          <Card className="p-3">
            <div className="text-[11px] uppercase text-muted-foreground">Ocorrências</div>
            <div className="font-display text-xl font-bold tabular-nums mt-1">{data?.occurrences_count ?? 0}</div>
          </Card>
        </div>
      )}

      {/* Lista */}
      {loading && !data ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : err && !data ? (
        <Card className="p-5 text-sm text-muted-foreground">
          Não foi possível carregar o extrato. <button className="text-primary underline" onClick={load}>Tentar novamente</button>
        </Card>
      ) : groups.length === 0 ? (
        <Card className="p-8 text-center">
          <Snowflake className="h-8 w-8 mx-auto text-muted-foreground/60" />
          <p className="mt-3 text-sm text-muted-foreground">Nenhum registro de acesso neste período.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map(([day, events]) => (
            <section key={day}>
              <h2 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground capitalize px-1">{fmtDayHeader(day)}</h2>
              <Card className="mt-2 divide-y divide-border/60 overflow-hidden">
                {events.map((ev) => {
                  const isEntry = ev.event_type === "entry";
                  const corr = correctionsByEvent.get(ev.id) ?? [];
                  return (
                    <div key={ev.id}>
                      <button
                        onClick={() => setExpanded(expanded === ev.id ? null : ev.id)}
                        className="w-full text-left p-3.5 flex items-center gap-3 active:bg-muted/40 transition"
                      >
                        <span className={cn(
                          "h-9 w-9 rounded-xl grid place-items-center shrink-0",
                          ev.synthetic ? "bg-status-yellow/15 text-status-yellow" : isEntry ? "bg-status-ok/15 text-status-ok" : "bg-muted text-muted-foreground",
                        )}>
                          {ev.synthetic ? <Clock className="h-4 w-4" /> : isEntry ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="font-semibold tabular-nums">{fmtTime(ev.occurred_at)}</span>
                            <span className="text-[13px] text-muted-foreground">{isEntry ? "Entrada" : "Saída"}</span>
                            {ev.synthetic && <Badge variant="outline" className="text-[10px] border-status-yellow/50 text-status-yellow">Encerrado pelo sistema</Badge>}
                          </span>
                          <span className="block text-[13px] text-muted-foreground truncate">{ev.cold_area_name ?? "Ambiente não informado"}</span>
                          {ev.synthetic && (
                            <span className="block text-[12px] text-status-yellow mt-0.5">
                              Sessão encerrada automaticamente após tempo sem retorno registrado
                            </span>
                          )}
                        </span>
                        {ev.duration_minutes != null && (
                          <span className="text-[13px] font-medium tabular-nums shrink-0">{fmtMinutes(ev.duration_minutes)}</span>
                        )}
                      </button>

                      {expanded === ev.id && (
                        <div className="px-3.5 pb-3.5 -mt-1 text-[12px] text-muted-foreground space-y-1">
                          <div>Ambiente: <span className="text-foreground">{ev.cold_area_name ?? "—"}</span></div>
                          <div>Dispositivo: <span className="text-foreground">{ev.device_id ?? "—"}</span></div>
                          <div>Origem do registro: <span className="text-foreground">{ev.source}</span></div>
                          {ev.duration_minutes != null && <div>Duração da sessão: <span className="text-foreground">{fmtMinutes(ev.duration_minutes)}</span></div>}
                        </div>
                      )}

                      {corr.map((c) => (
                        <div key={c.id} className="mx-3.5 mb-3.5 rounded-xl border border-status-orange/40 bg-status-orange/10 p-3 text-[12px] space-y-1.5">
                          <div className="flex items-center gap-1.5 font-semibold text-status-orange">
                            <AlertTriangle className="h-3.5 w-3.5" /> Registro corrigido
                          </div>
                          <div>Original: {fmtDateTime(c.original_occurred_at)} · {c.original_event_type === "entry" ? "entrada" : "saída"}</div>
                          {c.new_occurred_at && <div>Corrigido: {fmtDateTime(c.new_occurred_at)} · {(c.new_event_type ?? c.original_event_type) === "entry" ? "entrada" : "saída"}</div>}
                          <div className="text-muted-foreground">
                            por {c.approved_by_name ?? "gestor"}{c.approved_at ? `, em ${fmtDateTime(c.approved_at)}` : ""} — {c.reason_detail}
                          </div>
                          {c.employee_response ? (
                            <div className="font-medium">
                              Sua resposta: {c.employee_response === "accepted" ? "confirmada" : "contestada"} em {fmtDateTime(c.employee_responded_at)}
                            </div>
                          ) : (
                            <div className="flex gap-2 pt-1">
                              <Button size="sm" className="h-8 flex-1" onClick={() => respond(c.id, "accepted")}>
                                <Check className="h-3.5 w-3.5 mr-1" /> Confirmar
                              </Button>
                              <Button size="sm" variant="outline" className="h-8 flex-1" onClick={() => respond(c.id, "contested")}>
                                <X className="h-3.5 w-3.5 mr-1" /> Contestar
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </Card>
            </section>
          ))}
        </div>
      )}

      {/* Clickwrap (extrato do dia) */}
      {isDay && data && (
        confirmed ? (
          <Card className="p-4 flex items-center gap-3 border-status-ok/40 bg-status-ok/10">
            <ShieldCheck className="h-5 w-5 text-status-ok shrink-0" />
            <div className="text-[13px]">
              Revisado em {fmtDateTime(data.confirmation.confirmed_at)}
              <div className="text-[11px] text-muted-foreground font-mono break-all mt-0.5">selo {String(data.confirmation.record_hash ?? "").slice(0, 16)}…</div>
            </div>
          </Card>
        ) : (
          <Button className="w-full h-12" onClick={() => setConfirmOpen(true)}>
            Confirmar que revisei este extrato
          </Button>
        )
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-[92vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Confirmar revisão</DialogTitle>
            <DialogDescription>Você está registrando que viu seus dados deste dia. Não pode ser desfeito.</DialogDescription>
          </DialogHeader>
          <p className="rounded-md border bg-muted/30 p-3 text-[13px] leading-relaxed">{clickwrap}</p>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={confirmStatement} disabled={saving}>{saving ? "Confirmando…" : "Confirmar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className="text-[11px] text-muted-foreground text-center px-4">
        Registro de exposição ao frio com trilha de auditoria. Não é controle de ponto.
      </p>
    </div>
  );
}
