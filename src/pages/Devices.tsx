import { PageHeader } from "@/components/PageHeader";
import { useTenantScoped } from "@/lib/demo-store";
import { Cpu, LogIn, LogOut, Wifi, WifiOff } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function Devices() {
  const { devices, units, coldAreas } = useTenantScoped();
  return (
    <div className="container py-6 md:py-8">
      <PageHeader
        eyebrow="Cadastros"
        title="Dispositivos / Leitores Faciais"
        description="Cada ambiente frio deve ter um leitor facial de entrada e um de saída. Status online em tempo real."
        icon={<Cpu className="h-5 w-5" />}
      />
      <div className="glass-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dispositivo</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Unidade / Ambiente</TableHead>
              <TableHead>ID Externo</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Último evento</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {devices.map(d => {
              const u = units.find(x => x.id === d.unit_id);
              const a = coldAreas.find(x => x.id === d.cold_area_id);
              return (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={d.device_type === "entry" ? "border-status-ok/50 text-status-ok" : "border-status-break/50 text-status-break"}>
                      {d.device_type === "entry" ? <><LogIn className="h-3 w-3 mr-1" /> ENTRADA</> : <><LogOut className="h-3 w-3 mr-1" /> SAÍDA</>}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{u?.name}<div className="text-xs text-muted-foreground">{a?.name}</div></TableCell>
                  <TableCell className="font-mono text-xs">{d.external_device_id}</TableCell>
                  <TableCell>
                    {d.status === "online" ? (
                      <Badge className="bg-status-ok/20 text-status-ok border border-status-ok/40"><Wifi className="h-3 w-3 mr-1" /> Online</Badge>
                    ) : (
                      <Badge className="bg-status-red/20 text-status-red border border-status-red/40"><WifiOff className="h-3 w-3 mr-1" /> {d.status}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(d.last_seen_at), { addSuffix: true, locale: ptBR })}
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
