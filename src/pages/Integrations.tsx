import { PageHeader } from "@/components/PageHeader";
import { PlugZap, Copy, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const payload = `{
  "tenant_id": "t1",
  "device_id": "FR-CF-IN-01",
  "employee_external_id": "MAT-100023",
  "event_type": "entry",
  "timestamp": "2026-05-27T14:32:11Z",
  "confidence_score": 0.97
}`;

export default function Integrations() {
  const copy = (s: string) => { navigator.clipboard.writeText(s); toast.success("Copiado"); };
  return (
    <div className="container py-6 md:py-8">
      <PageHeader
        eyebrow="Gestão"
        title="Integrações / API"
        description="Endpoint conceitual para receber eventos de leitores faciais e sistemas externos. A arquitetura já considera integração real com qualquer fabricante via REST."
        icon={<PlugZap className="h-5 w-5" />}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="glass-card">
          <CardHeader><CardTitle className="font-display">POST /api/access-events</CardTitle></CardHeader>
          <CardContent>
            <div className="rounded-lg border border-border bg-background/60 p-3 font-mono text-xs flex items-start justify-between gap-2">
              <pre className="whitespace-pre-wrap leading-relaxed">{payload}</pre>
              <Button size="sm" variant="ghost" onClick={() => copy(payload)}><Copy className="h-4 w-4" /></Button>
            </div>
            <p className="text-sm text-muted-foreground mt-3">
              Cada dispositivo possui um <span className="font-mono">device_id</span> externo e uma API key. O colaborador é identificado por <span className="font-mono">employee_external_id</span> (matrícula ou ID do leitor facial).
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader><CardTitle className="font-display flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /> Segurança</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>Cada tenant possui sua própria chave de API. Eventos chegam isolados por <span className="font-mono">tenant_id</span> e são persistidos com confiança facial e payload bruto para auditoria.</p>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>Autenticação por <span className="font-mono">Bearer</span> token por dispositivo</li>
              <li>Rate limit e idempotência por evento</li>
              <li>Mapeamento externo de dispositivos e colaboradores</li>
              <li>Webhook reverso para status (opcional)</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
