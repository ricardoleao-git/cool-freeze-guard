import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Props { tenantId: string }

type Result = {
  ok: boolean;
  total_events: number;
  total_employees: number;
  validation_status_counts: Record<string, number>;
  breaks: Array<{ employee_id: string; event_id: string; occurred_at: string; reason: string; expected_previous_hash: string | null; actual_previous_hash: string | null }>;
  verified_at: string;
};

export default function GuardiaIntegrityTab({ tenantId }: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const verify = async () => {
    setLoading(true);
    setResult(null);
    const { data, error } = await supabase.functions.invoke("guardia-verify-chain", { body: { tenant_id: tenantId } });
    setLoading(false);
    if (error) { toast.error(error.message || "Falha na verificação"); return; }
    setResult(data as Result);
    if ((data as Result).ok) toast.success("Cadeia íntegra");
    else toast.error(`${(data as Result).breaks.length} quebra(s) detectada(s)`);
  };

  return (
    <div className="space-y-4">
      <Card className="glass-card">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="font-display flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" /> Integridade da trilha forense
          </CardTitle>
          <Button size="sm" onClick={verify} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-1.5" />}
            {loading ? "Verificando…" : "Verificar integridade da cadeia"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Cada evento é selado com hash SHA-256 encadeado ao anterior. Qualquer alteração ou exclusão quebra a cadeia e é detectada aqui.
            Os registros são imutáveis no banco de dados (UPDATE e DELETE bloqueados).
          </p>

          {result && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Eventos verificados" value={result.total_events.toLocaleString("pt-BR")} />
                <Stat label="Colaboradores" value={result.total_employees.toLocaleString("pt-BR")} />
                <Stat label="Quebras" value={result.breaks.length.toString()} danger={result.breaks.length > 0} />
                <Stat label="Verificado em" value={new Date(result.verified_at).toLocaleString("pt-BR")} small />
              </div>

              {result.ok ? (
                <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4 flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-emerald-500" />
                  <div>
                    <div className="font-medium text-emerald-600 dark:text-emerald-400">Cadeia íntegra</div>
                    <div className="text-xs text-muted-foreground">Todos os encadeamentos previous_hash → record_hash estão consistentes.</div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-5 w-5 text-red-500" />
                    <div className="font-medium text-red-600 dark:text-red-400">
                      {result.breaks.length} quebra(s) detectada(s)
                    </div>
                  </div>
                  <div className="rounded border border-border bg-background/40 max-h-80 overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground">
                        <tr className="text-left">
                          <th className="px-2 py-1.5">Colaborador</th>
                          <th className="px-2 py-1.5">Evento</th>
                          <th className="px-2 py-1.5">Quando</th>
                          <th className="px-2 py-1.5">Motivo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.breaks.map(b => (
                          <tr key={b.event_id} className="border-t border-border">
                            <td className="px-2 py-1.5 font-mono">{b.employee_id}</td>
                            <td className="px-2 py-1.5 font-mono">{b.event_id.slice(0, 8)}…</td>
                            <td className="px-2 py-1.5 tabular-nums">{new Date(b.occurred_at).toLocaleString("pt-BR")}</td>
                            <td className="px-2 py-1.5"><Badge variant="outline" className="border-red-500/40 text-red-500">{b.reason}</Badge></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div>
                <div className="text-xs text-muted-foreground mb-2">Eventos por status de validação:</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(result.validation_status_counts).map(([k, v]) => (
                    <Badge key={k} variant="outline">{k}: <span className="tabular-nums ml-1">{v}</span></Badge>
                  ))}
                  {Object.keys(result.validation_status_counts).length === 0 && (
                    <span className="text-xs text-muted-foreground italic">sem eventos</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, danger, small }: { label: string; value: string; danger?: boolean; small?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${danger ? "border-red-500/40 bg-red-500/5" : "border-border bg-background/40"}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`${small ? "text-sm" : "text-xl"} font-display tabular-nums ${danger ? "text-red-500" : ""}`}>{value}</div>
    </div>
  );
}
