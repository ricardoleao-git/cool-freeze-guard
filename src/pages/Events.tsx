import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { useTenantScoped } from "@/lib/demo-store";
import { Activity, Download, Pencil, Cpu, Hand } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { toast } from "sonner";
import { EventCorrectionDialog } from "@/components/EventCorrectionDialog";
import type { AccessEvent } from "@/lib/demo-data";
import { Link } from "react-router-dom";

export default function Events() {
  const { events, employees, coldAreas, devices } = useTenantScoped();
  const [editEvent, setEditEvent] = useState<AccessEvent | null>(null);
  return (
    <div className="container py-6 md:py-8">
      <PageHeader
        eyebrow="Operação"
        title="Eventos de Acesso"
        description="Histórico recente de entradas e saídas captadas por leitores faciais e simulações."
        icon={<Activity className="h-5 w-5" />}
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline"><Link to="/ajustes"><Pencil className="h-4 w-4 mr-2" /> Correções & Inconsistências</Link></Button>
            <Button variant="outline" onClick={() => toast.info("Exportação CSV simulada — pronto para integração real.")}><Download className="h-4 w-4 mr-2" /> Exportar CSV</Button>
          </div>
        }
      />
      <div className="glass-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Horário</TableHead>
              <TableHead>Colaborador</TableHead>
              <TableHead>Ambiente</TableHead>
              <TableHead>Dispositivo / Origem</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Confiança</TableHead>
              <TableHead className="w-24"></TableHead>
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
              const isManual = !dev || ev.source === "manual";
              return (
                <TableRow key={ev.id}>
                  <TableCell className="font-mono text-xs">{format(new Date(ev.occurred_at), "dd/MM HH:mm:ss")}</TableCell>
                  <TableCell>{emp?.name}</TableCell>
                  <TableCell className="text-sm">{area?.name}</TableCell>
                  <TableCell className="text-xs">
                    <div className="flex items-center gap-1.5">
                      {isManual ? <Hand className="h-3 w-3 text-status-yellow" /> : <Cpu className="h-3 w-3 text-status-ok" />}
                      <span className={isManual ? "text-status-yellow font-medium" : "text-muted-foreground"}>
                        {dev?.name || "Manual"}
                      </span>
                      <Badge variant="outline" className="ml-1 text-[9px] py-0 px-1">{ev.source}</Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={ev.event_type === "entry" ? "border-status-ok/50 text-status-ok" : "border-status-break/50 text-status-break"}>
                      {ev.event_type === "entry" ? "ENTRADA" : "SAÍDA"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{(ev.confidence_score * 100).toFixed(1)}%</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditEvent(ev)} title="Solicitar correção com justificativa">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <EventCorrectionDialog
        event={editEvent}
        open={!!editEvent}
        onOpenChange={(o) => !o && setEditEvent(null)}
      />
    </div>
  );
}
