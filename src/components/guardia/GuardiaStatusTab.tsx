import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Activity, AlertTriangle, Bell, CheckCircle2, Download, Filter, History,
  RefreshCw, Rewind, Save, Settings2, ListFilter, FileDown, FileText, Mail,
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

type DedupSample = { evento_id: string; remoteid: string; dispositivo_id: string; reason: string };

type AuditDetails = {
  deduped?: number;
  capped?: number;
  dedup_samples?: DedupSample[];
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

type BackfillPhase = {
  ts: string;
  phase: string;
  pct: number;
  attempt?: number;
  ok?: boolean;
  note?: string;
};

const sevColor = (s: string) =>
  s === "error" ? "destructive" : s === "warn" ? "secondary" : "outline";
const fmt = (d: string | null) => d ? new Date(d).toLocaleString("pt-BR") : "—";

const BACKFILL_MIN_DATE = new Date("2020-01-01T00:00:00Z");
const BACKFILL_MAX_WINDOW_DAYS = 31;
const EXPORT_PAGE_SIZE = 1000;
const EXPORT_HARD_CAP = 50000;

const lsEmailKey = (t: string) => `guardia:stale-email:${t}`;
const lsLastAlertKey = (t: string) => `guardia:stale-last-alert:${t}`;

export default function GuardiaStatusTab({ tenantId }: { tenantId: string }) {
  const [status, setStatus] = useState<StatusRow | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<{
    pct: number; phase: string; fetched?: number; dispatched?: number; deduped?: number;
  } | null>(null);
  const [backfillPhases, setBackfillPhases] = useState<BackfillPhase[]>([]);
  const [backfillModalOpen, setBackfillModalOpen] = useState(false);
  const [backfillResultRow, setBackfillResultRow] = useState<AuditRow | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [thresholdDraft, setThresholdDraft] = useState<number>(15);
  const [savingThreshold, setSavingThreshold] = useState(false);

  const [errSeverity, setErrSeverity] = useState<"all" | "error" | "warn" | "info">("error");
  const [errFrom, setErrFrom] = useState("");
  const [errTo, setErrTo] = useState("");
  const [exportingAll, setExportingAll] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ loaded: number; pct: number } | null>(null);

  const [lastSummary, setLastSummary] = useState<AuditRow | null>(null);

  // Email alert (UI-only, stored in localStorage per tenant)
  const [alertEmail, setAlertEmail] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const lastAlertRef = useRef<number>(0);

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

  // Load saved email
  useEffect(() => {
    if (!tenantId) return;
    setAlertEmail(localStorage.getItem(lsEmailKey(tenantId)) ?? "");
    lastAlertRef.current = parseInt(localStorage.getItem(lsLastAlertKey(tenantId)) ?? "0", 10);
  }, [tenantId]);

  // Stale-error notification trigger (toast + browser notification) — fires at most every 30 min
  useEffect(() => {
    if (!status?.last_event_error || !status.last_event_error_at) return;
    const threshold = status.stale_error_threshold_minutes ?? 15;
    const ageMin = Math.floor((Date.now() - new Date(status.last_event_error_at).getTime()) / 60000);
    if (ageMin < threshold) return;
    const now = Date.now();
    if (now - lastAlertRef.current < 30 * 60 * 1000) return;
    lastAlertRef.current = now;
    if (tenantId) localStorage.setItem(lsLastAlertKey(tenantId), String(now));
    toast.error("GuardIA: falha persistente", {
      description: `Sem sucesso há ${ageMin} min (limite ${threshold}). ${status.last_event_error}`,
      duration: 12000,
      action: { label: "Ver erros", onClick: () => {
        document.getElementById("last-errors")?.scrollIntoView({ behavior: "smooth" });
      } },
    });
    // Browser notification (best-effort)
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "granted") {
        try { new Notification("GuardIA · falha persistente", { body: `${ageMin} min sem sucesso` }); } catch { /* ignore */ }
      } else if (Notification.permission === "default") {
        Notification.requestPermission().catch(() => { /* ignore */ });
      }
    }
  }, [status, tenantId]);

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
      toast.error("Valor deve estar entre 1 e 1440 minutos"); return;
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

  const saveEmail = () => {
    const v = alertEmail.trim();
    if (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { toast.error("E-mail inválido"); return; }
    localStorage.setItem(lsEmailKey(tenantId), v);
    toast.success(v ? `Alertas serão enviados para ${v}` : "E-mail removido");
  };

  const sendTestEmail = async () => {
    const v = alertEmail.trim();
    if (!v) { toast.error("Configure um e-mail primeiro"); return; }
    setEmailSending(true);
    // Best-effort: call optional edge function if present. Falls back gracefully.
    const { data, error } = await supabase.functions.invoke("guardia-stale-alert", {
      body: { tenant_id: tenantId, email: v, test: true },
    });
    setEmailSending(false);
    if (error) {
      toast.warning("E-mail não enviado (provider não configurado). Notificações in-app continuam ativas.");
      return;
    }
    const r = data as { sent?: boolean; reason?: string };
    if (r?.sent) toast.success("E-mail de teste enviado");
    else toast.warning(`E-mail não enviado: ${r?.reason ?? "provider indisponível"}`);
  };

  // --- Backfill ---
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

  const pushPhase = (phase: BackfillPhase) =>
    setBackfillPhases(prev => [...prev, { ...phase, ts: new Date().toISOString() }]);

  const backfill = async () => {
    const v = validateBackfill();
    if (!v.ok) { toast.error(v.reason!); return; }
    setBackfilling(true);
    setBackfillPhases([]);
    setBackfillResultRow(null);
    setBackfillProgress({ pct: 5, phase: "Validando janela…" });
    pushPhase({ ts: "", phase: "Validando janela", pct: 5, ok: true, note: `${v.fromIso ?? "—"} → ${v.toIso ?? "agora"}` });

    const steps: BackfillPhase[] = [
      { ts: "", phase: "Conectando à GuardIA", pct: 20 },
      { ts: "", phase: "Buscando eventos (com backoff)", pct: 45 },
      { ts: "", phase: "Deduplicando", pct: 70 },
      { ts: "", phase: "Despachando para webhook", pct: 88 },
    ];
    let i = 0;
    const tick = setInterval(() => {
      if (i < steps.length) {
        setBackfillProgress({ pct: steps[i].pct, phase: steps[i].phase });
        pushPhase(steps[i]);
        i++;
      }
    }, 700);

    const body: Record<string, string> = { tenant_id: tenantId };
    if (v.fromIso) body.from = v.fromIso;
    if (v.toIso) body.to = v.toIso;

    let attempt = 0;
    let resp: { data: unknown; error: { message: string } | null } = { data: null, error: null };
    // local retry for transport errors (server already retries fetch internally)
    while (attempt < 2) {
      attempt++;
      resp = await supabase.functions.invoke("guardia-poll-events", { body });
      if (!resp.error) break;
      pushPhase({ ts: "", phase: "Falha de transporte", pct: 88, attempt, ok: false, note: resp.error.message });
      await new Promise(r => setTimeout(r, 800 * attempt));
    }
    clearInterval(tick);

    if (resp.error) {
      const msg = (resp.error as { message: string }).message;
      setBackfillProgress({ pct: 100, phase: `Erro: ${msg}` });
      pushPhase({ ts: "", phase: "Concluído com erro", pct: 100, ok: false, note: msg });
      toast.error(msg || "Erro no backfill");
      setBackfilling(false);
      await load();
      // Link to most recent backfill audit row if it appears
      setTimeout(() => setBackfillProgress(null), 4000);
      return;
    }
    const r = resp.data as { fetched?: number; dispatched?: number; deduped?: number };
    setBackfillProgress({
      pct: 100, phase: "Concluído",
      fetched: r.fetched ?? 0, dispatched: r.dispatched ?? 0, deduped: r.deduped ?? 0,
    });
    pushPhase({
      ts: "", phase: "Concluído", pct: 100, ok: true,
      note: `${r.fetched ?? 0} recebidos · ${r.dispatched ?? 0} processados · ${r.deduped ?? 0} duplicados`,
    });
    toast.success(`Backfill: ${r.fetched ?? 0} recebidos · ${r.dispatched ?? 0} processados · ${r.deduped ?? 0} duplicados`, {
      action: { label: "Ver logs", onClick: () => setBackfillModalOpen(true) },
    });
    setBackfilling(false);
    await load();
    // After reload, find the freshest backfill audit row for linking
    const { data: ar } = await supabase.from("integration_audit_log")
      .select("id, source, severity, code, message, fetched_count, processed_count, duration_ms, cursor_used, details, created_at")
      .eq("tenant_id", tenantId).eq("source", "backfill")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (ar) setBackfillResultRow(ar as AuditRow);
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
        created_at: fmt(r.created_at), source: r.source, severity: r.severity,
        code: r.code ?? "", cursor_used: r.cursor_used ?? "",
        fetched_count: r.fetched_count ?? "", processed_count: r.processed_count ?? "",
        duration_ms: r.duration_ms ?? "", message: r.message ?? "",
      })),
    );
    toast.success(`Exportado: ${filteredErrors.length} registros`);
  };

  // Export ALL audit rows (server-paged), with optional severity filter
  const exportAllErrorsCsv = async () => {
    setExportingAll(true);
    setExportProgress({ loaded: 0, pct: 0 });
    const all: AuditRow[] = [];
    try {
      let offset = 0;
      while (offset < EXPORT_HARD_CAP) {
        let q = supabase.from("integration_audit_log")
          .select("id, source, severity, code, message, fetched_count, processed_count, duration_ms, cursor_used, details, created_at", { count: "exact" })
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .range(offset, offset + EXPORT_PAGE_SIZE - 1);
        if (errSeverity !== "all") q = q.eq("severity", errSeverity);
        if (errFrom) q = q.gte("created_at", new Date(errFrom).toISOString());
        if (errTo) q = q.lte("created_at", new Date(errTo).toISOString());
        const { data, error, count } = await q;
        if (error) throw error;
        const rows = (data ?? []) as AuditRow[];
        all.push(...rows);
        const total = count ?? all.length;
        setExportProgress({
          loaded: all.length,
          pct: total > 0 ? Math.min(100, Math.round((all.length / Math.min(total, EXPORT_HARD_CAP)) * 100)) : 100,
        });
        if (rows.length < EXPORT_PAGE_SIZE) break;
        offset += EXPORT_PAGE_SIZE;
      }
      if (all.length === 0) { toast.error("Nada para exportar"); return; }
      downloadCsv(
        `guardia-audit-completo-${new Date().toISOString().slice(0, 10)}`,
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
          { header: "Detalhes", key: "details" },
        ],
        all.map(r => ({
          created_at: fmt(r.created_at), source: r.source, severity: r.severity,
          code: r.code ?? "", cursor_used: r.cursor_used ?? "",
          fetched_count: r.fetched_count ?? "", processed_count: r.processed_count ?? "",
          duration_ms: r.duration_ms ?? "", message: r.message ?? "",
          details: r.details ? JSON.stringify(r.details) : "",
        })),
      );
      toast.success(`Exportado completo: ${all.length} registros`);
    } catch (e) {
      toast.error(`Falha ao exportar: ${(e as Error).message}`);
    } finally {
      setExportingAll(false);
      setTimeout(() => setExportProgress(null), 3000);
    }
  };

  // Export dedup samples + reason counts from the latest run
  const exportDedupCsv = () => {
    const d = lastSummary?.details;
    const samples = d?.dedup_samples ?? [];
    const counts = d?.dedup_reason_counts ?? {};
    if (samples.length === 0 && Object.keys(counts).length === 0) {
      toast.error("Sem dados de dedup na última execução"); return;
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    if (samples.length) {
      downloadCsv(`guardia-dedup-samples-${stamp}`,
        [
          { header: "evento_id", key: "evento_id" },
          { header: "remoteid (CPF)", key: "remoteid" },
          { header: "dispositivo_id", key: "dispositivo_id" },
          { header: "motivo", key: "reason" },
        ],
        samples.map(s => ({ ...s }) as unknown as Record<string, unknown>),
      );
    }
    if (Object.keys(counts).length) {
      downloadCsv(`guardia-dedup-reasons-${stamp}`,
        [{ header: "motivo", key: "reason" }, { header: "contagem", key: "count" }],
        Object.entries(counts).map(([reason, count]) => ({ reason, count })),
      );
    }
    toast.success("CSV de dedup exportado");
  };

  if (loading) return <div className="text-sm text-muted-foreground">Carregando…</div>;

  const effectiveThreshold = status?.stale_error_threshold_minutes ?? 15;
  const ageMin = status?.last_event_error_at
    ? Math.floor((Date.now() - new Date(status.last_event_error_at).getTime()) / 60000)
    : null;
  const isStale = ageMin !== null && ageMin >= effectiveThreshold;

  return (
    <div className="space-y-4">
      <Card className="glass-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="font-display flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" /> Status da integração
            {isStale && (
              <Badge variant="destructive" className="ml-2 animate-pulse">
                <Bell className="h-3 w-3 mr-1" /> Alerta persistente
              </Badge>
            )}
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
                      <Badge variant="destructive" className="text-xs">{recentErrCount} erro(s) na última hora</Badge>
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

      {/* Threshold + Email config */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2 text-base">
              <Settings2 className="h-4 w-4 text-primary" /> Limite de alerta persistente
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Minutos com erro ativo antes de destacar como "persistente". Atual: <b>{effectiveThreshold} min</b>.
            </p>
            <div className="flex items-end gap-2">
              <div className="flex-1 max-w-[160px]">
                <Label className="text-xs">Minutos (1–1440)</Label>
                <Input type="number" min={1} max={1440} value={thresholdDraft}
                  onChange={e => setThresholdDraft(parseInt(e.target.value || "0", 10))} />
              </div>
              <Button onClick={saveThreshold} disabled={savingThreshold || thresholdDraft === effectiveThreshold}>
                <Save className="h-4 w-4 mr-1" />{savingThreshold ? "Salvando…" : "Salvar"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2 text-base">
              <Mail className="h-4 w-4 text-primary" /> Alerta por e-mail (opcional)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              E-mail para receber alertas quando a falha persistente passar do limite. Toast in-app é sempre disparado.
            </p>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label className="text-xs">E-mail</Label>
                <Input type="email" placeholder="sst@empresa.com" value={alertEmail}
                  onChange={e => setAlertEmail(e.target.value)} />
              </div>
              <Button onClick={saveEmail} variant="outline"><Save className="h-4 w-4 mr-1" />Salvar</Button>
              <Button onClick={sendTestEmail} disabled={emailSending || !alertEmail.trim()}>
                {emailSending ? "Enviando…" : "Testar"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Envio requer provider configurado (Resend). Sem provider, somente notificações in-app funcionam.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Backfill */}
      <Card className="glass-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="font-display flex items-center gap-2">
            <Rewind className="h-4 w-4 text-primary" /> Reprocessar (backfill)
          </CardTitle>
          {backfillPhases.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setBackfillModalOpen(true)}>
              <FileText className="h-4 w-4 mr-1" /> Logs detalhados
            </Button>
          )}
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

      {/* Last polling summary with dedup samples + CSV export */}
      {lastSummary && lastSummary.details && (
        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="font-display flex items-center gap-2 text-base">
              <ListFilter className="h-4 w-4 text-primary" /> Resumo da última execução ({lastSummary.source})
            </CardTitle>
            <Button size="sm" variant="outline" onClick={exportDedupCsv}>
              <FileDown className="h-4 w-4 mr-1" /> Exportar dedup (CSV)
            </Button>
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
                    <Badge key={k} variant="secondary" className="text-xs">{k}: {v}</Badge>
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
                          <TableCell><Badge variant="outline" className="text-xs">{s.reason}</Badge></TableCell>
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

      {/* Errors list with filters + CSV export (filtered + completo paginado) */}
      <Card id="last-errors" className="glass-card scroll-mt-20">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-base">
            <Filter className="h-4 w-4 text-primary" /> Erros e execuções (filtráveis)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
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
                <Download className="h-4 w-4 mr-1" /> CSV filtrado ({filteredErrors.length})
              </Button>
            </div>
            <div className="flex items-end">
              <Button variant="outline" className="w-full" onClick={exportAllErrorsCsv} disabled={exportingAll}>
                <FileDown className="h-4 w-4 mr-1" />
                {exportingAll ? `Exportando… ${exportProgress?.pct ?? 0}%` : "CSV completo (paginado)"}
              </Button>
            </div>
          </div>

          {exportProgress && exportingAll && (
            <div className="space-y-1">
              <Progress value={exportProgress.pct} className="h-1.5" />
              <p className="text-xs text-muted-foreground">
                {exportProgress.loaded.toLocaleString("pt-BR")} registros carregados (paginação {EXPORT_PAGE_SIZE}/req, teto {EXPORT_HARD_CAP.toLocaleString("pt-BR")})
              </p>
            </div>
          )}

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
                    <TableCell><Badge variant="outline" className="text-xs">{a.source}</Badge></TableCell>
                    <TableCell><Badge variant={sevColor(a.severity)} className="text-xs">{a.severity}</Badge></TableCell>
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
                Mostrando 100 de {filteredErrors.length} em memória — use "CSV completo" para exportar todos do banco.
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

      {/* Backfill phases modal */}
      <Dialog open={backfillModalOpen} onOpenChange={setBackfillModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" /> Logs detalhados do backfill
            </DialogTitle>
            <DialogDescription>
              Fases, tentativas e resultados. {backfillResultRow && (
                <a
                  href="#last-errors"
                  className="text-primary hover:underline ml-1"
                  onClick={() => {
                    setBackfillModalOpen(false);
                    setTimeout(() => document.getElementById("last-errors")?.scrollIntoView({ behavior: "smooth" }), 100);
                  }}
                >
                  Ver execução no integration_audit_log →
                </a>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {backfillPhases.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhuma fase registrada ainda.</p>
            )}
            <ol className="relative border-l border-border pl-4 space-y-2">
              {backfillPhases.map((p, i) => (
                <li key={i} className="text-xs">
                  <span className={`absolute -left-[5px] h-2 w-2 rounded-full ${p.ok === false ? "bg-destructive" : p.pct === 100 ? "bg-emerald-500" : "bg-primary"}`} />
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-muted-foreground">{new Date(p.ts).toLocaleTimeString("pt-BR")}</span>
                    <Badge variant={p.ok === false ? "destructive" : "outline"} className="text-xs">{p.pct}%</Badge>
                    <span className="font-medium">{p.phase}</span>
                    {p.attempt && <Badge variant="secondary" className="text-xs">tentativa {p.attempt}</Badge>}
                  </div>
                  {p.note && <div className="text-xs text-muted-foreground mt-0.5 ml-1">{p.note}</div>}
                </li>
              ))}
            </ol>
            {backfillResultRow && (
              <div className="rounded-lg border border-border bg-background/40 p-3 text-xs space-y-1">
                <div className="font-semibold">Registro no audit_log</div>
                <div className="font-mono text-xs break-all">id: {backfillResultRow.id}</div>
                <div>código: <Badge variant="outline" className="text-xs">{backfillResultRow.code ?? "—"}</Badge></div>
                <div>recebidos: {backfillResultRow.fetched_count ?? 0} · processados: {backfillResultRow.processed_count ?? 0} · duração: {backfillResultRow.duration_ms ?? 0} ms</div>
                {backfillResultRow.details?.errors && backfillResultRow.details.errors.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-destructive">{backfillResultRow.details.errors.length} erro(s) no servidor</summary>
                    <pre className="mt-1 text-xs whitespace-pre-wrap">{JSON.stringify(backfillResultRow.details.errors, null, 2)}</pre>
                  </details>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
