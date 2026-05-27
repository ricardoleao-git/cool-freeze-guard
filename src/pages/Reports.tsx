import { PageHeader } from "@/components/PageHeader";
import { useTenantScoped } from "@/lib/demo-store";
import { FileBarChart2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

const reports = [
  { title: "Exposição por colaborador", desc: "Tempo acumulado por ciclo, por colaborador e período." },
  { title: "Pausas térmicas realizadas", desc: "Histórico oficial de recuperação térmica, automática e manual." },
  { title: "Bloqueios preventivos", desc: "Episódios em que o sistema impediu nova entrada após 100 min." },
  { title: "Eventos de entrada e saída", desc: "Trilha completa dos leitores faciais (entrada/saída)." },
  { title: "Inconsistências / justificativas", desc: "Saídas não registradas, falhas de dispositivo e correções manuais." },
  { title: "Ranking de setores", desc: "Setores com maior exposição acumulada para ações preventivas." },
];

export default function Reports() {
  const { employees, breaks, events, alerts } = useTenantScoped();
  return (
    <div className="container py-6 md:py-8">
      <PageHeader
        eyebrow="Gestão"
        title="Relatórios e Auditoria"
        description="Evidências para SST, RH, Jurídico e Compliance. Exportação simulada em CSV/PDF disponível em todos os relatórios."
        icon={<FileBarChart2 className="h-5 w-5" />}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {reports.map(r => (
          <Card key={r.title} className="glass-card">
            <CardHeader><CardTitle className="font-display text-base">{r.title}</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">{r.desc}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => toast.info(`${r.title}: exportação CSV simulada`)}><Download className="h-4 w-4 mr-1" /> CSV</Button>
                <Button variant="outline" size="sm" onClick={() => toast.info(`${r.title}: exportação PDF simulada`)}><Download className="h-4 w-4 mr-1" /> PDF</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6 text-sm">
        <div className="glass-card p-4"><div className="text-muted-foreground text-xs uppercase">Colaboradores</div><div className="text-2xl font-display font-bold">{employees.length}</div></div>
        <div className="glass-card p-4"><div className="text-muted-foreground text-xs uppercase">Eventos</div><div className="text-2xl font-display font-bold">{events.length}</div></div>
        <div className="glass-card p-4"><div className="text-muted-foreground text-xs uppercase">Pausas</div><div className="text-2xl font-display font-bold">{breaks.length}</div></div>
        <div className="glass-card p-4"><div className="text-muted-foreground text-xs uppercase">Alertas</div><div className="text-2xl font-display font-bold">{alerts.length}</div></div>
      </div>
    </div>
  );
}
