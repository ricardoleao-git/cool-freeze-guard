import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bell, Check, X, ClipboardCheck, AlertTriangle, FileLock2, Clock, Snowflake, Activity, FileText } from "lucide-react";
import { MonthlyReportDialog } from "@/components/MonthlyReportDialog";
import { useTenantScoped, useDemo } from "@/lib/demo-store";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type Correction = {
  id: string;
  tenant_id: string;
  event_id: string;
  employee_id: string;
  original_event_type: string;
  original_occurred_at: string;
  new_event_type: string | null;
  new_occurred_at: string | null;
  reason_category: string;
  reason_detail: string;
  status: string;
  requested_by_name: string;
  employee_response: string | null;
  employee_responded_at: string | null;
  created_at: string;
};

type RenewalNotification = {
  id: string;
  tenant_id: string;
  employee_id: string;
  consent_version: number;
  previous_version: number | null;
  status: string;
  reason: string;
  message: string;
  created_at: string;
  sent_at: string | null;
  acknowledged_at: string | null;
};

const REASON_LABEL: Record<string, string> = {
  esquecimento_saida: "Esquecimento de saída",
  esquecimento_entrada: "Esquecimento de entrada",
  falha_dispositivo: "Falha de dispositivo",
  leitura_duplicada: "Leitura duplicada",
  horario_incorreto: "Horário incorreto",
  tipo_incorreto: "Tipo incorreto",
  outro: "Outro",
};

const fmtType = (t: string | null) => (t === "entry" ? "ENTRADA" : t === "exit" ? "SAÍDA" : "—");
const fmtDate = (iso: string | null) => (iso ? format(new Date(iso), "dd/MM/yyyy HH:mm", { locale: ptBR }) : "—");

export default function MyDay() {
  const { employees, events, alerts, coldAreas, breaks } = useTenantScoped();
  const { activeTenantId } = useDemo();
  const { user } = useAuth();

  const [selectedEmpId, setSelectedEmpId] = useState<string>("");
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [renewals, setRenewals] = useState<RenewalNotification[]>([]);
  const [loading, setLoading] = useState(false);

  const [responseFor, setResponseFor] = useState<Correction | null>(null);
  const [responseAction, setResponseAction] = useState<"accept" | "contest">("accept");
  const [responseText, setResponseText] = useState("");
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    if (!selectedEmpId && employees.length) setSelectedEmpId(employees[0].id);
  }, [employees, selectedEmpId]);

  const employee = employees.find(e => e.id === selectedEmpId) || null;
  const areaName = (id: string | null) => coldAreas.find(a => a.id === id)?.name || "—";

  const loadAll = async () => {
    if (!selectedEmpId) return;
    setLoading(true);
    const [{ data: corrs }, { data: rens }] = await Promise.all([
      supabase.from("access_event_corrections").select("*")
        .eq("tenant_id", activeTenantId).eq("employee_id", selectedEmpId)
        .order("created_at", { ascending: false }).limit(100),
      supabase.from("consent_renewal_notifications").select("*")
        .eq("tenant_id", activeTenantId).eq("employee_id", selectedEmpId)
        .order("created_at", { ascending: false }).limit(50),
    ]);
    setCorrections((corrs || []) as Correction[]);
    setRenewals((rens || []) as RenewalNotification[]);
    setLoading(false);
  };

  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, [selectedEmpId, activeTenantId]);

  const pendingCorrections = useMemo(() => corrections.filter(c => c.status === "pending"), [corrections]);
  const pendingRenewals = useMemo(() => renewals.filter(r => r.status === "pending" || r.status === "sent"), [renewals]);
  const todayEvents = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return events
      .filter(e => e.employee_id === selectedEmpId && e.occurred_at >= today.getTime())
      .sort((a, b) => b.occurred_at - a.occurred_at);
  }, [events, selectedEmpId]);
  const myAlerts = useMemo(
    () => alerts.filter(a => a.employee_id === selectedEmpId && a.status === "open").slice(0, 10),
    [alerts, selectedEmpId],
  );
  const myBreaks = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return breaks
      .filter(b => b.employee_id === selectedEmpId && new Date(b.started_at).getTime() >= today.getTime())
      .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
  }, [breaks, selectedEmpId]);

  const submitResponse = async () => {
    if (!responseFor) return;
    const { error } = await supabase
      .from("access_event_corrections")
      .update({
        status: responseAction === "accept" ? "employee_accepted" : "employee_contested",
        employee_response: responseText.trim() || (responseAction === "accept" ? "Aceito pelo colaborador." : "Colaborador contesta sem detalhamento."),
        employee_responded_at: new Date().toISOString(),
      })
      .eq("id", responseFor.id);
    if (error) { toast.error("Falha ao enviar resposta: " + error.message); return; }
    toast.success(responseAction === "accept" ? "Resposta enviada. Supervisor irá validar." : "Contestação registrada. RH/SST será notificado.");
    setResponseFor(null); setResponseText("");
    loadAll();
  };

  const acknowledgeRenewal = async (r: RenewalNotification) => {
    const { error } = await supabase
      .from("consent_renewal_notifications")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", r.id);
    if (error) { toast.error("Erro: " + error.message); return; }
    toast.info("Notificação marcada como lida. Faça o aceite na tela de Privacidade & LGPD.");
    loadAll();
  };

  const totalPendencias = pendingCorrections.length + pendingRenewals.length + myAlerts.length;

  return (
    <div className="p-4 md:p-6 space-y-5">
      <PageHeader
        title="Meu Dia"
        description="Visão pessoal do colaborador: pendências, notificações e respostas a correções de horário."
        icon={<Bell className="h-5 w-5" />}
      />

      <Card>
        <CardContent className="pt-5 flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex-1">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Colaborador</label>
            <Select value={selectedEmpId} onValueChange={setSelectedEmpId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione um colaborador" /></SelectTrigger>
              <SelectContent>
                {employees.map(e => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name} · matrícula {e.registration_number}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {employee && (
            <div className="flex items-center gap-2 text-xs flex-wrap">
              <Badge variant="outline" className="capitalize">{employee.position || "Colaborador"}</Badge>
              <Badge variant="outline">{employee.current_status === "thermal_break" ? "Em pausa" : employee.current_status === "outside" ? "Fora" : "Dentro / atenção"}</Badge>
              <Badge variant="outline">{Math.round(employee.accumulated_minutes)} min acumulados</Badge>
              <Button size="sm" variant="outline" onClick={() => setReportOpen(true)}>
                <FileText className="h-3.5 w-3.5 mr-1" /> Relatório mensal
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {!employee ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Selecione um colaborador acima.</CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryTile icon={<ClipboardCheck className="h-4 w-4" />} label="Correções aguardando você" value={pendingCorrections.length} tone={pendingCorrections.length ? "warning" : "ok"} />
            <SummaryTile icon={<FileLock2 className="h-4 w-4" />} label="Consentimentos a renovar" value={pendingRenewals.length} tone={pendingRenewals.length ? "warning" : "ok"} />
            <SummaryTile icon={<AlertTriangle className="h-4 w-4" />} label="Alertas em aberto" value={myAlerts.length} tone={myAlerts.length ? "danger" : "ok"} />
            <SummaryTile icon={<Activity className="h-4 w-4" />} label="Eventos hoje" value={todayEvents.length} tone="neutral" />
          </div>

          <Tabs defaultValue="pendencias">
            <TabsList>
              <TabsTrigger value="pendencias">Pendências ({totalPendencias})</TabsTrigger>
              <TabsTrigger value="hoje">Meu dia</TabsTrigger>
              <TabsTrigger value="historico">Histórico de respostas</TabsTrigger>
            </TabsList>

            <TabsContent value="pendencias" className="space-y-4 mt-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><ClipboardCheck className="h-4 w-4" /> Solicitações de correção</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {loading ? <p className="text-sm text-muted-foreground">Carregando…</p> :
                    pendingCorrections.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma correção aguardando sua resposta.</p> :
                      pendingCorrections.map(c => (
                        <div key={c.id} className="border border-border/60 rounded-lg p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="text-sm font-medium">
                              {REASON_LABEL[c.reason_category] || c.reason_category}
                            </div>
                            <Badge variant="outline" className="text-[10px]">Aberto por {c.requested_by_name}</Badge>
                          </div>
                          <div className="text-xs text-muted-foreground grid grid-cols-1 sm:grid-cols-2 gap-1">
                            <div><span className="font-medium text-foreground">Original:</span> {fmtType(c.original_event_type)} em {fmtDate(c.original_occurred_at)}</div>
                            <div><span className="font-medium text-foreground">Proposto:</span> {fmtType(c.new_event_type)} em {fmtDate(c.new_occurred_at)}</div>
                          </div>
                          <p className="text-xs leading-relaxed bg-muted/40 rounded px-2 py-1.5">{c.reason_detail}</p>
                          <div className="flex gap-2 pt-1">
                            <Button size="sm" onClick={() => { setResponseFor(c); setResponseAction("accept"); setResponseText(""); }}>
                              <Check className="h-3.5 w-3.5 mr-1" /> Aceitar
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => { setResponseFor(c); setResponseAction("contest"); setResponseText(""); }}>
                              <X className="h-3.5 w-3.5 mr-1" /> Contestar
                            </Button>
                          </div>
                        </div>
                      ))
                  }
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><FileLock2 className="h-4 w-4" /> Renovações de consentimento</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {pendingRenewals.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma renovação pendente.</p> :
                    pendingRenewals.map(r => (
                      <div key={r.id} className="border border-border/60 rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap">
                        <div className="space-y-0.5">
                          <div className="text-sm font-medium">Nova versão do termo (v{r.consent_version})</div>
                          <div className="text-xs text-muted-foreground">{r.message || "Atualize seu aceite para continuar registrando ponto biométrico."}</div>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => acknowledgeRenewal(r)}>
                          Marcar como lida
                        </Button>
                      </div>
                    ))
                  }
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-status-red" /> Alertas em aberto</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {myAlerts.length === 0 ? <p className="text-sm text-muted-foreground">Sem alertas em aberto.</p> :
                    myAlerts.map(a => (
                      <div key={a.id} className="text-xs border border-border/60 rounded px-2 py-1.5 flex items-center justify-between gap-2">
                        <span>{a.message}</span>
                        <Badge variant="outline" className="text-[10px]">{a.severity}</Badge>
                      </div>
                    ))
                  }
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="hoje" className="space-y-4 mt-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Snowflake className="h-4 w-4" /> Acessos de hoje</CardTitle></CardHeader>
                <CardContent>
                  {todayEvents.length === 0 ? <p className="text-sm text-muted-foreground">Sem registros hoje.</p> : (
                    <div className="space-y-1.5">
                      {todayEvents.map(e => (
                        <div key={e.id} className="text-xs border border-border/60 rounded px-2 py-1.5 flex items-center justify-between gap-2">
                          <span className="font-mono">{format(new Date(e.occurred_at), "HH:mm:ss")}</span>
                          <span>{e.event_type === "entry" ? "ENTRADA" : "SAÍDA"} · {areaName(e.cold_area_id)}</span>
                          <Badge variant="outline" className="text-[10px]">{e.source === "demo_simulation" ? "simulado" : e.source}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4" /> Pausas térmicas de hoje</CardTitle></CardHeader>
                <CardContent>
                  {myBreaks.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma pausa registrada hoje.</p> : (
                    <div className="space-y-1.5">
                      {myBreaks.map(b => (
                        <div key={b.id} className="text-xs border border-border/60 rounded px-2 py-1.5 flex items-center justify-between gap-2">
                          <span className="font-mono">{format(new Date(b.started_at), "HH:mm")} → {b.ended_at ? format(new Date(b.ended_at), "HH:mm") : "em curso"}</span>
                          <Badge variant="outline" className="text-[10px]">{b.completed ? "completa" : b.interrupted ? "interrompida" : "ativa"}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="historico" className="mt-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Minhas respostas a correções</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {corrections.filter(c => c.employee_responded_at).length === 0 ? (
                    <p className="text-sm text-muted-foreground">Você ainda não respondeu nenhuma correção.</p>
                  ) : corrections.filter(c => c.employee_responded_at).map(c => (
                    <div key={c.id} className="border border-border/60 rounded-lg p-3 space-y-1">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <span className="text-sm font-medium">{REASON_LABEL[c.reason_category] || c.reason_category}</span>
                        <Badge variant="outline" className={c.status === "employee_accepted" || c.status === "approved" ? "border-status-ok/40 text-status-ok" : c.status === "employee_contested" ? "border-status-red/40 text-status-red" : ""}>
                          {c.status === "employee_accepted" ? "Aceito por você" :
                           c.status === "employee_contested" ? "Contestado por você" :
                           c.status === "approved" ? "Aprovado pelo supervisor" :
                           c.status === "rejected" ? "Rejeitado" : c.status}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">Respondido em {fmtDate(c.employee_responded_at)}</div>
                      {c.employee_response && <p className="text-xs bg-muted/40 rounded px-2 py-1.5">{c.employee_response}</p>}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}

      <Dialog open={!!responseFor} onOpenChange={(o) => { if (!o) { setResponseFor(null); setResponseText(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{responseAction === "accept" ? "Aceitar correção" : "Contestar correção"}</DialogTitle>
          </DialogHeader>
          {responseFor && (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">
                <div>Original: {fmtType(responseFor.original_event_type)} em {fmtDate(responseFor.original_occurred_at)}</div>
                <div>Proposto: {fmtType(responseFor.new_event_type)} em {fmtDate(responseFor.new_occurred_at)}</div>
                <div className="mt-1">Justificativa do supervisor: <span className="text-foreground">{responseFor.reason_detail}</span></div>
              </div>
              <Textarea
                rows={3}
                placeholder={responseAction === "accept" ? "Comentário (opcional)" : "Explique o motivo da contestação (obrigatório)"}
                value={responseText}
                onChange={(e) => setResponseText(e.target.value)}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setResponseFor(null)}>Cancelar</Button>
            <Button
              onClick={submitResponse}
              disabled={responseAction === "contest" && !responseText.trim()}
            >
              {responseAction === "accept" ? "Confirmar aceite" : "Enviar contestação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryTile({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: "ok" | "warning" | "danger" | "neutral" }) {
  const toneCls =
    tone === "warning" ? "border-status-yellow/40 bg-status-yellow/5" :
    tone === "danger" ? "border-status-red/40 bg-status-red/5" :
    tone === "ok" ? "border-status-ok/30 bg-status-ok/5" :
    "border-border bg-muted/20";
  return (
    <div className={`rounded-lg border p-3 ${toneCls}`}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">{icon}{label}</div>
      <div className="text-2xl font-display font-semibold mt-1">{value}</div>
    </div>
  );
}
