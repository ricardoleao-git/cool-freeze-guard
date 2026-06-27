import { useEffect, useMemo, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Activity, AlertTriangle, CheckCircle2, Download, Filter, History,
  RefreshCw, Rewind, Save, Settings2, ListFilter,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { downloadCsv } from "@/lib/export-utils";

type StatusRow = {
  last_event_poll_at: string | null;
  last_event_cursor: string | null;
  last_event_error: string | null;
  last_event_error_at: string | null;
  events_processed_total: number | null;
  events_endpoint: string | null;
  stale_error_threshold_minutes: number | null;
};

type AuditDetails = {
  deduped?: number;
  capped?: number;
  dedup_samples?: Array<{ evento_id: string; remoteid: string; dispositivo_id: string; reason: string }>;
  dedup_reason_counts?: Record<string, number>;
  errors?: Array<{ raw: unknown; reason: string }>;
  [k: string]: unknown;
};

type AuditRow = {
  id: string;
  source: string;
  severity: string;
  code: string | null;
  message: string | null;
  fetched_count: number | null;
  processed_count: number | null;
  duration_ms: number | null;
  cursor_used: string | null;
  details: AuditDetails | null;
  created_at: string;
};

const sevColor = (s: string) =>
  s === "error" ? "destructive" : s === "warn" ? "secondary" : "outline";
const fmt = (d: string | null) => d ? new Date(d).toLocaleString("pt-BR") : "—";

// Backfill limits
const BACKFILL_MIN_DATE = new Date("2020-01-01T00:00:00Z");
const BACKFILL_MAX_WINDOW_DAYS = 31;

export default function GuardiaStatusTab({ tenantId }: { tenantId: string }) {
  const [status, setStatus] = useState<StatusRow | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<{
    pct: number; phase: string; fetched?: number; dispatched?: number; deduped?: number;
  } | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // Threshold editor
  const [thresholdDraft, setThresholdDraft] = useState<number>(15);
  const [savingThreshold, setSavingThreshold] = useState(false);

  // Error filters
  const [errSeverity, setErrSeverity] = useState<"all" | "error" | "warn" | "info">("error");
  const [errFrom, setErrFrom] = useState("");
  const [errTo, setErrTo] = useState("");

  // Last polling summary (with dedup samples)
  const [lastSummary, setLastSummary] = useState<AuditRow | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    const [s, a] = await Promise.all([
      supabase.from("integration_config")
        .select("last_event_poll_at, last_event_cursor, last_event_error, last_event_error_at, events_processed_total, events_endpoint, stale_error_threshold_minutes")
        .eq("tenant_id", tenantId).maybeSingle(),
      supabase.from("integration_audit_log")
        .select("id, source, severity, code, message, fetched_count, processed_count, duration_ms, cursor_used, details, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }).limit(200),
    ]);
    if (s.data) {
      setStatus(s.data as StatusRow);
      setThresholdDraft(s.data.stale_error_threshold_minutes ?? 15);
    }
    const rows = (a.data ?? []) as AuditRow[];
    setAudit(rows);
    setLastSummary(rows.find(r => r.source === "manual_sync" || r.source === "cron" || r.source === "backfill") ?? rows[0] ?? null);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const syncNow = async () => {
    setPolling(true);
    const { data, error } = await supabase.functions.invoke("guardia-poll-events", {
      body: { tenant_id: tenantId },
    });
    setPolling(false);
    if (error) { toast.error(error.message || "Erro no polling"); await load(); return; }
    const r = data as { polled?: boolean; fetched?: number; dispatched?: number; reason?: string };
    if (r.reason === "no_events_endpoint") toast.warning("Endpoint de eventos não configurado");
    else toast.success(`Sincronizado: ${r.fetched ?? 0} recebidos · ${r.dispatched ?? 0} processados`);
    await load();
  };

  const saveThreshold = async () => {
    if (thresholdDraft < 1 || thresholdDraft > 1440) {
      toast.error("Valor deve estar entre 1 e 1440 minutos");
      return;
    }
    setSavingThreshold(true);
    const { error } = await supabase.from("integration_config")
      .update({ stale_error_threshold_minutes: thresholdDraft })
      .eq("tenant_id", tenantId);
    setSavingThreshold(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Limite atualizado");
    await load();
  };

  // --- Backfill with validation + progress ---
  const validateBackfill = (): { ok: boolean; reason?: string; fromIso?: string; toIso?: string } => {
    if (!from && !to) return { ok: false, reason: "Informe pelo menos uma data inicial ou final" };
    const f = from ? new Date(from) : null;
    const t = to ? new Date(to) : new Date();
    if (f && isNaN(f.getTime())) return { ok: false, reason: "Data inicial inválida" };
    if (t && isNaN(t.getTime())) return { ok: false, reason: "Data final inválida" };
    if (f && f < BACKFILL_MIN_DATE) return { ok: false, reason: `Data mínima permitida: ${BACKFILL_MIN_DATE.toLocaleDateString("pt-BR")}` };
    if (t && t > new Date()) return { ok: false, reason: "Data final não pode estar no futuro" };
    if (f && t && f > t) return { ok: false, reason: "Data inicial deve ser anterior à final" };
    if (f && t) {
      const days = (t.getTime() - f.getTime()) / 86400000;
      if (days > BACKFILL_MAX_WINDOW_DAYS) return { ok: false, reason: `Janela máxima: ${BACKFILL_MAX_WINDOW_DAYS} dias (atual: ${Math.ceil(days)} dias)` };
    }
    return { ok: true, fromIso: f?.toISOString(), toIso: t?.toISOString() };
  };

  const backfill = async () => {
    const v = validateBackfill();
    if (!v.ok) { toast.error(v.reason!); return; }
    setBackfilling(true);
    setBackfillProgress({ pct: 5, phase: "Validando janela…" });

    // Fake stepped progress while the function runs (server is single-shot)
    const steps = [
      { pct: 20, phase: "Conectando à GuardIA…" },
      { pct: 45, phase: "Buscando eventos…" },
      { pct: 70, phase: "Deduplicando…" },
      { pct: 88, phase: "Despachando para webhook…" },
    ];
    let i = 0;
    const tick = setInterval(() => {
      if (i < steps.length) { setBackfillProgress(steps[i]); i++; }
    }, 700);

    const body: Record<string, string> = { tenant_id: tenantId };
    if (v.fromIso) body.from = v.fromIso;
    if (v.toIso) body.to = v.toIso;
    const { data, error } = await supabase.functions.invoke("guardia-poll-events", { body });
    clearInterval(tick);

    if (error) {
      setBackfillProgress({ pct: 100, phase: `Erro: ${error.message}` });
      toast.error(error.message || "Erro no backfill");
      setBackfilling(false);
      setTimeout(() => setBackfillProgress(null), 4000);
      await load();
      return;
    }
    const r = data as { fetched?: number; dispatched?: number; deduped?: number };
    setBackfillProgress({
      pct: 100, phase: "Concluído",
      fetched: r.fetched ?? 0, dispatched: r.dispatched ?? 0, deduped: r.deduped ?? 0,
    });
    toast.success(`Backfill: ${r.fetched ?? 0} recebidos · ${r.dispatched ?? 0} processados · ${r.deduped ?? 0} duplicados`);
    setBackfilling(false);
    await load();
    setTimeout(() => setBackfillProgress(null), 6000);
  };

  // --- Error filters ---
  const filteredErrors = useMemo(() => {
    const fromTs = errFrom ? new Date(errFrom).getTime() : 0;
    const toTs = errTo ? new Date(errTo).getTime() : Infinity;
    return audit.filter(a => {
      if (errSeverity !== "all" && a.severity !== errSeverity) return false;
      const t = new Date(a.created_at).getTime();
      return t >= fromTs && t <= toTs;
    });
  }, [audit, errSeverity, errFrom, errTo]);

  const exportErrorsCsv = () => {
    if (filteredErrors.length === 0) { toast.error("Nada para exportar"); return; }
    downloadCsv(
      `guardia-audit-${new Date().toISOString().slice(0, 10)}`,
      [
        { header: "Quando", key: "created_at" },
        { header: "Origem", key: "source" },
        { header: "Severidade", key: "severity" },
        { header: "Código", key: "code" },
        { header: "Cursor", key: "cursor_used" },
        { header: "Recebidos", key: "fetched_count" },
        { header: "Processados", key: "processed_count" },
        { header: "Duração (ms)", key: "duration_ms" },
        { header: "Mensagem", key: "message" },
      ],
      filteredErrors.map(r => ({
        created_at: fmt(r.created_at),
        source: r.source,
        severity: r.severity,
        code: r.code ?? "",
        cursor_used: r.cursor_used ?? "",
        fetched_count: r.fetched_count ?? "",
        processed_count: r.processed_count ?? "",
        duration_ms: r.duration_ms ?? "",
        message: r.message ?? "",
      })),
    );
    toast.success(`Exportado: ${filteredErrors.length} registros`);
  };

  if (loading) return <div className="text-sm text-muted-foreground">Carregando…</div>;

  // Effective threshold (live from draft if user is editing)
  const effectiveThreshold = status?.stale_error_threshold_minutes ?? 15;

  return (
    <div className="space-y-4">
      <Card className="glass-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="font-display flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" /> Status da integração
          </CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
            <Button size="sm" onClick={syncNow} disabled={polling}>
              <RefreshCw className={`h-4 w-4 mr-1 ${polling ? "animate-spin" : ""}`} />
              {polling ? "Sincronizando…" : "Sincronizar agora"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border border-border bg-background/40 p-3">
            <div className="text-xs text-muted-foreground">Último polling</div>
            <div className="font-medium">{fmt(status?.last_event_poll_at ?? null)}</div>
          </div>
          <div className="rounded-lg border border-border bg-background/40 p-3">
            <div className="text-xs text-muted-foreground">Cursor atual (since)</div>
            <div className="font-mono text-xs break-all">{status?.last_event_cursor ?? "—"}</div>
          </div>
          <div className="rounded-lg border border-border bg-background/40 p-3">
            <div className="text-xs text-muted-foreground">Total de eventos processados</div>
            <div className="font-medium">{(status?.events_processed_total ?? 0).toLocaleString("pt-BR")}</div>
          </div>
          <div className="rounded-lg border border-border bg-background/40 p-3">
            <div className="text-xs text-muted-foreground">Endpoint de eventos</div>
            <div className="font-mono text-xs break-all">{status?.events_endpoint || <span className="text-amber-500">não configurado</span>}</div>
          </div>
          {status?.last_event_error && (() => {
            const ageMin = status.last_event_error_at
              ? Math.floor((Date.now() - new Date(status.last_event_error_at).getTime()) / 60000)
              : null;
            const isStale = ageMin !== null && ageMin >= effectiveThreshold;
            const recentErrCount = audit.filter(a =>
              a.severity === "error" &&
              (Date.now() - new Date(a.created_at).getTime()) < 60 * 60 * 1000
            ).length;
            return (
              <div className={`md:col-span-2 rounded-lg border p-3 flex items-start gap-2 ${
                isStale ? "border-destructive bg-destructive/15 ring-1 ring-destructive/40" : "border-destructive/40 bg-destructive/10"
              }`}>
                <AlertTriangle className={`h-4 w-4 shrink-0 mt-0.5 ${isStale ? "text-destructive animate-pulse" : "text-destructive"}`} />
                <div className="flex-1">
                  <div className="text-xs text-destructive font-medium flex items-center gap-2 flex-wrap">
                    {isStale ? `⚠ Falha persistente há ${ageMin} min (limite: ${effectiveThreshold} min)` : "Última falha"} · {fmt(status.last_event_error_at)}
                    {recentErrCount > 0 && (
                      <Badge variant="destructive" className="text-[10px]">{recentErrCount} erro(s) na última hora</Badge>
                    )}
                  </div>
                  <div className="text-sm mt-1">{status.last_event_error}</div>
                  {isStale && (
                    <div className="mt-2 text-xs">
                      <a href="#last-errors" className="underline text-destructive hover:opacity-80">Ver lista de erros recentes ↓</a>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
          {!status?.last_event_error && status?.last_event_poll_at && (
            <div className="md:col-span-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              <span className="text-sm">Polling saudável — último ciclo sem erros</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Threshold config */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-base">
            <Settings2 className="h-4 w-4 text-primary" /> Limite de alerta de falha persistente
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Define após quantos minutos com erro ativo o painel passa a destacar a falha como "persistente". Valor atual: <b>{effectiveThreshold} min</b>.
          </p>
          <div className="flex items-end gap-2">
            <div className="flex-1 max-w-[200px]">
              <Label className="text-xs">Minutos (1 – 1440)</Label>
              <Input
                type="number" min={1} max={1440}
                value={thresholdDraft}
                onChange={e => setThresholdDraft(parseInt(e.target.value || "0", 10))}
              />
            </div>
            <Button onClick={saveThreshold} disabled={savingThreshold || thresholdDraft === effectiveThreshold}>
              <Save className="h-4 w-4 mr-1" />
              {savingThreshold ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Backfill with validation + progress */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <Rewind className="h-4 w-4 text-primary" /> Reprocessar (backfill)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Re-busca eventos em uma janela específica. Não altera o cursor de polling em curso. Janela máxima: <b>{BACKFILL_MAX_WINDOW_DAYS} dias</b>. Data mínima: {BACKFILL_MIN_DATE.toLocaleDateString("pt-BR")}.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">De (data/hora)</Label>
              <Input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Até (data/hora)</Label>
              <Input type="datetime-local" value={to} onChange={e => setTo(e.target.value)} />
            </div>
          </div>
          <Button onClick={backfill} disabled={backfilling}>
            <Rewind className={`h-4 w-4 mr-2 ${backfilling ? "animate-pulse" : ""}`} />
            {backfilling ? "Reprocessando…" : "Reprocessar janela"}
          </Button>

          {backfillProgress && (
            <div className="space-y-2 mt-3 rounded-lg border border-border bg-background/40 p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{backfillProgress.phase}</span>
                <span className="text-muted-foreground">{backfillProgress.pct}%</span>
              </div>
              <Progress value={backfillProgress.pct} className="h-2" />
              {backfillProgress.pct === 100 && backfillProgress.fetched !== undefined && (
                <div className="flex gap-2 flex-wrap text-xs pt-1">
                  <Badge variant="outline">Recebidos: {backfillProgress.fetched}</Badge>
                  <Badge variant="outline">Processados: {backfillProgress.dispatched ?? 0}</Badge>
                  <Badge variant="secondary">Duplicados: {backfillProgress.deduped ?? 0}</Badge>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Last polling summary with dedup samples */}
      {lastSummary && lastSummary.details && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2 text-base">
              <ListFilter className="h-4 w-4 text-primary" /> Resumo da última execução ({lastSummary.source})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex gap-2 flex-wrap text-xs">
              <Badge variant="outline">Recebidos: {lastSummary.fetched_count ?? 0}</Badge>
              <Badge variant="outline">Processados: {lastSummary.processed_count ?? 0}</Badge>
              <Badge variant="secondary">Duplicados ignorados: {lastSummary.details.deduped ?? 0}</Badge>
              <Badge variant="outline">Em {lastSummary.duration_ms ?? 0} ms</Badge>
              <Badge variant="outline">{fmt(lastSummary.created_at)}</Badge>
            </div>

            {lastSummary.details.dedup_reason_counts && Object.keys(lastSummary.details.dedup_reason_counts).length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Contagem por motivo de dedup</div>
                <div className="flex gap-2 flex-wrap">
                  {Object.entries(lastSummary.details.dedup_reason_counts).map(([k, v]) => (
                    <Badge key={k} variant="secondary" className="text-[10px]">{k}: {v}</Badge>
                  ))}
                </div>
              </div>
            )}

            {lastSummary.details.dedup_samples && lastSummary.details.dedup_samples.length > 0 ? (
              <div>
                <div className="text-xs text-muted-foreground mb-1">
                  Amostra de eventos deduplicados ({lastSummary.details.dedup_samples.length} de {lastSummary.details.deduped ?? 0})
                </div>
                <div className="overflow-x-auto rounded border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>evento_id</TableHead>
                        <TableHead>remoteid (CPF)</TableHead>
                        <TableHead>dispositivo_id</TableHead>
                        <TableHead>motivo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lastSummary.details.dedup_samples.map((s, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">{s.evento_id}</TableCell>
                          <TableCell className="font-mono text-xs">{s.remoteid}</TableCell>
                          <TableCell className="font-mono text-xs">{s.dispositivo_id}</TableCell>
                          <TableCell><Badge variant="outline" className="text-[10px]">{s.reason}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : (
              (lastSummary.details.deduped ?? 0) === 0 && (
                <p className="text-xs text-muted-foreground italic">Nenhum evento deduplicado nesta execução.</p>
              )
            )}
          </CardContent>
        </Card>
      )}

      {/* Errors list with filters + CSV export */}
      <Card id="last-errors" className="glass-card scroll-mt-20">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-base">
            <Filter className="h-4 w-4 text-primary" /> Erros e execuções (filtráveis)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">Severidade</Label>
              <Select value={errSeverity} onValueChange={(v) => setErrSeverity(v as typeof errSeverity)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="error">Erro</SelectItem>
                  <SelectItem value="warn">Aviso</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">De</Label>
              <Input type="datetime-local" value={errFrom} onChange={e => setErrFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Até</Label>
              <Input type="datetime-local" value={errTo} onChange={e => setErrTo(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button variant="outline" className="w-full" onClick={exportErrorsCsv} disabled={filteredErrors.length === 0}>
                <Download className="h-4 w-4 mr-1" /> Exportar CSV ({filteredErrors.length})
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Sev.</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>Recebidos</TableHead>
                  <TableHead>Processados</TableHead>
                  <TableHead>Duração</TableHead>
                  <TableHead>Mensagem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredErrors.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">Nenhum registro nos filtros selecionados.</TableCell></TableRow>
                )}
                {filteredErrors.slice(0, 100).map(a => (
                  <TableRow key={a.id}>
                    <TableCell className="text-xs whitespace-nowrap">{fmt(a.created_at)}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{a.source}</Badge></TableCell>
                    <TableCell><Badge variant={sevColor(a.severity)} className="text-[10px]">{a.severity}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{a.code ?? "—"}</TableCell>
                    <TableCell>{a.fetched_count ?? "—"}</TableCell>
                    <TableCell>{a.processed_count ?? "—"}</TableCell>
                    <TableCell className="text-xs">{a.duration_ms ? `${a.duration_ms} ms` : "—"}</TableCell>
                    <TableCell className="text-xs max-w-[280px] truncate" title={a.message ?? ""}>{a.message}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {filteredErrors.length > 100 && (
              <p className="text-xs text-muted-foreground mt-2 text-center">
                Mostrando 100 de {filteredErrors.length} — refine os filtros ou exporte o CSV completo.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-sm text-muted-foreground">
            <History className="h-3 w-3" /> {audit.length} execuções carregadas (200 mais recentes)
          </CardTitle>
        </CardHeader>
      </Card>
    </div>
  );
}
