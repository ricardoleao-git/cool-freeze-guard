import { PageHeader } from "@/components/PageHeader";
import { useTenantScoped, useDemo } from "@/lib/demo-store";
import { AlertTriangle, Check, CheckCheck, FileWarning, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type SevFilter = "all" | "critical" | "warning" | "info";

export default function Alerts() {
  const { alerts, employees, occurrences } = useTenantScoped();
  const { acknowledgeAlert, addOccurrence, activeTenantId } = useDemo();

  const [open, setOpen] = useState(false);
  const [sevFilter, setSevFilter] = useState<SevFilter>("all");
  const [form, setForm] = useState<{ employee_id: string; type: "missing_exit" | "device_failure" | "manual_correction" | "missing_entry" | "other"; description: string }>({ employee_id: "", type: "missing_exit", description: "" });

  const filteredAlerts = useMemo(
    () => alerts.filter(a => sevFilter === "all" ? true : a.severity === sevFilter),
    [alerts, sevFilter],
  );
  const openAlerts = useMemo(() => filteredAlerts.filter(a => a.status === "open"), [filteredAlerts]);

  const bulkResolve = async (subset: typeof alerts) => {
    if (subset.length === 0) return toast.info("Nenhum alerta para resolver.");
    await Promise.all(subset.map(a => acknowledgeAlert(a.id)));
    toast.success(`${subset.length} alerta(s) marcados como reconhecidos`);
  };

  const severityColor = (s: string) => s === "critical" ? "border-status-red/60 bg-status-red/10" : s === "warning" ? "border-status-orange/50 bg-status-orange/10" : "border-primary/40 bg-primary/10";


  return (
    <div className="container py-6 md:py-8">
      <PageHeader
        eyebrow="Operação"
        title="Alertas & Ocorrências"
        description="Alertas em tempo real do motor de exposição e ocorrências/justificativas abertas pelos gestores."
        icon={<AlertTriangle className="h-5 w-5" />}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" /> Abrir ocorrência</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Nova ocorrência / justificativa</DialogTitle></DialogHeader>
              <div className="grid gap-3 py-2">
                <div>
                  <Label>Colaborador</Label>
                  <Select value={form.employee_id} onValueChange={(v) => setForm(f => ({ ...f, employee_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>{employees.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Tipo</Label>
                  <Select value={form.type} onValueChange={(v) => setForm(f => ({ ...f, type: v as typeof f.type }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="missing_exit">Saída não registrada</SelectItem>
                      <SelectItem value="missing_entry">Entrada não registrada</SelectItem>
                      <SelectItem value="device_failure">Falha no leitor facial</SelectItem>
                      <SelectItem value="manual_correction">Correção manual</SelectItem>
                      <SelectItem value="other">Outro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Descrição</Label>
                  <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Descreva a justificativa e o contexto." />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => {
                  if (!form.employee_id) return toast.error("Selecione um colaborador");
                  addOccurrence({ tenant_id: activeTenantId, employee_id: form.employee_id, category: form.type, description: form.description });
                  toast.success("Ocorrência registrada");
                  setOpen(false);
                  setForm({ employee_id: "", type: "missing_exit", description: "" });
                }}>Salvar</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="glass-card">
          <CardHeader className="pb-3">
            <CardTitle className="font-display flex items-center gap-2 flex-wrap">
              <AlertTriangle className="h-4 w-4" /> Alertas em tempo real
              <Badge variant="outline" className="ml-1">{openAlerts.length} abertos</Badge>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                disabled={openAlerts.length === 0}
                onClick={() => bulkResolve(openAlerts)}
              >
                <CheckCheck className="h-3.5 w-3.5 mr-1" /> Resolver todos
              </Button>
            </CardTitle>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {([
                { id: "all", label: "Todos" },
                { id: "critical", label: "Crítico" },
                { id: "warning", label: "Atenção" },
                { id: "info", label: "Info" },
              ] as { id: SevFilter; label: string }[]).map(f => (
                <button
                  key={f.id}
                  onClick={() => setSevFilter(f.id)}
                  className={`px-2.5 py-1 rounded-full text-xs uppercase tracking-wider font-medium border transition-colors ${sevFilter === f.id ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[560px] overflow-y-auto">
            {filteredAlerts.length === 0 && <div className="text-sm text-muted-foreground">Nenhum alerta neste filtro.</div>}
            {filteredAlerts.map(a => {
              const emp = employees.find(e => e.id === a.employee_id);
              return (
                <div key={a.id} className={`rounded-xl border p-3 ${severityColor(a.severity)}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{emp?.name}</div>
                      <div className="text-xs text-muted-foreground">{format(new Date(a.triggered_at), "dd/MM HH:mm:ss")} · {a.alert_type}</div>
                      <p className="text-sm mt-1">{a.message}</p>
                    </div>
                    {a.status === "open" ? (
                      <Button size="sm" variant="outline" onClick={() => acknowledgeAlert(a.id)}><Check className="h-3.5 w-3.5 mr-1" /> Resolver</Button>
                    ) : <span className="text-xs text-muted-foreground whitespace-nowrap">Resolvido</span>}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader><CardTitle className="font-display flex items-center gap-2"><FileWarning className="h-4 w-4" /> Ocorrências / Justificativas</CardTitle></CardHeader>
          <CardContent className="space-y-2 max-h-[600px] overflow-y-auto">
            {occurrences.length === 0 && <div className="text-sm text-muted-foreground">Nenhuma ocorrência aberta.</div>}
            {occurrences.map(o => {
              const emp = employees.find(e => e.id === o.employee_id);
              return (
                <div key={o.id} className="rounded-xl border border-border bg-card/60 p-3">
                  <div className="text-sm font-semibold">{emp?.name} — <span className="font-normal text-muted-foreground">{o.title || o.category}</span></div>
                  <div className="text-xs text-muted-foreground">{format(new Date(o.created_at), "dd/MM HH:mm")}</div>
                  <p className="text-sm mt-1">{o.description || <span className="italic text-muted-foreground">Sem descrição</span>}</p>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
