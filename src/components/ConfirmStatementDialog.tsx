import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ShieldCheck } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tenantId: string;
  employeeId: string;
  employeeName: string;
  referenceDate: string;
  contentHash: string;
  contentSnapshot: any;
  onConfirmed: () => void;
  onStatementChanged: () => void;
}

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
};

export function ConfirmStatementDialog(p: Props) {
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const clickwrap = `Declaro que revisei e reconheço os registros de exposição ao frio e pausas do dia ${fmtDate(p.referenceDate)}, conforme apresentado nesta tela.`;

  const submit = async () => {
    if (!/^\d{4,8}$/.test(pin)) { toast.error("PIN deve ter 4 a 8 dígitos"); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("employee-confirm-statement", {
        body: {
          tenant_id: p.tenantId, employee_id: p.employeeId, reference_date: p.referenceDate,
          pin, clickwrap_text: clickwrap, content_hash: p.contentHash, content_snapshot: p.contentSnapshot,
        },
      });
      const payload = (data ?? {}) as any;
      if (error || payload?.error) {
        const code = payload?.error ?? (error as any)?.message ?? "server_error";
        if (code === "invalid_pin") {
          toast.error(`PIN incorreto. Tentativas restantes: ${payload?.attempts_remaining ?? "—"}`);
        } else if (code === "pin_locked") {
          const until = payload?.locked_until ? new Date(payload.locked_until).toLocaleTimeString("pt-BR") : "—";
          toast.error(`Muitas tentativas. Bloqueado até ${until}`);
        } else if (code === "pin_not_set") {
          toast.error("PIN ainda não cadastrado. Procure seu gestor.");
        } else if (code === "statement_changed") {
          toast.message("O extrato mudou. Recarregando…");
          setPin(""); p.onOpenChange(false); p.onStatementChanged();
        } else {
          toast.error("Falha na confirmação: " + code);
        }
        return;
      }
      toast.success("Extrato confirmado");
      setPin(""); p.onOpenChange(false); p.onConfirmed();
    } catch (e: any) {
      toast.error("Falha na confirmação: " + (e?.message || "tente novamente"));
    } finally { setLoading(false); }
  };

  return (
    <Dialog open={p.open} onOpenChange={(o) => { if (!o) setPin(""); p.onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" /> Confirmar meu extrato
          </DialogTitle>
          <DialogDescription>
            Esta confirmação é registrada em trilha imutável, com selo de integridade encadeado por colaborador.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md border bg-muted/30 p-3 text-sm leading-relaxed">
            {clickwrap}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conf-pin">Digite seu PIN pessoal</Label>
            <Input id="conf-pin" type="password" inputMode="numeric" maxLength={8} autoFocus
              value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
            <p className="text-xs text-muted-foreground">{p.employeeName}</p>
          </div>
          <p className="text-xs text-muted-foreground font-mono break-all">
            Hash do extrato: {p.contentHash.slice(0, 16)}…
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => p.onOpenChange(false)} disabled={loading}>Cancelar</Button>
          <Button onClick={submit} disabled={loading || !pin}>{loading ? "Confirmando…" : "Confirmar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
