import { PageHeader } from "@/components/PageHeader";
import { useTenantScoped, useDemo } from "@/lib/demo-store";
import { Users, LogIn, LogOut, AlertTriangle, ShieldAlert, Plus, Pencil, Trash2, ShieldCheck, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { STATUS_LABEL, STATUS_COLOR, type Employee } from "@/lib/demo-data";
import { toast } from "sonner";
import { EmployeeFormDialog } from "@/components/EmployeeFormDialog";
import { EmployeeAreaAuthDialog } from "@/components/EmployeeAreaAuthDialog";
import { SetEmployeePinDialog } from "@/components/SetEmployeePinDialog";
import { StorageImage } from "@/components/StorageImage";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/EmptyState";

export default function Employees() {
  const { employees, units, departments, employeeColdAreaAuth } = useTenantScoped();
  const { simulateEntry, simulateExit, forceStatus, deleteEmployee } = useDemo();
  const { roles, profile, isDemo } = useAuth();
  const canManagePin = !isDemo && roles.some(r => r === "super_admin" || r === "administrador");
  const tenantId = profile?.tenant_id ?? "";
  const [q, setQ] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [deleting, setDeleting] = useState<Employee | null>(null);
  const [authFor, setAuthFor] = useState<Employee | null>(null);
  const [pinFor, setPinFor] = useState<Employee | null>(null);
  const [pinSetMap, setPinSetMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!canManagePin || !tenantId) return;
    supabase.from("employees").select("id, pin_set_at").eq("tenant_id", tenantId)
      .then(({ data }) => {
        const m: Record<string, boolean> = {};
        (data ?? []).forEach((r: any) => { m[r.id] = !!r.pin_set_at; });
        setPinSetMap(m);
      });
  }, [canManagePin, tenantId, pinFor]);


  const filtered = employees.filter(e =>
    e.name.toLowerCase().includes(q.toLowerCase()) || e.registration_number.includes(q),
  );

  const openNew = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (emp: Employee) => { setEditing(emp); setFormOpen(true); };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteEmployee(deleting.id);
      toast.success(`${deleting.name} removido`);
    } catch (e: any) {
      toast.error("Falha ao remover: " + (e?.message || "tente novamente"));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="container py-6 md:py-8">
      <PageHeader
        eyebrow="Cadastros"
        title="Colaboradores"
        description="Lista de colaboradores do tenant ativo com status atual de exposição, ações de simulação e gestão completa (CRUD)."
        icon={<Users className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Input placeholder="Buscar por nome ou matrícula…" value={q} onChange={e => setQ(e.target.value)} className="w-full sm:w-[260px]" />
            <Button onClick={openNew}><Plus className="h-4 w-4 mr-1.5" /> Novo</Button>
          </div>
        }
      />

      <div className="glass-card overflow-hidden">
        {filtered.length === 0 && !q ? (
          <EmptyState
            icon={<Users className="h-5 w-5" />}
            title="Nenhum colaborador cadastrado"
            description="Adicione colaboradores manualmente ou sincronize via GuardIA para começar a monitorar a exposição."
            action={<Button onClick={openNew}><Plus className="h-4 w-4 mr-1.5" /> Cadastrar colaborador</Button>}
          />
        ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Colaborador</TableHead>
              <TableHead>Unidade / Setor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Exposição</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && q && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-10 text-muted-foreground text-sm">
                  Nenhum colaborador encontrado para “{q}”.
                </TableCell>
              </TableRow>
            )}
            {filtered.map(e => {
              const u = units.find(x => x.id === e.unit_id);
              const d = departments.find(x => x.id === e.department_id);
              return (
                <TableRow key={e.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {e.avatar
                        ? <StorageImage bucket="employee-avatars" path={e.avatar} alt={e.name} className="h-9 w-9 rounded-full ring-1 ring-border object-cover" fallback={<div className="h-9 w-9 rounded-full ring-1 ring-border bg-muted grid place-items-center text-xs font-semibold">{e.name.split(" ").map(s => s[0]).slice(0, 2).join("")}</div>} />
                        : <div className="h-9 w-9 rounded-full ring-1 ring-border bg-muted grid place-items-center text-xs font-semibold">{e.name.split(" ").map(s => s[0]).slice(0, 2).join("")}</div>
                      }
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          {e.name}
                          {e.status === "inactive" && <Badge variant="outline" className="text-xs px-1">INATIVO</Badge>}
                          {e.origem === "guardia" && <Badge variant="outline" className="text-xs px-1 border-primary/40 text-primary">GuardIA</Badge>}
                          {canManagePin && pinSetMap[e.id] && <Badge variant="outline" className="text-xs px-1 border-status-ok/50 text-status-ok gap-1"><KeyRound className="h-2.5 w-2.5" /> PIN</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">#{e.registration_number} · {e.position || "—"}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div>{u?.name || <span className="text-muted-foreground italic">sem unidade</span>}</div>
                    <div className="text-xs text-muted-foreground">{d?.name || "—"}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="gap-1.5">
                      <span className={`status-dot ${STATUS_COLOR[e.current_status]}`} />
                      {STATUS_LABEL[e.current_status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <div>{e.accumulated_minutes.toFixed(0)} min</div>
                    <div className="text-xs text-muted-foreground">
                      {employeeColdAreaAuth.filter(a => a.employee_id === e.id).length} áreas autorizadas
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1 flex-wrap">
                      <Button size="sm" variant="outline" onClick={() => { simulateEntry(e.id); toast.success(`Entrada: ${e.name}`); }}><LogIn className="h-3.5 w-3.5 mr-1" /> Entrada</Button>
                      <Button size="sm" variant="outline" onClick={() => { simulateExit(e.id); toast.success(`Saída: ${e.name}`); }}><LogOut className="h-3.5 w-3.5 mr-1" /> Saída</Button>
                      <Button size="sm" variant="ghost" className="text-status-yellow" onClick={() => forceStatus(e.id, "yellow")} title="Forçar amarelo"><AlertTriangle className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" className="text-status-orange" onClick={() => forceStatus(e.id, "orange")} title="Forçar laranja"><AlertTriangle className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" className="text-status-red" onClick={() => forceStatus(e.id, "blocked")} title="Bloquear"><ShieldAlert className="h-3.5 w-3.5" /></Button>
                      <div className="w-px h-5 bg-border mx-1" />
                      <Button size="sm" variant="ghost" onClick={() => setAuthFor(e)} title="Autorizar áreas frias"><ShieldCheck className="h-3.5 w-3.5" /></Button>
                      {canManagePin && (
                        <Button size="sm" variant="ghost" onClick={() => setPinFor(e)} title={pinSetMap[e.id] ? "Redefinir PIN" : "Definir PIN"}><KeyRound className="h-3.5 w-3.5" /></Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => openEdit(e)} title="Editar"><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" className="text-status-red" onClick={() => setDeleting(e)} title="Excluir"><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        )}
      </div>

      <EmployeeFormDialog open={formOpen} onOpenChange={setFormOpen} employee={editing} />
      <EmployeeAreaAuthDialog open={!!authFor} onOpenChange={(o) => !o && setAuthFor(null)} employee={authFor} />
      {pinFor && (
        <SetEmployeePinDialog
          open={!!pinFor}
          onOpenChange={(o) => !o && setPinFor(null)}
          tenantId={tenantId}
          employeeId={pinFor.id}
          employeeName={pinFor.name}
          hasPin={pinSetMap[pinFor.id]}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir colaborador?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação removerá <b>{deleting?.name}</b> (matrícula #{deleting?.registration_number}) permanentemente.
              Eventos históricos serão mantidos para auditoria, mas o colaborador deixará de aparecer nas listas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-status-red text-white hover:bg-status-red/90">Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
