import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, ExternalLink, FileText, Loader2, AlertCircle } from "lucide-react";
import { useDemo } from "@/lib/demo-store";
import type { OccurrenceAttachment } from "@/lib/demo-data";

interface Props {
  attachment: OccurrenceAttachment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Kind = "image" | "pdf" | "video" | "audio" | "text" | "other";

const detectKind = (mime: string, name: string): Kind => {
  const m = (mime || "").toLowerCase();
  const ext = name.toLowerCase().split(".").pop() || "";
  if (m.startsWith("image/")) return "image";
  if (m === "application/pdf" || ext === "pdf") return "pdf";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("text/") || ["txt", "csv", "log", "md", "json", "xml"].includes(ext)) return "text";
  return "other";
};

export function AttachmentPreviewDialog({ attachment, open, onOpenChange }: Props) {
  const { getAttachmentDownloadUrl } = useDemo();
  const [inlineUrl, setInlineUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kind = attachment ? detectKind(attachment.mime, attachment.name) : "other";

  useEffect(() => {
    if (!open || !attachment) {
      setInlineUrl(null); setTextContent(null); setError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null); setTextContent(null);
      try {
        const url = await getAttachmentDownloadUrl(attachment.storage_path!);
        if (cancelled) return;
        setInlineUrl(url);
        if (kind === "text") {
          const res = await fetch(url);
          const txt = await res.text();
          if (!cancelled) setTextContent(txt.slice(0, 200_000));
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Falha ao carregar pré-visualização");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, attachment, kind, getAttachmentDownloadUrl]);

  const handleDownload = async () => {
    if (!attachment) return;
    const url = await getAttachmentDownloadUrl(attachment.storage_path!, attachment.name);
    const a = document.createElement("a");
    a.href = url; a.download = attachment.name; a.click();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 py-3 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="truncate">{attachment?.name ?? "Anexo"}</span>
          </DialogTitle>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{attachment?.mime || "arquivo"}</span>
            {attachment && <span>· {(attachment.size / 1024).toFixed(0)} KB</span>}
            <div className="ml-auto flex items-center gap-1">
              {inlineUrl && (
                <Button asChild size="sm" variant="ghost" className="h-7">
                  <a href={inlineUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-3.5 w-3.5 mr-1" /> Abrir
                  </a>
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-7" onClick={handleDownload}>
                <Download className="h-3.5 w-3.5 mr-1" /> Baixar
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-auto bg-muted/30 min-h-[50vh]">
          {loading && (
            <div className="h-full grid place-items-center p-10 text-muted-foreground">
              <div className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
            </div>
          )}
          {!loading && error && (
            <div className="h-full grid place-items-center p-10">
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" /> {error}
              </div>
            </div>
          )}
          {!loading && !error && inlineUrl && attachment && (
            <>
              {kind === "image" && (
                <div className="grid place-items-center p-4">
                  <img src={inlineUrl} alt={attachment.name} className="max-w-full max-h-[75vh] object-contain rounded" />
                </div>
              )}
              {kind === "pdf" && (
                <iframe src={inlineUrl} title={attachment.name} className="w-full h-[75vh] border-0 bg-background" />
              )}
              {kind === "video" && (
                <div className="grid place-items-center p-4">
                  <video src={inlineUrl} controls className="max-w-full max-h-[75vh]" />
                </div>
              )}
              {kind === "audio" && (
                <div className="grid place-items-center p-10">
                  <audio src={inlineUrl} controls className="w-full max-w-md" />
                </div>
              )}
              {kind === "text" && (
                <pre className="text-xs p-4 whitespace-pre-wrap break-words font-mono">{textContent ?? ""}</pre>
              )}
              {kind === "other" && (
                <div className="h-full grid place-items-center p-10 text-center">
                  <div className="space-y-3">
                    <FileText className="h-12 w-12 text-muted-foreground mx-auto" />
                    <p className="text-sm text-muted-foreground">
                      Pré-visualização não disponível para este tipo de arquivo.
                    </p>
                    <Button size="sm" onClick={handleDownload}>
                      <Download className="h-3.5 w-3.5 mr-1.5" /> Baixar arquivo
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
