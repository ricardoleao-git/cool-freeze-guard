import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, UserCheck, AlertTriangle, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Props { tenantId: string; longSessionMinutes: number }
type Row = { id: string; name: string; inside_since: string; current_area_id: string | null; area_name?: string };

export default function GuardiaPresenceTab({ tenantId, longSessionMinutes }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const load = async () => {
    setLoading(true);
    const { data: emps } = await supabase
      .from("employees")
      .select("id, name, inside_since, current_area_id")
      .eq("tenant_id", tenantId)
      .eq("current_status", "inside")
      .not("inside_since", "is", null)
      .order("inside_since", { ascending: true });
    const list = (emps ?? []) as Row[];
    const ids = Array.from(new Set(list.map(r => r.current_area_id).filter(Boolean) as string[]));
    if (ids.length) {
      const { data: areas } = await supabase.from("cold_areas").select("id, name").in("id", ids);
      const m = new Map((areas ?? []).map(a => [a.id, a.name]));
      list.forEach(r => { r.area_name = r.current_area_id ? (m.get(r.current_area_id) ?? r.current_area_id) : undefined; });
    }
    setRows(list);
    setLoading(false);
  };

  useEffect(() => { if (tenantId) load(); /* eslint-disable-next-line */ }, [tenantId]);
  useEffect(() => {
    const i = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(i);
  }, []);

  const now = Date.now() + tick * 0; // tick triggers re-render
  const enriched = useMemo(() => rows.map(r => {
    const mins = (Date.now() - new Date(r.inside_since).getTime()) / 60000;
    return { ...r, minutes: Math.max(0, mins), long: mins >= longSessionMinutes };
  }), [rows, tick, longSessionMinutes, now]);

  const longCount = enriched.filter(r => r.long).length;

  return (
    <Card className="glass-card">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="font-display flex items-center gap-2">
          <UserCheck className="h-4 w-4 text-primary" /> Presença agora
        </CardTitle>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="gap-1 border-primary/40 text-primary">
            <Users className="h-3 w-3" /> {enriched.length} dentro
          </Badge>
          {longCount > 0 && (
            <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-500">
              <AlertTriangle className="h-3 w-3" /> {longCount} sessão longa
            </Badge>
          )}
          <Button size="sm" variant="outline" onClick={load}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {!loading && enriched.length === 0 && (
          <div className="text-center py-10 text-sm text-muted-foreground">
            Ninguém dentro das câmaras neste momento. 🎉
          </div>
        )}
        {!loading && enriched.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {enriched.map(r => {
              const tone = r.minutes >= longSessionMinutes
                ? "border-red-500/40 bg-red-500/5"
                : r.minutes >= longSessionMinutes * 0.75
                  ? "border-amber-500/40 bg-amber-500/5"
                  : "border-border";
              return (
                <div key={r.id} className={`rounded-lg border ${tone} p-3 space-y-1.5`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-sm">{r.name}</div>
                    <Badge variant="outline" className="tabular-nums">{r.minutes.toFixed(0)} min</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">{r.area_name ?? "—"}</div>
                  <div className="text-[11px] text-muted-foreground tabular-nums">
                    desde {new Date(r.inside_since).toLocaleTimeString("pt-BR")}
                  </div>
                  {r.long && (
                    <div className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> possível leitura externa perdida — revisar
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
