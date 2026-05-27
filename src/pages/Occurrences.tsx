import { PageHeader } from "@/components/PageHeader";
import { useTenantScoped, useDemo } from "@/lib/demo-store";
import { Occurrence, OccurrenceCategory, OccurrencePriority } from "@/lib/demo-data";
import {
  FileWarning, Plus, Paperclip, MessageSquarePlus, CheckCircle2, Filter, Search,
  AlertTriangle, ShieldAlert, ShieldCheck, Cpu, PencilLine, EyeOff, FileText, Download, Trash2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const CATEGORY_META: Record<OccurrenceCategory, { label: string; icon: any; tone: string }> = {
  missing_exit: { label: "Saída não registrada", icon: EyeOff, tone: "text-status-orange" },
  missing_entry: { label: "Entrada não registrada", icon: EyeOff, tone: "text-status-yellow" },
  device_failure: { label: "Falha no leitor", icon: Cpu, tone: "text-status-red" },
  manual_correction: { label: "Correção manual", icon: PencilLine, tone: "text-primary" },
  false_reading: { label: "Leitura falsa", icon: ShieldAlert, tone: "text-status-yellow" },
  other: { label: "Outro", icon: FileWarning, tone: "text-muted-foreground" },
};

const PRIORITY_META: Record<OccurrencePriority, { label: string; className: string }> = {
  low: { label: "Baixa", className: "bg-muted text-muted-foreground" },
  medium: { label: "Média", className: "bg-status-yellow/15 text-status-yellow border border-status-yellow/40" },
  high: { label: "Alta", className: "bg-status-red/15 text-status-red border border-status-red/40" },
};

const STATUS_META: Record<Occurrence["status"], { label: string; className: string }> = {
  open: { label: "Aberta", className: "bg-status-red/15 text-status-red border border-status-red/40" },
  in_review: { label: "Em análise", className: "bg-status-yellow/15 text-status-yellow border border-status-yellow/40" },
  resolved: { label: "Resolvida", className: "bg-status-ok/15 text-status-ok border border-status-ok/40" },
};

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function Occurrences() {
  const { occurrences, employees, units, departments } = useTenantScoped();
  const { addOccurrence, updateOccurrence, resolveOccurrence, addOccurrenceNote, addOccurrenceAttachment, activeTenantId } = useDemo();

  const [statusFilter, setStatusFilter] = useState<"all" | Occurrence["status"]>("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | OccurrenceCategory>("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | OccurrencePriority>("all");
  const [query, setQuery] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<{
    employee_id: string; category: OccurrenceCategory; priority: OccurrencePriority; title: string; description: string;
  }>({ employee_id: "", category: "missing_exit", priority: "medium", title: "", description: "" });

  const [detailId, setDetailId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [resolution, setResolution] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return occurrences.filter(o => {
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (categoryFilter !== "all" && o.category !== categoryFilter) return false;
      if (priorityFilter !== "all" && o.priority !== priorityFilter) return false;
      if (!q) return true;
      const emp = employees.find(e => e.id === o.employee_id);
      return [o.title, o.description, emp?.name, emp?.registration_number].some(v => v?.toLowerCase().includes(q));
    });
  }, [occurrences, statusFilter, categoryFilter, priorityFilter, query, employees]);

  const detail = detailId ? occurrences.find(o => o.id === detailId) : null;
  const detailEmp = detail ? employees.find(e => e.id === detail.employee_id) : null;
  const detailUnit = detailEmp ? units.find(u => u.id === detailEmp.unit_id) : null;
  const detailDept = detailEmp ? departments.find(d => d.id === detailEmp.department_id) : null;

  const counts = useMemo(() => ({
    open: occurrences.filter(o => o.status === "open").length,
    in_review: occurrences.filter(o => o.status === "in_review").length,
    resolved: occurrences.filter(o => o.status === "resolved").length,
    high: occurrences.filter(o => o.priority === "high" && o.status !== "resolved").length,
  }), [occurrences]);

  const handleCreate = () => {
    if (!form.employee_id) return toast.error("Selecione um colaborador");
    if (!form.description.trim()) return toast.error("Descreva a ocorrência");
    addOccurrence({
      tenant_id: activeTenantId,
      employee_id: form.employee_id,
      category: form.category,
      priority: form.priority,
      title: form.title || undefined,
      description: form.description,
    });
    toast.success("Ocorrência aberta");
    setCreateOpen(false);
    setForm({ employee_id: "", category: "missing_exit", priority: "medium", title: "", description: "" });
  };

  const handleAttach = async (files: FileList | null) => {
    if (!detail || !files || files.length === 0) return;
    for (const f of Array.from(files)) {
      if (f.size > 5 * 1024 * 1024) { toast.error(`${f.name} excede 5 MB`); continue; }
      await addOccurrenceAttachment(detail.id, f);
    }
    toast.success("Anexo(s) adicionado(s)");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="container py-6 md:py-8">
      <PageHeader
        eyebrow="RH / SST"
        title="Ocorrências & Justificativas"
        description="Abertura, categorização e tratamento de inconsistências do controle térmico — saídas não registradas, falhas de leitor, correções manuais e auditoria."
        icon={<FileWarning className="h-5 w-5" />}
        actions={
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" /> Nova ocorrência</Button></DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Abrir nova ocorrência</DialogTitle>
                <DialogDescription>Registre a justificativa para fins de auditoria SST. Toda ocorrência fica no log.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 py-2">
                <div>
                  <Label>Colaborador</Label>
                  <Select value={form.employee_id} onValueChange={(v) => setForm(f => ({ ...f, employee_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>{employees.map(e => <SelectItem key={e.id} value={e.id}>{e.name} · {e.registration_number}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Categoria</Label>
                    <Select value={form.category} onValueChange={(v) => setForm(f => ({ ...f, category: v as OccurrenceCategory }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(CATEGORY_META).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Prioridade</Label>
                    <Select value={form.priority} onValueChange={(v) => setForm(f => ({ ...f, priority: v as OccurrencePriority }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Baixa</SelectItem>
                        <SelectItem value="medium">Média</SelectItem>
                        <SelectItem value="high">Alta</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Título (opcional)</Label>
                  <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Resumo curto" />
                </div>
                <div>
                  <Label>Descrição / Justificativa</Label>
                  <Textarea rows={4} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Contextualize o evento, citando data/horário, área e ação tomada." />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
                <Button onClick={handleCreate}>Abrir ocorrência</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          { label: "Abertas", value: counts.open, icon: AlertTriangle, tone: "text-status-red" },
          { label: "Em análise", value: counts.in_review, icon: ShieldAlert, tone: "text-status-yellow" },
          { label: "Resolvidas", value: counts.resolved, icon: ShieldCheck, tone: "text-status-ok" },
          { label: "Prioridade alta", value: counts.high, icon: FileWarning, tone: "text-status-orange" },
        ].map(k => (
          <Card key={k.label} className="glass-card">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{k.label}</div>
                <div className="font-display text-2xl font-bold">{k.value}</div>
              </div>
              <k.icon className={`h-5 w-5 ${k.tone}`} />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="glass-card mb-4">
        <CardContent className="p-3 flex flex-col md:flex-row md:items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por colaborador, matrícula ou texto…" className="pl-9" />
          </div>
          <div className="flex gap-2 flex-wrap">
            <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
              <TabsList>
                <TabsTrigger value="all">Todas</TabsTrigger>
                <TabsTrigger value="open">Abertas</TabsTrigger>
                <TabsTrigger value="in_review">Em análise</TabsTrigger>
                <TabsTrigger value="resolved">Resolvidas</TabsTrigger>
              </TabsList>
            </Tabs>
            <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as any)}>
              <SelectTrigger className="w-[180px]"><Filter className="h-3.5 w-3.5 mr-1" /><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas categorias</SelectItem>
                {Object.entries(CATEGORY_META).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={(v) => setPriorityFilter(v as any)}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toda prioridade</SelectItem>
                <SelectItem value="high">Alta</SelectItem>
                <SelectItem value="medium">Média</SelectItem>
                <SelectItem value="low">Baixa</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {filtered.length === 0 && (
          <Card className="glass-card"><CardContent className="p-10 text-center text-muted-foreground">
            <FileWarning className="h-8 w-8 mx-auto mb-2 opacity-50" />
            Nenhuma ocorrência encontrada com os filtros atuais.
          </CardContent></Card>
        )}
        {filtered.map(o => {
          const emp = employees.find(e => e.id === o.employee_id);
          const cat = CATEGORY_META[o.category];
          const Icon = cat.icon;
          return (
            <Card key={o.id} className="glass-card cursor-pointer hover:border-primary/40 transition" onClick={() => { setDetailId(o.id); setNoteText(""); setResolution(""); }}>
              <CardContent className="p-4 flex flex-col md:flex-row md:items-center gap-4">
                <div className={`h-11 w-11 rounded-xl bg-card border border-border grid place-items-center ${cat.tone}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold truncate">{o.title}</span>
                    <Badge className={STATUS_META[o.status].className} variant="outline">{STATUS_META[o.status].label}</Badge>
                    <Badge className={PRIORITY_META[o.priority].className} variant="outline">{PRIORITY_META[o.priority].label}</Badge>
                    <span className="text-xs text-muted-foreground">· {cat.label}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                    {emp && <span className="flex items-center gap-1.5"><Avatar className="h-4 w-4"><AvatarImage src={emp.avatar} /><AvatarFallback>{emp.name[0]}</AvatarFallback></Avatar>{emp.name}</span>}
                    <span>· aberta {format(new Date(o.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>
                    <span>· por {o.created_by}</span>
                  </div>
                  <p className="text-sm mt-1.5 line-clamp-2 text-muted-foreground">{o.description}</p>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                  {o.attachments.length > 0 && <span className="flex items-center gap-1"><Paperclip className="h-3.5 w-3.5" />{o.attachments.length}</span>}
                  {o.notes.length > 0 && <span className="flex items-center gap-1"><MessageSquarePlus className="h-3.5 w-3.5" />{o.notes.length}</span>}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {detail && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 flex-wrap">
                  <DialogTitle className="font-display">{detail.title}</DialogTitle>
                  <Badge className={STATUS_META[detail.status].className} variant="outline">{STATUS_META[detail.status].label}</Badge>
                  <Badge className={PRIORITY_META[detail.priority].className} variant="outline">{PRIORITY_META[detail.priority].label}</Badge>
                </div>
                <DialogDescription>
                  {CATEGORY_META[detail.category].label} · aberta em {format(new Date(detail.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })} por {detail.created_by}
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-2">
                {detailEmp && (
                  <div className="flex items-center gap-3 rounded-xl border border-border p-3 bg-card/40">
                    <Avatar className="h-10 w-10"><AvatarImage src={detailEmp.avatar} /><AvatarFallback>{detailEmp.name[0]}</AvatarFallback></Avatar>
                    <div className="text-sm">
                      <div className="font-semibold">{detailEmp.name}</div>
                      <div className="text-xs text-muted-foreground">Matrícula {detailEmp.registration_number} · {detailDept?.name} · {detailUnit?.name}</div>
                    </div>
                  </div>
                )}

                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Descrição</Label>
                  <p className="text-sm whitespace-pre-wrap mt-1">{detail.description}</p>
                </div>

                {detail.status !== "resolved" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Status</Label>
                      <Select value={detail.status} onValueChange={(v) => updateOccurrence(detail.id, { status: v as Occurrence["status"] })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="open">Aberta</SelectItem>
                          <SelectItem value="in_review">Em análise</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Prioridade</Label>
                      <Select value={detail.priority} onValueChange={(v) => updateOccurrence(detail.id, { priority: v as OccurrencePriority })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Baixa</SelectItem>
                          <SelectItem value="medium">Média</SelectItem>
                          <SelectItem value="high">Alta</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                <Separator />

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Paperclip className="h-3.5 w-3.5" /> Anexos ({detail.attachments.length})</Label>
                    {detail.status !== "resolved" && (
                      <>
                        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={e => handleAttach(e.target.files)} />
                        <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                          <Paperclip className="h-3.5 w-3.5 mr-1" /> Anexar arquivo
                        </Button>
                      </>
                    )}
                  </div>
                  {detail.attachments.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">Nenhum anexo. Suba foto do leitor, planilha de turno ou PDF assinado pelo encarregado.</p>
                  ) : (
                    <div className="grid gap-2">
                      {detail.attachments.map(a => (
                        <div key={a.id} className="flex items-center gap-2 rounded-lg border border-border p-2 bg-card/40">
                          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm truncate">{a.name}</div>
                            <div className="text-[10.5px] text-muted-foreground">{a.mime || "arquivo"} · {fmtSize(a.size)}</div>
                          </div>
                          {a.data_url && (
                            <a href={a.data_url} download={a.name} className="text-muted-foreground hover:text-foreground">
                              <Download className="h-4 w-4" />
                            </a>
                          )}
                          {detail.status !== "resolved" && (
                            <button
                              onClick={() => updateOccurrence(detail.id, { attachments: detail.attachments.filter(x => x.id !== a.id) })}
                              className="text-muted-foreground hover:text-status-red"
                            ><Trash2 className="h-4 w-4" /></button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <Separator />

                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-2"><MessageSquarePlus className="h-3.5 w-3.5" /> Histórico ({detail.notes.length})</Label>
                  <div className="space-y-2 mb-2">
                    {detail.notes.map(n => (
                      <div key={n.id} className="rounded-lg border border-border bg-card/40 p-2.5">
                        <div className="text-[11px] text-muted-foreground">{n.author} · {format(new Date(n.created_at), "dd/MM HH:mm")}</div>
                        <p className="text-sm mt-0.5">{n.text}</p>
                      </div>
                    ))}
                    {detail.notes.length === 0 && <p className="text-xs text-muted-foreground italic">Sem anotações.</p>}
                  </div>
                  {detail.status !== "resolved" && (
                    <div className="flex gap-2">
                      <Textarea rows={2} value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Adicionar anotação ao histórico…" />
                      <Button variant="outline" onClick={() => {
                        if (!noteText.trim()) return;
                        addOccurrenceNote(detail.id, noteText.trim());
                        setNoteText("");
                      }}>Adicionar</Button>
                    </div>
                  )}
                </div>

                {detail.status === "resolved" ? (
                  <div className="rounded-xl border border-status-ok/40 bg-status-ok/10 p-3">
                    <div className="text-xs uppercase tracking-wider text-status-ok flex items-center gap-1.5 mb-1"><CheckCircle2 className="h-3.5 w-3.5" /> Resolução</div>
                    <p className="text-sm">{detail.resolution}</p>
                    <div className="text-[11px] text-muted-foreground mt-1">por {detail.resolved_by} · {detail.resolved_at && format(new Date(detail.resolved_at), "dd/MM/yyyy HH:mm")}</div>
                  </div>
                ) : (
                  <div>
                    <Label className="text-xs">Resolver ocorrência</Label>
                    <Textarea rows={2} value={resolution} onChange={e => setResolution(e.target.value)} placeholder="Descreva a ação tomada (correção aplicada, validação assinada, equipamento substituído…)" />
                  </div>
                )}
              </div>

              <DialogFooter>
                {detail.status !== "resolved" ? (
                  <Button onClick={() => {
                    if (!resolution.trim()) return toast.error("Descreva a resolução");
                    resolveOccurrence(detail.id, resolution.trim());
                    toast.success("Ocorrência resolvida");
                    setDetailId(null);
                  }}>
                    <CheckCircle2 className="h-4 w-4 mr-2" /> Marcar como resolvida
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => setDetailId(null)}>Fechar</Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
