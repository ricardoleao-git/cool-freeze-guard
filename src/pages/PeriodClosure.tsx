import { useEffect, useMemo, useState, useCallback } from "react";
import { format, addDays, addMonths, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Stamp, CheckCircle2, Lock, ChevronLeft, ChevronRight, Calendar as CalendarIcon,
  RefreshCw, ShieldCheck, Users, Timer, Activity, AlertTriangle, Snowflake, FileDown,
  Hourglass, Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { useAnnouncer } from "@/lib/announcer";

type PeriodType = "week" | "month";
type Stage = "supervisor" | "rh" | "legal";
type ClosureStatus = "open" | "supervisor_signed" | "rh_signed" | "legal_sealed" | "reopened";

const STAGE_LABEL: Record<Stage, string> = {
  supervisor: "Supervisor",
  rh: "RH",
  legal: "Jurídico",
};

const STAGE_CLICKWRAP: Record<Stage, string> = {
  supervisor: "Na qualidade de supervisor, valido a operação do período e atesto que revisei as inconsistências apontadas.",
  rh: "Na qualidade de RH, consolido e homologo os registros do período.",
  legal: "Na qualidade de responsável jurídico, selo este fechamento como prova documental íntegra.",
};

const STAGE_ORDER: Stage[] = ["supervisor", "rh", "legal"];

const TYPE_LABEL: Record<string, string> = {
  open_session: "Sessão em aberto",
  entry_without_exit_in_period: "Entrada sem saída",
  exposure_exceeded: "Exposição acima do limite",
  break_not_taken: "Pausa não cumprida",
  break_interrupted: "Pausa interrompida",
  unmapped_reader: "Leitor não mapeado",
  pending_event: "Evento pendente",
};

interface Signature {
  stage: Stage;
  signed_by_name: string;
  signed_by_role?: string | null;
  signed_at: string;
  record_hash: string | null;
  previous_hash: string | null;
  signature_method: string;
  content_hash: string;
}

interface Closure {
  id: string;
  status: ClosureStatus;
  reference_start: string;
  reference_end: string;
}

interface Consolidated {
  tenant_id: string;
  period_type: PeriodType;
  reference_start: string;
  reference_end: string;
  totals: {
    employees_count: number;
    total_exposure_minutes: number;
    sessions_count: number;
    open_sessions_count: number;
    breaks_completed: number;
    breaks_interrupted: number;
    inconsistencies_count: number;
    daily_confirmations: number;
  };
  inconsistencies_by_type: Record<string, number>;
  employees: Array<{
    employee_id: string;
    total_exposure_minutes: number;
    sessions_count: number;
    open_sessions_count: number;
    breaks_completed: number;
    breaks_interrupted: number;
    inconsistencies_count: number;
    daily_confirmations: number;
  }>;
}

interface ConsolidateResponse {
  consolidated: Consolidated;
  consolidated_hash: string;
  closure: Closure | null;
  signatures: Signature[];
}

function stageStatusFor(stage: Stage, status: ClosureStatus | undefined, signatures: Signature[]): "signed" | "active" | "locked" {
  const signed = signatures.some(s => s.stage === stage);
  if (signed) return "signed";
  const current: ClosureStatus = status ?? "open";
  if (stage === "supervisor" && current === "open") return "active";
  if (stage === "rh" && current === "supervisor_signed") return "active";
  if (stage === "legal" && current === "rh_signed") return "active";
  return "locked";
}

function shortHash(h?: string | null) {
  if (!h) return "—";
  return `${h.slice(0, 8)}…${h.slice(-6)}`;
}

function fmtMin(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function PeriodClosurePage() {
  const { profile, roles, session, isDemo } = useAuth();
  const tenantId = profile?.tenant_id ?? null;
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
  const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

  async function callFn(name: string, body: any): Promise<{ data: any; error: any }> {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY,
      };
      const token = session?.access_token;
      if (!isDemo && token) headers.Authorization = `Bearer ${token}`;
      const r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
        method: "POST", headers, body: JSON.stringify(body),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) return { data: null, error: { message: json?.error ?? `HTTP ${r.status}`, context: { status: r.status, error: json?.error } } };
      return { data: json, error: null };
    } catch (e: any) {
      return { data: null, error: { message: e?.message ?? "network_error" } };
    }
  }

  const canSign = roles.some(r => ["super_admin", "administrador", "gestor"].includes(r));

  const [periodType, setPeriodType] = useState<PeriodType>("week");
  const [refDate, setRefDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ConsolidateResponse | null>(null);
  const [loadError, setLoadError] = useState<{ status?: number; message: string } | null>(null);
  const [empNames, setEmpNames] = useState<Record<string, string>>({});
  const [signing, setSigning] = useState<Stage | null>(null);
  const [agree, setAgree] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const announce = useAnnouncer();

  const refDateStr = useMemo(() => format(refDate, "yyyy-MM-dd"), [refDate]);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const { data: resp, error } = await callFn("closure-consolidate", {
        tenant_id: tenantId, period_type: periodType, reference_date: refDateStr,
      });
      if (error) throw error;
      setData(resp as ConsolidateResponse);
      const ids = (resp.consolidated.employees ?? []).map((e: any) => e.employee_id);
      if (ids.length) {
        const { data: emps } = await supabase.from("employees").select("id, name").in("id", ids);
        const map: Record<string, string> = {};
        for (const e of emps ?? []) map[(e as any).id] = (e as any).name;
        setEmpNames(map);
      } else {
        setEmpNames({});
      }
    } catch (e: any) {
      console.error(e);
      toast.error("Falha ao consolidar o período", { description: e?.message ?? "Erro inesperado" });
    } finally {
      setLoading(false);
    }
  }, [tenantId, periodType, refDateStr]);

  useEffect(() => { load(); }, [load]);

  const navigatePeriod = (dir: -1 | 1) => {
    setRefDate(prev => periodType === "week" ? addDays(prev, dir * 7) : addMonths(prev, dir));
  };

  const onSign = async (stage: Stage) => {
    if (!data || !tenantId) return;
    if (!agree) { toast.error("Confirme a leitura para assinar"); return; }
    setSubmitting(true);
    announce(`Assinando etapa ${STAGE_LABEL[stage]}…`);
    try {
      const { data: resp, error } = await callFn("closure-sign", {
        tenant_id: tenantId,
        period_type: periodType,
        reference_date: refDateStr,
        stage,
        clickwrap_text: STAGE_CLICKWRAP[stage],
        content_hash: data.consolidated_hash,
        signature_method: "clickwrap",
      });
      if (error) {
        // supabase-js wraps non-2xx — try to read inner JSON
        const msg = (error as any)?.context?.error || (error as any)?.message || "Erro inesperado";
        const status = (error as any)?.context?.status;
        if (msg === "wrong_stage" || status === 409) {
          toast.error("Etapa fora de ordem — atualizando…");
          setSigning(null); setAgree(false);
          await load();
          return;
        }
        if (msg === "statement_changed") {
          toast.error("O consolidado mudou — recarregando…");
          setSigning(null); setAgree(false);
          await load();
          return;
        }
        throw new Error(msg);
      }
      if ((resp as any)?.already) {
        toast.info(`Etapa ${STAGE_LABEL[stage]} já estava assinada`);
        announce(`Etapa ${STAGE_LABEL[stage]} já estava assinada.`);
      } else {
        toast.success(`Assinado como ${STAGE_LABEL[stage]}`, {
          description: `Selo ${shortHash((resp as any)?.record_hash)}`,
        });
        announce(`Fechamento de período assinado com sucesso na etapa ${STAGE_LABEL[stage]}.`);
      }
      setSigning(null);
      setAgree(false);
      await load();
    } catch (e: any) {
      toast.error("Falha ao assinar", { description: e?.message ?? "Tente novamente" });
      announce(`Falha ao assinar etapa ${STAGE_LABEL[stage]}: ${e?.message ?? "tente novamente"}.`, "assertive");
    } finally {
      setSubmitting(false);
    }
  };

  const status: ClosureStatus = data?.closure?.status ?? "open";
  const signatures = data?.signatures ?? [];
  const c = data?.consolidated;

  return (
    <TooltipProvider>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-bold flex items-center gap-2">
              <Stamp className="h-7 w-7 text-primary" /> Fechamento de Período
            </h1>
            <p className="text-sm text-muted-foreground">
              Consolide e sele o período em cadeia: Supervisor → RH → Jurídico.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={periodType} onValueChange={(v) => setPeriodType(v as PeriodType)}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="week">Semana</SelectItem>
                <SelectItem value="month">Mês</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1">
              <Button size="icon" variant="outline" onClick={() => navigatePeriod(-1)} aria-label="Anterior">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-[200px] justify-start">
                    <CalendarIcon className="h-4 w-4 mr-2" />
                    {format(refDate, "PPP", { locale: ptBR })}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={refDate}
                    onSelect={(d) => d && setRefDate(d)}
                    initialFocus
                    locale={ptBR}
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
              <Button size="icon" variant="outline" onClick={() => navigatePeriod(1)} aria-label="Próximo">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <Button variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} /> Atualizar
            </Button>
          </div>
        </div>

        {/* Period range */}
        {c && (
          <div className="text-sm text-muted-foreground">
            Período: <span className="font-medium text-foreground">
              {format(parseISO(c.reference_start), "dd MMM yyyy", { locale: ptBR })}
            </span> a <span className="font-medium text-foreground">
              {format(parseISO(c.reference_end), "dd MMM yyyy", { locale: ptBR })}
            </span>
          </div>
        )}

        {loading && !c ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
          </div>
        ) : c ? (
          <>
            {/* 1) Totais */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard icon={Users} label="Colaboradores" value={c.totals.employees_count} />
              <KpiCard icon={Snowflake} label="Exposição total" value={fmtMin(c.totals.total_exposure_minutes)} />
              <KpiCard icon={Activity} label="Sessões" value={c.totals.sessions_count} sub={`${c.totals.open_sessions_count} abertas`} />
              <KpiCard icon={Timer} label="Pausas" value={c.totals.breaks_completed} sub={`${c.totals.breaks_interrupted} interrompidas`} />
              <KpiCard icon={AlertTriangle} label="Inconsistências" value={c.totals.inconsistencies_count} accent={c.totals.inconsistencies_count > 0 ? "warning" : undefined} />
              <KpiCard icon={CheckCircle2} label="Extratos confirmados" value={c.totals.daily_confirmations} />
              <KpiCard icon={Hourglass} label="Sessões abertas" value={c.totals.open_sessions_count} accent={c.totals.open_sessions_count > 0 ? "warning" : undefined} />
              <KpiCard icon={ShieldCheck} label="Status" value={
                status === "open" ? "Aberto"
                : status === "supervisor_signed" ? "Supervisor assinou"
                : status === "rh_signed" ? "RH assinou"
                : status === "legal_sealed" ? "Selado" : "Reaberto"
              } />
            </div>

            {/* 2) Stepper de Assinatura */}
            <Card className="glass-card border-primary/20">
              <CardHeader>
                <CardTitle className="font-display flex items-center gap-2">
                  <Stamp className="h-5 w-5 text-primary" /> Assinatura em cadeia
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-3 gap-3">
                  {STAGE_ORDER.map((stage, idx) => {
                    const s = signatures.find(x => x.stage === stage);
                    const st = stageStatusFor(stage, status, signatures);
                    return (
                      <StageCard
                        key={stage}
                        index={idx + 1}
                        stage={stage}
                        state={st}
                        signature={s}
                        canSign={canSign}
                        onSign={() => { setAgree(false); setSigning(stage); }}
                      />
                    );
                  })}
                </div>

                {status === "legal_sealed" && (
                  <div className="mt-4 rounded-xl border border-status-green/40 bg-status-green/10 p-4">
                    <div className="flex items-center gap-2 font-display font-semibold text-status-green">
                      <ShieldCheck className="h-5 w-5" /> Fechamento selado — prova documental completa
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      As três assinaturas formam uma cadeia: cada selo incorpora o hash do anterior.
                    </p>
                    <div className="mt-3 grid gap-2 font-mono text-xs">
                      {signatures.map((s, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Badge variant="outline" className="border-status-green/40 text-status-green">
                            {STAGE_LABEL[s.stage]}
                          </Badge>
                          <span className="text-muted-foreground">prev:</span>
                          <span>{shortHash(s.previous_hash)}</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="text-status-green">{shortHash(s.record_hash)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3">
                      <Button disabled variant="outline" size="sm">
                        <FileDown className="h-4 w-4 mr-2" /> Exportar dossiê (em breve)
                      </Button>
                      <span className="text-xs text-muted-foreground ml-2">PDF + ICP-Brasil planejados.</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 3) Inconsistências do período */}
            {Object.keys(c.inconsistencies_by_type).length > 0 && (
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="font-display text-base flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-status-orange" /> Inconsistências do período
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(c.inconsistencies_by_type)
                      .sort((a, b) => b[1] - a[1])
                      .map(([type, count]) => (
                        <Badge key={type} variant="outline" className="border-status-orange/40 text-status-orange">
                          {TYPE_LABEL[type] ?? type}: <span className="ml-1 font-semibold">{count}</span>
                        </Badge>
                      ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 4) Tabela por colaborador */}
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="font-display text-base flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" /> Por colaborador
                </CardTitle>
              </CardHeader>
              <CardContent>
                {c.employees.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-6 text-center">
                    Nenhum colaborador com eventos neste período.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Colaborador</TableHead>
                          <TableHead className="text-right">Exposição</TableHead>
                          <TableHead className="text-right">Sessões</TableHead>
                          <TableHead className="text-right">Pausas</TableHead>
                          <TableHead className="text-right">Inconsistências</TableHead>
                          <TableHead className="text-right">Extratos confirmados</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {c.employees.map(e => {
                          const warn = e.inconsistencies_count > 0;
                          return (
                            <TableRow key={e.employee_id} className={warn ? "bg-status-orange/5" : ""}>
                              <TableCell className="font-medium">
                                {empNames[e.employee_id] ?? e.employee_id}
                              </TableCell>
                              <TableCell className="text-right">{fmtMin(e.total_exposure_minutes)}</TableCell>
                              <TableCell className="text-right">
                                {e.sessions_count}{e.open_sessions_count > 0 && (
                                  <span className="text-status-orange ml-1">({e.open_sessions_count} abertas)</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                {e.breaks_completed}{e.breaks_interrupted > 0 && (
                                  <span className="text-status-red ml-1">/ {e.breaks_interrupted} interrompidas</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                {warn ? (
                                  <Badge variant="outline" className="border-status-orange/40 text-status-orange">
                                    {e.inconsistencies_count}
                                  </Badge>
                                ) : <span className="text-muted-foreground">0</span>}
                              </TableCell>
                              <TableCell className="text-right">{e.daily_confirmations}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Footer: consolidated_hash */}
            <div className="flex justify-end pt-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="font-mono text-xs text-muted-foreground border border-border rounded px-2 py-1 bg-muted/30">
                    selo do consolidado: {shortHash(data.consolidated_hash)}
                  </div>
                </TooltipTrigger>
                <TooltipContent className="font-mono text-xs max-w-md break-all">
                  {data.consolidated_hash}
                </TooltipContent>
              </Tooltip>
            </div>
          </>
        ) : (
          <div className="text-sm text-muted-foreground">Selecione um período para começar.</div>
        )}

        {/* Sign dialog */}
        <Dialog open={signing !== null} onOpenChange={(o) => { if (!o) { setSigning(null); setAgree(false); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-display flex items-center gap-2">
                <Stamp className="h-5 w-5 text-primary" /> Assinar como {signing && STAGE_LABEL[signing]}
              </DialogTitle>
              <DialogDescription>
                Esta assinatura é registrada de forma imutável e encadeada à anterior.
              </DialogDescription>
            </DialogHeader>
            {signing && (
              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm leading-relaxed">
                  {STAGE_CLICKWRAP[signing]}
                </div>
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <Checkbox checked={agree} onCheckedChange={(v) => setAgree(v === true)} className="mt-0.5" />
                  <span>Li e concordo com o termo acima. Confirmo que o consolidado exibido reflete os registros do período.</span>
                </label>
                <div className="font-mono text-xs text-muted-foreground">
                  selo do consolidado: {shortHash(data?.consolidated_hash)}
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => { setSigning(null); setAgree(false); }} disabled={submitting}>
                Cancelar
              </Button>
              <Button
                onClick={() => signing && onSign(signing)}
                disabled={!agree || submitting}
              >
                {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Stamp className="h-4 w-4 mr-2" />}
                Assinar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

function KpiCard({
  icon: Icon, label, value, sub, accent,
}: { icon: any; label: string; value: string | number; sub?: string; accent?: "warning" }) {
  return (
    <Card className={cn("glass-card", accent === "warning" && "border-status-orange/40")}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
          <Icon className={cn("h-3.5 w-3.5", accent === "warning" ? "text-status-orange" : "text-primary")} />
          {label}
        </div>
        <div className="mt-1 font-display text-2xl font-bold">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function StageCard({
  index, stage, state, signature, canSign, onSign,
}: {
  index: number;
  stage: Stage;
  state: "signed" | "active" | "locked";
  signature?: Signature;
  canSign: boolean;
  onSign: () => void;
}) {
  const isSigned = state === "signed";
  const isActive = state === "active";
  return (
    <div className={cn(
      "rounded-xl border p-4 transition",
      isSigned && "border-status-green/40 bg-status-green/5",
      isActive && "border-primary/50 bg-primary/5",
      state === "locked" && "border-border bg-muted/30 opacity-60",
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn(
            "h-7 w-7 rounded-full grid place-items-center text-xs font-bold",
            isSigned ? "bg-status-green text-white" : isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}>
            {isSigned ? <CheckCircle2 className="h-4 w-4" /> : state === "locked" ? <Lock className="h-3.5 w-3.5" /> : index}
          </div>
          <div className="font-display font-semibold">{STAGE_LABEL[stage]}</div>
        </div>
        <Badge variant="outline" className={cn(
          isSigned && "border-status-green/40 text-status-green",
          isActive && "border-primary/40 text-primary",
        )}>
          {isSigned ? "Assinado" : isActive ? "Pendente" : "Bloqueado"}
        </Badge>
      </div>

      {isSigned && signature ? (
        <div className="mt-3 text-xs space-y-1">
          <div><span className="text-muted-foreground">Por:</span> <span className="font-medium">{signature.signed_by_name}</span></div>
          <div className="text-muted-foreground">
            {format(parseISO(signature.signed_at), "dd MMM yyyy 'às' HH:mm", { locale: ptBR })}
          </div>
          <div className="font-mono text-[10.5px] text-status-green">
            selo: {shortHash(signature.record_hash)}
          </div>
        </div>
      ) : isActive ? (
        <div className="mt-3">
          {canSign ? (
            <Button size="sm" onClick={onSign} className="w-full">
              <Stamp className="h-4 w-4 mr-2" /> Assinar como {STAGE_LABEL[stage]}
            </Button>
          ) : (
            <div className="text-xs text-muted-foreground">Sem permissão para assinar.</div>
          )}
        </div>
      ) : (
        <div className="mt-3 text-xs text-muted-foreground">
          Aguardando etapa anterior.
        </div>
      )}
    </div>
  );
}
