import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useDemo } from "@/lib/demo-store";
import type { AccessEvent } from "@/lib/demo-data";
import { toast } from "sonner";
import { format } from "date-fns";

type Props = {
  event: AccessEvent | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated?: () => void;
};

const REASONS = [
  { value: "esquecimento_saida", label: "Esquecimento de saída" },
  { value: "esquecimento_entrada", label: "Esquecimento de entrada" },
  { value: "falha_dispositivo", label: "Falha do dispositivo / leitor" },
  { value: "leitura_duplicada", label: "Leitura duplicada / erro biométrico" },
  { value: "horario_incorreto", label: "Horário incorreto" },
  { value: "tipo_incorreto", label: "Tipo de evento incorreto" },
  { value: "outro", label: "Outro motivo (descrever)" },
];

function toLocalInput(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EventCorrectionDialog({ event, open, onOpenChange, onCreated }: Props) {
  const { user } = useAuth();
  const { activeTenantId } = useDemo();
  const [reason, setReason] = useState("esquecimento_saida");
  const [detail, setDetail] = useState("");
  const [newType, setNewType] = useState<"entry" | "exit" | "keep">("keep");
  const [newWhen, setNewWhen] = useState<string>(event ? toLocalInput(event.occurred_at) : "");
  const [saving, setSaving] = useState(false);

  if (!event) return null;

  const submit = async () => {
    if (!detail.trim()) { toast.error("Descreva a justificativa."); return; }
    setSaving(true);
    const finalType = newType === "keep" ? event.event_type : newType;
    const finalWhen = new Date(newWhen).getTime();
    const { error } = await supabase.from("access_event_corrections").insert({
      tenant_id: activeTenantId,
      event_id: event.id,
      employee_id: event.employee_id,
      original_event_type: event.event_type,
      original_occurred_at: new Date(event.occurred_at).toISOString(),
      new_event_type: finalType,
      new_occurred_at: new Date(finalWhen).toISOString(),
      reason_category: reason,
      reason_detail: detail.trim(),
      status: "pending",
      requested_by_user_id: user?.id ?? null,
      requested_by_name: user?.email ?? "gestor.demo",
    });
    setSaving(false);
    if (error) { toast.error("Não foi possível abrir a correção: " + error.message); return; }
    toast.success("Correção registrada. Colaborador será notificado para validar.");
    onOpenChange(false);
    onCreated?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Solicitar correção de evento</DialogTitle>
          <DialogDescription>
            Evento original: <span className="font-mono">{event.event_type === "entry" ? "ENTRADA" : "SAÍDA"}</span> em {format(new Date(event.occurred_at), "dd/MM/yyyy HH:mm:ss")}. O evento original permanece imutável na trilha forense; esta correção fica vinculada para auditoria.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Motivo</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {REASONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Tipo corrigido</Label>
              <Select value={newType} onValueChange={(v) => setNewType(v as "entry" | "exit" | "keep")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="keep">Manter ({event.event_type === "entry" ? "ENTRADA" : "SAÍDA"})</SelectItem>
                  <SelectItem value="entry">ENTRADA</SelectItem>
                  <SelectItem value="exit">SAÍDA</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Horário corrigido</Label>
              <Input type="datetime-local" value={newWhen} onChange={(e) => setNewWhen(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Justificativa detalhada *</Label>
            <Textarea
              rows={3}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="Descreva o que aconteceu, evidências consultadas, testemunhas, etc."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Salvando..." : "Abrir correção"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
