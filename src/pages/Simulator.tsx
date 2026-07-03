import { PageHeader } from "@/components/PageHeader";
import { useDemo, useTenantScoped } from "@/lib/demo-store";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { FlaskConical, LogIn, LogOut, Plus, Minus, AlertTriangle, ShieldAlert, Play, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { DemoLiveStatusPanel } from "@/components/DemoLiveStatusPanel";
import { cn } from "@/lib/utils";

type ActionKey = "entry" | "exit" | "plus10" | "minus10" | "yellow" | "orange" | "blocked";

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

  // Destaca apenas o último botão clicado (por ~2s).
  const [lastAction, setLastAction] = useState<ActionKey | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = (a: ActionKey) => {
    setLastAction(a);
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = setTimeout(() => setLastAction(null), 2000);
  };
  useEffect(() => () => { if (clearTimerRef.current) clearTimeout(clearTimerRef.current); }, []);

  const run = async (key: ActionKey, fn: () => Promise<void> | void, okMsg: string) => {
    flash(key);
    try {
      await fn();
      toast.success(okMsg);
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao simular ação");
    }
  };

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
                onClick={() => run("entry", () => simulateEntry(emp), "Entrada simulada")}
              >
                <LogIn className="h-4 w-4 mr-2" /> Entrada
              </Button>
              <Button
                variant="outline" disabled={!emp}
                className={cn(lastAction === "exit" && btnActive)}
                onClick={() => run("exit", () => simulateExit(emp), "Saída simulada")}
              >
                <LogOut className="h-4 w-4 mr-2" /> Saída
              </Button>
              <Button
                variant="outline"
                className={cn(lastAction === "advance" && btnActive)}
                onClick={() => run("advance", () => advanceMinutes(10), "Avançado +10 min")}
              >
                <FastForward className="h-4 w-4 mr-2" /> +10 min
              </Button>
              <Button
                variant="outline" disabled={!emp}
                className={cn(
                  "border-status-yellow/60 text-status-yellow hover:bg-status-yellow/10",
                  lastAction === "yellow" && btnActive,
                )}
                onClick={() => run("yellow", () => forceStatus(emp, "yellow"), "Status forçado: amarelo")}
              >
                <AlertTriangle className="h-4 w-4 mr-2" /> Amarelo
              </Button>
              <Button
                variant="outline" disabled={!emp}
                className={cn(
                  "border-status-orange/60 text-status-orange hover:bg-status-orange/10",
                  lastAction === "orange" && btnActive,
                )}
                onClick={() => run("orange", () => forceStatus(emp, "orange"), "Status forçado: laranja")}
              >
                <AlertTriangle className="h-4 w-4 mr-2" /> Laranja
              </Button>
              <Button
                variant="outline" disabled={!emp}
                className={cn(
                  "border-status-red/60 text-status-red hover:bg-status-red/10",
                  lastAction === "blocked" && btnActive,
                )}
                onClick={() => run("blocked", () => forceStatus(emp, "blocked"), "Status forçado: bloqueio")}
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
                em outra aba (ou TV via <code>/loginpainel</code>) e dispare uma entrada aqui — o card
                do colaborador muda de estado em tempo real e os alertas aparecem no sino.
                <br />
                O painel externo (TV) atualiza automaticamente a cada 60 segundos.
              </div>
            </div>
          </CardContent>
        </Card>

        <DemoLiveStatusPanel employeeId={emp} />
      </div>
    </div>
  );
}
