import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Receipt, LogIn, LogOut, Timer, AlertTriangle, ShieldCheck, Snowflake, Activity, CheckCircle2, AlertOctagon } from "lucide-react";
import { ConfirmStatementDialog } from "@/components/ConfirmStatementDialog";

type Period = "day" | "week" | "month";

interface Statement {
  period: Period;
  range: { start: string; end: string };
  employee: { id: string; name: string };
  totals: {
    total_exposure_minutes: number;
    entries_count: number;
    external_reads_count: number;
    breaks_completed: number;
    breaks_interrupted: number;
  };
  sessions: Array<{
    entry_at: string; exit_at: string | null; duration_minutes: number;
    cold_area_id: string | null; cold_area_name: string | null; open: boolean;
  }>;
  breaks: Array<{ id: string; started_at: string; ended_at: string | null; completed: boolean; interrupted: boolean }>;
  areas_used: Array<{ id: string; name: string; exposure_limit_minutes: number; break_minutes: number }>;
  inconsistencies: Array<{ type: string; message: string; session_index?: number }>;
  content_hash: string;
  confirmation: { exists: boolean; confirmed_at?: string; matches_current_hash?: boolean; record_hash?: string };
}

interface EmpRow { id: string; name: string; }

const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtPeriodLabel = (period: Period, ref: string) => {
  if (period === "day") {
    const [y, m, d] = ref.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  }
  if (period === "week") return `Semana de ${ref}`;
  return new Date(`${ref}T00:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
};

function shiftDate(ref: string, days: number): string {
  const d = new Date(ref + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function Statement() {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id ?? "";
  const [employees, setEmployees] = useState<EmpRow[]>([]);
  const [employeeId, setEmployeeId] = useState<string>("");
  const [period, setPeriod] = useState<Period>("day");
  const [refDate, setRefDate] = useState<string>(todayISO());
  const [statement, setStatement] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    supabase.from("employees").select("id, name").eq("tenant_id", tenantId).eq("status", "active").order("name")
      .then(({ data, error }) => {
        if (error) { toast.error("Falha ao carregar colaboradores"); return; }
        setEmployees((data ?? []) as EmpRow[]);
        if (data && data.length && !employeeId) setEmployeeId(data[0].id);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const fetchStatement = async () => {
    if (!tenantId || !employeeId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("employee-statement", {
        body: { tenant_id: tenantId, employee_id: employeeId, period, reference_date: refDate },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setStatement(data as Statement);
    } catch (e: any) {
      toast.error("Falha ao carregar extrato: " + (e?.message || "tente novamente"));
      setStatement(null);
    } finally { setLoading(false); }
  };

  useEffect(() => { if (employeeId) fetchStatement(); /* eslint-disable-next-line */ }, [employeeId, period, refDate]);

  const stepDays = useMemo(() => period === "day" ? 1 : period === "week" ? 7 : 30, [period]);

  const inconsistencyBySession = useMemo(() => {
    const map = new Map<number, string[]>();
    statement?.inconsistencies.forEach((i) => {
      if (typeof i.session_index === "number") {
        const arr = map.get(i.session_index) ?? [];
        arr.push(i.message); map.set(i.session_index, arr);
      }
    });
    return map;
  }, [statement]);

  return (
    <TooltipProvider>
      <div className="container py-6 md:py-8">
        <PageHeader
          eyebrow="Transparência"
          title="Meu Extrato de Exposição"
          description="Extrato individual com sessões, pausas e inconsistências detectadas. Pode ser confirmado pelo colaborador com PIN pessoal."
          icon={<Receipt className="h-5 w-5" />}
        />

        <div className="glass-card p-4 md:p-5 mb-5 flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[220px]">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Colaborador</label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
              <SelectContent>
                {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-[160px]">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Período</label>
            <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="day">Dia</SelectItem>
                <SelectItem value="week">Semana</SelectItem>
                <SelectItem value="month">Mês</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-1.5">
            <Button variant="outline" size="icon" onClick={() => setRefDate(shiftDate(refDate, -stepDays))} title="Anterior">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground">Data de referência</label>
              <Input type="date" value={refDate} onChange={(e) => setRefDate(e.target.value)} className="w-[170px]" />
            </div>
            <Button variant="outline" size="icon" onClick={() => setRefDate(shiftDate(refDate, stepDays))} title="Próximo">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {statement && (
          <>
            <div className="mb-3 text-sm text-muted-foreground capitalize">{fmtPeriodLabel(period, refDate)}</div>

            {/* Confirmação banner (somente dia) */}
            {period === "day" && (
              <div className="mb-5">
                {statement.confirmation.exists ? (
                  <div className={`glass-card p-4 flex items-center gap-3 ${statement.confirmation.matches_current_hash ? "border-status-ok/40" : "border-status-yellow/40"}`}>
                    {statement.confirmation.matches_current_hash ? (
                      <CheckCircle2 className="h-5 w-5 text-status-ok shrink-0" />
                    ) : (
                      <AlertOctagon className="h-5 w-5 text-status-yellow shrink-0" />
                    )}
                    <div className="flex-1">
                      <div className="font-medium">
                        {statement.confirmation.matches_current_hash
                          ? "Extrato confirmado"
                          : "Extrato confirmado, mas os dados mudaram depois"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        em {fmtDateTime(statement.confirmation.confirmed_at!)} · selo {statement.confirmation.record_hash?.slice(0, 12)}…
                      </div>
                      {!statement.confirmation.matches_current_hash && (
                        <div className="text-xs text-status-yellow mt-1">
                          Este extrato foi recalculado após a confirmação — os dados podem ter mudado.
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="glass-card p-4 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">Este extrato ainda não foi confirmado</div>
                      <div className="text-xs text-muted-foreground">A confirmação é registrada em trilha imutável com selo encadeado.</div>
                    </div>
                    <Button onClick={() => setConfirmOpen(true)}>
                      <ShieldCheck className="h-4 w-4 mr-1.5" /> Confirmar meu extrato
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Totais */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
              <TotalCard icon={<Snowflake className="h-4 w-4" />} label="Exposição total" value={`${statement.totals.total_exposure_minutes} min`} />
              <TotalCard icon={<LogIn className="h-4 w-4" />} label="Entradas" value={String(statement.totals.entries_count)} />
              <TotalCard icon={<LogOut className="h-4 w-4" />} label="Leituras externas" value={String(statement.totals.external_reads_count)} />
              <TotalCard icon={<Timer className="h-4 w-4" />} label="Pausas cumpridas" value={String(statement.totals.breaks_completed)} accent="ok" />
              <TotalCard icon={<AlertTriangle className="h-4 w-4" />} label="Pausas interrompidas" value={String(statement.totals.breaks_interrupted)} accent={statement.totals.breaks_interrupted > 0 ? "yellow" : undefined} />
            </div>

            {/* Inconsistências */}
            {statement.inconsistencies.length > 0 && (
              <div className="glass-card p-4 mb-5 border-status-red/40">
                <div className="flex items-center gap-2 font-display font-semibold mb-2">
                  <AlertTriangle className="h-4 w-4 text-status-red" /> Inconsistências detectadas
                </div>
                <ul className="space-y-1.5 text-sm">
                  {statement.inconsistencies.map((i, n) => (
                    <li key={n} className="flex items-start gap-2">
                      <span className="status-dot bg-status-red mt-1.5" />
                      <span>{i.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Sessões */}
            <div className="glass-card p-4 mb-5">
              <div className="flex items-center gap-2 font-display font-semibold mb-3">
                <Activity className="h-4 w-4" /> Sessões de exposição ({statement.sessions.length})
              </div>
              {statement.sessions.length === 0 ? (
                <div className="text-sm text-muted-foreground py-4 text-center">Nenhuma sessão no período.</div>
              ) : (
                <div className="space-y-2">
                  {statement.sessions.map((s, i) => {
                    const area = statement.areas_used.find(a => a.id === s.cold_area_id);
                    const exceeded = area && s.duration_minutes > area.exposure_limit_minutes;
                    const issues = inconsistencyBySession.get(i) ?? [];
                    return (
                      <div key={i} className={`rounded-md border p-3 flex items-center gap-3 flex-wrap ${exceeded ? "border-status-red/50 bg-status-red/5" : "border-border"}`}>
                        <div className="flex items-center gap-2 min-w-[180px]">
                          <LogIn className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="font-mono text-sm">{fmtTime(s.entry_at)}</span>
                          <span className="text-muted-foreground">→</span>
                          <LogOut className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="font-mono text-sm">{s.exit_at ? fmtTime(s.exit_at) : "—"}</span>
                        </div>
                        <Badge variant="outline" className="tabular-nums">{s.duration_minutes} min</Badge>
                        <span className="text-sm text-muted-foreground flex-1">{s.cold_area_name ?? "—"}</span>
                        {s.open && <Badge className="bg-status-yellow text-black">EM ABERTO</Badge>}
                        {exceeded && <Badge className="bg-status-red text-white">EXCESSO</Badge>}
                        {issues.length > 0 && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <AlertTriangle className="h-4 w-4 text-status-yellow" />
                            </TooltipTrigger>
                            <TooltipContent>{issues.join(" · ")}</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Pausas */}
            <div className="glass-card p-4 mb-5">
              <div className="flex items-center gap-2 font-display font-semibold mb-3">
                <Timer className="h-4 w-4" /> Pausas térmicas ({statement.breaks.length})
              </div>
              {statement.breaks.length === 0 ? (
                <div className="text-sm text-muted-foreground py-4 text-center">Nenhuma pausa no período.</div>
              ) : (
                <div className="space-y-2">
                  {statement.breaks.map((b) => (
                    <div key={b.id} className={`rounded-md border p-3 flex items-center gap-3 ${b.interrupted ? "border-status-yellow/50" : b.completed ? "border-status-ok/40" : "border-border"}`}>
                      <span className="font-mono text-sm">{fmtTime(b.started_at)}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="font-mono text-sm">{b.ended_at ? fmtTime(b.ended_at) : "em curso"}</span>
                      <div className="flex-1" />
                      {b.interrupted
                        ? <Badge className="bg-status-yellow text-black">INTERROMPIDA</Badge>
                        : b.completed
                          ? <Badge className="bg-status-ok text-white">CUMPRIDA</Badge>
                          : <Badge variant="outline">EM CURSO</Badge>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="text-xs text-muted-foreground flex items-center gap-2 justify-end">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="font-mono cursor-help">selo: {statement.content_hash.slice(0, 16)}…</span>
                </TooltipTrigger>
                <TooltipContent>Selo de integridade SHA-256 deste extrato.</TooltipContent>
              </Tooltip>
            </div>

            {period === "day" && statement && (
              <ConfirmStatementDialog
                open={confirmOpen}
                onOpenChange={setConfirmOpen}
                tenantId={tenantId}
                employeeId={statement.employee.id}
                employeeName={statement.employee.name}
                referenceDate={refDate}
                contentHash={statement.content_hash}
                contentSnapshot={statement}
                onConfirmed={fetchStatement}
                onStatementChanged={fetchStatement}
              />
            )}
          </>
        )}

        {!statement && !loading && employeeId && (
          <div className="glass-card p-10 text-center text-muted-foreground text-sm">Sem dados para o período.</div>
        )}
        {loading && <div className="glass-card p-10 text-center text-muted-foreground text-sm">Carregando…</div>}
      </div>
    </TooltipProvider>
  );
}

function TotalCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: "ok" | "yellow" | "red" }) {
  const accentCls = accent === "ok" ? "text-status-ok" : accent === "yellow" ? "text-status-yellow" : accent === "red" ? "text-status-red" : "";
  return (
    <div className="glass-card p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</div>
      <div className={`font-display text-2xl mt-1 tabular-nums ${accentCls}`}>{value}</div>
    </div>
  );
}
