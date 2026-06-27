import { useMemo, useState, useEffect, useCallback } from "react";
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
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  ClipboardList, Download, FileText, Filter, ImageIcon, Paperclip, Search, X, Eye,
  ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight,
  BookmarkPlus, Star, Trash2, Save,
} from "lucide-react";
import type { Occurrence, OccurrencePriority, OccurrenceCategory, OccurrenceAttachment } from "@/lib/demo-data";
import { AttachmentPreviewDialog } from "@/components/AttachmentPreviewDialog";
import { StorageImage } from "@/components/StorageImage";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

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

const PRIORITY_ORDER: Record<OccurrencePriority, number> = { high: 3, medium: 2, low: 1 };
const STATUS_ORDER: Record<string, number> = { open: 3, in_review: 2, resolved: 1 };

const LS_SORT_KEY = "friosafe-history-sort";
const LS_PAGE_SIZE_KEY = "friosafe-history-pagesize";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

type SortField = "created_at" | "priority" | "status" | "category" | "employee" | "title";
type SortDir = "asc" | "desc";

interface SortState { field: SortField; dir: SortDir }

function getStoredSort(): SortState {
  try {
    const raw = localStorage.getItem(LS_SORT_KEY);
    if (raw) return JSON.parse(raw) as SortState;
  } catch { /* noop */ }
  return { field: "created_at", dir: "desc" };
}

function storeSort(s: SortState) {
  try { localStorage.setItem(LS_SORT_KEY, JSON.stringify(s)); } catch { /* noop */ }
}

function getStoredPageSize(): number {
  try {
    const raw = localStorage.getItem(LS_PAGE_SIZE_KEY);
    if (raw) { const n = parseInt(raw, 10); if (PAGE_SIZE_OPTIONS.includes(n)) return n; }
  } catch { /* noop */ }
  return 25;
}

function storePageSize(n: number) {
  try { localStorage.setItem(LS_PAGE_SIZE_KEY, String(n)); } catch { /* noop */ }
}

interface FilterSnapshot {
  search: string;
  employeeId: string;
  unitId: string;
  priority: string;
  category: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  hasAttach: "all" | "yes" | "no";
  sort: SortState;
}

interface FilterPreset {
  id: string;
  name: string;
  tenant_id: string | null;
  filters: FilterSnapshot;
  is_default: boolean;
}

export default function History() {
  const { occurrences, employees, units, getAttachmentDownloadUrl } = useDemo();
  const { user, profile } = useAuth();

  // Filters
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

  // Pagination & sort
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(getStoredPageSize());
  const [sort, setSort] = useState<SortState>(getStoredSort());
  const [previewAtt, setPreviewAtt] = useState<OccurrenceAttachment | null>(null);

  // Presets
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [presetId, setPresetId] = useState<string>("none");
  const [presetsLoaded, setPresetsLoaded] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [scopeToTenant, setScopeToTenant] = useState(true);
  const tenantId = profile?.tenant_id ?? null;

  const applySnapshot = useCallback((s: FilterSnapshot) => {
    setSearch(s.search ?? "");
    setEmployeeId(s.employeeId ?? "all");
    setUnitId(s.unitId ?? "all");
    setPriority(s.priority ?? "all");
    setCategory(s.category ?? "all");
    setStatus(s.status ?? "all");
    setDateFrom(s.dateFrom ?? "");
    setDateTo(s.dateTo ?? "");
    setHasAttach(s.hasAttach ?? "all");
    if (s.sort) { setSort(s.sort); storeSort(s.sort); }
  }, []);

  const currentSnapshot = useCallback((): FilterSnapshot => ({
    search, employeeId, unitId, priority, category, status,
    dateFrom, dateTo, hasAttach, sort,
  }), [search, employeeId, unitId, priority, category, status, dateFrom, dateTo, hasAttach, sort]);

  // Presets require a real authenticated UUID. Demo/anonymous users skip persistence.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const canPersistPresets = !!user && UUID_RE.test(user.id);

  // Load presets on mount / user change
  useEffect(() => {
    if (!canPersistPresets) { setPresets([]); setPresetsLoaded(true); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("history_filter_presets")
        .select("id,name,tenant_id,filters,is_default")
        .eq("user_id", user.id)
        .order("is_default", { ascending: false })
        .order("name", { ascending: true });
      if (cancelled) return;
      if (error) { toast.error("Falha ao carregar presets: " + error.message); setPresetsLoaded(true); return; }
      const items = (data || []).map(d => ({
        id: d.id, name: d.name, tenant_id: d.tenant_id,
        filters: ((d.filters || {}) as unknown) as FilterSnapshot, is_default: !!d.is_default,
      }));
      setPresets(items);
      // Auto-apply default scoped to current tenant (or global) if no preset chosen yet
      const def = items.find(p => p.is_default && (p.tenant_id === tenantId || p.tenant_id === null));
      if (def) { setPresetId(def.id); applySnapshot(def.filters); }
      setPresetsLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [user, tenantId, applySnapshot]);

  const visiblePresets = useMemo(
    () => presets.filter(p => p.tenant_id === null || p.tenant_id === tenantId),
    [presets, tenantId]
  );

  const handleSelectPreset = (id: string) => {
    setPresetId(id);
    if (id === "none") return;
    const p = presets.find(x => x.id === id);
    if (p) { applySnapshot(p.filters); setPage(1); }
  };

  const handleSavePreset = async () => {
    if (!canPersistPresets) { toast.error("Faça login para salvar presets"); return; }
    const name = newPresetName.trim();
    if (!name) return toast.error("Informe um nome para o preset");
    const payload = {
      user_id: user.id,
      tenant_id: scopeToTenant ? tenantId : null,
      name,
      filters: currentSnapshot() as any,
      is_default: false,
    };
    const { data, error } = await supabase
      .from("history_filter_presets")
      .insert(payload)
      .select("id,name,tenant_id,filters,is_default")
      .single();
    if (error) return toast.error("Falha ao salvar: " + error.message);
    const preset: FilterPreset = {
      id: data!.id, name: data!.name, tenant_id: data!.tenant_id,
      filters: (data!.filters as unknown) as FilterSnapshot, is_default: !!data!.is_default,
    };
    setPresets(prev => [...prev, preset].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
    setPresetId(preset.id);
    setSaveOpen(false); setNewPresetName("");
    toast.success(`Preset "${name}" salvo`);
  };

  const handleDeletePreset = async () => {
    if (!user || presetId === "none") return;
    const p = presets.find(x => x.id === presetId);
    if (!p) return;
    if (!window.confirm(`Excluir preset "${p.name}"?`)) return;
    const { error } = await supabase.from("history_filter_presets").delete().eq("id", p.id);
    if (error) return toast.error("Falha ao excluir: " + error.message);
    setPresets(prev => prev.filter(x => x.id !== p.id));
    setPresetId("none");
    toast.success("Preset excluído");
  };

  const handleToggleDefault = async () => {
    if (!user || presetId === "none") return;
    const p = presets.find(x => x.id === presetId);
    if (!p) return;
    const makeDefault = !p.is_default;
    // Clear other defaults in same tenant scope first
    if (makeDefault) {
      const sameScope = presets.filter(x => x.id !== p.id && x.tenant_id === p.tenant_id && x.is_default);
      for (const s of sameScope) {
        await supabase.from("history_filter_presets").update({ is_default: false }).eq("id", s.id);
      }
    }
    const { error } = await supabase.from("history_filter_presets")
      .update({ is_default: makeDefault }).eq("id", p.id);
    if (error) return toast.error("Falha: " + error.message);
    setPresets(prev => prev.map(x => {
      if (x.id === p.id) return { ...x, is_default: makeDefault };
      if (makeDefault && x.tenant_id === p.tenant_id) return { ...x, is_default: false };
      return x;
    }));
    toast.success(makeDefault ? "Definido como padrão" : "Padrão removido");
  };

  const handleUpdatePreset = async () => {
    if (!user || presetId === "none") return;
    const p = presets.find(x => x.id === presetId);
    if (!p) return;
    const { error } = await supabase.from("history_filter_presets")
      .update({ filters: currentSnapshot() as any }).eq("id", p.id);
    if (error) return toast.error("Falha: " + error.message);
    setPresets(prev => prev.map(x => x.id === p.id ? { ...x, filters: currentSnapshot() } : x));
    toast.success(`Preset "${p.name}" atualizado`);
  };


  const employeeMap = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);
  const unitMap = useMemo(() => new Map(units.map(u => [u.id, u])), [units]);

  const filtered = useMemo(() => {
    const arr = occurrences.filter(o => {
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
    });

    // Sort
    arr.sort((a, b) => {
      const dir = sort.dir === "asc" ? 1 : -1;
      switch (sort.field) {
        case "created_at":
          return (a.created_at - b.created_at) * dir;
        case "priority":
          return (PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]) * dir;
        case "status":
          return (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) * dir;
        case "category":
          return CATEGORY_LABELS[a.category].localeCompare(CATEGORY_LABELS[b.category], "pt-BR") * dir;
        case "employee": {
          const ea = employeeMap.get(a.employee_id)?.name ?? "";
          const eb = employeeMap.get(b.employee_id)?.name ?? "";
          return ea.localeCompare(eb, "pt-BR") * dir;
        }
        case "title":
          return a.title.localeCompare(b.title, "pt-BR") * dir;
        default:
          return 0;
      }
    });

    return arr;
  }, [occurrences, employeeId, unitId, priority, category, status, hasAttach, dateFrom, dateTo, search, employeeMap, unitMap, sort]);

  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, totalItems);
  const pageItems = filtered.slice(startIdx, endIdx);

  // Reset to page 1 when filters or page size change
  useEffect(() => { setPage(1); }, [search, employeeId, unitId, priority, category, status, hasAttach, dateFrom, dateTo, pageSize]);

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
    setPage(1);
  };

  const handleSort = useCallback((field: SortField) => {
    setSort(prev => {
      const next: SortState = prev.field === field && prev.dir === "desc"
        ? { field, dir: "asc" }
        : { field, dir: "desc" };
      storeSort(next);
      return next;
    });
    setPage(1);
  }, []);

  const handlePageSizeChange = useCallback((val: string) => {
    const n = parseInt(val, 10);
    setPageSize(n);
    storePageSize(n);
    setPage(1);
  }, []);

  const handleDownload = async (path: string, name: string) => {
    const url = await getAttachmentDownloadUrl(path, name);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
  };

  const exportCsv = () => {
    const sortLabel = `${sort.field} ${sort.dir}`;
    const activeFilters: Array<[string, string]> = [
      ["Busca", search || "—"],
      ["Colaborador", employeeId === "all" ? "Todos" : (employeeMap.get(employeeId)?.name ?? employeeId)],
      ["Unidade", unitId === "all" ? "Todas" : (unitMap.get(unitId)?.name ?? unitId)],
      ["Severidade", priority === "all" ? "Todas" : (PRIORITY_LABELS[priority as OccurrencePriority] ?? priority)],
      ["Categoria", category === "all" ? "Todas" : (CATEGORY_LABELS[category as OccurrenceCategory] ?? category)],
      ["Status", status === "all" ? "Todos" : (STATUS_LABELS[status] ?? status)],
      ["Evidência", hasAttach === "all" ? "Todas" : hasAttach === "yes" ? "Apenas com anexo" : "Apenas sem anexo"],
      ["Data inicial", dateFrom || "—"],
      ["Data final", dateTo || "—"],
      ["Ordenação", sortLabel],
      ["Total exportado", String(filtered.length)],
    ];

    const headerRows: string[][] = [
      [`Histórico RH/SST — exportado em ${new Date().toLocaleString("pt-BR")}`],
      ["Filtros ativos:"],
      ...activeFilters.map(([k, v]) => [k, v]),
      [""],
    ];

    const columns = [
      "Data de abertura", "Colaborador", "Matrícula", "Unidade",
      "Categoria", "Prioridade", "Status",
      "Título", "Descrição",
      "Resolvida em", "Resolvido por", "Resolução",
      "Qtd. evidências", "Evidências (nomes)",
      "Notas (qtd)", "ID ocorrência",
    ];

    const dataRows = filtered.map(o => {
      const emp = employeeMap.get(o.employee_id);
      const u = emp ? unitMap.get(emp.unit_id) : undefined;
      return [
        new Date(o.created_at).toLocaleString("pt-BR"),
        emp?.name ?? "—",
        emp?.registration_number ?? "—",
        u?.name ?? "—",
        CATEGORY_LABELS[o.category],
        PRIORITY_LABELS[o.priority],
        STATUS_LABELS[o.status],
        o.title,
        o.description ?? "",
        o.resolved_at ? new Date(o.resolved_at).toLocaleString("pt-BR") : "—",
        o.resolved_by ?? "—",
        o.resolution ?? "—",
        String(o.attachments.length),
        o.attachments.map(a => a.name).join(" | "),
        String(o.notes.length),
        o.id,
      ];
    });

    const rows = [...headerRows, columns, ...dataRows];
    const csv = rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `historico-rh-sst-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sort.field !== field) return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/60" />;
    return sort.dir === "desc" ? <ArrowDown className="h-3.5 w-3.5 text-primary" /> : <ArrowUp className="h-3.5 w-3.5 text-primary" />;
  };

  const pageNumbers = useMemo(() => {
    const pages: (number | "ellipsis")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      if (safePage <= 4) {
        for (let i = 1; i <= 5; i++) pages.push(i);
        pages.push("ellipsis", totalPages);
      } else if (safePage >= totalPages - 3) {
        pages.push(1, "ellipsis");
        for (let i = totalPages - 4; i <= totalPages; i++) pages.push(i);
      } else {
        pages.push(1, "ellipsis");
        for (let i = safePage - 1; i <= safePage + 1; i++) pages.push(i);
        pages.push("ellipsis", totalPages);
      }
    }
    return pages;
  }, [safePage, totalPages]);

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
        <ExportCsvButton onRun={exportCsv} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Ocorrências" value={totals.total} />
        <KPI label="Alta severidade" value={totals.high} tone="red" />
        <KPI label="Em aberto" value={totals.open} tone="yellow" />
        <KPI label="Com evidência" value={totals.withEvidence} tone="primary" />
      </div>

      <Card>
        <CardHeader className="pb-3 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Filter className="h-4 w-4 text-primary" /> Filtros avançados
              </CardTitle>
              <CardDescription>Combine critérios para investigar incidentes específicos.</CardDescription>
            </div>
            {canPersistPresets && presetsLoaded && (
              <div className="flex flex-wrap items-center gap-2">
                <Select value={presetId} onValueChange={handleSelectPreset}>
                  <SelectTrigger className="h-9 w-[220px]">
                    <SelectValue placeholder="Aplicar preset…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem preset</SelectItem>
                    {visiblePresets.length === 0 && (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum preset salvo</div>
                    )}
                    {visiblePresets.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.is_default ? "★ " : ""}{p.name}
                        {p.tenant_id === null ? " · global" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {presetId !== "none" && (
                  <>
                    <Button size="sm" variant="ghost" onClick={handleUpdatePreset} title="Atualizar preset com filtros atuais">
                      <Save className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={handleToggleDefault}
                      title={presets.find(p => p.id === presetId)?.is_default ? "Remover como padrão" : "Definir como padrão"}>
                      <Star className={`h-4 w-4 ${presets.find(p => p.id === presetId)?.is_default ? "fill-status-yellow text-status-yellow" : ""}`} />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={handleDeletePreset} title="Excluir preset">
                      <Trash2 className="h-4 w-4 text-status-red" />
                    </Button>
                  </>
                )}
                <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
                  <Button size="sm" variant="outline" onClick={() => setSaveOpen(true)}>
                    <BookmarkPlus className="h-4 w-4 mr-1.5" /> Salvar como…
                  </Button>
                  <DialogContent className="max-w-sm">
                    <DialogHeader>
                      <DialogTitle>Salvar preset de filtros</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                      <div>
                        <Label>Nome</Label>
                        <Input autoFocus value={newPresetName} onChange={e => setNewPresetName(e.target.value)}
                          placeholder="Ex.: Alta severidade — Unidade SP" />
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={scopeToTenant} onChange={e => setScopeToTenant(e.target.checked)} />
                        Restringir a este tenant {tenantId ? `(${tenantId})` : ""}
                      </label>
                      <div className="flex justify-end gap-2 pt-2">
                        <Button variant="ghost" onClick={() => setSaveOpen(false)}>Cancelar</Button>
                        <Button onClick={handleSavePreset}>Salvar</Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            )}
          </div>
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
              <X className="h-4 w-4 mr-2" /> Limpar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-base">Resultados</CardTitle>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">Ordenar por</span>
              <div className="flex gap-1">
                <SortButton active={sort.field === "created_at"} onClick={() => handleSort("created_at")} icon={<SortIcon field="created_at" />} label="Data" />
                <SortButton active={sort.field === "priority"} onClick={() => handleSort("priority")} icon={<SortIcon field="priority" />} label="Severidade" />
                <SortButton active={sort.field === "status"} onClick={() => handleSort("status")} icon={<SortIcon field="status" />} label="Status" />
                <SortButton active={sort.field === "category"} onClick={() => handleSort("category")} icon={<SortIcon field="category" />} label="Categoria" />
                <SortButton active={sort.field === "employee"} onClick={() => handleSort("employee")} icon={<SortIcon field="employee" />} label="Colaborador" />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-muted-foreground">
              Mostrando {totalItems > 0 ? startIdx + 1 : 0}–{endIdx} de {totalItems} resultados
            </p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Por página</span>
              <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
                <SelectTrigger className="h-8 w-20 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {pageItems.length === 0 ? (
            <div className="text-center py-16 text-sm text-muted-foreground">
              Nenhuma ocorrência corresponde aos filtros selecionados.
            </div>
          ) : (
            <div className="divide-y">
              {pageItems.map(o => {
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
                                <StorageImage bucket="occurrence-attachments" path={a.storage_path} alt={a.name} className="h-full w-full object-cover" />
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
                        <Eye className="h-4 w-4 mr-2" /> Detalhes
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {totalPages > 1 && (
            <div className="py-4 border-t">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1"
                      disabled={safePage <= 1}
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-4 w-4" /> Anterior
                    </Button>
                  </PaginationItem>
                  {pageNumbers.map((p, i) => (
                    <PaginationItem key={i}>
                      {p === "ellipsis" ? (
                        <PaginationEllipsis />
                      ) : (
                        <PaginationLink
                          isActive={p === safePage}
                          onClick={(e) => { e.preventDefault(); setPage(p); }}
                          href="#"
                        >
                          {p}
                        </PaginationLink>
                      )}
                    </PaginationItem>
                  ))}
                  <PaginationItem>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1"
                      disabled={safePage >= totalPages}
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    >
                      Próxima <ChevronRight className="h-4 w-4" />
                    </Button>
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
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
                            <button
                              type="button"
                              onClick={() => setPreviewAtt(a)}
                              className="block w-full text-left focus:outline-none focus:ring-2 focus:ring-primary"
                              title="Pré-visualizar"
                            >
                              {a.mime.startsWith("image/") ? (
                                <StorageImage bucket="occurrence-attachments" path={a.storage_path} alt={a.name} className="h-32 w-full object-cover" />
                              ) : (
                                <div className="h-32 grid place-items-center bg-muted">
                                  <FileText className="h-10 w-10 text-muted-foreground" />
                                </div>
                              )}
                            </button>
                            <div className="p-2 text-xs">
                              <div className="truncate font-medium" title={a.name}>{a.name}</div>
                              <div className="flex items-center justify-between mt-1">
                                <span className="text-muted-foreground">{(a.size / 1024).toFixed(0)} KB</span>
                                <div className="flex items-center gap-0.5">
                                  <Button size="sm" variant="ghost" className="h-7 px-2"
                                    onClick={() => setPreviewAtt(a)} title="Pré-visualizar">
                                    <Eye className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-7 px-2"
                                    onClick={() => handleDownload(a.storage_path!, a.name)} title="Baixar">
                                    <Download className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
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

      <AttachmentPreviewDialog
        attachment={previewAtt}
        open={!!previewAtt}
        onOpenChange={(o) => { if (!o) setPreviewAtt(null); }}
      />
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
      <div className="text-xs uppercase tracking-wider mt-1 opacity-80">{label}</div>
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

function SortButton({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
        active
          ? "bg-primary/10 text-primary ring-1 ring-primary/30"
          : "bg-muted text-muted-foreground hover:bg-muted/80"
      }`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function ExportCsvButton({ onRun }: { onRun: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      disabled={busy}
      aria-busy={busy}
      onClick={async () => {
        setBusy(true);
        try { await onRun(); } finally {
          // Give the user visible feedback even on synchronous exports
          setTimeout(() => setBusy(false), 350);
        }
      }}
    >
      {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
      {busy ? "Exportando…" : "Exportar CSV"}
    </Button>
  );
}
