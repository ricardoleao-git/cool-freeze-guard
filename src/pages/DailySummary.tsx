import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Stethoscope, AlertTriangle, ClipboardCheck, FileLock2, Snowflake, Activity,
  Clock, ExternalLink, FileWarning, BellRing, ShieldAlert, Sparkles, Download,
} from "lucide-react";
import { useDemo, useTenantScoped } from "@/lib/demo-store";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type Correction = {
  id: string;
  employee_id: string;
  event_id: string;
  status: string;
  reason_category: string;
  reason_detail: string;
  original_event_type: string;
  original_occurred_at: string;
  new_event_type: string | null;
  new_occurred_at: string | null;
  requested_by_name: string;
  created_at: string;
  employee_response: string | null;
};

type Renewal = {
  id: string;
  employee_id: string;
  status: string;
  consent_version: number;
  previous_version: number | null;
  created_at: string;
  acknowledged_at: string | null;
};

type Inconsistency = {
  key: string;
  employee_id: string;
  employee_name: string;
  registration_number: string;
  severity: "high" | "medium" | "low";
  type:
    | "unmatched_entry"
    | "unmatched_exit"
    | "exposure_over_limit"
    | "break_interrupted"
    | "break_incomplete"
    | "open_alert"
    | "consent_outdated"
    | "consent_missing"
    | "consent_revoked";
  title: string;
  detail: string;
  occurred_at?: number;
  evidence_link: string;
};

const SEVERITY_TONE: Record<Inconsistency["severity"], string> = {
  high: "border-status-red/40 bg-status-red/5 text-status-red",
  medium: "border-status-yellow/40 bg-status-yellow/5 text-status-yellow",
  low: "border-status-ok/30 bg-status-ok/5 text-status-ok",
};

const SEVERITY_LABEL: Record<Inconsistency["severity"], string> = {
  high: "Crítica",
  medium: "Atenção",
  low: "Informativa",
};

const REASON_LABEL: Record<string, string> = {
  esquecimento_saida: "Esquecimento de saída",
  esquecimento_entrada: "Esquecimento de entrada",
  falha_dispositivo: "Falha de dispositivo",
  leitura_duplicada: "Leitura duplicada",
  horario_incorreto: "Horário incorreto",
  tipo_incorreto: "Tipo incorreto",
  outro: "Outro",
};

function dayBounds(yyyy_mm_dd: string) {
  const [y, m, d] = yyyy_mm_dd.split("-").map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  const end = start + 24 * 3600 * 1000;
  return { start, end };
}

export default function DailySummary() {
  const { events, breaks, alerts, employees, coldAreas } = useTenantScoped();
  const { activeTenantId, getConsentStatus } = useDemo();
  const [date, setDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [renewals, setRenewals] = useState<Renewal[]>([]);
  const [loading, setLoading] = useState(false);

  const { start, end } = useMemo(() => dayBounds(date), [date]);
  const dayLabel = useMemo(
    () => format(new Date(start), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR }),
    [start],
  );
  const areaName = (id: string | null) => coldAreas.find(a => a.id === id)?.name || "—";
  const empById = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);

  const loadPendings = async () => {
    setLoading(true);
    const [{ data: corrs }, { data: rens }] = await Promise.all([
      supabase.from("access_event_corrections")
        .select("*")
        .eq("tenant_id", activeTenantId)
        .order("created_at", { ascending: false })
        .limit(300),
      supabase.from("consent_renewal_notifications")
        .select("*")
        .eq("tenant_id", activeTenantId)
        .order("created_at", { ascending: false })
        .limit(300),
    ]);
    setCorrections((corrs || []) as Correction[]);
    setRenewals((rens || []) as Renewal[]);
    setLoading(false);
  };

  useEffect(() => { loadPendings(); /* eslint-disable-next-line */ }, [activeTenantId]);

  const dayEvents = useMemo(
    () => events.filter(e => e.occurred_at >= start && e.occurred_at < end)
                .sort((a, b) => a.occurred_at - b.occurred_at),
    [events, start, end],
  );
  const dayBreaks = useMemo(
    () => breaks.filter(b => {
      const t = new Date(b.started_at).getTime();
      return t >= start && t < end;
    }),
    [breaks, start, end],
  );
  const dayAlerts = useMemo(
    () => alerts.filter(a => a.triggered_at >= start && a.triggered_at < end),
    [alerts, start, end],
  );

  // ---- Detect inconsistencies per employee for the selected day ----
  const inconsistencies = useMemo<Inconsistency[]>(() => {
    const out: Inconsistency[] = [];
    const byEmp = new Map<string, typeof dayEvents>();
    for (const ev of dayEvents) {
      if (!byEmp.has(ev.employee_id)) byEmp.set(ev.employee_id, []);
      byEmp.get(ev.employee_id)!.push(ev);
    }

    for (const [empId, evs] of byEmp.entries()) {
      const emp = empById.get(empId);
      if (!emp) continue;
      let lastEntry: typeof evs[number] | null = null;

      for (const ev of evs) {
        if (ev.event_type === "entry") {
          if (lastEntry) {
            // entry seguido de entry: saída esquecida
            out.push({
              key: `ue_${lastEntry.id}`,
              employee_id: empId,
              employee_name: emp.name,
              registration_number: emp.registration_number,
              severity: "high",
              type: "unmatched_entry",
              title: "Entrada sem saída registrada",
              detail: `Entrada em ${format(new Date(lastEntry.occurred_at), "HH:mm:ss")} (${areaName(lastEntry.cold_area_id)}) sem evento de saída antes da próxima entrada.`,
              occurred_at: lastEntry.occurred_at,
              evidence_link: "/eventos",
            });
          }
          lastEntry = ev;
        } else if (ev.event_type === "exit") {
          if (!lastEntry) {
            out.push({
              key: `ux_${ev.id}`,
              employee_id: empId,
              employee_name: emp.name,
              registration_number: emp.registration_number,
              severity: "high",
              type: "unmatched_exit",
              title: "Saída sem entrada correspondente",
              detail: `Saída em ${format(new Date(ev.occurred_at), "HH:mm:ss")} (${areaName(ev.cold_area_id)}) sem evento de entrada anterior no dia.`,
              occurred_at: ev.occurred_at,
              evidence_link: "/eventos",
            });
          } else {
            const minutes = (ev.occurred_at - lastEntry.occurred_at) / 60000;
            const area = coldAreas.find(a => a.id === lastEntry!.cold_area_id);
            const limit = area?.exposure_limit_minutes ?? 100;
            if (minutes > limit) {
              out.push({
                key: `eol_${ev.id}`,
                employee_id: empId,
                employee_name: emp.name,
                registration_number: emp.registration_number,
                severity: "high",
                type: "exposure_over_limit",
                title: `Exposição acima do limite (${Math.round(minutes)}/${limit} min)`,
                detail: `Sessão em ${areaName(lastEntry.cold_area_id)} de ${format(new Date(lastEntry.occurred_at), "HH:mm")} a ${format(new Date(ev.occurred_at), "HH:mm")} ultrapassou o limite NR-36.`,
                occurred_at: ev.occurred_at,
                evidence_link: "/pausas",
              });
            }
            lastEntry = null;
          }
        }
      }
      // entrada aberta ao final do dia
      if (lastEntry) {
        out.push({
          key: `oe_${lastEntry.id}`,
          employee_id: empId,
          employee_name: emp.name,
          registration_number: emp.registration_number,
          severity: "medium",
          type: "unmatched_entry",
          title: "Entrada em aberto ao final do dia",
          detail: `Última entrada em ${format(new Date(lastEntry.occurred_at), "HH:mm:ss")} (${areaName(lastEntry.cold_area_id)}) sem saída registrada.`,
          occurred_at: lastEntry.occurred_at,
          evidence_link: "/eventos",
        });
      }
    }

    // pausas
    for (const b of dayBreaks) {
      const emp = empById.get(b.employee_id);
      if (!emp) continue;
      if (b.interrupted) {
        out.push({
          key: `bi_${b.id}`,
          employee_id: b.employee_id,
          employee_name: emp.name,
          registration_number: emp.registration_number,
          severity: "high",
          type: "break_interrupted",
          title: "Pausa térmica interrompida",
          detail: `Pausa iniciada às ${format(new Date(b.started_at), "HH:mm")} foi interrompida${b.interruption_reason ? `: ${b.interruption_reason}` : ""}.`,
          occurred_at: new Date(b.started_at).getTime(),
          evidence_link: "/pausas",
        });
      } else if (!b.completed && !b.ended_at) {
        out.push({
          key: `bn_${b.id}`,
          employee_id: b.employee_id,
          employee_name: emp.name,
          registration_number: emp.registration_number,
          severity: "medium",
          type: "break_incomplete",
          title: "Pausa térmica em curso / não finalizada",
          detail: `Pausa iniciada às ${format(new Date(b.started_at), "HH:mm")} ainda não foi finalizada.`,
          occurred_at: new Date(b.started_at).getTime(),
          evidence_link: "/pausas",
        });
      }
    }

    // alertas abertos do dia
    for (const a of dayAlerts) {
      if (a.status !== "open") continue;
      const emp = empById.get(a.employee_id);
      if (!emp) continue;
      out.push({
        key: `al_${a.id}`,
        employee_id: a.employee_id,
        employee_name: emp.name,
        registration_number: emp.registration_number,
        severity: a.severity === "critical" ? "high" : a.severity === "warning" ? "medium" : "low",
        type: "open_alert",
        title: `Alerta aberto: ${a.alert_type}`,
        detail: a.message,
        occurred_at: a.triggered_at,
        evidence_link: "/alertas",
      });
    }

    // consentimento LGPD
    for (const emp of employees) {
      const status = getConsentStatus(emp.id);
      if (status === "outdated" || status === "missing" || status === "revoked") {
        out.push({
          key: `cs_${emp.id}_${status}`,
          employee_id: emp.id,
          employee_name: emp.name,
          registration_number: emp.registration_number,
          severity: status === "missing" || status === "revoked" ? "high" : "medium",
          type: status === "outdated" ? "consent_outdated" : status === "missing" ? "consent_missing" : "consent_revoked",
          title:
            status === "outdated" ? "Consentimento LGPD desatualizado" :
            status === "missing" ? "Consentimento LGPD ausente" :
            "Consentimento LGPD revogado",
          detail: "Capture não autorizado / requer renovação do aceite antes do próximo acesso.",
          evidence_link: "/lgpd",
        });
      }
    }

    out.sort((a, b) => {
      const w = { high: 0, medium: 1, low: 2 };
      if (w[a.severity] !== w[b.severity]) return w[a.severity] - w[b.severity];
      return (b.occurred_at || 0) - (a.occurred_at || 0);
    });

    return out;
  }, [dayEvents, dayBreaks, dayAlerts, employees, coldAreas, empById, getConsentStatus]);

  const pendingCorrections = useMemo(
    () => corrections.filter(c => ["pending", "employee_contested", "employee_accepted"].includes(c.status)),
    [corrections],
  );
  const dayCorrections = useMemo(
    () => corrections.filter(c => new Date(c.created_at).getTime() >= start && new Date(c.created_at).getTime() < end),
    [corrections, start, end],
  );
  const pendingRenewals = useMemo(
    () => renewals.filter(r => r.status === "pending" || r.status === "sent"),
    [renewals],
  );

  const grouped = useMemo(() => {
    const m = new Map<string, Inconsistency[]>();
    for (const i of inconsistencies) {
      if (!m.has(i.employee_id)) m.set(i.employee_id, []);
      m.get(i.employee_id)!.push(i);
    }
    return Array.from(m.entries()).sort((a, b) => {
      const sevW = (g: Inconsistency[]) => g.reduce((acc, x) => acc + (x.severity === "high" ? 3 : x.severity === "medium" ? 2 : 1), 0);
      return sevW(b[1]) - sevW(a[1]);
    });
  }, [inconsistencies]);

  const highCount = inconsistencies.filter(i => i.severity === "high").length;
  const medCount = inconsistencies.filter(i => i.severity === "medium").length;

  const exportCsv = () => {
    const rows: string[] = [
      "data,colaborador,matricula,severidade,tipo,titulo,detalhe",
    ];
    for (const i of inconsistencies) {
      rows.push([
        date,
        `"${i.employee_name.replace(/"/g, "'")}"`,
        i.registration_number,
        SEVERITY_LABEL[i.severity],
        i.type,
        `"${i.title.replace(/"/g, "'")}"`,
        `"${i.detail.replace(/"/g, "'")}"`,
      ].join(","));
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `resumo-diario_${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 md:p-6 space-y-5">
      <PageHeader
        title="Resumo Diário — RH / SST"
        description="Inconsistências detectadas, pendências de correção e links diretos para evidências em um único painel."
        icon={<Stethoscope className="h-5 w-5" />}
      />

      <Card>
        <CardContent className="pt-5 flex flex-col md:flex-row md:items-end gap-3 flex-wrap">
          <div className="grid gap-1.5">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Data</label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
          </div>
          <div className="flex-1 text-xs text-muted-foreground">
            <div className="capitalize">{dayLabel}</div>
            <div>Tenant: <code>{activeTenantId}</code></div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={loadPendings} disabled={loading}>
              <Sparkles className="h-3.5 w-3.5 mr-1" /> {loading ? "Atualizando…" : "Reanalisar"}
            </Button>
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={!inconsistencies.length}>
              <Download className="h-3.5 w-3.5 mr-1" /> Exportar CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Tile icon={<ShieldAlert className="h-4 w-4" />} label="Críticas" value={highCount} tone={highCount ? "danger" : "ok"} />
        <Tile icon={<AlertTriangle className="h-4 w-4" />} label="Atenção" value={medCount} tone={medCount ? "warning" : "ok"} />
        <Tile icon={<ClipboardCheck className="h-4 w-4" />} label="Correções abertas" value={pendingCorrections.length} tone={pendingCorrections.length ? "warning" : "ok"} />
        <Tile icon={<FileLock2 className="h-4 w-4" />} label="Renovações LGPD" value={pendingRenewals.length} tone={pendingRenewals.length ? "warning" : "ok"} />
        <Tile icon={<Activity className="h-4 w-4" />} label="Eventos no dia" value={dayEvents.length} tone="neutral" />
        <Tile icon={<Snowflake className="h-4 w-4" />} label="Pausas no dia" value={dayBreaks.length} tone="neutral" />
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-status-yellow" />
              Inconsistências detectadas ({inconsistencies.length})
            </CardTitle>
            <div className="text-xs text-muted-foreground">Agrupadas por colaborador</div>
          </CardHeader>
          <CardContent>
            {inconsistencies.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-10">
                Nenhuma inconsistência detectada para o dia selecionado.
              </div>
            ) : (
              <ScrollArea className="h-[520px] pr-2">
                <div className="space-y-4">
                  {grouped.map(([empId, items]) => {
                    const emp = empById.get(empId);
                    return (
                      <div key={empId} className="rounded-lg border border-border/60 p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div>
                            <div className="font-medium text-sm">{emp?.name || empId}</div>
                            <div className="text-xs text-muted-foreground">
                              Matrícula {emp?.registration_number} · {emp?.position || "—"}
                            </div>
                          </div>
                          <div className="flex gap-1.5">
                            <Button size="sm" variant="outline" asChild>
                              <Link to="/eventos"><Activity className="h-3 w-3 mr-1" />Eventos</Link>
                            </Button>
                            <Button size="sm" variant="outline" asChild>
                              <Link to="/colaboradores"><ExternalLink className="h-3 w-3 mr-1" />Ficha</Link>
                            </Button>
                          </div>
                        </div>
                        <Separator />
                        <div className="space-y-1.5">
                          {items.map(i => (
                            <div key={i.key} className={`rounded-md border p-2 ${SEVERITY_TONE[i.severity]}`}>
                              <div className="flex items-start justify-between gap-2 flex-wrap">
                                <div className="space-y-0.5">
                                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                                    {i.title}
                                    <Badge variant="outline" className="text-xs">{SEVERITY_LABEL[i.severity]}</Badge>
                                  </div>
                                  <div className="text-xs text-muted-foreground">{i.detail}</div>
                                  {i.occurred_at && (
                                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                                      <Clock className="h-3 w-3" /> {format(new Date(i.occurred_at), "dd/MM HH:mm:ss")}
                                    </div>
                                  )}
                                </div>
                                <Button size="sm" variant="ghost" asChild className="text-foreground">
                                  <Link to={i.evidence_link}>
                                    Ver evidência <ExternalLink className="h-3 w-3 ml-1" />
                                  </Link>
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4 text-status-yellow" />
                Pendências de correção ({pendingCorrections.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {pendingCorrections.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-6">Nenhuma correção em aberto.</div>
              ) : (
                <ScrollArea className="h-[240px]">
                  <div className="space-y-2">
                    {pendingCorrections.slice(0, 30).map(c => {
                      const emp = empById.get(c.employee_id);
                      return (
                        <div key={c.id} className="rounded-md border border-border/60 p-2 text-xs space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{emp?.name || c.employee_id}</span>
                            <Badge variant="outline" className="text-xs capitalize">{c.status.replace(/_/g, " ")}</Badge>
                          </div>
                          <div className="text-muted-foreground">
                            {REASON_LABEL[c.reason_category] || c.reason_category} · {format(new Date(c.created_at), "dd/MM HH:mm")}
                          </div>
                          {c.reason_detail && <div className="text-xs line-clamp-2">{c.reason_detail}</div>}
                          <div className="flex justify-end pt-1">
                            <Button size="sm" variant="ghost" asChild className="h-6 text-xs">
                              <Link to="/ajustes">Abrir <ExternalLink className="h-3 w-3 ml-1" /></Link>
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
              <div className="pt-2 text-xs text-muted-foreground">
                Criadas hoje: {dayCorrections.length} · Contestadas: {corrections.filter(c => c.status === "employee_contested").length}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileLock2 className="h-4 w-4 text-status-yellow" />
                Renovações LGPD pendentes ({pendingRenewals.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {pendingRenewals.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-6">Sem renovações pendentes.</div>
              ) : (
                <ScrollArea className="h-[200px]">
                  <div className="space-y-2">
                    {pendingRenewals.slice(0, 30).map(r => {
                      const emp = empById.get(r.employee_id);
                      return (
                        <div key={r.id} className="rounded-md border border-border/60 p-2 text-xs space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{emp?.name || r.employee_id}</span>
                            <Badge variant="outline" className="text-xs">v{r.consent_version}</Badge>
                          </div>
                          <div className="text-muted-foreground">
                            Notificado em {format(new Date(r.created_at), "dd/MM HH:mm")}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
              <div className="pt-2 flex justify-end">
                <Button size="sm" variant="outline" asChild>
                  <Link to="/lgpd"><FileLock2 className="h-3.5 w-3.5 mr-1" /> Privacidade & LGPD</Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BellRing className="h-4 w-4 text-status-red" />
                Alertas abertos do dia ({dayAlerts.filter(a => a.status === "open").length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {dayAlerts.filter(a => a.status === "open").length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-6">Sem alertas em aberto hoje.</div>
              ) : (
                <ScrollArea className="h-[180px]">
                  <div className="space-y-2">
                    {dayAlerts.filter(a => a.status === "open").slice(0, 30).map(a => {
                      const emp = empById.get(a.employee_id);
                      return (
                        <div key={a.id} className="rounded-md border border-border/60 p-2 text-xs space-y-0.5">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{emp?.name || a.employee_id}</span>
                            <Badge variant="outline" className="text-xs capitalize">{a.severity}</Badge>
                          </div>
                          <div className="text-muted-foreground line-clamp-2">{a.message}</div>
                          <div className="text-xs text-muted-foreground">{format(new Date(a.triggered_at), "dd/MM HH:mm")}</div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
              <div className="pt-2 flex justify-end">
                <Button size="sm" variant="outline" asChild>
                  <Link to="/alertas"><FileWarning className="h-3.5 w-3.5 mr-1" /> Central de alertas</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Tile({
  icon, label, value, tone,
}: { icon: React.ReactNode; label: string; value: number; tone: "ok" | "warning" | "danger" | "neutral" }) {
  const toneCls =
    tone === "warning" ? "border-status-yellow/40 bg-status-yellow/5" :
    tone === "danger" ? "border-status-red/40 bg-status-red/5" :
    tone === "ok" ? "border-status-ok/30 bg-status-ok/5" :
    "border-border bg-muted/20";
  return (
    <div className={`rounded-lg border p-3 ${toneCls}`}>
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">{icon}{label}</div>
      <div className="text-2xl font-display font-semibold mt-1">{value}</div>
    </div>
  );
}
