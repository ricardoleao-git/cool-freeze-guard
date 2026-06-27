import { useEffect, useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Snowflake, ShieldCheck, Sparkles, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

import { useAuth } from "@/lib/auth";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  const { user } = useAuth();
  const from = (loc.state as any)?.from || "/";

  useEffect(() => { if (user) nav(from, { replace: true }); }, [user, from, nav]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Bem-vindo ao FrioSafe");
    nav(from, { replace: true });
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/` },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Conta criada! Você já pode entrar.");
  };


  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      <div className="relative hidden lg:flex flex-col justify-between p-12 bg-gradient-hero overflow-hidden hero-on-dark">
        <div className="absolute inset-0 bg-grid opacity-30" />
        <div className="relative">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary to-primary-glow grid place-items-center shadow-glow">
              <Snowflake className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <div className="font-display font-bold text-xl">FrioSafe</div>
              <div className="text-xs uppercase tracking-[0.2em] hero-eyebrow">Controle Térmico Ocupacional</div>
            </div>
          </div>
        </div>
        <div className="relative">
          <h1 className="font-display text-4xl xl:text-5xl font-bold leading-tight">
            Proteja o colaborador.<br />
            <span className="text-gradient-on-hero">Comprove compliance.</span>
          </h1>
          <p className="mt-4 hero-muted max-w-md text-[15px] leading-relaxed">
            Plataforma SaaS multi-tenant para controle de exposição ao frio e pausa térmica em câmaras frias, açougues, frigoríficos e centros de distribuição.
          </p>
          <div className="mt-8 grid grid-cols-3 gap-3 text-center max-w-md">
            <div className="rounded-xl border border-white/30 bg-white/10 p-3 backdrop-blur-sm"><div className="font-display text-xl font-bold text-white">80'</div><div className="text-xs uppercase mt-1 hero-eyebrow">Atenção</div></div>
            <div className="rounded-xl border border-white/30 bg-white/10 p-3 backdrop-blur-sm"><div className="font-display text-xl font-bold text-white">90'</div><div className="text-xs uppercase mt-1 hero-eyebrow">Crítico</div></div>
            <div className="rounded-xl border border-white/40 bg-white/15 p-3 backdrop-blur-sm"><div className="font-display text-xl font-bold text-white">100'</div><div className="text-xs uppercase mt-1 hero-eyebrow">Bloqueio</div></div>
          </div>
        </div>
        <div className="relative text-[13px] hero-muted flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-white" /> Independente do ponto eletrônico — evidência para SST, RH e Jurídico.</div>
      </div>

      <div className="flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8 flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary to-primary-glow grid place-items-center shadow-glow"><Snowflake className="h-6 w-6 text-primary-foreground" /></div>
            <div><div className="font-display font-bold text-xl">FrioSafe</div></div>
          </div>
          <h2 className="font-display text-2xl font-bold">Acesse a plataforma</h2>
          <p className="text-[13px] text-muted-foreground mt-1">Entre com sua conta ou cadastre-se para acessar a plataforma.</p>

          <Tabs defaultValue="signin" className="mt-6">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="signin">Entrar</TabsTrigger>
              <TabsTrigger value="signup">Cadastrar</TabsTrigger>
            </TabsList>

            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="space-y-4 mt-4">
                <div><Label>E-mail</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
                <div><Label>Senha</Label><Input type="password" value={password} onChange={e => setPassword(e.target.value)} required /></div>
                <Button type="submit" className="w-full" size="lg" disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Entrar <ArrowRight className="h-4 w-4 ml-2" /></>}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-4 mt-4">
                <div><Label>E-mail</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
                <div><Label>Senha</Label><Input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} /></div>
                <Button type="submit" className="w-full" size="lg" disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Criar conta"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>


          <Link
            to="/demo"
            className="mt-6 block rounded-xl border border-primary/30 bg-primary/5 p-4 transition hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex items-start gap-3">
              <Sparkles className="h-5 w-5 text-primary mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="font-semibold text-sm">Experimente sem cadastro</div>
                <p className="text-[13px] text-muted-foreground mt-1">
                  Entre no modo demonstração com dados simulados (3 meses de operação, alertas, fechamentos e painel TV). Nenhum dado real é gravado e você pode sair quando quiser.
                </p>
                <div className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-primary">
                  Abrir modo demonstração <ArrowRight className="h-3.5 w-3.5" />
                </div>
              </div>
            </div>
          </Link>

        </div>
      </div>
    </div>
  );
}
