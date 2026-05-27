import { useMemo, useState } from "react";
import { useDemo } from "@/lib/demo-store";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ClipboardList, Download, FileText, Filter, ImageIcon, Paperclip, Search, X, Eye } from "lucide-react";
import type { Occurrence, OccurrencePriority, OccurrenceCategory } from "@/lib/demo-data";

const CATEGORY_LABELS: Record<OccurrenceCategory, string> = {
  missing_exit: "Saída não registrada",
  missing_entry: "Entrada não registrada",
  device_failure: "Falha no leitor facial",
  manual_correction: "Correção manual",
  false_reading: "Leitura inválida",
  other: "Outros",
};

const PRIORITY_LABELS: Record<OccurrencePriority, string> = { low: "Baixa", medium: "Média", high: "Alta" };
const PRIORITY_CLASS: Record<OccurrencePriority, string> = {
  low: "border-status-ok/40 text-status-ok bg-status-ok/10",
  medium: "border-status-yellow/40 text-status-yellow bg-status-yellow/10",
  high: "border-status-red/40 text-status-red bg-status-red/10",
};
const STATUS_LABELS: Record<string, string> = { open: "Aberta", in_review: "Em análise", resolved: "Resolvida" };

export default function History() {
  const { occurrences, employees, units, getAttachmentDownloadUrl } = useDemo();

  const [search, setSearch] = useState("");
  const [employeeId, setEmployeeId] = useState<string>("all");
  const [unitId, setUnitId] = useState<string>("all");
  const [priority, setPriority] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [hasAttach, setHasAttach] = useState<"all" | "yes" | "no">("all");
  const [openOcc, setOpenOcc] = useState<Occurrence | null>(null);

  const employeeMap = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);
  const unitMap = useMemo(() => new Map(units.map(u => [u.id, u])), [units]);

  const filtered = useMemo(() => {
    return occurrences
      .filter(o => {
        const emp = employeeMap.get(o.employee_id);
        const u = emp ? unitMap.get(emp.unit_id) : undefined;
        if (employeeId !== "all" && o.employee_id !== employeeId) return false;
        if (unitId !== "all" && emp?.unit_id !== unitId) return false;
        if (priority !== "all" && o.priority !== priority) return false;
        if (category !== "all" && o.category !== category) return false;
        if (status !== "all" && o.status !== status) return false;
        if (hasAttach === "yes" && o.attachments.length === 0) return false;
        if (hasAttach === "no" && o.attachments.length > 0) return false;
        if (dateFrom && o.created_at < new Date(dateFrom).getTime()) return false;
        if (dateTo && o.created_at > new Date(dateTo).getTime() + 86400000) return false;
        if (search) {
          const q = search.toLowerCase();
          const hit = o.title.toLowerCase().includes(q)
            || o.description.toLowerCase().includes(q)
            || emp?.name.toLowerCase().includes(q)
            || emp?.registration_number.toLowerCase().includes(q)
            || u?.name.toLowerCase().includes(q);
          if (!hit) return false;
        }
        return true;
      })
      .sort((a, b) => b.created_at - a.created_at);
  }, [occurrences, employeeId, unitId, priority, category, status, hasAttach, dateFrom, dateTo, search, employeeMap, unitMap]);

  const totals = useMemo(() => ({
    total: filtered.length,
    high: filtered.filter(o => o.priority === "high").length,
    open: filtered.filter(o => o.status !== "resolved").length,
    withEvidence: filtered.filter(o => o.attachments.length > 0).length,
  }), [filtered]);

  const clearFilters = () => {
    setSearch(""); setEmployeeId("all"); setUnitId("all");
    setPriority("all"); setCategory("all"); setStatus("all");
    setDateFrom(""); setDateTo(""); setHasAttach("all");
  };

  const handleDownload = async (path: string, name: string) => {
    const url = await getAttachmentDownloadUrl(path, name);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
  };

  const exportCsv = () => {
    const rows = [
      ["Data", "Colaborador", "Matrícula", "Unidade", "Categoria", "Prioridade", "Status", "Título", "Anexos"],
      ...filtered.map(o => {
        const emp = employeeMap.get(o.employee_id);
        const u = emp ? unitMap.get(emp.unit_id) : undefined;
        return [
          new Date(o.created_at).toLocaleString("pt-BR"),
          emp?.name ?? "—", emp?.registration_number ?? "—", u?.name ?? "—",
          CATEGORY_LABELS[o.category], PRIORITY_LABELS[o.priority], STATUS_LABELS[o.status],
          o.title, String(o.attachments.length),
        ];
      }),
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `historico-rh-sst-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-primary" /> Histórico RH / SST
          </h1>
          <p className="text-sm text-muted-foreground">
            Trilha de auditoria completa de ocorrências, evidências e ações corretivas.
          </p>
        </div>
        <Button variant="outline" onClick={exportCsv}>
          <Download className="h-4 w-4" /> Exportar CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Ocorrências" value={totals.total} />
        <KPI label="Alta severidade" value={totals.high} tone="red" />
        <KPI label="Em aberto" value={totals.open} tone="yellow" />
        <KPI label="Com evidência" value={totals.withEvidence} tone="primary" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4 text-primary" /> Filtros avançados
          </CardTitle>
          <CardDescription>Combine critérios para investigar incidentes específicos.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
          <div className="md:col-span-2 lg:col-span-2">
            <Label>Busca livre</Label>
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Título, descrição, colaborador, matrícula…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          <FilterSelect label="Colaborador" value={employeeId} onChange={setEmployeeId}
            options={[{ v: "all", l: "Todos" }, ...employees.map(e => ({ v: e.id, l: `${e.name} (${e.registration_number})` }))]} />
          <FilterSelect label="Unidade" value={unitId} onChange={setUnitId}
            options={[{ v: "all", l: "Todas" }, ...units.map(u => ({ v: u.id, l: u.name }))]} />
          <FilterSelect label="Severidade" value={priority} onChange={setPriority}
            options={[{ v: "all", l: "Todas" }, ...(["high","medium","low"] as OccurrencePriority[]).map(p => ({ v: p, l: PRIORITY_LABELS[p] }))]} />
          <FilterSelect label="Categoria" value={category} onChange={setCategory}
            options={[{ v: "all", l: "Todas" }, ...(Object.keys(CATEGORY_LABELS) as OccurrenceCategory[]).map(c => ({ v: c, l: CATEGORY_LABELS[c] }))]} />
          <FilterSelect label="Status" value={status} onChange={setStatus}
            options={[{ v: "all", l: "Todos" }, ...Object.entries(STATUS_LABELS).map(([v, l]) => ({ v, l }))]} />
          <div>
            <Label>Evidência</Label>
            <Tabs value={hasAttach} onValueChange={(v) => setHasAttach(v as any)}>
              <TabsList className="grid grid-cols-3 w-full">
                <TabsTrigger value="all">Todas</TabsTrigger>
                <TabsTrigger value="yes">Com</TabsTrigger>
                <TabsTrigger value="no">Sem</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div><Label>De</Label><Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></div>
          <div><Label>Até</Label><Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></div>
          <div className="flex items-end">
            <Button variant="ghost" onClick={clearFilters} className="w-full">
              <X className="h-4 w-4" /> Limpar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Resultados ({filtered.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="text-center py-16 text-sm text-muted-foreground">
              Nenhuma ocorrência corresponde aos filtros selecionados.
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map(o => {
                const emp = employeeMap.get(o.employee_id);
                const u = emp ? unitMap.get(emp.unit_id) : undefined;
                const images = o.attachments.filter(a => a.mime.startsWith("image/"));
                return (
                  <div key={o.id} className="p-4 hover:bg-muted/30 transition-colors">
                    <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <Badge variant="outline" className={PRIORITY_CLASS[o.priority]}>{PRIORITY_LABELS[o.priority]}</Badge>
                          <Badge variant="outline">{CATEGORY_LABELS[o.category]}</Badge>
                          <Badge variant={o.status === "resolved" ? "default" : "secondary"}>{STATUS_LABELS[o.status]}</Badge>
                          {o.attachments.length > 0 && (
                            <Badge variant="outline" className="border-primary/40 text-primary">
                              <Paperclip className="h-3 w-3 mr-1" />{o.attachments.length}
                            </Badge>
                          )}
                        </div>
                        <div className="font-semibold truncate">{o.title}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {emp?.name ?? "—"} · {emp?.registration_number ?? "—"} · {u?.name ?? "—"} ·{" "}
                          {new Date(o.created_at).toLocaleString("pt-BR")}
                        </div>
                        {o.description && (
                          <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{o.description}</p>
                        )}
                        {images.length > 0 && (
                          <div className="flex gap-2 mt-3 flex-wrap">
                            {images.slice(0, 4).map(a => (
                              <button key={a.id} onClick={() => setOpenOcc(o)}
                                className="h-16 w-16 rounded-md overflow-hidden border bg-muted">
                                <img src={a.data_url} alt={a.name} className="h-full w-full object-cover" />
                              </button>
                            ))}
                            {images.length > 4 && (
                              <div className="h-16 w-16 rounded-md border bg-muted/50 grid place-items-center text-xs text-muted-foreground">
                                +{images.length - 4}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <Button variant="outline" size="sm" onClick={() => setOpenOcc(o)}>
                        <Eye className="h-4 w-4" /> Detalhes
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!openOcc} onOpenChange={(o) => !o && setOpenOcc(null)}>
        <DialogContent className="max-w-3xl">
          {openOcc && (
            <>
              <DialogHeader>
                <DialogTitle>{openOcc.title}</DialogTitle>
              </DialogHeader>
              <ScrollArea className="max-h-[70vh] pr-4">
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className={PRIORITY_CLASS[openOcc.priority]}>{PRIORITY_LABELS[openOcc.priority]}</Badge>
                    <Badge variant="outline">{CATEGORY_LABELS[openOcc.category]}</Badge>
                    <Badge variant={openOcc.status === "resolved" ? "default" : "secondary"}>{STATUS_LABELS[openOcc.status]}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Aberta em {new Date(openOcc.created_at).toLocaleString("pt-BR")} por {openOcc.created_by}
                    {openOcc.resolved_at && <> · Resolvida em {new Date(openOcc.resolved_at).toLocaleString("pt-BR")} por {openOcc.resolved_by}</>}
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{openOcc.description || "Sem descrição."}</p>

                  {openOcc.resolution && (
                    <div className="rounded-md border bg-status-ok/5 border-status-ok/30 p-3">
                      <div className="text-xs font-semibold text-status-ok mb-1">Resolução</div>
                      <p className="text-sm whitespace-pre-wrap">{openOcc.resolution}</p>
                    </div>
                  )}

                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                      Evidências anexas ({openOcc.attachments.length})
                    </div>
                    {openOcc.attachments.length === 0 ? (
                      <div className="text-sm text-muted-foreground italic">Sem anexos.</div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {openOcc.attachments.map(a => (
                          <div key={a.id} className="rounded-md border overflow-hidden bg-muted/30">
                            {a.mime.startsWith("image/") ? (
                              <a href={a.data_url} target="_blank" rel="noreferrer">
                                <img src={a.data_url} alt={a.name} className="h-32 w-full object-cover" />
                              </a>
                            ) : (
                              <div className="h-32 grid place-items-center bg-muted">
                                <FileText className="h-10 w-10 text-muted-foreground" />
                              </div>
                            )}
                            <div className="p-2 text-xs">
                              <div className="truncate font-medium" title={a.name}>{a.name}</div>
                              <div className="flex items-center justify-between mt-1">
                                <span className="text-muted-foreground">{(a.size / 1024).toFixed(0)} KB</span>
                                <Button size="sm" variant="ghost" className="h-7 px-2"
                                  onClick={() => handleDownload(a.storage_path!, a.name)}>
                                  <Download className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {openOcc.notes.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                        Notas ({openOcc.notes.length})
                      </div>
                      <div className="space-y-2">
                        {openOcc.notes.map(n => (
                          <div key={n.id} className="rounded-md border p-3 text-sm">
                            <div className="text-xs text-muted-foreground mb-1">
                              {n.author} · {new Date(n.created_at).toLocaleString("pt-BR")}
                            </div>
                            <p className="whitespace-pre-wrap">{n.text}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KPI({ label, value, tone }: { label: string; value: number; tone?: "red" | "yellow" | "primary" }) {
  const cls = tone === "red" ? "text-status-red border-status-red/30 bg-status-red/5"
    : tone === "yellow" ? "text-status-yellow border-status-yellow/30 bg-status-yellow/5"
    : tone === "primary" ? "text-primary border-primary/30 bg-primary/5"
    : "border-border";
  return (
    <div className={`rounded-xl border p-4 ${cls}`}>
      <div className="text-2xl font-display font-bold">{value}</div>
      <div className="text-[11px] uppercase tracking-wider mt-1 opacity-80">{label}</div>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { v: string; l: string }[];
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map(o => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
