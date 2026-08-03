import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { Snowflake, ArrowRight, Loader2, ShieldCheck, Building2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import PageHead from "@/components/PageHead";
import { usePortal, maskCpf, PortalError, PortalLink } from "@/lib/portal";

type Step = "splash" | "login" | "first_access" | "select_company" | "no_link";

export default function PortalLogin() {
  const { token, links, link, mustChangePassword, login, changePassword, selectLink, ready } = usePortal();
  const [step, setStep] = useState<Step>("splash");
  const [cpf, setCpf] = useState("");
  const [password, setPassword] = useState("");
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  const from = (loc.state as any)?.from as string | undefined;

  // Sessão já ativa: manda direto para o app (ou pede o que falta).
  useEffect(() => {
    if (!ready || !token) return;
    if (mustChangePassword) { setStep("first_access"); return; }
    if (!links.length) { setStep("no_link"); return; }
    if (!link) { setStep("select_company"); return; }
    nav(from || "/colaborador/inicio", { replace: true });
  }, [ready, token, links, link, mustChangePassword, nav, from]);

  const advance = (l: PortalLink[]) => {
    if (!l.length) return setStep("no_link");
    if (l.length > 1) return setStep("select_company");
    nav(from || "/colaborador/inicio", { replace: true });
  };

  const doLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await login(cpf, password);
      if (res.mustChange) { setStep("first_access"); return; }
      advance(res.links);
    } catch (err) {
      const code = err instanceof PortalError ? err.code : "network_error";
      if (code === "locked") toast.error("Acesso bloqueado temporariamente. Tente novamente em alguns minutos.");
      else if (code === "network_error") toast.error("Sem conexão com o servidor. Tente novamente.");
      else toast.error("CPF ou senha inválidos");
    } finally { setLoading(false); }
  };

  const doChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (p1.length < 6) return toast.error("A nova senha deve ter ao menos 6 caracteres");
    if (p1 !== p2) return toast.error("As senhas não conferem");
    setLoading(true);
    try {
      await changePassword(p1);
      toast.success("Senha atualizada");
      advance(links);
    } catch (err) {
      const code = err instanceof PortalError ? err.code : "network_error";
      if (code === "password_is_provisional") toast.error("Escolha uma senha diferente da provisória");
      else if (code === "weak_password") toast.error("Senha muito curta");
      else toast.error("Não foi possível alterar a senha");
    } finally { setLoading(false); }
  };

  const cpfDigits = useMemo(() => cpf.replace(/\D/g, ""), [cpf]);

  return (
    <div className="min-h-[100dvh] bg-gradient-hero text-white flex flex-col">
      <PageHead
        title="Portal do colaborador — FrioSafe"
        description="Acesse seu extrato de exposição ao frio, pausas térmicas e ocorrências de SST."
      />
      <div className="absolute inset-0 bg-grid opacity-20 pointer-events-none" />

      <div className="relative flex-1 flex flex-col justify-center px-5 py-10 max-w-md w-full mx-auto">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-white/15 backdrop-blur grid place-items-center">
            <Snowflake className="h-7 w-7 text-white" />
          </div>
          <div>
            <div className="font-display font-bold text-2xl">FrioSafe</div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-white/70">Meu extrato de exposição ao frio</div>
          </div>
        </div>

        {step === "splash" && (
          <div className="mt-10 animate-fade-in">
            <h1 className="font-display text-3xl font-bold leading-tight">
              Seus registros de<br />exposição ao frio,<br />na sua mão.
            </h1>
            <p className="mt-3 text-[15px] text-white/75 leading-relaxed">
              Consulte entradas e saídas das câmaras frias, pausas térmicas e ocorrências de SST. Não é controle de ponto.
            </p>
            <Button size="lg" className="mt-8 w-full h-14 text-base" onClick={() => setStep("login")}>
              Entrar como colaborador <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
            <Link to="/login" className="mt-6 block text-center text-[13px] text-white/60 underline underline-offset-4">
              Sou gestor
            </Link>
          </div>
        )}

        {step === "login" && (
          <form onSubmit={doLogin} className="mt-10 space-y-5 animate-fade-in">
            <div>
              <h1 className="font-display text-2xl font-bold">Entrar</h1>
              <p className="text-[13px] text-white/70 mt-1">Use seu CPF e sua senha.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cpf" className="text-white/85">CPF</Label>
              <Input
                id="cpf" inputMode="numeric" autoComplete="username" placeholder="000.000.000-00"
                className="h-14 text-lg bg-white/10 border-white/25 text-white placeholder:text-white/40"
                value={cpf} onChange={(e) => setCpf(maskCpf(e.target.value))} required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pwd" className="text-white/85">Senha</Label>
              <Input
                id="pwd" type="password" autoComplete="current-password"
                className="h-14 text-lg bg-white/10 border-white/25 text-white"
                value={password} onChange={(e) => setPassword(e.target.value)} required
              />
            </div>
            <Button type="submit" size="lg" className="w-full h-14 text-base" disabled={loading || cpfDigits.length !== 11}>
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Entrar"}
            </Button>
            <p className="text-center text-[13px] text-white/70">
              Primeiro acesso? Use os <strong className="text-white">6 primeiros dígitos do seu CPF</strong> como senha.
            </p>
            <button type="button" className="w-full text-center text-[13px] text-white/60 underline underline-offset-4"
              onClick={() => toast.message("Fale com o RH ou seu gestor para redefinir sua senha.")}>
              Esqueci minha senha
            </button>
          </form>
        )}

        {step === "first_access" && (
          <form onSubmit={doChange} className="mt-10 space-y-5 animate-fade-in">
            <div className="flex items-center gap-2 text-white/80 text-[13px]">
              <ShieldCheck className="h-4 w-4" /> Primeiro acesso
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold">Crie sua senha</h1>
              <p className="text-[13px] text-white/70 mt-1">
                Por segurança, a senha provisória precisa ser trocada antes de continuar.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-white/85">Nova senha</Label>
              <Input type="password" autoComplete="new-password" minLength={6}
                className="h-14 text-lg bg-white/10 border-white/25 text-white"
                value={p1} onChange={(e) => setP1(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-white/85">Confirmar nova senha</Label>
              <Input type="password" autoComplete="new-password" minLength={6}
                className="h-14 text-lg bg-white/10 border-white/25 text-white"
                value={p2} onChange={(e) => setP2(e.target.value)} required />
            </div>
            <Button type="submit" size="lg" className="w-full h-14 text-base" disabled={loading}>
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Salvar e continuar"}
            </Button>
          </form>
        )}

        {step === "select_company" && (
          <div className="mt-10 animate-fade-in">
            <h1 className="font-display text-2xl font-bold">Escolha a empresa</h1>
            <p className="text-[13px] text-white/70 mt-1">Seu CPF está vinculado a mais de uma empresa.</p>
            <ul className="mt-6 space-y-3">
              {links.map((l) => (
                <li key={l.employee_id}>
                  <button
                    onClick={() => { selectLink(l.employee_id); nav(from || "/colaborador/inicio", { replace: true }); }}
                    className="w-full text-left rounded-2xl border border-white/20 bg-white/10 p-4 flex items-center gap-3 active:scale-[0.99] transition"
                  >
                    <div className="h-10 w-10 rounded-xl bg-white/15 grid place-items-center shrink-0">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold truncate">{l.tenant_name}</div>
                      <div className="text-[13px] text-white/70 truncate">
                        {[l.unit_name, l.unit_location].filter(Boolean).join(" · ") || "Unidade não informada"}
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-white/60 shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {step === "no_link" && (
          <div className="mt-10 animate-fade-in text-center">
            <div className="mx-auto h-14 w-14 rounded-2xl bg-white/10 grid place-items-center">
              <Building2 className="h-7 w-7 text-white/80" />
            </div>
            <h1 className="font-display text-xl font-bold mt-4">Nenhuma empresa vinculada ao seu CPF no momento</h1>
            <p className="text-[13px] text-white/70 mt-2">
              Seu acesso funcionou, mas ainda não há vínculo ativo. Procure o RH da sua empresa.
            </p>
            <Button variant="secondary" className="mt-6 w-full h-12" onClick={() => setStep("login")}>Voltar</Button>
          </div>
        )}
      </div>

      <div className="relative px-5 pb-6 text-center text-[11px] text-white/50">
        Controle ocupacional de exposição ao frio · não substitui o registro de ponto
      </div>
    </div>
  );
}
