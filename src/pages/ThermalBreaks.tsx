import { PageHeader } from "@/components/PageHeader";
import { useTenantScoped } from "@/lib/demo-store";
import { Timer } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

export default function ThermalBreaks() {
  const { breaks, employees } = useTenantScoped();
  return (
    <div className="container py-6 md:py-8">
      <PageHeader
        eyebrow="Operação"
        title="Pausas Térmicas"
        description="Registro oficial de pausas térmicas/recuperação. Não é ponto eletrônico nem substitui intervalo intrajornada — é evidência de SST e compliance."
        icon={<Timer className="h-5 w-5" />}
      />
      <div className="glass-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Colaborador</TableHead>
              <TableHead>Início</TableHead>
              <TableHead>Fim</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {breaks.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-10">Nenhuma pausa térmica registrada ainda.</TableCell></TableRow>}
            {breaks.map(b => {
              const emp = employees.find(e => e.id === b.employee_id);
              return (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{emp?.name}</TableCell>
                  <TableCell className="font-mono text-xs">{format(new Date(b.started_at), "dd/MM HH:mm:ss")}</TableCell>
                  <TableCell className="font-mono text-xs">{b.ended_at ? format(new Date(b.ended_at), "dd/MM HH:mm:ss") : "—"}</TableCell>
                  <TableCell><Badge variant="outline">{b.source}</Badge></TableCell>
                  <TableCell>{b.completed ? <Badge className="bg-status-ok/20 text-status-ok border border-status-ok/40">Concluída</Badge> : <Badge className="bg-status-break/20 text-status-break border border-status-break/40">Em andamento</Badge>}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
