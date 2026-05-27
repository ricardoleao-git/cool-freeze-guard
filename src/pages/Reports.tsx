import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { useTenantScoped, useDemo } from "@/lib/demo-store";
import { FileBarChart2, Download, FileText, FileSpreadsheet, Filter, Thermometer, Timer, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Column, downloadCsv, downloadPdf, fmtDate, fmtMinutes, PdfMeta } from "@/lib/export-utils";
import { STATUS_LABEL } from "@/lib/demo-data";
import { toast } from "sonner";

type Scope = "all" | "employee" | "unit";

export default function Reports() {
  const scoped = useTenantScoped();
  const demo = useDemo();
  const { employees, breaks, events, alerts, units, departments, coldAreas } = scoped;
  const tenant = demo.tenants.find(t => t.id === demo.activeTenantId);

  const [scope, setScope] = useState<Scope>("all");
  const [employeeId, setEmployeeId] = useState<string>("");
  const [unitId, setUnitId] = useState<string>("");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  const fromTs = fromDate ? new Date(fromDate + "T00:00:00").getTime() : 0;
  const toTs = toDate ? new Date(toDate + "T23:59:59").getTime() : Number.MAX_SAFE_INTEGER;

  // Resolve scope members
  const scopedEmployees = useMemo(() => {
    if (scope === "employee" && employeeId) return employees.filter(e => e.id === employeeId);
    if (scope === "unit" && unitId) return employees.filter(e => e.unit_id === unitId);
    return employees;
  }, [scope, employeeId, unitId, employees]);
  const scopedEmployeeIds = useMemo(() => new Set(scopedEmployees.map(e => e.id)), [scopedEmployees]);

  const scopeLabel = useMemo(() => {
    if (scope === "employee") {
      const emp = employees.find(e => e.id === employeeId);
      return emp ? `Colaborador: ${emp.name} (${emp.registration_number})` : "Colaborador: —";
    }
    if (scope === "unit") {
      const u = units.find(u => u.id === unitId);
      return u ? `Unidade: ${u.name}` : "Unidade: —";
    }
    return `Todos os colaboradores (${employees.length})`;
  }, [scope, employeeId, unitId, employees, units]);

  const period = fromDate || toDate
    ? `${fromDate || "início"} → ${toDate || "hoje"}`
    : "Sem filtro de data";

  // ---- Datasets ----
  const exposureRows = useMemo(() => {
    return scopedEmployees.map(emp => {
      const unit = units.find(u => u.id === emp.unit_id);
      const dept = departments.find(d => d.id === emp.department_id);
      const area = coldAreas.find(c => c.id === emp.current_area_id);
      const empEvents = events.filter(e => e.employee_id === emp.id && e.occurred_at >= fromTs && e.occurred_at <= toTs);
      const empBreaks = breaks.filter(b => b.employee_id === emp.id && b.started_at >= fromTs && b.started_at <= toTs);
      return {
        registration_number: emp.registration_number,
        name: emp.name,
        unit: unit?.name || "—",
        department: dept?.name || "—",
        current_area: area?.name || "—",
        current_status: STATUS_LABEL[emp.current_status],
        accumulated_minutes: emp.accumulated_minutes,
        accumulated_minutes_fmt: fmtMinutes(emp.accumulated_minutes),
        events_count: empEvents.length,
        breaks_count: empBreaks.length,
        last_entry: fmtDate(emp.inside_since),
      };
    });
  }, [scopedEmployees, units, departments, coldAreas, events, breaks, fromTs, toTs]);

  const breakRows = useMemo(() => {
    return breaks
      .filter(b => scopedEmployeeIds.has(b.employee_id) && b.started_at >= fromTs && b.started_at <= toTs)
      .sort((a, b) => b.started_at - a.started_at)
      .map(b => {
        const emp = employees.find(e => e.id === b.employee_id);
        const unit = units.find(u => u.id === emp?.unit_id);
        const dur = b.ended_at ? Math.round((b.ended_at - b.started_at) / 60000) : null;
        return {
          registration_number: emp?.registration_number || "—",
          name: emp?.name || "—",
          unit: unit?.name || "—",
          started_at: fmtDate(b.started_at),
          ended_at: fmtDate(b.ended_at),
          duration: dur !== null ? fmtMinutes(dur) : "em andamento",
          source: b.source === "automatic" ? "Automática" : "Manual",
          completed: b.completed ? "Sim" : "Não",
        };
      });
  }, [breaks, scopedEmployeeIds, employees, units, fromTs, toTs]);

  const alertRows = useMemo(() => {
    return alerts
      .filter(a => scopedEmployeeIds.has(a.employee_id) && a.triggered_at >= fromTs && a.triggered_at <= toTs)
      .sort((a, b) => b.triggered_at - a.triggered_at)
      .map(a => {
        const emp = employees.find(e => e.id === a.employee_id);
        const unit = units.find(u => u.id === emp?.unit_id);
        return {
          registration_number: emp?.registration_number || "—",
          name: emp?.name || "—",
          unit: unit?.name || "—",
          triggered_at: fmtDate(a.triggered_at),
          alert_type: a.alert_type,
          severity: a.severity,
          message: a.message,
          status: a.status,
        };
      });
  }, [alerts, scopedEmployeeIds, employees, units, fromTs, toTs]);

  const eventRows = useMemo(() => {
    return events
      .filter(e => scopedEmployeeIds.has(e.employee_id) && e.occurred_at >= fromTs && e.occurred_at <= toTs)
      .sort((a, b) => b.occurred_at - a.occurred_at)
      .slice(0, 1000)
      .map(e => {
        const emp = employees.find(x => x.id === e.employee_id);
        const area = coldAreas.find(c => c.id === e.cold_area_id);
        const unit = units.find(u => u.id === e.unit_id);
        return {
          registration_number: emp?.registration_number || "—",
          name: emp?.name || "—",
          unit: unit?.name || "—",
          area: area?.name || "—",
          event_type: e.event_type === "entry" ? "Entrada" : "Saída",
          occurred_at: fmtDate(e.occurred_at),
          source: e.source,
          validation_status: e.validation_status,
          confidence: e.confidence_score.toFixed(2),
        };
      });
  }, [events, scopedEmployeeIds, employees, units, coldAreas, fromTs, toTs]);

  // ---- Report descriptors ----
  type ReportDef = {
    id: string; title: string; icon: any; desc: string;
    rows: Record<string, unknown>[]; columns: Column[];
  };
  const reportDefs: ReportDef[] = [
    {
      id: "exposure",
      title: "Histórico de exposição por colaborador",
      icon: Thermometer,
      desc: "Tempo acumulado, área atual, último ingresso e contagem de eventos por colaborador no escopo selecionado.",
      rows: exposureRows,
      columns: [
        { header: "Matrícula", key: "registration_number", width: 65 },
        { header: "Colaborador", key: "name", width: 140 },
        { header: "Unidade", key: "unit", width: 130 },
        { header: "Setor", key: "department", width: 110 },
        { header: "Área atual", key: "current_area", width: 130 },
        { header: "Status", key: "current_status", width: 110 },
        { header: "Acumulado", key: "accumulated_minutes_fmt", width: 75 },
        { header: "Eventos", key: "events_count", width: 55 },
        { header: "Pausas", key: "breaks_count", width: 55 },
        { header: "Última entrada", key: "last_entry", width: 110 },
      ],
    },
    {
      id: "breaks",
      title: "Pausas térmicas realizadas",
      icon: Timer,
      desc: "Registro oficial de pausas de recuperação térmica, automáticas e manuais, com duração e conclusão.",
      rows: breakRows,
      columns: [
        { header: "Matrícula", key: "registration_number", width: 65 },
        { header: "Colaborador", key: "name", width: 150 },
        { header: "Unidade", key: "unit", width: 140 },
        { header: "Início", key: "started_at", width: 115 },
        { header: "Fim", key: "ended_at", width: 115 },
        { header: "Duração", key: "duration", width: 80 },
        { header: "Origem", key: "source", width: 70 },
        { header: "Concluída", key: "completed", width: 70 },
      ],
    },
    {
      id: "alerts",
      title: "Alertas e ocorrências críticas",
      icon: AlertTriangle,
      desc: "Trilha de alertas: atenção (80'), crítico (90'), bloqueio (100') e demais eventos do motor de exposição.",
      rows: alertRows,
      columns: [
        { header: "Matrícula", key: "registration_number", width: 65 },
        { header: "Colaborador", key: "name", width: 140 },
        { header: "Unidade", key: "unit", width: 130 },
        { header: "Disparo", key: "triggered_at", width: 115 },
        { header: "Tipo", key: "alert_type", width: 90 },
        { header: "Severidade", key: "severity", width: 75 },
        { header: "Mensagem", key: "message", width: 230 },
        { header: "Status", key: "status", width: 80 },
      ],
    },
    {
      id: "events",
      title: "Eventos de entrada e saída",
      icon: FileText,
      desc: "Trilha completa dos leitores faciais — entradas, saídas, origem e score de confiança (até 1.000 linhas).",
      rows: eventRows,
      columns: [
        { header: "Matrícula", key: "registration_number", width: 65 },
        { header: "Colaborador", key: "name", width: 140 },
        { header: "Unidade", key: "unit", width: 120 },
        { header: "Área", key: "area", width: 130 },
        { header: "Evento", key: "event_type", width: 60 },
        { header: "Horário", key: "occurred_at", width: 115 },
        { header: "Origem", key: "source", width: 90 },
        { header: "Validação", key: "validation_status", width: 70 },
        { header: "Confiança", key: "confidence", width: 60 },
      ],
    },
  ];

  const fileBase = (id: string) => {
    const scopeSlug = scope === "employee"
      ? `colab-${employees.find(e => e.id === employeeId)?.registration_number || "x"}`
      : scope === "unit"
        ? `unidade-${units.find(u => u.id === unitId)?.name.replace(/\s+/g, "_").toLowerCase() || "x"}`
        : "todos";
    const stamp = new Date().toISOString().slice(0, 10);
    return `friosafe_${id}_${scopeSlug}_${stamp}`;
  };

  const exportCsv = (def: ReportDef) => {
    if (def.rows.length === 0) return toast.warning("Nenhum registro no escopo selecionado.");
    downloadCsv(fileBase(def.id), def.columns, def.rows);
    toast.success(`CSV gerado: ${def.title}`);
  };
  const exportPdf = (def: ReportDef) => {
    if (def.rows.length === 0) return toast.warning("Nenhum registro no escopo selecionado.");
    const meta: PdfMeta = {
      title: def.title,
      subtitle: def.desc,
      tenantName: tenant?.name,
      scopeLabel,
      period,
    };
    downloadPdf(fileBase(def.id), meta, def.columns, def.rows);
    toast.success(`PDF gerado: ${def.title}`);
  };

  const validScope = scope === "all" || (scope === "employee" && employeeId) || (scope === "unit" && unitId);

  return (
    <div className="container py-6 md:py-8">
      <PageHeader
        eyebrow="Gestão"
        title="Relatórios e Auditoria"
        description="Exporte evidências para SST, RH, Jurídico e Compliance em PDF e CSV, por colaborador, unidade ou consolidado."
        icon={<FileBarChart2 className="h-5 w-5" />}
      />

      <Card className="glass-card mb-5">
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-base flex items-center gap-2"><Filter className="h-4 w-4" /> Escopo e período</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <Label className="text-xs">Escopo</Label>
              <Select value={scope} onValueChange={(v) => { setScope(v as Scope); setEmployeeId(""); setUnitId(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os colaboradores</SelectItem>
                  <SelectItem value="employee">Por colaborador</SelectItem>
                  <SelectItem value="unit">Por unidade</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scope === "employee" && (
              <div className="lg:col-span-2">
                <Label className="text-xs">Colaborador</Label>
                <Select value={employeeId} onValueChange={setEmployeeId}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{employees.map(e => <SelectItem key={e.id} value={e.id}>{e.name} · {e.registration_number}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {scope === "unit" && (
              <div className="lg:col-span-2">
                <Label className="text-xs">Unidade</Label>
                <Select value={unitId} onValueChange={setUnitId}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{units.map(u => <SelectItem key={u.id} value={u.id}>{u.name} — {u.city}/{u.state}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label className="text-xs">De</Label>
              <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Até</Label>
              <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-3">
            {([
              { id: "today", label: "Hoje", days: 0 },
              { id: "7d", label: "Últimos 7 dias", days: 6 },
              { id: "30d", label: "Últimos 30 dias", days: 29 },
              { id: "month", label: "Mês atual", days: -1 },
              { id: "clear", label: "Limpar", days: -2 },
            ]).map(p => (
              <button
                key={p.id}
                onClick={() => {
                  if (p.days === -2) { setFromDate(""); setToDate(""); return; }
                  const to = new Date();
                  let from = new Date();
                  if (p.days === -1) from = new Date(to.getFullYear(), to.getMonth(), 1);
                  else from.setDate(to.getDate() - p.days);
                  const iso = (d: Date) => d.toISOString().slice(0, 10);
                  setFromDate(iso(from));
                  setToDate(iso(to));
                }}
                className="px-2.5 py-1 rounded-full text-[11px] uppercase tracking-wider font-medium border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3 text-xs text-muted-foreground">
            <Badge variant="outline" className="border-primary/40 text-primary">{scopeLabel}</Badge>
            <Badge variant="outline">{period}</Badge>
            {!validScope && <span className="text-status-orange">Selecione um colaborador ou unidade para continuar.</span>}
          </div>
        </CardContent>
      </Card>


      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {reportDefs.map(def => {
          const Icon = def.icon;
          const preview = def.rows.slice(0, 4);
          return (
            <Card key={def.id} className="glass-card">
              <CardHeader className="pb-3">
                <CardTitle className="font-display text-base flex items-center gap-2">
                  <Icon className="h-4 w-4 text-primary" />
                  {def.title}
                  <Badge variant="outline" className="ml-auto">{def.rows.length} reg.</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-3">{def.desc}</p>
                <div className="rounded-lg border border-border bg-card/40 overflow-hidden mb-3">
                  <div className="max-h-44 overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {def.columns.slice(0, 4).map(c => <TableHead key={c.key} className="text-[11px]">{c.header}</TableHead>)}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.length === 0 && (
                          <TableRow><TableCell colSpan={4} className="text-center text-xs text-muted-foreground py-4">Sem registros no escopo.</TableCell></TableRow>
                        )}
                        {preview.map((r, i) => (
                          <TableRow key={i}>
                            {def.columns.slice(0, 4).map(c => <TableCell key={c.key} className="text-xs py-2">{String(r[c.key] ?? "")}</TableCell>)}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={!validScope} onClick={() => exportCsv(def)}>
                    <FileSpreadsheet className="h-4 w-4 mr-1" /> CSV
                  </Button>
                  <Button size="sm" disabled={!validScope} onClick={() => exportPdf(def)}>
                    <Download className="h-4 w-4 mr-1" /> PDF
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6 text-sm">
        <div className="glass-card p-4"><div className="text-muted-foreground text-xs uppercase">Colaboradores no escopo</div><div className="text-2xl font-display font-bold">{scopedEmployees.length}</div></div>
        <div className="glass-card p-4"><div className="text-muted-foreground text-xs uppercase">Eventos</div><div className="text-2xl font-display font-bold">{eventRows.length}</div></div>
        <div className="glass-card p-4"><div className="text-muted-foreground text-xs uppercase">Pausas</div><div className="text-2xl font-display font-bold">{breakRows.length}</div></div>
        <div className="glass-card p-4"><div className="text-muted-foreground text-xs uppercase">Alertas</div><div className="text-2xl font-display font-bold">{alertRows.length}</div></div>
      </div>
    </div>
  );
}
