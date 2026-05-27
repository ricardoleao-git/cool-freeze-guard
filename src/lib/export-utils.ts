import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type Column = { header: string; key: string; width?: number };

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",;\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function downloadCsv(filename: string, columns: Column[], rows: Record<string, unknown>[]) {
  const header = columns.map(c => csvEscape(c.header)).join(";");
  const body = rows.map(r => columns.map(c => csvEscape(r[c.key])).join(";")).join("\n");
  const blob = new Blob(["\ufeff" + header + "\n" + body], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, filename.endsWith(".csv") ? filename : `${filename}.csv`);
}

export type PdfMeta = {
  title: string;
  subtitle?: string;
  tenantName?: string;
  scopeLabel?: string;
  period?: string;
};

export function downloadPdf(
  filename: string,
  meta: PdfMeta,
  columns: Column[],
  rows: Record<string, unknown>[],
) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header band
  doc.setFillColor(14, 165, 233);
  doc.rect(0, 0, pageWidth, 56, "F");
  doc.setTextColor(255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("FrioSafe — Controle Térmico", 40, 24);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(meta.title, 40, 42);
  if (meta.tenantName) {
    doc.text(meta.tenantName, pageWidth - 40, 24, { align: "right" });
  }
  doc.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, pageWidth - 40, 42, { align: "right" });

  // Sub-info
  doc.setTextColor(40);
  let y = 78;
  doc.setFontSize(10);
  if (meta.subtitle) { doc.text(meta.subtitle, 40, y); y += 14; }
  if (meta.scopeLabel) { doc.text(`Escopo: ${meta.scopeLabel}`, 40, y); y += 14; }
  if (meta.period) { doc.text(`Período: ${meta.period}`, 40, y); y += 14; }
  doc.text(`Registros: ${rows.length}`, 40, y); y += 8;

  autoTable(doc, {
    startY: y + 8,
    head: [columns.map(c => c.header)],
    body: rows.map(r => columns.map(c => {
      const v = r[c.key];
      return v === null || v === undefined ? "" : String(v);
    })),
    styles: { fontSize: 9, cellPadding: 5, overflow: "linebreak" },
    headStyles: { fillColor: [14, 165, 233], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 249, 252] },
    columnStyles: Object.fromEntries(columns.map((c, i) => [i, c.width ? { cellWidth: c.width } : {}])),
    didDrawPage: (data) => {
      const page = doc.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(
        `FrioSafe · Documento gerado automaticamente · Página ${page}`,
        pageWidth / 2,
        doc.internal.pageSize.getHeight() - 16,
        { align: "center" },
      );
    },
    margin: { left: 40, right: 40, bottom: 40 },
  });

  doc.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function fmtDate(ts: number | null | undefined) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("pt-BR");
}

export function fmtMinutes(min: number | null | undefined) {
  if (min === null || min === undefined) return "—";
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h > 0 ? `${h}h ${r}min` : `${r} min`;
}
