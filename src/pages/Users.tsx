import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppRole, ROLE_LABELS, ROLE_DESCRIPTIONS } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Mail, Plus, Trash2, Copy, UserCog, Building2 } from "lucide-react";
import { toast } from "sonner";

type ProfileRow = {
  id: string; user_id: string; email: string; full_name: string;
  tenant_id: string | null; status: string;
};
type RoleRow = { id: string; user_id: string; role: AppRole; tenant_id: string | null };
type InviteRow = {
  id: string; email: string; role: AppRole; tenant_id: string;
  status: string; token: string; expires_at: string; created_at: string;
};
type TenantRow = { id: string; name: string };

const ASSIGNABLE_ROLES: AppRole[] = ["administrador", "gestor", "rh_sst", "visualizador"];

export default function Users() {
  const { roles, profile } = useAuth();
  const isSuper = roles.includes("super_admin");
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<string>("");
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [userRoles, setUserRoles] = useState<RoleRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(false);

  // invite form
  const [invEmail, setInvEmail] = useState("");
  const [invRole, setInvRole] = useState<AppRole>("visualizador");
  const [inviteOpen, setInviteOpen] = useState(false);

  useEffect(() => {
    supabase.from("tenants").select("id,name").order("name").then(({ data }) => {
      const list = (data ?? []) as TenantRow[];
      setTenants(list);
      if (!selectedTenant) {
        setSelectedTenant(isSuper ? (list[0]?.id ?? "") : (profile?.tenant_id ?? ""));
      }
    });
  }, [isSuper, profile?.tenant_id]);

  const load = async (tid: string) => {
    if (!tid) return;
    setLoading(true);
    const [{ data: ps }, { data: rs }, { data: invs }] = await Promise.all([
      supabase.from("profiles").select("*").eq("tenant_id", tid),
      supabase.from("user_roles").select("*").eq("tenant_id", tid),
      supabase.from("invitations").select("*").eq("tenant_id", tid).order("created_at", { ascending: false }),
    ]);
    setProfiles((ps ?? []) as ProfileRow[]);
    setUserRoles((rs ?? []) as RoleRow[]);
    setInvites((invs ?? []) as InviteRow[]);
    setLoading(false);
  };

  useEffect(() => { load(selectedTenant); }, [selectedTenant]);

  const rolesByUser = useMemo(() => {
    const m = new Map<string, AppRole[]>();
    for (const r of userRoles) {
      m.set(r.user_id, [...(m.get(r.user_id) ?? []), r.role]);
    }
    return m;
  }, [userRoles]);

  const sendInvite = async () => {
    if (!invEmail || !selectedTenant) return;
    const { data, error } = await supabase.from("invitations")
      .insert({ email: invEmail.trim().toLowerCase(), role: invRole, tenant_id: selectedTenant })
      .select().single();
    if (error) { toast.error("Falha ao convidar", { description: error.message }); return; }
    const link = `${window.location.origin}/login?invite=${(data as any).token}`;
    await navigator.clipboard.writeText(link).catch(() => {});
    toast.success("Convite criado", { description: "Link copiado para a área de transferência." });
    setInvEmail(""); setInviteOpen(false);
    load(selectedTenant);
  };

  const revokeInvite = async (id: string) => {
    const { error } = await supabase.from("invitations").delete().eq("id", id);
    if (error) toast.error("Falha", { description: error.message });
    else { toast.success("Convite revogado"); load(selectedTenant); }
  };

  const copyInviteLink = async (token: string) => {
    const link = `${window.location.origin}/login?invite=${token}`;
    await navigator.clipboard.writeText(link);
    toast.success("Link copiado");
  };

  const changeRole = async (userId: string, newRole: AppRole) => {
    // remove papéis existentes desse tenant e adiciona o novo
    await supabase.from("user_roles").delete().eq("user_id", userId).eq("tenant_id", selectedTenant);
    const { error } = await supabase.from("user_roles")
      .insert({ user_id: userId, role: newRole, tenant_id: selectedTenant });
    if (error) toast.error("Falha", { description: error.message });
    else { toast.success("Papel atualizado"); load(selectedTenant); }
  };

  const removeUser = async (userId: string) => {
    if (!confirm("Remover acesso deste usuário a esta empresa?")) return;
    await supabase.from("user_roles").delete().eq("user_id", userId).eq("tenant_id", selectedTenant);
    await supabase.from("profiles").update({ tenant_id: null }).eq("user_id", userId);
    toast.success("Acesso removido");
    load(selectedTenant);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <UserCog className="h-6 w-6 text-primary" /> Usuários e Permissões
          </h1>
          <p className="text-sm text-muted-foreground">
            Gerencie quem acessa esta empresa e com qual papel.
          </p>
        </div>
        {isSuper && tenants.length > 0 && (
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <Select value={selectedTenant} onValueChange={setSelectedTenant}>
              <SelectTrigger className="w-[260px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {tenants.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Usuários ativos</TabsTrigger>
          <TabsTrigger value="invites">Convites</TabsTrigger>
          <TabsTrigger value="matrix">Matriz de permissões</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Membros da empresa</CardTitle>
              <CardDescription>Usuários que já aceitaram o convite.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Papel</TableHead>
                    <TableHead className="w-[120px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profiles.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      {loading ? "Carregando…" : "Nenhum usuário nesta empresa ainda."}
                    </TableCell></TableRow>
                  )}
                  {profiles.map(p => {
                    const userRolesList = rolesByUser.get(p.user_id) ?? [];
                    const primaryRole = userRolesList[0] ?? "visualizador";
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.full_name || "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{p.email}</TableCell>
                        <TableCell>
                          <Select value={primaryRole} onValueChange={(v) => changeRole(p.user_id, v as AppRole)}>
                            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {ASSIGNABLE_ROLES.map(r => (
                                <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" onClick={() => removeUser(p.user_id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invites" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <div>
                <CardTitle>Convites</CardTitle>
                <CardDescription>Envie um link para que a pessoa crie a conta com o papel correto.</CardDescription>
              </div>
              <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
                <DialogTrigger asChild>
                  <Button><Plus className="h-4 w-4" /> Convidar</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Novo convite</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <div>
                      <Label>E-mail</Label>
                      <Input type="email" value={invEmail} onChange={e => setInvEmail(e.target.value)} placeholder="pessoa@empresa.com" />
                    </div>
                    <div>
                      <Label>Papel</Label>
                      <Select value={invRole} onValueChange={(v) => setInvRole(v as AppRole)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ASSIGNABLE_ROLES.map(r => (
                            <SelectItem key={r} value={r}>
                              <div className="flex flex-col py-0.5">
                                <span>{ROLE_LABELS[r]}</span>
                                <span className="text-[10px] text-muted-foreground">{ROLE_DESCRIPTIONS[r]}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancelar</Button>
                    <Button onClick={sendInvite}><Mail className="h-4 w-4" /> Gerar link de convite</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Papel</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Expira</TableHead>
                    <TableHead className="w-[160px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invites.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      Nenhum convite pendente.
                    </TableCell></TableRow>
                  )}
                  {invites.map(i => (
                    <TableRow key={i.id}>
                      <TableCell className="font-medium">{i.email}</TableCell>
                      <TableCell><Badge variant="outline">{ROLE_LABELS[i.role]}</Badge></TableCell>
                      <TableCell>
                        <Badge variant={i.status === "accepted" ? "default" : "secondary"}>
                          {i.status === "accepted" ? "Aceito" : "Pendente"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {new Date(i.expires_at).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {i.status === "pending" && (
                            <Button size="icon" variant="ghost" onClick={() => copyInviteLink(i.token)}>
                              <Copy className="h-4 w-4" />
                            </Button>
                          )}
                          <Button size="icon" variant="ghost" onClick={() => revokeInvite(i.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="matrix" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Matriz de permissões</CardTitle>
              <CardDescription>Resumo do que cada papel pode fazer.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-2">
                {(["super_admin","administrador","gestor","rh_sst","visualizador"] as AppRole[]).map(r => (
                  <div key={r} className="rounded-lg border p-4">
                    <div className="font-semibold">{ROLE_LABELS[r]}</div>
                    <p className="text-sm text-muted-foreground mt-1">{ROLE_DESCRIPTIONS[r]}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
