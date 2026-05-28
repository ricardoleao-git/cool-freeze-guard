import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClipboardCheck, AlertTriangle, Check, X, MessageSquare, Filter } from "lucide-react";
import { useTenantScoped, useDemo } from "@/lib/demo-store";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { format } from "date-fns";
import { EventCorrectionDialog } from "@/components/EventCorrectionDialog";

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
  approved_by_name: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  employee_response: string | null;
  employee_responded_at: string | null;
  supervisor_validation: string | null;
  created_at: string;
};

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  pending: { label: "Aguardando colaborador", cls: "bg-status-yellow/15 text-status-yellow border-status-yellow/40" },
  employee_accepted: { label: "Aceito pelo colaborador", cls: "bg-status-ok/15 text-status-ok border-status-ok/40" },
  employee_contested: { label: "Contestado", cls: "bg-status-red/15 text-status-red border-status-red/40" },
  approved: { label: "Aprovado", cls: "bg-status-ok/15 text-status-ok border-status-ok/40" },
  rejected: { label: "Rejeitado", cls: "bg-muted text-muted-foreground border-border" },
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

type Inconsistency = {
  kind: "missing_exit" | "exit_without_entry" | "long_stay" | "back_to_back";
  employee_id: string;
  area_id: string | null;
  occurred_at: number;
  detail: string;
  event_id: string;
};

export default function TimeAdjustments() {
  const { events, employees, coldAreas } = useTenantScoped();
  const { activeTenantId } = useDemo();
  const { user } = useAuth();

  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterEmployee, setFilterEmployee] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const [editEvent, setEditEvent] = useState<typeof events[number] | null>(null);
  const [responseFor, setResponseFor] = useState<Correction | null>(null);
  const [responseText, setResponseText] = useState("");
  const [responseAction, setResponseAction] = useState<"accept" | "contest">("accept");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("access_event_corrections")
      .select("*")
      .eq("tenant_id", activeTenantId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) toast.error("Falha ao carregar correções: " + error.message);
    setCorrections((data || []) as Correction[]);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [activeTenantId]);

  const employeeName = (id: string) => employees.find(e => e.id === id)?.name || id;

  const filtered = useMemo(() => {
    return corrections.filter(c => {
      if (filterStatus !== "all" && c.status !== filterStatus) return false;
      if (filterEmployee && !employeeName(c.employee_id).toLowerCase().includes(filterEmployee.toLowerCase())) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corrections, filterEmployee, filterStatus, employees]);

  // Inconsistency detection
  const inconsistencies = useMemo<Inconsistency[]>(() => {
    const out: Inconsistency[] = [];
    const byEmp = new Map<string, typeof events>();
    for (const ev of events) {
      const arr = byEmp.get(ev.employee_id) || [];
      arr.push(ev);
      byEmp.set(ev.employee_id, arr);
    }
    for (const [empId, arr] of byEmp) {
      const sorted = [...arr].sort((a, b) => a.occurred_at - b.occurred_at);
      let lastEntry: typeof events[number] | null = null;
      for (let i = 0; i < sorted.length; i++) {
        const ev = sorted[i];
        if (ev.event_type === "entry") {
          if (lastEntry) {
            out.push({
              kind: "back_to_back",
              employee_id: empId,
              area_id: ev.cold_area_id,
              occurred_at: ev.occurred_at,
              detail: `Duas entradas consecutivas sem saída registrada (anterior em ${format(new Date(lastEntry.occurred_at), "dd/MM HH:mm")}).`,
              event_id: ev.id,
            });
          }
          lastEntry = ev;
        } else if (ev.event_type === "exit") {
          if (!lastEntry) {
            out.push({
              kind: "exit_without_entry",
              employee_id: empId,
              area_id: ev.cold_area_id,
              occurred_at: ev.occurred_at,
              detail: "Saída registrada sem entrada anterior.",
              event_id: ev.id,
            });
          } else {
            const diffMin = (ev.occurred_at - lastEntry.occurred_at) / 60000;
            if (diffMin > 240) {
              out.push({
                kind: "long_stay",
                employee_id: empId,
                area_id: lastEntry.cold_area_id,
                occurred_at: lastEntry.occurred_at,
                detail: `Permanência de ${Math.round(diffMin)} min entre entrada e saída.`,
                event_id: lastEntry.id,
              });
            }
            lastEntry = null;
          }
        }
      }
      if (lastEntry) {
        const ageMin = (Date.now() - lastEntry.occurred_at) / 60000;
        if (ageMin > 120) {
          out.push({
            kind: "missing_exit",
            employee_id: empId,
            area_id: lastEntry.cold_area_id,
            occurred_at: lastEntry.occurred_at,
            detail: `Entrada sem saída há ${Math.round(ageMin)} min.`,
            event_id: lastEntry.id,
          });
        }
      }
    }
    return out.sort((a, b) => b.occurred_at - a.occurred_at);
  }, [events]);

  const approve = async (c: Correction) => {
    const { error } = await supabase
      .from("access_event_corrections")
      .update({
        status: "approved",
        approved_by_user_id: user?.id ?? null,
        approved_by_name: user?.email ?? "gestor.demo",
        approved_at: new Date().toISOString(),
        supervisor_validation: "validated",
      })
      .eq("id", c.id);
    if (error) { toast.error("Erro: " + error.message); return; }
    toast.success("Correção aprovada e registrada em trilha.");
    load();
  };

  const reject = async (c: Correction) => {
    const reason = window.prompt("Motivo da rejeição:");
    if (!reason) return;
    const { error } = await supabase
      .from("access_event_corrections")
      .update({
        status: "rejected",
        approved_by_user_id: user?.id ?? null,
        approved_by_name: user?.email ?? "gestor.demo",
        approved_at: new Date().toISOString(),
        rejection_reason: reason,
      })
      .eq("id", c.id);
    if (error) { toast.error("Erro: " + error.message); return; }
    toast.success("Correção rejeitada.");
    load();
  };

  const submitResponse = async () => {
    if (!responseFor) return;
    const { error } = await supabase
      .from("access_event_corrections")
      .update({
        status: responseAction === "accept" ? "employee_accepted" : "employee_contested",
        employee_response: responseText.trim() || (responseAction === "accept" ? "Aceito sem comentário." : "Contesta sem detalhe."),
        employee_responded_at: new Date().toISOString(),
      })
      .eq("id", responseFor.id);
    if (error) { toast.error("Erro: " + error.message); return; }
    toast.success(responseAction === "accept" ? "Resposta registrada: colaborador aceitou." : "Resposta registrada: colaborador contestou.");
    setResponseFor(null); setResponseText("");
    load();
  };

  const inconsistencyForEvent = (eventId: string) => events.find(e => e.id === eventId);

  return (
    <div className="container py-6 md:py-8 space-y-6">
      <PageHeader
        eyebrow="Operação"
        title="Ajustes & Inconsistências"
        description="Edite horários e tipos de evento com justificativa, valide contestações dos colaboradores e resolva inconsistências detectadas automaticamente."
        icon={<ClipboardCheck className="h-5 w-5" />}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Correções pendentes</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold">{corrections.filter(c => c.status === "pending" || c.status === "employee_accepted" || c.status === "employee_contested").length}</CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Contestações</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold text-status-red">{corrections.filter(c => c.status === "employee_contested").length}</CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Inconsistências detectadas</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold text-status-yellow">{inconsistencies.length}</CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Aprovadas hoje</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold text-status-ok">
            {corrections.filter(c => c.status === "approved" && new Date(c.approved_at || 0).toDateString() === new Date().toDateString()).length}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="corrections">
        <TabsList>
          <TabsTrigger value="corrections">Correções de eventos</TabsTrigger>
          <TabsTrigger value="inconsistencies">Inconsistências detectadas ({inconsistencies.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="corrections" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Filter className="h-3.5 w-3.5" /> Filtros:</div>
            <Input placeholder="Colaborador..." value={filterEmployee} onChange={(e) => setFilterEmployee(e.target.value)} className="max-w-xs h-9" />
            {(["all", "pending", "employee_accepted", "employee_contested", "approved", "rejected"]).map(s => (
              <Button key={s} size="sm" variant={filterStatus === s ? "default" : "outline"} onClick={() => setFilterStatus(s)}>
                {s === "all" ? "Todos" : STATUS_LABEL[s]?.label || s}
              </Button>
            ))}
          </div>

          <div className="glass-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Aberta em</TableHead>
                  <TableHead>Colaborador</TableHead>
                  <TableHead>Original</TableHead>
                  <TableHead>Corrigido</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && <TableRow><TableCell colSpan={7} className="text-center py-10 text-sm text-muted-foreground">Carregando…</TableCell></TableRow>}
                {!loading && filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-10 text-sm text-muted-foreground">Nenhuma correção registrada.</TableCell></TableRow>}
                {filtered.map(c => {
                  const st = STATUS_LABEL[c.status] || { label: c.status, cls: "" };
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs">{format(new Date(c.created_at), "dd/MM HH:mm")}</TableCell>
                      <TableCell className="text-sm">{employeeName(c.employee_id)}</TableCell>
                      <TableCell className="text-xs">
                        <div>{c.original_event_type === "entry" ? "ENTRADA" : "SAÍDA"}</div>
                        <div className="text-muted-foreground font-mono">{format(new Date(c.original_occurred_at), "dd/MM HH:mm")}</div>
                      </TableCell>
                      <TableCell className="text-xs">
                        <div>{(c.new_event_type || c.original_event_type) === "entry" ? "ENTRADA" : "SAÍDA"}</div>
                        <div className="text-muted-foreground font-mono">{c.new_occurred_at ? format(new Date(c.new_occurred_at), "dd/MM HH:mm") : "—"}</div>
                      </TableCell>
                      <TableCell className="text-xs max-w-[240px]">
                        <div className="font-medium">{REASON_LABEL[c.reason_category] || c.reason_category}</div>
                        <div className="text-muted-foreground truncate" title={c.reason_detail}>{c.reason_detail}</div>
                        {c.employee_response && <div className="mt-1 text-[11px] italic">"{c.employee_response}"</div>}
                      </TableCell>
                      <TableCell><Badge variant="outline" className={st.cls}>{st.label}</Badge></TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end flex-wrap">
                          {(c.status === "pending" || c.status === "employee_accepted" || c.status === "employee_contested") && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => { setResponseFor(c); setResponseAction("accept"); setResponseText(""); }}>
                                <MessageSquare className="h-3.5 w-3.5 mr-1" /> Resposta do colaborador
                              </Button>
                              <Button size="sm" variant="default" onClick={() => approve(c)}><Check className="h-3.5 w-3.5 mr-1" /> Validar</Button>
                              <Button size="sm" variant="ghost" className="text-status-red" onClick={() => reject(c)}><X className="h-3.5 w-3.5 mr-1" /> Rejeitar</Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="inconsistencies" className="space-y-3">
          <div className="glass-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Colaborador</TableHead>
                  <TableHead>Ambiente</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Detalhe</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inconsistencies.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center py-10 text-sm text-muted-foreground">
                    <Check className="h-5 w-5 inline mr-1 text-status-ok" /> Nenhuma inconsistência detectada.
                  </TableCell></TableRow>
                )}
                {inconsistencies.map((i, idx) => {
                  const kindLabel = {
                    missing_exit: { label: "Saída ausente", cls: "border-status-red/40 text-status-red" },
                    exit_without_entry: { label: "Saída órfã", cls: "border-status-red/40 text-status-red" },
                    long_stay: { label: "Permanência longa", cls: "border-status-yellow/40 text-status-yellow" },
                    back_to_back: { label: "Entradas duplicadas", cls: "border-status-yellow/40 text-status-yellow" },
                  }[i.kind];
                  const area = coldAreas.find(a => a.id === i.area_id);
                  return (
                    <TableRow key={idx}>
                      <TableCell className="font-mono text-xs">{format(new Date(i.occurred_at), "dd/MM HH:mm")}</TableCell>
                      <TableCell className="text-sm">{employeeName(i.employee_id)}</TableCell>
                      <TableCell className="text-xs">{area?.name || "—"}</TableCell>
                      <TableCell><Badge variant="outline" className={kindLabel.cls}><AlertTriangle className="h-3 w-3 mr-1" />{kindLabel.label}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[320px]">{i.detail}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => {
                          const ev = inconsistencyForEvent(i.event_id);
                          if (ev) setEditEvent(ev);
                          else toast.error("Evento não encontrado no cache.");
                        }}>Corrigir</Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      <EventCorrectionDialog
        event={editEvent}
        open={!!editEvent}
        onOpenChange={(o) => !o && setEditEvent(null)}
        onCreated={load}
      />

      <Dialog open={!!responseFor} onOpenChange={(o) => { if (!o) { setResponseFor(null); setResponseText(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resposta do colaborador</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="flex gap-2">
              <Button variant={responseAction === "accept" ? "default" : "outline"} onClick={() => setResponseAction("accept")} className="flex-1">
                <Check className="h-4 w-4 mr-1" /> Aceito
              </Button>
              <Button variant={responseAction === "contest" ? "destructive" : "outline"} onClick={() => setResponseAction("contest")} className="flex-1">
                <X className="h-4 w-4 mr-1" /> Contesto
              </Button>
            </div>
            <Textarea rows={4} placeholder="Comentário do colaborador..." value={responseText} onChange={(e) => setResponseText(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setResponseFor(null); setResponseText(""); }}>Cancelar</Button>
            <Button onClick={submitResponse}>Registrar resposta</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
