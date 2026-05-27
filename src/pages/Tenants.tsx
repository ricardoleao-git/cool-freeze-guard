import { PageHeader } from "@/components/PageHeader";
import { useDemo } from "@/lib/demo-store";
import { Building2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default function Tenants() {
  const { tenants, units, employees, devices } = useDemo();
  return (
    <div className="container py-6 md:py-8">
      <PageHeader
        eyebrow="Administração"
        title="Empresas (Multi-tenant)"
        description="Visão de Super Admin: todas as empresas/tenants da plataforma, com isolamento de dados garantido por design."
        icon={<Building2 className="h-5 w-5" />}
      />
      <div className="glass-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Empresa</TableHead>
              <TableHead>CNPJ</TableHead>
              <TableHead>Plano</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Unidades</TableHead>
              <TableHead className="text-right">Colaboradores</TableHead>
              <TableHead className="text-right">Dispositivos</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tenants.map(t => (
              <TableRow key={t.id}>
                <TableCell><div className="font-medium">{t.name}</div><div className="text-xs text-muted-foreground">{t.legal_name}</div></TableCell>
                <TableCell className="font-mono text-xs">{t.document_number}</TableCell>
                <TableCell><Badge variant="outline" className="border-primary/40 text-primary">{t.plan}</Badge></TableCell>
                <TableCell><Badge className="bg-status-ok/20 text-status-ok border border-status-ok/40">{t.status}</Badge></TableCell>
                <TableCell className="text-right">{units.filter(u => u.tenant_id === t.id).length}</TableCell>
                <TableCell className="text-right">{employees.filter(e => e.tenant_id === t.id).length}</TableCell>
                <TableCell className="text-right">{devices.filter(d => d.tenant_id === t.id).length}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
