import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { KeyRound } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tenantId: string;
  employeeId: string;
  employeeName: string;
  hasPin?: boolean;
}

export function SetEmployeePinDialog({ open, onOpenChange, tenantId, employeeId, employeeName, hasPin }: Props) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const reset = () => { setPin(""); setConfirm(""); setLoading(false); };

  const submit = async () => {
    if (!/^\d{4,8}$/.test(pin)) { toast.error("PIN deve ter 4 a 8 dígitos"); return; }
    if (pin !== confirm) { toast.error("PIN e confirmação não coincidem"); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("employee-set-pin", {
        body: { tenant_id: tenantId, employee_id: employeeId, pin },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(`PIN ${hasPin ? "redefinido" : "definido"} para ${employeeName}`);
      reset(); onOpenChange(false);
    } catch (e: any) {
      toast.error("Falha ao salvar PIN: " + (e?.message || "tente novamente"));
    } finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> {hasPin ? "Redefinir PIN" : "Definir PIN"}
          </DialogTitle>
          <DialogDescription>
            PIN pessoal de <b>{employeeName}</b>. Será usado para confirmar o extrato diário de exposição.
            Nunca armazenamos o PIN em texto.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pin">PIN (4 a 8 dígitos)</Label>
            <Input id="pin" type="password" inputMode="numeric" maxLength={8} autoComplete="new-password"
              value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pin2">Confirme o PIN</Label>
            <Input id="pin2" type="password" inputMode="numeric" maxLength={8} autoComplete="new-password"
              value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>Cancelar</Button>
          <Button onClick={submit} disabled={loading || !pin || !confirm}>{loading ? "Salvando…" : "Salvar PIN"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
