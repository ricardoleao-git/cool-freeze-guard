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
import GuardiaPresenceTab from "@/components/guardia/GuardiaPresenceTab";
import GuardiaIntegrityTab from "@/components/guardia/GuardiaIntegrityTab";
import GuardiaStatusTab from "@/components/guardia/GuardiaStatusTab";

const WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/guardia-webhook`;

type Config = {
  guardia_url: string;
  guardia_token: string;
  auth_header_name: string;
  auth_scheme: string;
  api_base_path: string;
  events_endpoint: string | null;
  active: boolean;
  sync_interval: string;
  last_sync_at: string | null;
  last_sync_count: number | null;
  last_push_at: string | null;
  last_push_count: number | null;
  last_event_poll_at: string | null;
  janela_tolerancia_segundos: number;
  sessao_longa_alerta_minutos: number;
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
  auth_header_name: "X-GuardIA-Token",
  auth_scheme: "header",
  api_base_path: "/guardiaapi",
  events_endpoint: "",
  active: false,
  sync_interval: "1h",
  last_sync_at: null,
  last_sync_count: null,
  last_push_at: null,
  last_push_count: null,
  last_event_poll_at: null,
  janela_tolerancia_segundos: 180,
  sessao_longa_alerta_minutos: 240,
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
  const [pushing, setPushing] = useState(false);
  const [polling, setPolling] = useState(false);

  const [events, setEvents] = useState<GuardiaEvent[]>([]);
  const [filterDate, setFilterDate] = useState("");
  const [filterArea, setFilterArea] = useState("");

  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      const { data } = await supabase
        .from("integration_config")
        .select("guardia_url, auth_header_name, auth_scheme, api_base_path, events_endpoint, active, sync_interval, last_sync_at, last_sync_count, last_push_at, last_push_count, last_event_poll_at, janela_tolerancia_segundos, sessao_longa_alerta_minutos")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      // guardia_token is write-only via RLS: never returned to the client.
      // Keep field blank; submitting blank preserves the existing token.
      if (data) setCfg({ ...empty, ...data, guardia_token: "" });
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
    const basePayload = {
      tenant_id: tenantId,
      guardia_url: cfg.guardia_url.trim(),
      auth_header_name: cfg.auth_header_name.trim() || "X-GuardIA-Token",
      auth_scheme: cfg.auth_scheme || "header",
      api_base_path: cfg.api_base_path.trim() || "/guardiaapi",
      events_endpoint: cfg.events_endpoint?.trim() || null,
      active: cfg.active,
      sync_interval: cfg.sync_interval,
      janela_tolerancia_segundos: Math.max(0, Math.floor(Number(cfg.janela_tolerancia_segundos) || 0)),
      sessao_longa_alerta_minutos: Math.max(1, Math.floor(Number(cfg.sessao_longa_alerta_minutos) || 1)),
    };
    // Only write the token when the admin actually typed a new value;
    // the DB never returns it back, so leaving the field blank preserves the saved one.
    const payload = cfg.guardia_token.trim()
      ? { ...basePayload, guardia_token: cfg.guardia_token.trim() }
      : basePayload;
    const { error } = await supabase.from("integration_config").upsert(payload, { onConflict: "tenant_id" });
    setSaving(false);
    if (error) toast.error("Erro ao salvar"); else { toast.success("Configuração salva"); setCfg(c => ({ ...c, guardia_token: "" })); }
  };


  const testConnection = async () => {
    if (!tenantId) return;
    if (!cfg.guardia_url) { toast.error("Preencha URL"); return; }
    setTesting(true);
    try {
      // Persist current config first so the server uses the latest values.
      const baseTestPayload = {
        tenant_id: tenantId,
        guardia_url: cfg.guardia_url.trim(),
        auth_header_name: cfg.auth_header_name.trim() || "X-GuardIA-Token",
        auth_scheme: cfg.auth_scheme || "header",
        api_base_path: cfg.api_base_path.trim() || "/guardiaapi",
        events_endpoint: cfg.events_endpoint?.trim() || null,
      };
      const testPayload = cfg.guardia_token.trim()
        ? { ...baseTestPayload, guardia_token: cfg.guardia_token.trim() }
        : baseTestPayload;
      await supabase.from("integration_config").upsert(testPayload, { onConflict: "tenant_id" });

      const { data, error } = await supabase.functions.invoke("guardia-poll-events", {
        body: { tenant_id: tenantId, test_only: true },
      });
      if (error) { toast.error(error.message || "Falha no teste"); return; }
      const r = data as {
        ok?: boolean;
        auth?: { ok: boolean; message?: string };
        events?: { ok: boolean; configured: boolean; message?: string };
      };
      const authMsg = r.auth?.message || "auth desconhecido";
      const evMsg = r.events?.configured ? (r.events.message || "events desconhecido") : "events_endpoint não configurado";
      if (r.ok) toast.success(`Conexão OK — ${authMsg} · ${evMsg}`);
      else if (r.auth?.ok && r.events?.configured && !r.events.ok)
        toast.warning(`Auth OK, mas events_endpoint falhou: ${evMsg}`);
      else toast.error(`Falha: ${authMsg}${r.events?.configured ? ` · ${evMsg}` : ""}`);
    } catch (e) {
      toast.error(`Erro inesperado: ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  const pushNow = async () => {
    setPushing(true);
    const { data, error } = await supabase.functions.invoke("guardia-sync-employees", {
      body: { tenant_id: tenantId, only_active: true },
    });
    setPushing(false);
    if (error) { toast.error(error.message || "Erro ao enviar"); return; }
    const r = data as { created?: number; updated?: number; deleted?: number; skipped?: number; errors?: unknown[]; atualizado_em?: string };
    toast.success(`Enviados: ${r.created ?? 0} novos, ${r.updated ?? 0} atualizados${r.errors?.length ? ` · ${r.errors.length} erros` : ""}`);
    setCfg(c => ({ ...c, last_push_at: r.atualizado_em ?? new Date().toISOString(), last_push_count: (r.created ?? 0) + (r.updated ?? 0) }));
  };

  const pollNow = async () => {
    setPolling(true);
    const { data, error } = await supabase.functions.invoke("guardia-poll-events", {
      body: { tenant_id: tenantId },
    });
    setPolling(false);
    if (error) { toast.error(error.message || "Erro no polling"); return; }
    const r = data as { polled?: boolean; fetched?: number; staged?: number; dispatched?: number; reason?: string };
    if (r.reason === "no_events_endpoint") { toast.warning("Endpoint de eventos não configurado (OpenAPI 1.0 não documenta histórico)"); return; }
    toast.success(`Polling: ${r.fetched ?? 0} eventos · ${r.dispatched ?? 0} processados`);
    setCfg(c => ({ ...c, last_event_poll_at: new Date().toISOString() }));
    loadEvents();
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
        actions={
          <Button onClick={pollNow} disabled={polling}>
            <RefreshCw className={`h-4 w-4 mr-2 ${polling ? "animate-spin" : ""}`} />
            {polling ? "Sincronizando…" : "Sincronizar agora"}
          </Button>
        }
      />

      <Tabs defaultValue="config" className="space-y-4">
        <TabsList>
          <TabsTrigger value="config">Configuração</TabsTrigger>
          <TabsTrigger value="status">Status</TabsTrigger>
          <TabsTrigger value="devices">Câmaras / Leitores</TabsTrigger>
          <TabsTrigger value="presence">Presença agora</TabsTrigger>
          <TabsTrigger value="log" onClick={loadEvents}>Log de Eventos</TabsTrigger>
          <TabsTrigger value="integrity">Integridade (forense)</TabsTrigger>
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
                      placeholder="••• salvo • preencha para substituir"
                      className="pr-10"
                      autoComplete="new-password"
                    />
                    <Button type="button" size="icon" variant="ghost" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                      onClick={() => setShowToken(s => !s)}>
                      {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Esquema de autenticação</Label>
                  <Select value={cfg.auth_scheme} onValueChange={v => setCfg(c => ({ ...c, auth_scheme: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="header">Header customizado</SelectItem>
                      <SelectItem value="bearer">Authorization: Bearer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Nome do header (quando customizado)</Label>
                  <Input
                    value={cfg.auth_header_name}
                    onChange={e => setCfg(c => ({ ...c, auth_header_name: e.target.value }))}
                    placeholder="X-GuardIA-Token"
                    disabled={cfg.auth_scheme === "bearer"}
                  />
                </div>
                <div>
                  <Label className="text-xs">Base path da API</Label>
                  <Input
                    value={cfg.api_base_path}
                    onChange={e => setCfg(c => ({ ...c, api_base_path: e.target.value }))}
                    placeholder="/guardiaapi"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">OpenAPI 1.0.0 usa <code>/guardiaapi</code>.</p>
                </div>
              </div>

              <div>
                <Label className="text-xs">Endpoint de eventos (opcional — extensão proprietária)</Label>
                <Input
                  value={cfg.events_endpoint ?? ""}
                  onChange={e => setCfg(c => ({ ...c, events_endpoint: e.target.value }))}
                  placeholder="/events ou /access-history (vazio = polling desabilitado)"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  O OpenAPI 1.0.0 não documenta histórico de eventos. Preencha apenas se a sua instância expõe um endpoint customizado.
                </p>
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
            <CardHeader><CardTitle className="font-display">Parâmetros de presença</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Janela de tolerância global (segundos)</Label>
                  <Input
                    type="number" min={0}
                    value={cfg.janela_tolerancia_segundos}
                    onChange={e => setCfg(c => ({ ...c, janela_tolerancia_segundos: Number(e.target.value) }))}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Leituras repetidas do mesmo leitor dentro deste intervalo não contam como nova passagem (mas o registro bruto é sempre preservado).
                  </p>
                </div>
                <div>
                  <Label className="text-xs">Alerta de sessão longa (minutos)</Label>
                  <Input
                    type="number" min={1}
                    value={cfg.sessao_longa_alerta_minutos}
                    onChange={e => setCfg(c => ({ ...c, sessao_longa_alerta_minutos: Number(e.target.value) }))}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Sessões de exposição acima deste tempo são sinalizadas para revisão (não são encerradas automaticamente).
                  </p>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Estes parâmetros são salvos junto com a configuração da integração.
              </p>
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
                <div className="flex flex-col justify-end gap-2">
                  <Button onClick={pushNow} disabled={pushing}>
                    <Send className={`h-4 w-4 mr-2 ${pushing ? "animate-pulse" : ""}`} />
                    {pushing ? "Enviando…" : "Enviar colaboradores para GuardIA"}
                  </Button>
                  <Button variant="outline" onClick={pollNow} disabled={polling}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${polling ? "animate-spin" : ""}`} />
                    {polling ? "Buscando…" : "Buscar eventos (polling)"}
                  </Button>
                </div>
              </div>
              <div className="text-sm text-muted-foreground space-y-1">
                <div>
                  Último push para GuardIA:{" "}
                  {cfg.last_push_at
                    ? <span className="text-foreground">{new Date(cfg.last_push_at).toLocaleString("pt-BR")} — {cfg.last_push_count ?? 0} pessoas</span>
                    : "nunca executado"}
                </div>
                <div>
                  Último polling de eventos:{" "}
                  {cfg.last_event_poll_at
                    ? <span className="text-foreground">{new Date(cfg.last_event_poll_at).toLocaleString("pt-BR")}</span>
                    : "nunca executado"}
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Conforme OpenAPI 1.0.0 da GuardIA, colaboradores são <strong>empurrados</strong> via <code>POST/PUT/DELETE /guardiaapi/person/&#123;remoteid&#125;</code> usando o CPF como <code>remoteid</code>.
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

        <TabsContent value="status" className="space-y-4">
          <GuardiaStatusTab tenantId={tenantId} />
        </TabsContent>

        <TabsContent value="devices" className="space-y-4">
          <GuardiaDeviceMapTab tenantId={tenantId} />
        </TabsContent>

        <TabsContent value="presence" className="space-y-4">
          <GuardiaPresenceTab tenantId={tenantId} longSessionMinutes={cfg.sessao_longa_alerta_minutos} />
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

        <TabsContent value="integrity" className="space-y-4">
          <GuardiaIntegrityTab tenantId={tenantId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
