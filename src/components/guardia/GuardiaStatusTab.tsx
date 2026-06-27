import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Activity, AlertTriangle, CheckCircle2, History, RefreshCw, Rewind } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type StatusRow = {
  last_event_poll_at: string | null;
  last_event_cursor: string | null;
  last_event_error: string | null;
  last_event_error_at: string | null;
  events_processed_total: number | null;
  events_endpoint: string | null;
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
  details: unknown;
  created_at: string;
};

const sevColor = (s: string) =>
  s === "error" ? "destructive" : s === "warn" ? "secondary" : "outline";

const fmt = (d: string | null) => d ? new Date(d).toLocaleString("pt-BR") : "—";

export default function GuardiaStatusTab({ tenantId }: { tenantId: string }) {
  const [status, setStatus] = useState<StatusRow | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(async () => {
    if (!tenantId) return;
    const [s, a] = await Promise.all([
      supabase.from("integration_config")
        .select("last_event_poll_at, last_event_cursor, last_event_error, last_event_error_at, events_processed_total, events_endpoint")
        .eq("tenant_id", tenantId).maybeSingle(),
      supabase.from("integration_audit_log")
        .select("id, source, severity, code, message, fetched_count, processed_count, duration_ms, cursor_used, details, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }).limit(50),
    ]);
    if (s.data) setStatus(s.data as StatusRow);
    setAudit((a.data ?? []) as AuditRow[]);
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

  const backfill = async () => {
    if (!from && !to) { toast.error("Informe pelo menos uma data inicial ou final"); return; }
    setBackfilling(true);
    const body: Record<string, string> = { tenant_id: tenantId };
    if (from) body.from = new Date(from).toISOString();
    if (to) body.to = new Date(to).toISOString();
    const { data, error } = await supabase.functions.invoke("guardia-poll-events", { body });
    setBackfilling(false);
    if (error) { toast.error(error.message || "Erro no backfill"); await load(); return; }
    const r = data as { fetched?: number; dispatched?: number };
    toast.success(`Backfill: ${r.fetched ?? 0} recebidos · ${r.dispatched ?? 0} processados`);
    await load();
  };

  if (loading) return <div className="text-sm text-muted-foreground">Carregando…</div>;

  const lastErrors = audit.filter(a => a.severity === "error").slice(0, 5);

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
          {status?.last_event_error && (
            <div className="md:col-span-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <div>
                <div className="text-xs text-destructive font-medium">Última falha · {fmt(status.last_event_error_at)}</div>
                <div className="text-sm">{status.last_event_error}</div>
              </div>
            </div>
          )}
          {!status?.last_event_error && status?.last_event_poll_at && (
            <div className="md:col-span-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              <span className="text-sm">Polling saudável — último ciclo sem erros</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <Rewind className="h-4 w-4 text-primary" /> Reprocessar (backfill)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Re-busca eventos em uma janela específica. Não altera o cursor de polling em curso — útil para preencher lacunas históricas ou corrigir erros do endpoint.
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
        </CardContent>
      </Card>

      {lastErrors.length > 0 && (
        <Card className="glass-card border-destructive/30">
          <CardHeader><CardTitle className="font-display text-base">Últimos erros</CardTitle></CardHeader>
          <CardContent>
            <ul className="text-sm space-y-2">
              {lastErrors.map(e => (
                <li key={e.id} className="rounded border border-destructive/30 bg-destructive/5 p-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="destructive" className="text-[10px]">{e.code ?? "error"}</Badge>
                    <span>{e.source}</span>
                    <span>·</span>
                    <span>{fmt(e.created_at)}</span>
                  </div>
                  <div className="mt-1">{e.message}</div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <History className="h-4 w-4 text-primary" /> Histórico de execuções (50 mais recentes)
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Severidade</TableHead>
                <TableHead>Código</TableHead>
                <TableHead>Recebidos</TableHead>
                <TableHead>Processados</TableHead>
                <TableHead>Duração</TableHead>
                <TableHead>Mensagem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audit.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">Nenhuma execução registrada ainda.</TableCell></TableRow>
              )}
              {audit.map(a => (
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
        </CardContent>
      </Card>
    </div>
  );
}
