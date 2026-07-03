import { PageHeader } from "@/components/PageHeader";
import { useDemo, useTenantScoped } from "@/lib/demo-store";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { FlaskConical, LogIn, LogOut, Plus, Minus, AlertTriangle, ShieldAlert, Play, Loader2, ExternalLink, Clock, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { DemoLiveStatusPanel } from "@/components/DemoLiveStatusPanel";
import { cn } from "@/lib/utils";

type ActionKey = "entry" | "exit" | "plus10" | "minus10" | "yellow" | "orange" | "blocked";

type QueueItem = {
  id: string;
  kind: ActionKey;
  empId: string;
  empName: string;
  createdAt: number;
  attempts: number;
  lastError?: string;
};

const QUEUE_STORAGE_KEY = (tenant: string) => `sim-queue:v1:${tenant}`;
const QUEUE_RETRY_MS = 5_000;
const ACTION_LABEL: Record<ActionKey, string> = {
  entry: "Entrada", exit: "Saída",
  plus10: "+10 min", minus10: "-10 min",
  yellow: "Status amarelo", orange: "Status laranja", blocked: "Bloqueio",
};

export default function Simulator() {
  const { profile } = useAuth();
  const {
    simulateEntry, simulateExit, forceStatus,
    timeScale, setTimeScale, setActiveTenantId, loading,
  } = useDemo();

  useEffect(() => {
    if (profile?.tenant_id) setActiveTenantId(profile.tenant_id);
  }, [profile?.tenant_id, setActiveTenantId]);

  // Prepara o tenant para simulação: garante tenant_settings com require_consent_before_capture=false
  // (evita bloqueio LGPD silencioso em ambientes de treinamento/validação).
  const preparedRef = useRef<string | null>(null);
  useEffect(() => {
    const t = profile?.tenant_id;
    if (!t || preparedRef.current === t) return;
    preparedRef.current = t;
    (async () => {
      const { data: existing } = await supabase
        .from("tenant_settings")
        .select("tenant_id, require_consent_before_capture")
        .eq("tenant_id", t)
        .maybeSingle();
      if (!existing) {
        await supabase.from("tenant_settings").insert({
          tenant_id: t,
          require_consent_before_capture: false,
        });
      } else if (existing.require_consent_before_capture) {
        await supabase
          .from("tenant_settings")
          .update({ require_consent_before_capture: false })
          .eq("tenant_id", t);
      }
    })();
  }, [profile?.tenant_id]);

  const { employees, coldAreas, units } = useTenantScoped();
  const [emp, setEmp] = useState<string>("");
  useEffect(() => { if (!emp && employees[0]) setEmp(employees[0].id); }, [employees, emp]);
  const selected = useMemo(() => employees.find(e => e.id === emp), [employees, emp]);
  const isInside = !!selected && ["inside", "yellow", "orange", "blocked"].includes(selected.current_status);

  // Canal de broadcast: notifica painéis TV para refazer o fetch imediatamente.
  const tenantId = profile?.tenant_id ?? null;
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  useEffect(() => {
    if (!tenantId) return;
    const ch = supabase.channel(`kiosk:${tenantId}`, { config: { broadcast: { self: false } } });
    ch.subscribe();
    channelRef.current = ch;
    return () => { supabase.removeChannel(ch); channelRef.current = null; };
  }, [tenantId]);

  // Destaca apenas o último botão clicado (por ~2s).
  const [lastAction, setLastAction] = useState<ActionKey | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = (a: ActionKey) => {
    setLastAction(a);
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = setTimeout(() => setLastAction(null), 2000);
  };
  useEffect(() => () => { if (clearTimerRef.current) clearTimeout(clearTimerRef.current); }, []);

  // -----------------------------------------------------------------
  // Fila persistente de eventos (localStorage) — se a rede/DB falharem,
  // as ações ficam enfileiradas e um worker tenta reprocessá-las a cada
  // QUEUE_RETRY_MS. Ao concluir, dispara broadcast para o painel externo.
  // -----------------------------------------------------------------
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const queueRef = useRef<QueueItem[]>([]);
  const processingRef = useRef(false);
  const employeesRef = useRef(employees);
  useEffect(() => { employeesRef.current = employees; }, [employees]);

  // Hidrata a fila do localStorage quando o tenant muda.
  useEffect(() => {
    if (!tenantId) return;
    try {
      const raw = localStorage.getItem(QUEUE_STORAGE_KEY(tenantId));
      const parsed: QueueItem[] = raw ? JSON.parse(raw) : [];
      queueRef.current = parsed;
      setQueue(parsed);
    } catch { /* noop */ }
  }, [tenantId]);

  const persistQueue = useCallback((next: QueueItem[]) => {
    queueRef.current = next;
    setQueue(next);
    if (tenantId) {
      try { localStorage.setItem(QUEUE_STORAGE_KEY(tenantId), JSON.stringify(next)); }
      catch { /* noop */ }
    }
  }, [tenantId]);

  // Executor de uma ação individual (uma vez). Levanta em falha para retry.
  const executeAction = useCallback(async (item: QueueItem) => {
    const emps = employeesRef.current;
    const target = emps.find(e => e.id === item.empId);
    switch (item.kind) {
      case "entry":   await simulateEntry(item.empId); break;
      case "exit":    await simulateExit(item.empId); break;
      case "yellow":  await forceStatus(item.empId, "yellow"); break;
      case "orange":  await forceStatus(item.empId, "orange"); break;
      case "blocked": await forceStatus(item.empId, "blocked"); break;
      case "plus10":
      case "minus10": {
        if (!tenantId) throw new Error("Tenant não carregado");
        if (!target || !target.inside_since ||
            !["inside","yellow","orange","blocked"].includes(target.current_status)) {
          throw new Error("Colaborador não está dentro");
        }
        const delta = item.kind === "plus10" ? 10 : -10;
        const nowMs = Date.now();
        const shiftedMs = target.inside_since - delta * 60_000;
        const newInsideSince = new Date(Math.min(nowMs, shiftedMs)).toISOString();
        const newAcc = Math.max(0, target.accumulated_minutes + delta);
        const { error } = await supabase
          .from("employees")
          .update({ inside_since: newInsideSince, accumulated_minutes: newAcc })
          .eq("id", target.id)
          .eq("tenant_id", tenantId);
        if (error) throw error;
        break;
      }
    }
  }, [simulateEntry, simulateExit, forceStatus, tenantId]);

  const broadcastRefresh = useCallback(() => {
    channelRef.current?.send({ type: "broadcast", event: "refresh", payload: { ts: Date.now() } });
  }, []);

  // Worker que drena a fila (FIFO). Executa 1 por vez para preservar ordem.
  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    if (queueRef.current.length === 0) return;
    processingRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const head = queueRef.current[0];
        try {
          await executeAction(head);
          persistQueue(queueRef.current.slice(1));
          broadcastRefresh();
        } catch (e: any) {
          const updated: QueueItem = {
            ...head,
            attempts: head.attempts + 1,
            lastError: e?.message ?? "erro desconhecido",
          };
          persistQueue([updated, ...queueRef.current.slice(1)]);
          // Interrompe o loop — retry em QUEUE_RETRY_MS.
          break;
        }
      }
    } finally {
      processingRef.current = false;
    }
  }, [executeAction, persistQueue, broadcastRefresh]);

  // Retry periódico + retry ao voltar online.
  useEffect(() => {
    const id = setInterval(() => { void processQueue(); }, QUEUE_RETRY_MS);
    const onOnline = () => { void processQueue(); };
    window.addEventListener("online", onOnline);
    return () => { clearInterval(id); window.removeEventListener("online", onOnline); };
  }, [processQueue]);

  // Enfileira e tenta processar imediatamente.
  const enqueue = useCallback((kind: ActionKey, empId: string) => {
    const target = employeesRef.current.find(e => e.id === empId);
    const item: QueueItem = {
      id: crypto.randomUUID(),
      kind, empId,
      empName: target?.name ?? "—",
      createdAt: Date.now(),
      attempts: 0,
    };
    persistQueue([...queueRef.current, item]);
    void processQueue();
  }, [persistQueue, processQueue]);

  const run = (key: ActionKey) => {
    flash(key);
    if (!emp) return;
    enqueue(key, emp);
    toast.success(`${ACTION_LABEL[key]} enfileirada`, {
      description: queueRef.current.length > 1
        ? `${queueRef.current.length} eventos aguardando processamento`
        : "Aplicando ao painel…",
    });
  };

  const retryNow = () => { void processQueue(); };
  const clearFailed = () => persistQueue([]);


  const noSeed = !loading && (employees.length === 0 || coldAreas.length === 0);
  const btnActive = "ring-2 ring-primary ring-offset-2 ring-offset-background";


  return (
    <div className="container py-6 md:py-8">
      <PageHeader
        eyebrow="Operação"
        title="Simulador ao vivo"
        description="Dispare eventos de entrada/saída, pausas térmicas e alertas no seu ambiente real e veja o painel reagir em tempo real. Ideal para treinamento e validação — todos os eventos são persistidos com hash forense."
        icon={<FlaskConical className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button asChild variant="outline">
              <Link to="/painel-operacional"><ExternalLink className="h-4 w-4 mr-2" /> Abrir Painel Operacional</Link>
            </Button>
          </div>
        }
      />

      {noSeed && (
        <Alert className="mb-4 border-status-yellow/50">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Ambiente sem dados suficientes</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              Para simular eventos você precisa ter ao menos <strong>uma unidade</strong>,{" "}
              <strong>uma área fria</strong> e <strong>um colaborador autorizado</strong> na área.
            </p>
            <div className="flex gap-2 flex-wrap pt-1">
              <Button asChild size="sm" variant="outline"><Link to="/ambientes">Cadastrar áreas frias</Link></Button>
              <Button asChild size="sm" variant="outline"><Link to="/colaboradores">Cadastrar colaboradores</Link></Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="glass-card lg:col-span-2">
          <CardHeader><CardTitle className="font-display">Controles de simulação</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
              <div className="rounded-md border bg-muted/20 px-3 py-2">
                <div className="uppercase tracking-wider">Unidades</div>
                <div className="text-lg font-semibold text-foreground">{units.length}</div>
              </div>
              <div className="rounded-md border bg-muted/20 px-3 py-2">
                <div className="uppercase tracking-wider">Áreas frias</div>
                <div className="text-lg font-semibold text-foreground">{coldAreas.length}</div>
              </div>
              <div className="rounded-md border bg-muted/20 px-3 py-2">
                <div className="uppercase tracking-wider">Colaboradores</div>
                <div className="text-lg font-semibold text-foreground">{employees.length}</div>
              </div>
            </div>

            <div>
              <Label>Colaborador alvo</Label>
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
                </div>
              ) : employees.length === 0 ? (
                <div className="text-sm text-muted-foreground py-2">Nenhum colaborador cadastrado neste tenant.</div>
              ) : (
                <Select value={emp} onValueChange={setEmp}>
                  <SelectTrigger><SelectValue placeholder="Selecione um colaborador" /></SelectTrigger>
                  <SelectContent>
                    {employees.map(e => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name} <span className="text-muted-foreground">· {e.current_status}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <Button
                variant="outline" disabled={!emp}
                className={cn(lastAction === "entry" && btnActive)}
                onClick={() => run("entry")}
              >
                <LogIn className="h-4 w-4 mr-2" /> Entrada
              </Button>
              <Button
                variant="outline" disabled={!emp}
                className={cn(lastAction === "exit" && btnActive)}
                onClick={() => run("exit")}
              >
                <LogOut className="h-4 w-4 mr-2" /> Saída
              </Button>
              <Button
                variant="outline" disabled={!emp || !isInside}
                className={cn(lastAction === "plus10" && btnActive)}
                onClick={() => run("plus10")}
                title={isInside ? "Adiciona 10 min ao tempo dentro" : "Registre uma entrada primeiro"}
              >
                <Plus className="h-4 w-4 mr-2" /> 10 min
              </Button>
              <Button
                variant="outline" disabled={!emp || !isInside}
                className={cn(lastAction === "minus10" && btnActive)}
                onClick={() => run("minus10")}
                title={isInside ? "Remove 10 min do tempo dentro" : "Registre uma entrada primeiro"}
              >
                <Minus className="h-4 w-4 mr-2" /> 10 min
              </Button>
              <Button
                variant="outline" disabled={!emp}
                className={cn(
                  "border-status-yellow/60 text-status-yellow hover:bg-status-yellow/10",
                  lastAction === "yellow" && btnActive,
                )}
                onClick={() => run("yellow")}
              >
                <AlertTriangle className="h-4 w-4 mr-2" /> Amarelo
              </Button>
              <Button
                variant="outline" disabled={!emp}
                className={cn(
                  "border-status-orange/60 text-status-orange hover:bg-status-orange/10",
                  lastAction === "orange" && btnActive,
                )}
                onClick={() => run("orange")}
              >
                <AlertTriangle className="h-4 w-4 mr-2" /> Laranja
              </Button>
              <Button
                variant="outline" disabled={!emp}
                className={cn(
                  "border-status-red/60 text-status-red hover:bg-status-red/10",
                  lastAction === "blocked" && btnActive,
                )}
                onClick={() => run("blocked")}
              >
                <ShieldAlert className="h-4 w-4 mr-2" /> Bloqueio
              </Button>
            </div>

            <div>
              <Label className="flex items-center justify-between">
                Velocidade do tempo (min simulados / segundo real)
                <span className="text-primary font-semibold">{timeScale.toFixed(1)}×</span>
              </Label>
              <Slider value={[timeScale]} min={0.2} max={6} step={0.2}
                onValueChange={(v) => setTimeScale(v[0])} className="mt-2" />
              <p className="text-xs text-muted-foreground mt-1">
                Aumente para ver os alertas dispararem em segundos durante a demonstração.
              </p>
            </div>

            <div className="rounded-md border bg-muted/10 p-3 text-xs text-muted-foreground flex gap-2">
              <Play className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
              <div>
                <strong className="text-foreground">Como validar:</strong> abra o{" "}
                <Link to="/painel-operacional" className="underline">Painel Operacional</Link>{" "}
                em outra aba (ou TV via <code>/loginpainel</code>) e dispare uma entrada aqui — o painel reage
                em tempo real via Realtime (com fallback de polling a cada 60 s).
              </div>
            </div>

            {/* Fila de eventos: persistida em localStorage e reprocessada a cada 5s. */}
            <div className="rounded-md border bg-muted/10 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Clock className="h-4 w-4 text-primary" />
                  Fila de eventos
                  <Badge variant={queue.length === 0 ? "secondary" : "default"}>
                    {queue.length} pendente{queue.length === 1 ? "" : "s"}
                  </Badge>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={retryNow} disabled={queue.length === 0}>
                    <RefreshCw className="h-3.5 w-3.5 mr-1" /> Reprocessar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={clearFailed} disabled={queue.length === 0}>
                    Limpar
                  </Button>
                </div>
              </div>
              {queue.length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Check className="h-3.5 w-3.5 text-status-green" />
                  Todos os eventos foram entregues.
                </div>
              ) : (
                <ul className="space-y-1 max-h-40 overflow-auto text-xs">
                  {queue.slice(0, 20).map((q) => (
                    <li key={q.id} className="flex items-center justify-between gap-2 border-b border-border/40 py-1 last:border-b-0">
                      <span className="truncate">
                        <span className="font-medium text-foreground">{ACTION_LABEL[q.kind]}</span>{" "}
                        <span className="text-muted-foreground">· {q.empName}</span>
                      </span>
                      <span className={cn("shrink-0 text-xs", q.attempts > 0 ? "text-status-orange" : "text-muted-foreground")}>
                        {q.attempts > 0 ? `${q.attempts} tentativa${q.attempts === 1 ? "" : "s"}` : "aguardando"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[11px] text-muted-foreground mt-2">
                Se a rede/backend cair, os eventos ficam salvos localmente e são reenviados automaticamente
                ao restabelecer a conexão (retry a cada {QUEUE_RETRY_MS / 1000}s).
              </p>
            </div>

          </CardContent>
        </Card>

        <DemoLiveStatusPanel employeeId={emp} />
      </div>
    </div>
  );
}
