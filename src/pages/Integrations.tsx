import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { PlugZap, Copy, ShieldCheck, Send, Webhook, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useDemo } from "@/lib/demo-store";
import { supabase } from "@/integrations/supabase/client";

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ingest-access-event`;

type IngestResponse = {
  ok?: boolean;
  error?: string;
  message?: string;
  details?: string[];
  validation_status?: string;
  reject_reason?: string;
  event?: { id: string; occurred_at: string };
  resolved?: { device_id: string; employee_id: string; cold_area_id: string; unit_id: string };
};

export default function Integrations() {
  const { activeTenantId, devices, employees } = useDemo();
  const tenantDevices = useMemo(() => devices.filter(d => d.tenant_id === activeTenantId), [devices, activeTenantId]);
  const tenantEmployees = useMemo(() => employees.filter(e => e.tenant_id === activeTenantId), [employees, activeTenantId]);

  const [deviceId, setDeviceId] = useState<string>("");
  const [employeeExt, setEmployeeExt] = useState<string>("");
  const [eventType, setEventType] = useState<"entry" | "exit">("entry");
  const [confidence, setConfidence] = useState<string>("0.97");
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<{ status: number; body: IngestResponse } | null>(null);

  const selectedDevice = tenantDevices.find(d => d.external_device_id === deviceId || d.id === deviceId);
  const selectedEmployee = tenantEmployees.find(e => e.registration_number === employeeExt || e.id === employeeExt);

  const payload = useMemo(() => ({
    tenant_id: activeTenantId,
    device_id: deviceId || "FR-CF-IN-01",
    employee_external_id: employeeExt || "MAT-100023",
    event_type: eventType,
    timestamp: new Date().toISOString(),
    confidence_score: Number(confidence) || 0.95,
  }), [activeTenantId, deviceId, employeeExt, eventType, confidence]);

  const payloadString = JSON.stringify(payload, null, 2);

  const curlExample = `curl -X POST '${FUNCTION_URL}' \\
  -H 'Content-Type: application/json' \\
  -H 'apikey: ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}' \\
  -d '${JSON.stringify(payload)}'`;

  const copy = (s: string) => { navigator.clipboard.writeText(s); toast.success("Copiado"); };

  const sendEvent = async () => {
    setSending(true);
    setResponse(null);
    try {
      const { data, error } = await supabase.functions.invoke("ingest-access-event", { body: payload });
      if (error) {
        const status = (error as { context?: { status?: number } }).context?.status ?? 500;
        let body: IngestResponse = { error: error.message };
        try {
          const ctx = (error as { context?: Response }).context;
          if (ctx && typeof ctx.json === "function") body = await ctx.json();
        } catch { /* noop */ }
        setResponse({ status, body });
        toast.error(body.error || "Falha ao enviar evento");
      } else {
        setResponse({ status: 201, body: data as IngestResponse });
        const vs = (data as IngestResponse)?.validation_status;
        if (vs === "valid") toast.success("Evento aceito");
        else if (vs === "needs_review") toast.warning("Evento aceito — revisão manual");
        else toast.error("Evento rejeitado");
      }
    } catch (e) {
      setResponse({ status: 0, body: { error: (e as Error).message } });
      toast.error("Erro de rede");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="container py-6 md:py-8 space-y-6">
      <PageHeader
        eyebrow="Gestão"
        title="Integrações / API"
        description="Endpoint real para receber eventos de leitores faciais. Use o simulador abaixo para validar o fluxo de ingestão ponta a ponta."
        icon={<PlugZap className="h-5 w-5" />}
      />

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <Webhook className="h-4 w-4 text-primary" /> Endpoint de ingestão
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-border bg-background/60 p-3 font-mono text-xs flex items-center justify-between gap-2">
            <code className="break-all">POST {FUNCTION_URL}</code>
            <Button size="sm" variant="ghost" onClick={() => copy(FUNCTION_URL)}><Copy className="h-4 w-4" /></Button>
          </div>
          <p className="text-sm text-muted-foreground">
            A função resolve o dispositivo pelo <span className="font-mono">device_id</span> (externo ou interno), localiza o colaborador por matrícula ou ID, valida regras de exposição e persiste o evento na tabela <span className="font-mono">access_events</span> com origem <span className="font-mono">device_api</span>.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="glass-card">
          <CardHeader><CardTitle className="font-display flex items-center gap-2"><Send className="h-4 w-4 text-primary" /> Simulador de webhook</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Dispositivo</Label>
                <Select value={deviceId} onValueChange={setDeviceId}>
                  <SelectTrigger><SelectValue placeholder="Selecione um device" /></SelectTrigger>
                  <SelectContent>
                    {tenantDevices.map(d => (
                      <SelectItem key={d.id} value={d.external_device_id || d.id}>
                        {d.external_device_id || d.id} — {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Colaborador (matrícula)</Label>
                <Select value={employeeExt} onValueChange={setEmployeeExt}>
                  <SelectTrigger><SelectValue placeholder="Selecione um colaborador" /></SelectTrigger>
                  <SelectContent>
                    {tenantEmployees.map(e => (
                      <SelectItem key={e.id} value={e.registration_number}>
                        {e.registration_number} — {e.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Tipo de evento</Label>
                <Select value={eventType} onValueChange={(v) => setEventType(v as "entry" | "exit")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="entry">entry (entrada)</SelectItem>
                    <SelectItem value="exit">exit (saída)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Confiança facial (0–1)</Label>
                <Input type="number" min="0" max="1" step="0.01" value={confidence} onChange={(e) => setConfidence(e.target.value)} />
              </div>
            </div>

            {(selectedDevice || selectedEmployee) && (
              <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
                {selectedDevice && <Badge variant="outline">Área: {selectedDevice.cold_area_id}</Badge>}
                {selectedEmployee && <Badge variant="outline">Status atual: {selectedEmployee.current_status}</Badge>}
              </div>
            )}

            <div className="rounded-lg border border-border bg-background/60 p-3 font-mono text-xs flex items-start justify-between gap-2">
              <pre className="whitespace-pre-wrap leading-relaxed flex-1">{payloadString}</pre>
              <Button size="sm" variant="ghost" onClick={() => copy(payloadString)}><Copy className="h-4 w-4" /></Button>
            </div>

            <Button onClick={sendEvent} disabled={sending} className="w-full">
              <Send className="h-4 w-4 mr-2" />
              {sending ? "Enviando..." : "Enviar evento para o endpoint"}
            </Button>

            {response && (
              <div className="rounded-lg border border-border bg-background/60 p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  {response.body.validation_status === "valid" && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                  {response.body.validation_status === "needs_review" && <AlertTriangle className="h-4 w-4 text-amber-500" />}
                  {(response.body.error || response.body.validation_status === "rejected") && <XCircle className="h-4 w-4 text-destructive" />}
                  <span className="font-mono">HTTP {response.status}</span>
                  {response.body.validation_status && <Badge variant="outline">{response.body.validation_status}</Badge>}
                  {response.body.reject_reason && <span className="text-xs text-muted-foreground">{response.body.reject_reason}</span>}
                </div>
                <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed text-muted-foreground">
                  {JSON.stringify(response.body, null, 2)}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="glass-card">
            <CardHeader><CardTitle className="font-display">Exemplo cURL</CardTitle></CardHeader>
            <CardContent>
              <div className="rounded-lg border border-border bg-background/60 p-3 font-mono text-xs flex items-start justify-between gap-2">
                <pre className="whitespace-pre-wrap leading-relaxed flex-1">{curlExample}</pre>
                <Button size="sm" variant="ghost" onClick={() => copy(curlExample)}><Copy className="h-4 w-4" /></Button>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                O endpoint aceita JSON e responde com o evento persistido e o status de validação. Eventos rejeitados retornam HTTP 422; eventos aceitos retornam 201.
              </p>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader><CardTitle className="font-display flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /> Validações aplicadas</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                <li>Dispositivo deve existir e estar <span className="font-mono">online</span> no tenant informado</li>
                <li>Colaborador identificado por matrícula ou ID dentro do tenant</li>
                <li>Entrada bloqueada para colaborador em <span className="font-mono">blocked</span> ou <span className="font-mono">thermal_break</span></li>
                <li>Saída sem entrada ativa fica como <span className="font-mono">needs_review</span></li>
                <li>Confiança facial &lt; 0.6 marca o evento para revisão manual</li>
                <li>Atualiza <span className="font-mono">last_seen_at</span> do dispositivo a cada chamada</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
