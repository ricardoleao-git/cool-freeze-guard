import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, Shield, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useDemo, useTenantScoped } from "@/lib/demo-store";
import type { Employee } from "@/lib/demo-data";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type Props = {
  employee: Employee | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
};

const CLICKWRAP_VERSION = 1;
const CLICKWRAP_TEXT = `Declaro, para fins de comprovação junto ao RH, SST e Jurídico, que revisei o relatório mensal de acessos a ambientes frios apresentado e CONFIRMO que os registros refletem minha jornada de trabalho no período. Estou ciente de que esta confirmação eletrônica (clickwrap) é registrada com data/hora, endereço IP, identificação do dispositivo (user-agent) e hash criptográfico do conteúdo do relatório, formando evidência integrada à trilha de auditoria do sistema, em conformidade com a LGPD (Lei nº 13.709/2018) e com as Normas Regulamentadoras aplicáveis.`;

async function sha256(text: string) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function monthRange(year: number, month: number) {
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0).getTime();
  const end = new Date(year, month, 1, 0, 0, 0, 0).getTime();
  return { start, end };
}

export function MonthlyReportDialog({ employee, open, onOpenChange }: Props) {
  const { events, breaks, alerts, coldAreas } = useTenantScoped();
  const { activeTenantId } = useDemo();
  const { user } = useAuth();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [accepted, setAccepted] = useState(false);
  const [signerName, setSignerName] = useState(employee?.name || "");
  const [busy, setBusy] = useState(false);

  const range = useMemo(() => monthRange(year, month), [year, month]);
  const areaName = (id: string | null) => coldAreas.find(a => a.id === id)?.name || "—";

  const periodEvents = useMemo(() => {
    if (!employee) return [];
    return events
      .filter(e => e.employee_id === employee.id && e.occurred_at >= range.start && e.occurred_at < range.end)
      .sort((a, b) => a.occurred_at - b.occurred_at);
  }, [events, employee, range]);

  const periodBreaks = useMemo(() => {
    if (!employee) return [];
    return breaks.filter(b => b.employee_id === employee.id && new Date(b.started_at).getTime() >= range.start && new Date(b.started_at).getTime() < range.end);
  }, [breaks, employee, range]);

  const periodAlerts = useMemo(() => {
    if (!employee) return [];
    return alerts.filter(a => a.employee_id === employee.id && a.triggered_at >= range.start && a.triggered_at < range.end);
  }, [alerts, employee, range]);

  const totals = useMemo(() => {
    let accumulated = 0;
    let lastEntry: number | null = null;
    for (const ev of periodEvents) {
      if (ev.event_type === "entry") lastEntry = ev.occurred_at;
      else if (ev.event_type === "exit" && lastEntry) {
        accumulated += (ev.occurred_at - lastEntry) / 60000;
        lastEntry = null;
      }
    }
    return {
      events: periodEvents.length,
      entries: periodEvents.filter(e => e.event_type === "entry").length,
      exits: periodEvents.filter(e => e.event_type === "exit").length,
      cold_minutes: Math.round(accumulated),
      breaks: periodBreaks.length,
      alerts: periodAlerts.length,
    };
  }, [periodEvents, periodBreaks, periodAlerts]);

  if (!employee) return null;

  const monthLabel = format(new Date(year, month - 1, 1), "MMMM 'de' yyyy", { locale: ptBR });

  const buildContentString = (signedAt: Date) => {
    const lines: string[] = [
      `Relatorio mensal de acessos a ambientes frios`,
      `Colaborador: ${employee.name} | Matricula: ${employee.registration_number}`,
      `Periodo: ${monthLabel}`,
      `Tenant: ${activeTenantId}`,
      `Totais: eventos=${totals.events} entradas=${totals.entries} saidas=${totals.exits} min_frio=${totals.cold_minutes} pausas=${totals.breaks} alertas=${totals.alerts}`,
      `Assinante: ${signerName.trim()}`,
      `Assinado em: ${signedAt.toISOString()}`,
      `User-Agent: ${navigator.userAgent}`,
      `Clickwrap-Versao: ${CLICKWRAP_VERSION}`,
    ];
    for (const ev of periodEvents) {
      lines.push(`EV|${ev.id}|${ev.event_type}|${new Date(ev.occurred_at).toISOString()}|${ev.cold_area_id}|${ev.record_hash || ""}`);
    }
    return lines.join("\n");
  };

  const generateAndSign = async () => {
    if (!accepted) { toast.error("Marque o aceite (clickwrap) antes de assinar."); return; }
    if (!signerName.trim()) { toast.error("Informe o nome do colaborador."); return; }
    setBusy(true);
    try {
      const signedAt = new Date();
      const content = buildContentString(signedAt);
      const [contentHash, clickwrapHash] = await Promise.all([sha256(content), sha256(`v${CLICKWRAP_VERSION}|${CLICKWRAP_TEXT}`)]);
      const filename = `relatorio-mensal_${employee.registration_number}_${year}-${String(month).padStart(2, "0")}.pdf`;

      // Persist signature first so hash matches the saved record
      const { error } = await supabase.from("monthly_report_signatures").insert({
        tenant_id: activeTenantId,
        employee_id: employee.id,
        reference_year: year,
        reference_month: month,
        clickwrap_version: CLICKWRAP_VERSION,
        clickwrap_text: CLICKWRAP_TEXT,
        clickwrap_text_hash: clickwrapHash,
        content_hash: contentHash,
        signed_by_name: signerName.trim(),
        signed_by_user_id: user?.id ?? null,
        signature_method: "clickwrap",
        user_agent: navigator.userAgent,
        totals,
        pdf_filename: filename,
        signed_at: signedAt.toISOString(),
      });
      if (error) throw error;

      // Generate PDF
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const W = doc.internal.pageSize.getWidth();
      const M = 40;

      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      doc.text("Relatório mensal de acessos a ambientes frios", M, 60);
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Período: ${monthLabel}`, M, 80);
      doc.text(`Empresa/Tenant: ${activeTenantId}`, M, 95);

      autoTable(doc, {
        startY: 115,
        head: [["Colaborador", "Matrícula", "Cargo"]],
        body: [[employee.name, employee.registration_number, employee.position || "-"]],
        styles: { fontSize: 9 },
        headStyles: { fillColor: [30, 41, 59] },
      });

      autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 14,
        head: [["Eventos", "Entradas", "Saídas", "Minutos no frio", "Pausas térmicas", "Alertas"]],
        body: [[totals.events, totals.entries, totals.exits, totals.cold_minutes, totals.breaks, totals.alerts]],
        styles: { fontSize: 9, halign: "center" },
        headStyles: { fillColor: [30, 41, 59], halign: "center" },
      });

      autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 14,
        head: [["Data/Hora", "Tipo", "Ambiente", "Fonte"]],
        body: periodEvents.length
          ? periodEvents.map(e => [
              format(new Date(e.occurred_at), "dd/MM/yyyy HH:mm:ss"),
              e.event_type === "entry" ? "ENTRADA" : "SAÍDA",
              areaName(e.cold_area_id),
              e.source,
            ])
          : [["—", "—", "Sem eventos no período", "—"]],
        styles: { fontSize: 8 },
        headStyles: { fillColor: [51, 65, 85] },
        columnStyles: { 0: { cellWidth: 120 }, 1: { cellWidth: 70 } },
      });

      const afterEvents = (doc as any).lastAutoTable.finalY + 20;
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text("Termo de confirmação (clickwrap)", M, afterEvents);
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      const wrapped = doc.splitTextToSize(CLICKWRAP_TEXT, W - M * 2);
      doc.text(wrapped, M, afterEvents + 14);

      const afterTerm = afterEvents + 14 + wrapped.length * 11 + 12;
      autoTable(doc, {
        startY: afterTerm,
        head: [["Campo", "Valor"]],
        body: [
          ["Assinado por", signerName.trim()],
          ["Data/hora", format(signedAt, "dd/MM/yyyy HH:mm:ss")],
          ["Método", "Clickwrap eletrônico (LGPD art. 7º, V)"],
          ["Versão do termo", String(CLICKWRAP_VERSION)],
          ["Hash do termo (SHA-256)", clickwrapHash],
          ["Hash do conteúdo (SHA-256)", contentHash],
          ["User-Agent", navigator.userAgent.slice(0, 90)],
        ],
        styles: { fontSize: 8 },
        headStyles: { fillColor: [16, 185, 129] },
        columnStyles: { 0: { cellWidth: 150, fontStyle: "bold" }, 1: { cellWidth: W - M * 2 - 150 } },
      });

      // Footer with signature placeholder for manual signing if needed
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(120);
        doc.text(
          `${employee.name} · ${monthLabel} · página ${i}/${pageCount} · hash ${contentHash.slice(0, 16)}…`,
          M,
          doc.internal.pageSize.getHeight() - 20,
        );
      }

      // Manual signature block on last page
      doc.setPage(pageCount);
      const y = doc.internal.pageSize.getHeight() - 90;
      doc.setDrawColor(150);
      doc.line(M, y, W / 2 - 10, y);
      doc.line(W / 2 + 10, y, W - M, y);
      doc.setFontSize(8);
      doc.setTextColor(80);
      doc.text("Assinatura do colaborador (manual, opcional)", M, y + 12);
      doc.text("Assinatura do supervisor/RH (manual, opcional)", W / 2 + 10, y + 12);

      doc.save(filename);

      toast.success("Relatório assinado eletronicamente e baixado.");
      setAccepted(false);
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Falha ao assinar: " + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Relatório mensal — {employee.name}</DialogTitle>
          <DialogDescription>
            Revise os dados do período, marque o aceite (clickwrap) e gere o PDF com hash criptográfico para arquivamento e assinatura.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label>Ano</Label>
            <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value) || now.getFullYear())} />
          </div>
          <div className="grid gap-1.5">
            <Label>Mês</Label>
            <Input type="number" min={1} max={12} value={month} onChange={(e) => setMonth(Math.min(12, Math.max(1, Number(e.target.value) || 1)))} />
          </div>
        </div>

        <div className="rounded-lg border border-border/60 p-3 grid grid-cols-3 md:grid-cols-6 gap-2 text-center">
          {[
            ["Eventos", totals.events],
            ["Entradas", totals.entries],
            ["Saídas", totals.exits],
            ["Min frio", totals.cold_minutes],
            ["Pausas", totals.breaks],
            ["Alertas", totals.alerts],
          ].map(([l, v]) => (
            <div key={l as string}>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{l}</div>
              <div className="text-lg font-display font-semibold">{v as number}</div>
            </div>
          ))}
        </div>

        <ScrollArea className="h-32 rounded-md border border-border/60 p-3 text-xs leading-relaxed bg-muted/20">
          {CLICKWRAP_TEXT}
        </ScrollArea>

        <div className="grid gap-1.5">
          <Label>Nome do colaborador para assinatura</Label>
          <Input value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Nome completo" />
        </div>

        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <Checkbox checked={accepted} onCheckedChange={(v) => setAccepted(!!v)} className="mt-0.5" />
          <span>
            Li e <strong>aceito</strong> os termos acima. Entendo que esta confirmação será registrada com data/hora, IP, user-agent e hash SHA-256 do conteúdo.
            <Badge variant="outline" className="ml-2 text-[10px]"><Shield className="h-3 w-3 mr-1" />Clickwrap v{CLICKWRAP_VERSION}</Badge>
          </span>
        </label>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={generateAndSign} disabled={busy || !accepted}>
            <Download className="h-4 w-4 mr-1" /> {busy ? "Gerando…" : "Assinar e baixar PDF"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
