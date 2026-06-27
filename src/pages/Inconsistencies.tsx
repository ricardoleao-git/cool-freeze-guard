import { useEffect, useMemo, useState } from "react";
import { format, addDays, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ShieldAlert, AlertTriangle, AlertCircle, Info, RefreshCw, ChevronLeft, ChevronRight,
  Calendar as CalendarIcon, CheckCircle2, MoreVertical, FilePlus2, BellRing, EyeOff, Eye,
  Snowflake, User, ShieldCheck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

type Period = "day" | "week";
type Severity = "info" | "warning" | "critical";

interface Item {
  type: string;
  severity: Severity;
  employee_id: string | null;
  employee_nome: string | null;
  description: string;
  cold_area?: { id: string; name: string } | null;
  related_event_id?: string | null;
  context?: Record<string, any>;
  signature_key: string;
  reviewed?: boolean;
  reviewed_at?: string | null;
  reviewed_by_name?: string | null;
}

interface ScanResult {
  range: { start: string; end: string };
  period: Period;
  reference_date: string;
  summary: {
    total: number;
    by_type: Record<string, number>;
    by_severity: Record<string, number>;
    affected_employees: number;
  };
  items: Item[];
}

const TYPE_LABEL: Record<string, string> = {
  open_session: "Sessão em aberto",
  entry_without_exit_in_period: "Entrada sem saída",
  exposure_exceeded: "Exposição acima do limite",
  break_not_taken: "Pausa não cumprida",
  break_interrupted: "Pausa interrompida",
  unmapped_reader: "Leitor não mapeado",
  pending_event: "Evento pendente",
};

const TYPE_TO_CATEGORY: Record<string, string> = {
  open_session: "operacional",
  entry_without_exit_in_period: "operacional",
  exposure_exceeded: "sst",
  break_not_taken: "sst",
  break_interrupted: "sst",
  unmapped_reader: "tecnica",
  pending_event: "tecnica",
};

const SEV_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

function SeverityBadge({ severity }: { severity: Severity }) {
  if (severity === "critical")
    return <Badge className="bg-status-red/15 text-status-red border border-status-red/40 gap-1"><AlertCircle className="h-3 w-3" />Crítico</Badge>;
  if (severity === "warning")
    return <Badge className="bg-status-orange/15 text-status-orange border border-status-orange/40 gap-1"><AlertTriangle className="h-3 w-3" />Atenção</Badge>;
  return <Badge className="bg-primary/15 text-primary border border-primary/40 gap-1"><Info className="h-3 w-3" />Info</Badge>;
}

function CreateOccurrenceDialog({
  item, tenantId, open, onOpenChange, onDone,
}: { item: Item | null; tenantId: string; open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const [category, setCategory] = useState("operacional");
  const [priority, setPriority] = useState("medium");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!item) return;
    setCategory(TYPE_TO_CATEGORY[item.type] ?? "operacional");
    setPriority(item.severity === "critical" ? "high" : item.severity === "warning" ? "medium" : "low");
    setTitle(`${TYPE_LABEL[item.type] ?? item.type}${item.employee_nome ? ` — ${item.employee_nome}` : ""}`);
    setDescription(item.description);
  }, [item]);

  if (!item) return null;

  const submit = async () => {
    if (!item.employee_id) {
      toast.error("Ocorrência exige um colaborador associado");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("inconsistency-action", {
        body: {
          tenant_id: tenantId,
          action: "create_occurrence",
          payload: {
            category, priority, title, description,
            employee_id: item.employee_id,
            related_event_id: item.related_event_id ?? null,
          },
        },
      });
      if (error || (data as any)?.error) throw new Error((data as any)?.error || error?.message);
      toast.success("Ocorrência criada");
      onOpenChange(false);
      onDone();
    } catch (e: any) {
      toast.error("Falha ao criar ocorrência", { description: e?.message });
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Abrir ocorrência</DialogTitle>
          <DialogDescription>Gerar ocorrência formal para RH/SST a partir desta inconsistência.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Categoria</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="operacional">Operacional</SelectItem>
                  <SelectItem value="sst">SST / Saúde</SelectItem>
                  <SelectItem value="tecnica">Técnica</SelectItem>
                  <SelectItem value="disciplinar">Disciplinar</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Prioridade</Label>
              <Select value={priority} onValueChange={setPriority}>
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
            <Label className="text-xs">Título</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Descrição</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Salvando..." : "Criar ocorrência"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DismissDialog({
  item, tenantId, open, onOpenChange, onDone,
}: { item: Item | null; tenantId: string; open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setNote(""); }, [open]);
  if (!item) return null;
  const submit = async () => {
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("inconsistency-action", {
        body: { tenant_id: tenantId, action: "dismiss", payload: { signature_key: item.signature_key, note } },
      });
      if (error || (data as any)?.error) throw new Error((data as any)?.error || error?.message);
      toast.success("Item marcado como revisado");
      onOpenChange(false);
      onDone();
    } catch (e: any) {
      toast.error("Falha ao marcar revisado", { description: e?.message });
    } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Marcar como revisado</DialogTitle>
          <DialogDescription>Este item será ocultado da fila. Você pode adicionar uma nota.</DialogDescription>
        </DialogHeader>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota (opcional)" rows={3} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Salvando..." : "Confirmar revisão"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ItemCard({
  item, canAct, onOccurrence, onAlert, onDismiss,
}: {
  item: Item; canAct: boolean;
  onOccurrence: () => void; onAlert: () => void; onDismiss: () => void;
}) {
  const ctx = item.context ?? {};
  const ctxBits: string[] = [];
  if (ctx.entry_at) ctxBits.push(`Entrada ${format(parseISO(ctx.entry_at), "dd/MM HH:mm")}`);
  if (ctx.exit_at) ctxBits.push(`Saída ${format(parseISO(ctx.exit_at), "dd/MM HH:mm")}`);
  if (ctx.duration_minutes) ctxBits.push(`${ctx.duration_minutes} min`);
  if (ctx.limit_minutes) ctxBits.push(`limite ${ctx.limit_minutes} min`);
  if (ctx.inside_since) ctxBits.push(`Desde ${format(parseISO(ctx.inside_since), "dd/MM HH:mm")}`);
  if (ctx.started_at && item.type === "break_interrupted") ctxBits.push(`Início ${format(parseISO(ctx.started_at), "dd/MM HH:mm")}`);
  if (ctx.dispositivo_id) ctxBits.push(`Leitor ${ctx.dispositivo_id}`);
  if (ctx.reason) ctxBits.push(`Motivo: ${ctx.reason}`);

  return (
    <Card className={cn("glass-card transition", item.reviewed && "opacity-60")}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5">
            <SeverityBadge severity={item.severity} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display font-semibold text-sm">{TYPE_LABEL[item.type] ?? item.type}</span>
              {item.employee_nome && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <User className="h-3 w-3" />{item.employee_nome}
                </span>
              )}
              {item.cold_area && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Snowflake className="h-3 w-3" />{item.cold_area.name}
                </span>
              )}
              {item.reviewed && (
                <Badge variant="outline" className="border-status-green/40 text-status-green text-xs gap-1">
                  <ShieldCheck className="h-3 w-3" />Revisado{item.reviewed_by_name ? ` por ${item.reviewed_by_name}` : ""}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1">{item.description}</p>
            {ctxBits.length > 0 && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-muted-foreground">
                {ctxBits.map((b, i) => <span key={i}>• {b}</span>)}
              </div>
            )}
          </div>
          {canAct && !item.reviewed && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={onOccurrence} disabled={!item.employee_id}>
                  <FilePlus2 className="h-4 w-4 mr-2" />Abrir ocorrência
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onAlert} disabled={!item.employee_id}>
                  <BellRing className="h-4 w-4 mr-2" />Gerar alerta
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onDismiss}>
                  <EyeOff className="h-4 w-4 mr-2" />Marcar revisado
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Inconsistencies() {
  const { profile, roles } = useAuth();
  const tenantId = profile?.tenant_id ?? "";
  const canAct = roles.some((r) => ["super_admin", "administrador", "gestor"].includes(r));

  const [period, setPeriod] = useState<Period>("day");
  const [refDate, setRefDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [data, setData] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);

  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [sevFilter, setSevFilter] = useState<Severity[]>([]);
  const [showReviewed, setShowReviewed] = useState(false);

  const [occurrenceItem, setOccurrenceItem] = useState<Item | null>(null);
  const [dismissItem, setDismissItem] = useState<Item | null>(null);

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("inconsistency-scan", {
        body: { tenant_id: tenantId, period, reference_date: refDate },
      });
      if (error) throw error;
      if ((res as any)?.error) throw new Error((res as any).error);
      setData(res as ScanResult);
    } catch (e: any) {
      toast.error("Falha ao carregar inconsistências", { description: e?.message });
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenantId, period, refDate]);

  const createAlert = async (item: Item) => {
    if (!item.employee_id) return;
    try {
      const { data: res, error } = await supabase.functions.invoke("inconsistency-action", {
        body: {
          tenant_id: tenantId, action: "create_alert",
          payload: {
            employee_id: item.employee_id,
            alert_type: item.type,
            severity: item.severity,
            message: item.description,
          },
        },
      });
      if (error || (res as any)?.error) throw new Error((res as any)?.error || error?.message);
      toast.success("Alerta gerado");
      load();
    } catch (e: any) {
      toast.error("Falha ao gerar alerta", { description: e?.message });
    }
  };

  const filteredItems = useMemo(() => {
    if (!data) return [];
    return data.items
      .filter((i) => showReviewed || !i.reviewed)
      .filter((i) => typeFilter.length === 0 || typeFilter.includes(i.type))
      .filter((i) => sevFilter.length === 0 || sevFilter.includes(i.severity))
      .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  }, [data, typeFilter, sevFilter, showReviewed]);

  const grouped = useMemo(() => {
    const g: Record<Severity, Item[]> = { critical: [], warning: [], info: [] };
    for (const it of filteredItems) g[it.severity].push(it);
    return g;
  }, [filteredItems]);

  const navDate = (delta: number) => {
    const d = parseISO(refDate);
    const next = period === "week" ? addDays(d, 7 * delta) : addDays(d, delta);
    setRefDate(format(next, "yyyy-MM-dd"));
  };

  const summary = data?.summary;
  const typesPresent = data ? Object.keys(data.summary.by_type) : [];

  const toggle = <T,>(list: T[], v: T, set: (l: T[]) => void) => {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-status-orange" />
            Fila de Inconsistências
          </h1>
          <p className="text-sm text-muted-foreground">Detecção tenant-wide de exageros, sessões abertas e eventos pendentes.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Dia</SelectItem>
              <SelectItem value="week">Semana</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => navDate(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="gap-2 min-w-44 justify-start">
                <CalendarIcon className="h-4 w-4" />
                {format(parseISO(refDate), period === "week" ? "'Semana de' dd/MM" : "dd 'de' MMMM, yyyy", { locale: ptBR })}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={parseISO(refDate)}
                onSelect={(d) => d && setRefDate(format(d, "yyyy-MM-dd"))}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
          <Button variant="outline" size="icon" onClick={() => navDate(1)}><ChevronRight className="h-4 w-4" /></Button>
          <Button onClick={load} disabled={loading} className="gap-2">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />Atualizar
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="glass-card">
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-normal">Total</CardTitle></CardHeader>
          <CardContent><div className="font-display text-2xl font-bold">{summary?.total ?? "—"}</div></CardContent>
        </Card>
        <Card className="glass-card border-status-red/30">
          <CardHeader className="pb-2"><CardTitle className="text-xs text-status-red font-normal">Crítico</CardTitle></CardHeader>
          <CardContent><div className="font-display text-2xl font-bold text-status-red">{summary?.by_severity.critical ?? 0}</div></CardContent>
        </Card>
        <Card className="glass-card border-status-orange/30">
          <CardHeader className="pb-2"><CardTitle className="text-xs text-status-orange font-normal">Atenção</CardTitle></CardHeader>
          <CardContent><div className="font-display text-2xl font-bold text-status-orange">{summary?.by_severity.warning ?? 0}</div></CardContent>
        </Card>
        <Card className="glass-card border-primary/30">
          <CardHeader className="pb-2"><CardTitle className="text-xs text-primary font-normal">Info</CardTitle></CardHeader>
          <CardContent><div className="font-display text-2xl font-bold text-primary">{summary?.by_severity.info ?? 0}</div></CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground font-normal">Colaboradores afetados</CardTitle></CardHeader>
          <CardContent><div className="font-display text-2xl font-bold">{summary?.affected_employees ?? 0}</div></CardContent>
        </Card>
      </div>

      <Card className="glass-card">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground mr-1">Tipo:</span>
            {(typesPresent.length ? typesPresent : Object.keys(TYPE_LABEL)).map((t) => (
              <Badge key={t} variant={typeFilter.includes(t) ? "default" : "outline"}
                className="cursor-pointer" onClick={() => toggle(typeFilter, t, setTypeFilter)}>
                {TYPE_LABEL[t] ?? t}{data?.summary.by_type[t] ? ` (${data.summary.by_type[t]})` : ""}
              </Badge>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground mr-1">Severidade:</span>
            {(["critical", "warning", "info"] as Severity[]).map((s) => (
              <Badge key={s} variant={sevFilter.includes(s) ? "default" : "outline"}
                className="cursor-pointer" onClick={() => toggle(sevFilter, s, setSevFilter)}>
                {s === "critical" ? "Crítico" : s === "warning" ? "Atenção" : "Info"}
              </Badge>
            ))}
            <div className="ml-auto flex items-center gap-2">
              <Switch id="show-reviewed" checked={showReviewed} onCheckedChange={setShowReviewed} />
              <Label htmlFor="show-reviewed" className="text-xs flex items-center gap-1 cursor-pointer">
                {showReviewed ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}Mostrar revisados
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading && !data ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : filteredItems.length === 0 ? (
        <Card className="glass-card">
          <CardContent className="p-10 text-center space-y-2">
            <CheckCircle2 className="h-12 w-12 text-status-green mx-auto" />
            <div className="font-display text-lg">Tudo certo neste período ✅</div>
            <p className="text-sm text-muted-foreground">Nenhuma inconsistência detectada com os filtros atuais.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {(["critical", "warning", "info"] as Severity[]).map((sev) =>
            grouped[sev].length > 0 ? (
              <div key={sev} className="space-y-2">
                <div className="flex items-center gap-2">
                  <SeverityBadge severity={sev} />
                  <span className="text-xs text-muted-foreground">{grouped[sev].length} item(ns)</span>
                </div>
                <div className="space-y-2">
                  {grouped[sev].map((it, idx) => (
                    <ItemCard
                      key={`${it.signature_key}-${idx}`}
                      item={it}
                      canAct={canAct}
                      onOccurrence={() => setOccurrenceItem(it)}
                      onAlert={() => createAlert(it)}
                      onDismiss={() => setDismissItem(it)}
                    />
                  ))}
                </div>
              </div>
            ) : null
          )}
        </div>
      )}

      <CreateOccurrenceDialog
        item={occurrenceItem} tenantId={tenantId}
        open={!!occurrenceItem} onOpenChange={(v) => !v && setOccurrenceItem(null)}
        onDone={load}
      />
      <DismissDialog
        item={dismissItem} tenantId={tenantId}
        open={!!dismissItem} onOpenChange={(v) => !v && setDismissItem(null)}
        onDone={load}
      />
    </div>
  );
}
