import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Snowflake, ShieldCheck } from "lucide-react";
import { Employee } from "@/lib/demo-data";
import { useDemo, useTenantScoped } from "@/lib/demo-store";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  employee: Employee | null;
}

export function EmployeeAreaAuthDialog({ open, onOpenChange, employee }: Props) {
  const { coldAreas, units, employeeColdAreaAuth } = useTenantScoped();
  const { setEmployeeAreaAuthorizations } = useDemo();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const tenantAreas = useMemo(() => coldAreas.filter(a => a.status === "active"), [coldAreas]);

  useEffect(() => {
    if (!employee) return;
    const ids = employeeColdAreaAuth
      .filter(a => a.employee_id === employee.id)
      .map(a => a.cold_area_id);
    setSelected(new Set(ids));
  }, [employee, employeeColdAreaAuth]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const save = async () => {
    if (!employee) return;
    setSaving(true);
    try {
      await setEmployeeAreaAuthorizations(employee.id, Array.from(selected));
      toast.success("Autorizações atualizadas");
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Falha ao salvar: " + (e?.message || "tente novamente"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Autorização de áreas frias
          </DialogTitle>
          <DialogDescription>
            Selecione as câmaras / túneis em que <b>{employee?.name}</b> está autorizado a registrar entrada.
            Eventos em áreas não autorizadas são bloqueados e geram alerta operacional.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[55vh] pr-3">
          <div className="space-y-2">
            {tenantAreas.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">
                Nenhuma área fria cadastrada neste tenant.
              </p>
            )}
            {tenantAreas.map(area => {
              const unit = units.find(u => u.id === area.unit_id);
              const checked = selected.has(area.id);
              return (
                <label
                  key={area.id}
                  htmlFor={`area-${area.id}`}
                  className="flex items-start gap-3 rounded-lg border border-border p-3 hover:bg-accent/40 cursor-pointer"
                >
                  <Checkbox id={`area-${area.id}`} checked={checked} onCheckedChange={() => toggle(area.id)} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Snowflake className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="font-medium text-sm truncate">{area.name}</span>
                      <Badge variant="outline" className="text-[10px]">{area.type}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {unit?.name || "—"} · {area.average_temperature}°C · limite {area.exposure_limit_minutes} min
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Salvando…" : "Salvar autorizações"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
