import { useEffect, useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Snowflake, ShieldCheck, Sparkles, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
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

  const handleGoogle = async () => {
    setLoading(true);
    const { error } = await lovable.auth.signInWithOAuth("google", { redirect_uri: `${window.location.origin}/` });
    if (error) { setLoading(false); toast.error(error.message); }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      <div className="relative hidden lg:flex flex-col justify-between p-12 bg-gradient-hero overflow-hidden">
        <div className="absolute inset-0 bg-grid opacity-30" />
        <div className="relative">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary to-primary-glow grid place-items-center shadow-glow">
              <Snowflake className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <div className="font-display font-bold text-xl">FrioSafe</div>
              <div className="text-xs uppercase tracking-[0.2em] text-primary/80">Controle Térmico Ocupacional</div>
            </div>
          </div>
        </div>
        <div className="relative">
          <h1 className="font-display text-4xl xl:text-5xl font-bold leading-tight">
            Proteja o colaborador.<br />
            <span className="text-gradient">Comprove compliance.</span>
          </h1>
          <p className="mt-4 text-muted-foreground max-w-md">
            Plataforma SaaS multi-tenant para controle de exposição ao frio e pausa térmica em câmaras frias, açougues, frigoríficos e centros de distribuição.
          </p>
          <div className="mt-8 grid grid-cols-3 gap-3 text-center max-w-md">
            <div className="rounded-xl border border-status-yellow/40 bg-status-yellow/10 p-3"><div className="text-status-yellow font-display text-xl font-bold">80'</div><div className="text-xs uppercase mt-1">Atenção</div></div>
            <div className="rounded-xl border border-status-orange/40 bg-status-orange/10 p-3"><div className="text-status-orange font-display text-xl font-bold">90'</div><div className="text-xs uppercase mt-1">Crítico</div></div>
            <div className="rounded-xl border border-status-red/50 bg-status-red/10 p-3"><div className="text-status-red font-display text-xl font-bold">100'</div><div className="text-xs uppercase mt-1">Bloqueio</div></div>
          </div>
        </div>
        <div className="relative text-xs text-muted-foreground flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /> Independente do ponto eletrônico — evidência para SST, RH e Jurídico.</div>
      </div>

      <div className="flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8 flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary to-primary-glow grid place-items-center shadow-glow"><Snowflake className="h-6 w-6 text-primary-foreground" /></div>
            <div><div className="font-display font-bold text-xl">FrioSafe</div></div>
          </div>
          <h2 className="font-display text-2xl font-bold">Acesse a plataforma</h2>
          <p className="text-sm text-muted-foreground mt-1">Entre com sua conta ou cadastre-se. Ou explore sem login no <Link to="/demo" className="text-primary underline">modo Experimentação</Link>.</p>

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

          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs uppercase text-muted-foreground tracking-wider">ou</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <Button variant="outline" className="w-full" onClick={handleGoogle} disabled={loading}>
            <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            Entrar com Google
          </Button>

          <div className="mt-6 rounded-xl border border-primary/30 bg-primary/5 p-3 flex items-start gap-2 text-xs">
            <Sparkles className="h-4 w-4 text-primary mt-0.5" />
            <div>
              <div className="font-semibold">Quer só explorar?</div>
              <div className="text-muted-foreground">Acesse <Link to="/demo" className="text-primary underline">/demo</Link> para uma sessão de Experimentação sem cadastro.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
