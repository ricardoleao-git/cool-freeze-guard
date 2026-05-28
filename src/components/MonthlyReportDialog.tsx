import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { FileText, Shield, Download, Upload, BadgeCheck, FileSignature } from "lucide-react";
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

async function sha256Bytes(bytes: ArrayBuffer) {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function monthRange(year: number, month: number) {
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0).getTime();
  const end = new Date(year, month, 1, 0, 0, 0, 0).getTime();
  return { start, end };
}

type CreatedSignature = {
  id: string;
  filename: string;
  contentHash: string;
};

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

  // ICP step
  const [created, setCreated] = useState<CreatedSignature | null>(null);
  const [icpFile, setIcpFile] = useState<File | null>(null);
  const [icpSignerName, setIcpSignerName] = useState("");
  const [icpSignerCpf, setIcpSignerCpf] = useState("");
  const [icpIssuer, setIcpIssuer] = useState("");
  const [icpValidUntil, setIcpValidUntil] = useState("");
  const [icpNotes, setIcpNotes] = useState("");
  const [icpBusy, setIcpBusy] = useState(false);

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

  const resetAll = () => {
    setCreated(null);
    setIcpFile(null);
    setIcpSignerName("");
    setIcpSignerCpf("");
    setIcpIssuer("");
    setIcpValidUntil("");
    setIcpNotes("");
    setAccepted(false);
  };

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

      const { data: inserted, error } = await supabase.from("monthly_report_signatures").insert({
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
        signature_type: "clickwrap",
        user_agent: navigator.userAgent,
        totals,
        pdf_filename: filename,
        signed_at: signedAt.toISOString(),
      }).select("id").single();
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
      doc.text(`Protocolo: ${inserted.id}`, M, 110);

      autoTable(doc, {
        startY: 130,
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
          ["Protocolo", inserted.id],
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

      // ICP signature instructions block
      const afterAudit = (doc as any).lastAutoTable.finalY + 18;
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text("Assinatura digital ICP-Brasil (opcional)", M, afterAudit);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      const icpText = `Para assinar com certificado ICP-Brasil (e-CPF A1/A3 ou e-CNPJ), aplique a assinatura PAdES neste PDF usando um assinador homologado (ex.: Assinador SERPRO, Adobe Acrobat, BRy, ITI), preservando o hash do conteúdo: ${contentHash}. Em seguida, anexe o PDF assinado nesta tela para vincular a evidência ao protocolo ${inserted.id} na trilha de auditoria. A validade jurídica segue a MP 2.200-2/2001.`;
      const wrappedIcp = doc.splitTextToSize(icpText, W - M * 2);
      doc.text(wrappedIcp, M, afterAudit + 12);

      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(120);
        doc.text(
          `${employee.name} · ${monthLabel} · página ${i}/${pageCount} · hash ${contentHash.slice(0, 16)}… · ${inserted.id.slice(0, 8)}`,
          M,
          doc.internal.pageSize.getHeight() - 20,
        );
      }

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

      setCreated({ id: inserted.id, filename, contentHash });
      setIcpSignerName(signerName.trim());
      toast.success("Relatório assinado eletronicamente e baixado. Você pode anexar a assinatura ICP-Brasil abaixo (opcional).");
    } catch (e: any) {
      toast.error("Falha ao assinar: " + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const attachIcpSignature = async () => {
    if (!created) return;
    if (!icpFile) { toast.error("Selecione o PDF assinado com ICP-Brasil."); return; }
    if (icpFile.type !== "application/pdf" && !icpFile.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Envie um arquivo PDF assinado (.pdf com PAdES).");
      return;
    }
    if (!icpSignerName.trim()) { toast.error("Informe o nome do signatário ICP."); return; }
    setIcpBusy(true);
    try {
      const bytes = await icpFile.arrayBuffer();
      const fileHash = await sha256Bytes(bytes);
      const path = `${activeTenantId}/${employee.id}/${created.id}_${Date.now()}_${icpFile.name.replace(/[^\w.-]+/g, "_")}`;

      const { error: upErr } = await supabase.storage
        .from("monthly-report-signatures")
        .upload(path, icpFile, { contentType: "application/pdf", upsert: false });
      if (upErr) throw upErr;

      const validUntilIso = icpValidUntil ? new Date(icpValidUntil).toISOString() : null;
      const { error: updErr } = await supabase.from("monthly_report_signatures").update({
        signature_type: "icp_brasil",
        signature_method: "icp_brasil_pades",
        icp_signed_file_path: path,
        icp_signed_file_hash: fileHash,
        icp_signed_file_size: icpFile.size,
        icp_signer_name: icpSignerName.trim(),
        icp_signer_cpf: icpSignerCpf.trim() || null,
        icp_certificate_issuer: icpIssuer.trim() || null,
        icp_certificate_valid_until: validUntilIso,
        icp_signed_at: new Date().toISOString(),
        icp_notes: icpNotes.trim() || null,
      }).eq("id", created.id);
      if (updErr) throw updErr;

      toast.success("Assinatura ICP-Brasil anexada à trilha auditável.");
      resetAll();
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Falha ao anexar assinatura ICP: " + (e?.message || e));
    } finally {
      setIcpBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) resetAll(); onOpenChange(o); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Relatório mensal — {employee.name}</DialogTitle>
          <DialogDescription>
            Revise os dados, gere o PDF assinado por clickwrap (com hash) e, opcionalmente, anexe a assinatura digital ICP-Brasil para reforço jurídico.
          </DialogDescription>
        </DialogHeader>

        {!created && (
          <>
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
          </>
        )}

        {created && (
          <>
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm space-y-1">
              <div className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-300">
                <BadgeCheck className="h-4 w-4" /> Clickwrap registrado
              </div>
              <div className="text-xs text-muted-foreground break-all">
                Protocolo: <code>{created.id}</code><br />
                Hash do conteúdo: <code>{created.contentHash}</code><br />
                Arquivo gerado: <code>{created.filename}</code>
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <div>
                <div className="flex items-center gap-2 font-medium">
                  <FileSignature className="h-4 w-4 text-primary" /> Assinatura digital ICP-Brasil (opcional)
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Assine o PDF gerado com seu certificado ICP-Brasil (e-CPF A1/A3) em um assinador homologado (PAdES) e envie aqui. O arquivo é
                  armazenado em bucket privado com hash SHA-256 e vinculado ao protocolo na trilha de auditoria.
                </p>
              </div>

              <div className="grid gap-1.5">
                <Label>PDF assinado (.pdf PAdES)</Label>
                <Input type="file" accept="application/pdf,.pdf" onChange={(e) => setIcpFile(e.target.files?.[0] || null)} />
                {icpFile && (
                  <div className="text-[11px] text-muted-foreground">
                    {icpFile.name} · {(icpFile.size / 1024).toFixed(1)} KB
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>Nome do titular do certificado</Label>
                  <Input value={icpSignerName} onChange={(e) => setIcpSignerName(e.target.value)} placeholder="Nome no certificado" />
                </div>
                <div className="grid gap-1.5">
                  <Label>CPF do titular (opcional)</Label>
                  <Input value={icpSignerCpf} onChange={(e) => setIcpSignerCpf(e.target.value)} placeholder="000.000.000-00" />
                </div>
                <div className="grid gap-1.5">
                  <Label>Autoridade certificadora (opcional)</Label>
                  <Input value={icpIssuer} onChange={(e) => setIcpIssuer(e.target.value)} placeholder="Ex.: AC SERPRO, AC Certisign…" />
                </div>
                <div className="grid gap-1.5">
                  <Label>Validade do certificado (opcional)</Label>
                  <Input type="date" value={icpValidUntil} onChange={(e) => setIcpValidUntil(e.target.value)} />
                </div>
              </div>

              <div className="grid gap-1.5">
                <Label>Observações (opcional)</Label>
                <Input value={icpNotes} onChange={(e) => setIcpNotes(e.target.value)} placeholder="Ex.: assinador utilizado, política PAdES, etc." />
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { resetAll(); onOpenChange(false); }} disabled={icpBusy}>
                Concluir sem ICP
              </Button>
              <Button onClick={attachIcpSignature} disabled={icpBusy || !icpFile}>
                <Upload className="h-4 w-4 mr-1" /> {icpBusy ? "Enviando…" : "Anexar assinatura ICP"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
