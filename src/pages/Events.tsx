import { PageHeader } from "@/components/PageHeader";
import { useTenantScoped } from "@/lib/demo-store";
import { Activity, Download } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { toast } from "sonner";

export default function Events() {
  const { events, employees, coldAreas, devices } = useTenantScoped();
  return (
    <div className="container py-6 md:py-8">
      <PageHeader
        eyebrow="Operação"
        title="Eventos de Acesso"
        description="Histórico recente de entradas e saídas captadas por leitores faciais e simulações."
        icon={<Activity className="h-5 w-5" />}
        actions={<Button variant="outline" onClick={() => toast.info("Exportação CSV simulada — pronto para integração real.")}><Download className="h-4 w-4 mr-2" /> Exportar CSV</Button>}
      />
      <div className="glass-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Horário</TableHead>
              <TableHead>Colaborador</TableHead>
              <TableHead>Ambiente</TableHead>
              <TableHead>Dispositivo</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead className="text-right">Confiança</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-10">Nenhum evento registrado ainda. Use o Modo Demonstração para simular.</TableCell></TableRow>
            )}
            {events.map(ev => {
              const emp = employees.find(e => e.id === ev.employee_id);
              const area = coldAreas.find(a => a.id === ev.cold_area_id);
              const dev = devices.find(d => d.id === ev.device_id);
              return (
                <TableRow key={ev.id}>
                  <TableCell className="font-mono text-xs">{format(new Date(ev.occurred_at), "dd/MM HH:mm:ss")}</TableCell>
                  <TableCell>{emp?.name}</TableCell>
                  <TableCell className="text-sm">{area?.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{dev?.name || "Manual"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={ev.event_type === "entry" ? "border-status-ok/50 text-status-ok" : "border-status-break/50 text-status-break"}>
                      {ev.event_type === "entry" ? "ENTRADA" : "SAÍDA"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{ev.source}</TableCell>
                  <TableCell className="text-right tabular-nums">{(ev.confidence_score * 100).toFixed(1)}%</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
