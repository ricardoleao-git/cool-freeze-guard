import { PageHeader } from "@/components/PageHeader";
import { useTenantScoped, useDemo } from "@/lib/demo-store";
import { Users, LogIn, LogOut, Play, Pause, AlertTriangle, ShieldAlert, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { STATUS_LABEL, STATUS_COLOR } from "@/lib/demo-data";
import { toast } from "sonner";

export default function Employees() {
  const { employees, units, departments } = useTenantScoped();
  const { simulateEntry, simulateExit, forceStatus } = useDemo();
  const [q, setQ] = useState("");

  const filtered = employees.filter(e => e.name.toLowerCase().includes(q.toLowerCase()) || e.registration_number.includes(q));

  return (
    <div className="container py-6 md:py-8">
      <PageHeader
        eyebrow="Cadastros"
        title="Colaboradores"
        description="Lista de colaboradores do tenant ativo com status atual de exposição e ações de simulação para apresentação."
        icon={<Users className="h-5 w-5" />}
        actions={<Input placeholder="Buscar por nome ou matrícula…" value={q} onChange={e => setQ(e.target.value)} className="w-[260px]" />}
      />

      <div className="glass-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Colaborador</TableHead>
              <TableHead>Unidade / Setor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Exposição</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(e => {
              const u = units.find(x => x.id === e.unit_id);
              const d = departments.find(x => x.id === e.department_id);
              return (
                <TableRow key={e.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <img src={e.avatar} alt={e.name} className="h-9 w-9 rounded-full ring-1 ring-border" />
                      <div>
                        <div className="font-medium">{e.name}</div>
                        <div className="text-xs text-muted-foreground">#{e.registration_number} · {e.position}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div>{u?.name}</div>
                    <div className="text-xs text-muted-foreground">{d?.name}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="gap-1.5">
                      <span className={`status-dot ${STATUS_COLOR[e.current_status]}`} />
                      {STATUS_LABEL[e.current_status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{e.accumulated_minutes.toFixed(0)} min</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1.5 flex-wrap">
                      <Button size="sm" variant="outline" onClick={() => { simulateEntry(e.id); toast.success(`Entrada simulada: ${e.name}`); }}><LogIn className="h-3.5 w-3.5 mr-1" /> Entrada</Button>
                      <Button size="sm" variant="outline" onClick={() => { simulateExit(e.id); toast.success(`Saída simulada: ${e.name}`); }}><LogOut className="h-3.5 w-3.5 mr-1" /> Saída</Button>
                      <Button size="sm" variant="ghost" className="text-status-yellow" onClick={() => forceStatus(e.id, "yellow")}><AlertTriangle className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" className="text-status-orange" onClick={() => forceStatus(e.id, "orange")}><AlertTriangle className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" className="text-status-red" onClick={() => forceStatus(e.id, "blocked")}><ShieldAlert className="h-3.5 w-3.5" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
