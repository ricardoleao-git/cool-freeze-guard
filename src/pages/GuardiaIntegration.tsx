import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { ScanFace, Eye, EyeOff, Copy, RefreshCw, Send, CheckCircle2, XCircle, Webhook } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import GuardiaDeviceMapTab from "@/components/guardia/GuardiaDeviceMapTab";

const WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/guardia-webhook`;

type Config = {
  guardia_url: string;
  guardia_token: string;
  active: boolean;
  sync_interval: string;
  last_sync_at: string | null;
  last_sync_count: number | null;
};

type GuardiaEvent = {
  id: string;
  evento_id: string;
  colaborador_id: string;
  colaborador_nome: string | null;
  local_id: string;
  local_nome: string | null;
  tipo: "entrada" | "saida";
  event_timestamp: string;
  dispositivo_id: string | null;
  processed: boolean;
};

const empty: Config = {
  guardia_url: "",
  guardia_token: "",
  active: false,
  sync_interval: "1h",
  last_sync_at: null,
  last_sync_count: null,
};

export default function GuardiaIntegration() {
  const { profile } = useAuth();
  const tenantId = profile?.tenant_id ?? "";

  const [cfg, setCfg] = useState<Config>(empty);
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [events, setEvents] = useState<GuardiaEvent[]>([]);
  const [filterDate, setFilterDate] = useState("");
  const [filterArea, setFilterArea] = useState("");

  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      const { data } = await supabase
        .from("integration_config")
        .select("guardia_url, guardia_token, active, sync_interval, last_sync_at, last_sync_count")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (data) setCfg({ ...empty, ...data });
      setLoading(false);
    })();
  }, [tenantId]);

  const loadEvents = async () => {
    if (!tenantId) return;
    const { data, error } = await supabase
      .from("guardia_events")
      .select("id, evento_id, colaborador_id, colaborador_nome, local_id, local_nome, tipo, event_timestamp, dispositivo_id, processed")
      .eq("tenant_id", tenantId)
      .order("event_timestamp", { ascending: false })
      .limit(100);
    if (error) { toast.error("Falha ao carregar log de eventos"); return; }
    setEvents((data ?? []) as GuardiaEvent[]);
  };

  useEffect(() => { loadEvents(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tenantId]);

  const areas = useMemo(() => {
    const set = new Map<string, string>();
    events.forEach(e => set.set(e.local_id, e.local_nome ?? e.local_id));
    return Array.from(set, ([id, name]) => ({ id, name }));
  }, [events]);

  const filteredEvents = useMemo(() => events.filter(e => {
    if (filterArea && e.local_id !== filterArea) return false;
    if (filterDate && !e.event_timestamp.startsWith(filterDate)) return false;
    return true;
  }), [events, filterDate, filterArea]);

  const save = async () => {
    if (!tenantId) return;
    setSaving(true);
    const { error } = await supabase.from("integration_config").upsert({
      tenant_id: tenantId,
      guardia_url: cfg.guardia_url.trim(),
      guardia_token: cfg.guardia_token.trim(),
      active: cfg.active,
      sync_interval: cfg.sync_interval,
    }, { onConflict: "tenant_id" });
    setSaving(false);
    if (error) toast.error("Erro ao salvar"); else toast.success("Configuração salva");
  };

  const testConnection = async () => {
    if (!cfg.guardia_url || !cfg.guardia_token) { toast.error("Preencha URL e token"); return; }
    setTesting(true);
    try {
      const base = cfg.guardia_url.replace(/\/+$/, "");
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const resp = await fetch(`${base}/api/v1/colaboradores?limit=1`, {
        headers: { "X-GuardIA-Token": cfg.guardia_token, "Accept": "application/json" },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (resp.ok) toast.success(`Conexão OK (HTTP ${resp.status})`);
      else toast.error(`GuardIA respondeu HTTP ${resp.status}`);
    } catch (e) {
      toast.error(`Falha de conexão: ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    const { data, error } = await supabase.functions.invoke("guardia-sync-employees", {
      body: { tenant_id: tenantId },
    });
    setSyncing(false);
    if (error) { toast.error(error.message || "Erro ao sincronizar"); return; }
    const r = data as { imported?: number; updated?: number; skipped?: number; total?: number; atualizado_em?: string };
    toast.success(`Sincronizado: ${r.imported ?? 0} importados, ${r.updated ?? 0} atualizados`);
    setCfg(c => ({ ...c, last_sync_at: r.atualizado_em ?? new Date().toISOString(), last_sync_count: r.total ?? 0 }));
  };

  const copy = (s: string) => { navigator.clipboard.writeText(s); toast.success("Copiado"); };

  if (loading) return <div className="container py-8 text-sm text-muted-foreground">Carregando…</div>;

  return (
    <div className="container py-6 md:py-8 space-y-6">
      <PageHeader
        eyebrow="Configurações"
        title="Integração GuardIA"
        description="Receba eventos de acesso e sincronize colaboradores diretamente do sistema de reconhecimento facial GuardIA."
        icon={<ScanFace className="h-5 w-5" />}
      />

      <Tabs defaultValue="config" className="space-y-4">
        <TabsList>
          <TabsTrigger value="config">Configuração</TabsTrigger>
          <TabsTrigger value="devices">Câmaras / Leitores</TabsTrigger>
          <TabsTrigger value="log" onClick={loadEvents}>Log de Eventos</TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="space-y-4">
          <Card className="glass-card">
            <CardHeader><CardTitle className="font-display">Conexão</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">URL base do GuardIA</Label>
                  <Input
                    value={cfg.guardia_url}
                    onChange={e => setCfg(c => ({ ...c, guardia_url: e.target.value }))}
                    placeholder="https://api.guardia.exemplo.com"
                  />
                </div>
                <div>
                  <Label className="text-xs">Token de autenticação</Label>
                  <div className="relative">
                    <Input
                      type={showToken ? "text" : "password"}
                      value={cfg.guardia_token}
                      onChange={e => setCfg(c => ({ ...c, guardia_token: e.target.value }))}
                      placeholder="Token fornecido pelo GuardIA"
                      className="pr-10"
                    />
                    <Button type="button" size="icon" variant="ghost" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                      onClick={() => setShowToken(s => !s)}>
                      {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={cfg.active} onCheckedChange={v => setCfg(c => ({ ...c, active: v }))} />
                <Label className="text-sm">Integração ativa (eventos recebidos serão processados)</Label>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={save} disabled={saving}>{saving ? "Salvando…" : "Salvar configuração"}</Button>
                <Button variant="outline" onClick={testConnection} disabled={testing}>
                  {testing ? "Testando…" : "Testar conexão"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader><CardTitle className="font-display">Sincronização de colaboradores</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Intervalo de sincronização</Label>
                  <Select value={cfg.sync_interval} onValueChange={v => setCfg(c => ({ ...c, sync_interval: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15min">A cada 15 minutos</SelectItem>
                      <SelectItem value="30min">A cada 30 minutos</SelectItem>
                      <SelectItem value="1h">A cada 1 hora</SelectItem>
                      <SelectItem value="4h">A cada 4 horas</SelectItem>
                      <SelectItem value="manual">Somente manual</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Salve a configuração para aplicar o novo intervalo.
                  </p>
                </div>
                <div className="flex flex-col justify-end">
                  <Button onClick={syncNow} disabled={syncing}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
                    {syncing ? "Sincronizando…" : "Sincronizar colaboradores agora"}
                  </Button>
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                Última sincronização:{" "}
                {cfg.last_sync_at
                  ? <span className="text-foreground">{new Date(cfg.last_sync_at).toLocaleString("pt-BR")} — {cfg.last_sync_count ?? 0} colaboradores</span>
                  : "nunca executada"}
              </div>
              <p className="text-[11px] text-muted-foreground">
                A chave do colaborador é o CPF (apenas dígitos). Importações e webhooks normalizam pontuação automaticamente.
              </p>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="font-display flex items-center gap-2">
                <Webhook className="h-4 w-4 text-primary" /> Webhook (configurar no GuardIA)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs">URL do webhook (POST)</Label>
                <div className="rounded-lg border border-border bg-background/60 p-3 font-mono text-xs flex items-center justify-between gap-2">
                  <code className="break-all">{WEBHOOK_URL}</code>
                  <Button size="sm" variant="ghost" onClick={() => copy(WEBHOOK_URL)}><Copy className="h-4 w-4" /></Button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Header: X-Tenant-Id</Label>
                  <div className="rounded-lg border border-border bg-background/60 p-3 font-mono text-xs flex items-center justify-between gap-2">
                    <code className="break-all">{tenantId}</code>
                    <Button size="sm" variant="ghost" onClick={() => copy(tenantId)}><Copy className="h-4 w-4" /></Button>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Header: X-GuardIA-Token</Label>
                  <div className="rounded-lg border border-border bg-background/60 p-3 font-mono text-xs text-muted-foreground">
                    use o mesmo token configurado acima
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-background/40 p-3 text-xs text-muted-foreground">
                <div className="font-medium text-foreground mb-1">Exemplo de payload esperado:</div>
                <pre className="font-mono leading-relaxed whitespace-pre-wrap">{`{
  "evento_id": "uuid-do-evento",
  "colaborador_id": "12345678900",
  "colaborador_nome": "Maria Silva",
  "local_id": "cam-01",
  "local_nome": "Câmara Fria 1",
  "tipo": "entrada",
  "timestamp": "2026-06-27T12:34:56Z",
  "dispositivo_id": "FR-CF-IN-01"
}`}</pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="log" className="space-y-4">
          <Card className="glass-card">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle className="font-display">Últimos 100 eventos recebidos</CardTitle>
              <Button size="sm" variant="outline" onClick={loadEvents}>
                <RefreshCw className="h-4 w-4 mr-1.5" /> Atualizar
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-3">
                <div>
                  <Label className="text-xs">Data</Label>
                  <Input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} className="w-48" />
                </div>
                <div>
                  <Label className="text-xs">Câmara</Label>
                  <Select value={filterArea || "all"} onValueChange={v => setFilterArea(v === "all" ? "" : v)}>
                    <SelectTrigger className="w-56"><SelectValue placeholder="Todas" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas as câmaras</SelectItem>
                      {areas.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {(filterDate || filterArea) && (
                  <Button variant="ghost" size="sm" className="self-end" onClick={() => { setFilterDate(""); setFilterArea(""); }}>
                    Limpar filtros
                  </Button>
                )}
              </div>

              <div className="rounded-lg border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data/Hora</TableHead>
                      <TableHead>Colaborador</TableHead>
                      <TableHead>Câmara</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredEvents.length === 0 && (
                      <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">
                        Nenhum evento recebido ainda.
                      </TableCell></TableRow>
                    )}
                    {filteredEvents.map(e => (
                      <TableRow key={e.id}>
                        <TableCell className="text-xs tabular-nums">{new Date(e.event_timestamp).toLocaleString("pt-BR")}</TableCell>
                        <TableCell className="text-sm">
                          <div>{e.colaborador_nome || <span className="text-muted-foreground italic">sem nome</span>}</div>
                          <div className="text-[11px] text-muted-foreground font-mono">{e.colaborador_id}</div>
                        </TableCell>
                        <TableCell className="text-sm">{e.local_nome || e.local_id}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={e.tipo === "entrada" ? "border-emerald-500/40 text-emerald-500" : "border-amber-500/40 text-amber-500"}>
                            {e.tipo}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {e.processed
                            ? <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-500"><CheckCircle2 className="h-3 w-3" /> processado</Badge>
                            : <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-500"><XCircle className="h-3 w-3" /> pendente</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
