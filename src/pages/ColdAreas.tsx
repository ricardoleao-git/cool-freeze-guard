import { PageHeader } from "@/components/PageHeader";
import { useTenantScoped } from "@/lib/demo-store";
import { Snowflake, Thermometer } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function ColdAreas() {
  const { coldAreas, units, departments } = useTenantScoped();
  return (
    <div className="container py-6 md:py-8">
      <PageHeader
        eyebrow="Cadastros"
        title="Ambientes Frios"
        description="Câmaras frias, açougues e depósitos refrigerados com regras de exposição parametrizáveis por ambiente."
        icon={<Snowflake className="h-5 w-5" />}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {coldAreas.map(a => {
          const u = units.find(x => x.id === a.unit_id);
          const d = departments.find(x => x.id === a.department_id);
          return (
            <Card key={a.id} className="glass-card overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="font-display text-lg">{a.name}</CardTitle>
                  <Badge variant="outline" className="border-primary/40 text-primary">{a.type}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">{u?.name} · {d?.name}</div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <Thermometer className="h-4 w-4 text-primary" />
                  Temperatura média: <span className="font-semibold tabular-nums">{a.average_temperature}°C</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border border-status-yellow/30 bg-status-yellow/10 p-2"><div className="text-status-yellow font-semibold">Amarelo</div><div>{a.warning_yellow_minutes} min</div></div>
                  <div className="rounded-lg border border-status-orange/30 bg-status-orange/10 p-2"><div className="text-status-orange font-semibold">Laranja</div><div>{a.warning_orange_minutes} min</div></div>
                  <div className="rounded-lg border border-status-red/30 bg-status-red/10 p-2"><div className="text-status-red font-semibold">Vermelho / Bloqueio</div><div>{a.exposure_limit_minutes} min</div></div>
                  <div className="rounded-lg border border-status-break/30 bg-status-break/10 p-2"><div className="text-status-break font-semibold">Pausa térmica</div><div>{a.break_minutes} min</div></div>
                </div>
                <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Modo de contagem: {a.counting_mode === "accumulated" ? "Acumulada no ciclo" : "Contínua"}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
