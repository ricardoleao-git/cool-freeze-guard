import { useMemo } from "react";
import { PageHeader, StatCard } from "@/components/PageHeader";
import PageHead from "@/components/PageHead";
import { useTenantScoped } from "@/lib/demo-store";
import { Activity, AlertTriangle, Cpu, Snowflake, Timer, Users, ShieldAlert, Wifi } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, AreaChart, Area, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmployeeStatusCard } from "@/components/EmployeeStatusCard";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function Dashboard() {
  const { employees, devices, breaks, events, alerts, units } = useTenantScoped();

  const counts = useMemo(() => {
    const inside = employees.filter(e => ["inside", "yellow", "orange"].includes(e.current_status)).length;
    const yellow = employees.filter(e => e.current_status === "yellow").length;
    const orange = employees.filter(e => e.current_status === "orange").length;
    const blocked = employees.filter(e => e.current_status === "blocked" || e.current_status === "thermal_break").length;
    return { inside, yellow, orange, blocked };
  }, [employees]);

  const todayMs = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); }, []);
  const eventsToday = events.filter(e => e.occurred_at >= todayMs).length;
  const onlineDevices = devices.filter(d => d.status === "online").length;
  const offlineDevices = devices.length - onlineDevices;

  const hourly = useMemo(() => {
    const nowH = new Date().getHours();
    const buckets = Array.from({ length: 12 }, (_, i) => {
      const h = (nowH - 11 + i + 24) % 24;
      return { h: `${h}h`, hour: h, eventos: 0 };
    });
    events.forEach(e => {
      if (e.occurred_at < todayMs) return;
      const h = new Date(e.occurred_at).getHours();
      const b = buckets.find(x => x.hour === h);
      if (b) b.eventos++;
    });
    return buckets;
  }, [events, todayMs]);

  const ranking = useMemo(() => {
    const map = new Map<string, number>();
    employees.forEach(e => map.set(e.unit_id, (map.get(e.unit_id) || 0) + e.accumulated_minutes));
    return Array.from(map.entries()).map(([uid, min]) => ({ unidade: units.find(u => u.id === uid)?.name || uid, minutos: Math.round(min) }));
  }, [employees, units]);

  const watchList = employees
    .filter(e => e.current_status !== "outside")
    .sort((a, b) => b.accumulated_minutes - a.accumulated_minutes)
    .slice(0, 6);

  return (
    <div className="container py-6 md:py-8">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <span className="relative inline-flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-status-ok opacity-75 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-status-ok" />
            </span>
            Dashboard do Gestor · Ao vivo
          </span>
        }
        title="Visão geral em tempo real"
        description="Indicadores operacionais consolidados de exposição ao frio, pausas térmicas e estado dos dispositivos."
        icon={<Activity className="h-5 w-5" />}
        actions={
          <>
            <Button asChild variant="outline"><Link to="/painel-operacional">Abrir Painel Operacional</Link></Button>
            <Button asChild><Link to="/demo">Modo Experimentação</Link></Button>
          </>
        }
      />
      <PageHead
        title="Dashboard — FrioSafe"
        description="Visão geral em tempo real da exposição ao frio, pausas térmicas e estado dos dispositivos da sua operação."
      />

      <h2 className="sr-only">Indicadores gerais</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Dentro de áreas frias" value={counts.inside} hint="ativos agora" icon={<Snowflake className="h-4 w-4" />} accent="primary" />
        <StatCard label="Atenção (amarelo)" value={counts.yellow} hint="≥ 80 min de exposição" icon={<AlertTriangle className="h-4 w-4" />} accent="yellow" />
        <StatCard label="Crítico (laranja)" value={counts.orange} hint="≥ 90 min de exposição" icon={<AlertTriangle className="h-4 w-4" />} accent="orange" />
        <StatCard label="Bloqueio / Pausa" value={counts.blocked} hint="pausa térmica obrigatória" icon={<ShieldAlert className="h-4 w-4" />} accent="red" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
        <StatCard label="Pausas hoje" value={breaks.filter(b => b.started_at >= todayMs).length} icon={<Timer className="h-4 w-4" />} accent="break" />
        <StatCard label="Eventos hoje" value={eventsToday} icon={<Activity className="h-4 w-4" />} accent="primary" />
        <StatCard label="Dispositivos online" value={`${onlineDevices}/${devices.length}`} hint={`${offlineDevices} offline`} icon={<Wifi className="h-4 w-4" />} accent={offlineDevices > 0 ? "orange" : "ok"} />
        <StatCard label="Alertas abertos" value={alerts.filter(a => a.status === "open").length} icon={<AlertTriangle className="h-4 w-4" />} accent="orange" />
      </div>

      <h2 className="sr-only">Gráficos analíticos</h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
        <Card className="lg:col-span-2 glass-card">
          <CardHeader><CardTitle className="font-display">Eventos por hora</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={hourly}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis dataKey="h" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Area type="monotone" dataKey="eventos" stroke="hsl(var(--primary))" fill="url(#g1)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader><CardTitle className="font-display">Exposição por unidade</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={ranking}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis dataKey="unidade" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Bar dataKey="minutos" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
        <div className="flex items-end justify-between mb-3">
          <h2 className="font-display text-lg font-semibold">Colaboradores em observação</h2>
          <Button asChild variant="ghost" size="sm"><Link to="/painel-operacional">Ver painel completo →</Link></Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {watchList.map(e => <EmployeeStatusCard key={e.id} employee={e} />)}
          {watchList.length === 0 && <div className="text-sm text-muted-foreground glass-card p-6 col-span-full">Nenhum colaborador em áreas frias no momento.</div>}
        </div>
      </div>
    </div>
  );
}
