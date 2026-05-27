import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, Cpu, AlertCircle, CheckCircle2 } from "lucide-react";
import { useDemo, useTenantScoped } from "@/lib/demo-store";
import type { Employee } from "@/lib/demo-data";

const schema = z.object({
  name: z.string().trim().min(2, "Nome deve ter ao menos 2 caracteres").max(120),
  registration_number: z.string().trim().min(1, "Matrícula obrigatória").max(40),
  position: z.string().trim().max(80).optional().default(""),
  unit_id: z.string().min(1, "Selecione a unidade"),
  department_id: z.string().min(1, "Selecione o setor"),
  status: z.enum(["active", "inactive"]),
});

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  employee?: Employee | null;
};

export function EmployeeFormDialog({ open, onOpenChange, employee }: Props) {
  const { units, departments, devices, coldAreas } = useTenantScoped();
  const { activeTenantId, createEmployee, updateEmployee, uploadEmployeeAvatar, employees } = useDemo();

  const [name, setName] = useState("");
  const [reg, setReg] = useState("");
  const [position, setPosition] = useState("");
  const [unitId, setUnitId] = useState("");
  const [deptId, setDeptId] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const [avatar, setAvatar] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(employee?.name || "");
    setReg(employee?.registration_number || "");
    setPosition(employee?.position || "");
    setUnitId(employee?.unit_id || units[0]?.id || "");
    setDeptId(employee?.department_id || "");
    setStatus((employee?.status as any) || "active");
    setAvatar(employee?.avatar || "");
    setErrors({});
  }, [open, employee, units]);

  const availableDepts = useMemo(() => departments.filter(d => d.unit_id === unitId), [departments, unitId]);
  useEffect(() => {
    if (deptId && !availableDepts.some(d => d.id === deptId)) setDeptId("");
  }, [availableDepts, deptId]);

  // device linkage preview — devices in cold areas of selected unit/department
  const linkedDevices = useMemo(() => {
    if (!unitId) return [];
    const areaIds = coldAreas
      .filter(a => a.unit_id === unitId && (!deptId || a.department_id === deptId))
      .map(a => a.id);
    return devices.filter(d => areaIds.includes(d.cold_area_id));
  }, [devices, coldAreas, unitId, deptId]);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) return toast.error("Selecione uma imagem (JPG/PNG/WebP)");
    if (file.size > 3 * 1024 * 1024) return toast.error("Imagem deve ter no máximo 3MB");
    setUploading(true);
    try {
      const tempId = employee?.id || `tmp_${Date.now()}`;
      const url = await uploadEmployeeAvatar(tempId, file);
      setAvatar(url);
      toast.success("Foto carregada");
    } catch (e: any) {
      toast.error("Falha no upload: " + (e?.message || "erro desconhecido"));
    } finally {
      setUploading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ name, registration_number: reg, position, unit_id: unitId, department_id: deptId, status });
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      parsed.error.errors.forEach(err => { fieldErrors[err.path[0] as string] = err.message; });
      setErrors(fieldErrors);
      return;
    }
    // dedup matricula
    const dup = employees.find(e => e.registration_number === reg.trim() && e.tenant_id === activeTenantId && e.id !== employee?.id);
    if (dup) { setErrors({ registration_number: "Matrícula já em uso por outro colaborador" }); return; }
    setErrors({});
    setSaving(true);
    try {
      if (employee) {
        await updateEmployee(employee.id, { ...parsed.data, avatar });
        toast.success("Colaborador atualizado");
      } else {
        await createEmployee({ ...parsed.data, tenant_id: activeTenantId, avatar });
        toast.success("Colaborador criado");
      }
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Erro ao salvar: " + (e?.message || "tente novamente"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{employee ? "Editar colaborador" : "Novo colaborador"}</DialogTitle>
          <DialogDescription>Preencha os dados, vincule à unidade/setor e confira os dispositivos cobertos.</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          <div className="flex items-center gap-4">
            <div className="relative h-20 w-20 rounded-full overflow-hidden ring-2 ring-border bg-muted grid place-items-center">
              {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : <Upload className="h-6 w-6 text-muted-foreground" />}
            </div>
            <div className="flex-1">
              <Label>Foto</Label>
              <div className="flex gap-2 mt-1">
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
                  {avatar ? "Trocar foto" : "Enviar foto"}
                </Button>
                {avatar && <Button type="button" variant="ghost" size="sm" onClick={() => setAvatar("")}>Remover</Button>}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
              <p className="text-[11px] text-muted-foreground mt-1">JPG/PNG/WebP, até 3MB.</p>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label>Nome completo *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} maxLength={120} />
              {errors.name && <p className="text-xs text-status-red mt-1">{errors.name}</p>}
            </div>
            <div>
              <Label>Matrícula *</Label>
              <Input value={reg} onChange={e => setReg(e.target.value)} maxLength={40} />
              {errors.registration_number && <p className="text-xs text-status-red mt-1">{errors.registration_number}</p>}
            </div>
            <div>
              <Label>Cargo</Label>
              <Input value={position} onChange={e => setPosition(e.target.value)} maxLength={80} placeholder="Ex.: Açougueiro" />
            </div>
            <div>
              <Label>Situação</Label>
              <Select value={status} onValueChange={v => setStatus(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="inactive">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Unidade *</Label>
              <Select value={unitId} onValueChange={setUnitId}>
                <SelectTrigger><SelectValue placeholder="Selecione a unidade" /></SelectTrigger>
                <SelectContent>
                  {units.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {errors.unit_id && <p className="text-xs text-status-red mt-1">{errors.unit_id}</p>}
            </div>
            <div>
              <Label>Setor *</Label>
              <Select value={deptId} onValueChange={setDeptId} disabled={!unitId || availableDepts.length === 0}>
                <SelectTrigger><SelectValue placeholder={unitId ? "Selecione o setor" : "Selecione a unidade primeiro"} /></SelectTrigger>
                <SelectContent>
                  {availableDepts.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {errors.department_id && <p className="text-xs text-status-red mt-1">{errors.department_id}</p>}
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
            <div className="flex items-center gap-2 text-sm font-medium mb-2">
              <Cpu className="h-4 w-4 text-primary" /> Dispositivos vinculados
              <Badge variant="outline" className="ml-auto">{linkedDevices.length}</Badge>
            </div>
            {!unitId ? (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5"><AlertCircle className="h-3.5 w-3.5" /> Selecione uma unidade para ver os leitores faciais.</p>
            ) : linkedDevices.length === 0 ? (
              <p className="text-xs text-status-orange flex items-center gap-1.5"><AlertCircle className="h-3.5 w-3.5" /> Nenhum dispositivo cobre este setor. O colaborador será criado mas eventos automáticos não serão capturados.</p>
            ) : (
              <ul className="space-y-1.5">
                {linkedDevices.map(d => {
                  const area = coldAreas.find(a => a.id === d.cold_area_id);
                  return (
                    <li key={d.id} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2">
                        <CheckCircle2 className={`h-3.5 w-3.5 ${d.status === "online" ? "text-status-green" : "text-muted-foreground"}`} />
                        <span className="font-medium">{d.name}</span>
                        <span className="text-muted-foreground">· {area?.name}</span>
                      </span>
                      <Badge variant="outline" className="text-[10px]">{d.device_type === "entry" ? "Entrada" : "Saída"} · {d.status}</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving || uploading}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {employee ? "Salvar alterações" : "Criar colaborador"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
