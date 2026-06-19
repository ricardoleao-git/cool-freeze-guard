import { PageHeader } from "@/components/PageHeader";
import { useDemo, useTenantScoped } from "@/lib/demo-store";
import { Sparkles, LogIn, LogOut, FastForward, AlertTriangle, ShieldAlert, RotateCcw, Play, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { DemoLiveStatusPanel } from "@/components/DemoLiveStatusPanel";
import { regenerateDemoSeed, getAutoRegenerate, setAutoRegenerate } from "@/lib/demo-seed";


export default function DemoMode() {
  const { simulateEntry, simulateExit, advanceMinutes, forceStatus, resetDemo, timeScale, setTimeScale, setActiveTenantId, loading } = useDemo();
  // O modo Experimentação opera SEMPRE no tenant público "demo-tenant"
  // (policies anon liberam leitura/escrita apenas neste escopo).
  useEffect(() => { setActiveTenantId("demo-tenant"); }, [setActiveTenantId]);
  const { employees } = useTenantScoped();
  const [emp, setEmp] = useState<string>("");
  const [autoRegen, setAutoRegenState] = useState<boolean>(() => getAutoRegenerate());
  const [regenerating, setRegenerating] = useState(false);
  useEffect(() => { if (!emp && employees[0]) setEmp(employees[0].id); }, [employees, emp]);

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      await regenerateDemoSeed();
      toast.success("Dados simulados regenerados. Recarregando…");
      setTimeout(() => window.location.reload(), 500);
    } catch (e) {
      console.error(e);
      toast.error("Falha ao regenerar dados de demonstração.");
      setRegenerating(false);
    }
  };

  return (
    <div className="container py-6 md:py-8">
      <PageHeader
        eyebrow="Apresentação"
        title="Modo Experimentação"
        description="Ambiente paralelo para testes e demonstrações ao vivo: simule entradas, avance o tempo, dispare alertas e observe o bloqueio preventivo com a pausa térmica — sem afetar dados de produção."
        icon={<Sparkles className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button asChild variant="outline"><Link to="/demo/painel">Painel Operacional (demo)</Link></Button>
            <Button asChild><a href="/painel-demo" target="_blank" rel="noopener">Abrir Painel TV (sem login)</a></Button>
          </div>
        }
      />


      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="glass-card lg:col-span-2">
          <CardHeader><CardTitle className="font-display">Controles de simulação</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div>
              <Label>Colaborador alvo</Label>
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2"><Loader2 className="h-4 w-4 animate-spin" /> Carregando ambiente de experimentação…</div>
              ) : employees.length === 0 ? (
                <div className="text-sm text-muted-foreground py-2">Nenhum colaborador disponível no tenant de demonstração.</div>
              ) : (
                <Select value={emp} onValueChange={setEmp}>
                  <SelectTrigger><SelectValue placeholder="Selecione um colaborador" /></SelectTrigger>
                  <SelectContent>{employees.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
                </Select>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <Button onClick={() => { simulateEntry(emp); toast.success("Entrada simulada"); }}><LogIn className="h-4 w-4 mr-2" /> Entrada</Button>
              <Button onClick={() => { simulateExit(emp); toast.success("Saída simulada"); }} variant="outline"><LogOut className="h-4 w-4 mr-2" /> Saída</Button>
              <Button onClick={() => advanceMinutes(10)} variant="outline"><FastForward className="h-4 w-4 mr-2" /> +10 min</Button>
              <Button onClick={() => forceStatus(emp, "yellow")} className="bg-status-yellow text-black hover:bg-status-yellow/90"><AlertTriangle className="h-4 w-4 mr-2" /> Amarelo</Button>
              <Button onClick={() => forceStatus(emp, "orange")} className="bg-status-orange text-black hover:bg-status-orange/90"><AlertTriangle className="h-4 w-4 mr-2" /> Laranja</Button>
              <Button onClick={() => forceStatus(emp, "blocked")} className="bg-status-red text-white hover:bg-status-red/90"><ShieldAlert className="h-4 w-4 mr-2" /> Bloqueio</Button>
            </div>

            <div>
              <Label className="flex items-center justify-between">Velocidade do tempo (min simulados / segundo real) <span className="text-primary font-semibold">{timeScale.toFixed(1)}×</span></Label>
              <Slider value={[timeScale]} min={0.2} max={6} step={0.2} onValueChange={(v) => setTimeScale(v[0])} className="mt-2" />
              <p className="text-xs text-muted-foreground mt-1">Aumente para ver os alertas dispararem em segundos durante a apresentação.</p>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { resetDemo(); toast.success("Experimento resetado"); }}><RotateCcw className="h-4 w-4 mr-2" /> Resetar experimento</Button>
              <Button variant="ghost" asChild><Link to="/demo/como-funciona"><Play className="h-4 w-4 mr-2" /> Roteiro de apresentação</Link></Button>
            </div>
          </CardContent>
        </Card>

        <DemoLiveStatusPanel employeeId={emp} />
      </div>

      <Card className="glass-card mt-4">
        <CardHeader><CardTitle className="font-display">Roteiro sugerido</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-3 text-muted-foreground">
          <ol className="list-decimal pl-5 space-y-2 md:columns-2 md:gap-8">
            <li>Abra o <strong className="text-foreground">Painel Operacional</strong> em uma TV.</li>
            <li>Use <strong className="text-foreground">Entrada</strong> para um colaborador iniciar exposição.</li>
            <li>Aumente a velocidade do tempo para 4× e observe o card mudar para <span className="text-status-yellow">amarelo</span> aos 80 min.</li>
            <li>Acompanhe a evolução para <span className="text-status-orange">laranja</span> aos 90 min.</li>
            <li>Aos 100 min, o sistema dispara <span className="text-status-red font-semibold">bloqueio preventivo</span> e inicia automaticamente a pausa térmica.</li>
            <li>Após 20 min fora, o colaborador é liberado e o ciclo reinicia.</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

