import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, KeyRound, LogOut, ShieldCheck, ChevronRight, Snowflake } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import PageHead from "@/components/PageHead";
import { usePortal, PortalError } from "@/lib/portal";

export default function PortalProfile() {
  const { link, links, cpfMasked, selectLink, changePassword, logout } = usePortal();
  const [pwdOpen, setPwdOpen] = useState(false);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [saving, setSaving] = useState(false);
  const nav = useNavigate();

  const submitPwd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (p1.length < 6) return toast.error("A senha deve ter ao menos 6 caracteres");
    if (p1 !== p2) return toast.error("As senhas não conferem");
    setSaving(true);
    try {
      await changePassword(p1);
      toast.success("Senha alterada");
      setPwdOpen(false); setP1(""); setP2("");
    } catch (e) {
      toast.error(e instanceof PortalError && e.code === "password_is_provisional"
        ? "Escolha uma senha diferente da provisória" : "Não foi possível alterar a senha");
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <PageHead title="Perfil — Portal do colaborador FrioSafe" description="Seus dados, vínculos de empresa e transparência sobre o tratamento das informações." />
      <h1 className="font-display text-xl font-bold">Perfil</h1>

      <Card className="p-5 flex items-center gap-4">
        <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-primary to-primary-glow grid place-items-center shrink-0">
          <Snowflake className="h-7 w-7 text-primary-foreground" />
        </div>
        <div className="min-w-0">
          <div className="font-display font-bold text-lg leading-tight truncate">{link?.name}</div>
          <div className="text-[13px] text-muted-foreground truncate">{link?.position}</div>
          <div className="text-[12px] text-muted-foreground mt-0.5 tabular-nums">CPF {cpfMasked ?? "—"}</div>
        </div>
      </Card>

      <Card className="divide-y divide-border/60 overflow-hidden">
        <div className="p-4">
          <div className="text-[11px] uppercase text-muted-foreground">Empresa ativa</div>
          <div className="mt-1 font-medium">{link?.tenant_name}</div>
          <div className="text-[13px] text-muted-foreground">
            {[link?.unit_name, link?.unit_location].filter(Boolean).join(" · ") || "Unidade não informada"}
          </div>
        </div>
        {links.length > 1 && (
          <button className="w-full p-4 flex items-center gap-3 active:bg-muted/40 transition text-left" onClick={() => setCompanyOpen(true)}>
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1 text-[15px]">Trocar empresa</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
        <button className="w-full p-4 flex items-center gap-3 active:bg-muted/40 transition text-left" onClick={() => setPwdOpen(true)}>
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1 text-[15px]">Alterar senha</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
          <ShieldCheck className="h-4 w-4" /> Sobre estes dados
        </div>
        <p className="text-[13px] leading-relaxed">
          Registramos suas <strong>entradas e saídas de câmaras frias</strong>, o <strong>tempo de exposição</strong> e as
          <strong> pausas térmicas</strong>. A finalidade é controle ocupacional de saúde e segurança do trabalho —
          proteger você do frio e comprovar o cumprimento das pausas obrigatórias.
        </p>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Isto <strong className="text-foreground">não é registro de ponto</strong> e não substitui o controle de jornada da
          empresa. Os dados são tratados para cumprimento de obrigação legal e regulatória de SST, ficam restritos à sua
          empresa e são guardados em trilha de auditoria que não pode ser alterada. Para pedir acesso, correção ou
          exclusão dos seus dados, fale com o RH ou com o encarregado de dados (DPO) da sua empresa.
        </p>
      </Card>

      <Button variant="outline" className="w-full h-12" onClick={() => { logout(); nav("/colaborador", { replace: true }); }}>
        <LogOut className="h-4 w-4 mr-2" /> Sair
      </Button>

      <div className="text-center text-[11px] text-muted-foreground space-y-1 pt-1">
        <div className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Dados protegidos por assinatura digital</div>
        <div>FrioSafe · Meu extrato de exposição ao frio</div>
      </div>

      <Dialog open={pwdOpen} onOpenChange={setPwdOpen}>
        <DialogContent className="max-w-[92vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Alterar senha</DialogTitle>
            <DialogDescription>Escolha uma senha com ao menos 6 caracteres.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitPwd} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pp1">Nova senha</Label>
              <Input id="pp1" type="password" className="h-12" value={p1} onChange={(e) => setP1(e.target.value)} required minLength={6} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pp2">Confirmar nova senha</Label>
              <Input id="pp2" type="password" className="h-12" value={p2} onChange={(e) => setP2(e.target.value)} required minLength={6} />
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={() => setPwdOpen(false)} disabled={saving}>Cancelar</Button>
              <Button type="submit" disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={companyOpen} onOpenChange={setCompanyOpen}>
        <DialogContent className="max-w-[92vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Trocar empresa</DialogTitle>
            <DialogDescription>Seu CPF está vinculado a mais de uma empresa.</DialogDescription>
          </DialogHeader>
          <ul className="space-y-2">
            {links.map((l) => (
              <li key={l.employee_id}>
                <button
                  onClick={() => { selectLink(l.employee_id); setCompanyOpen(false); toast.success(`Empresa ativa: ${l.tenant_name}`); }}
                  className="w-full text-left rounded-xl border p-3 flex items-center gap-3 active:bg-muted/40 transition"
                >
                  <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium truncate">{l.tenant_name}</span>
                    <span className="block text-[12px] text-muted-foreground truncate">
                      {[l.unit_name, l.unit_location].filter(Boolean).join(" · ") || "Unidade não informada"}
                    </span>
                  </span>
                  {l.employee_id === link?.employee_id && <span className="text-[11px] text-primary shrink-0">ativa</span>}
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}
