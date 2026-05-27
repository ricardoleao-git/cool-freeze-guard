import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Snowflake, ShieldCheck, Sparkles, ArrowRight } from "lucide-react";
import { toast } from "sonner";

export default function Login() {
  const [email, setEmail] = useState("gestor@friosafe.demo");
  const [password, setPassword] = useState("demo");
  const nav = useNavigate();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    toast.success("Bem-vindo ao FrioSafe (modo demo)");
    nav("/");
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
              <div className="text-[11px] uppercase tracking-[0.2em] text-primary/80">Controle Térmico Ocupacional</div>
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
            <div className="rounded-xl border border-status-yellow/40 bg-status-yellow/10 p-3"><div className="text-status-yellow font-display text-xl font-bold">80'</div><div className="text-[10px] uppercase mt-1">Atenção</div></div>
            <div className="rounded-xl border border-status-orange/40 bg-status-orange/10 p-3"><div className="text-status-orange font-display text-xl font-bold">90'</div><div className="text-[10px] uppercase mt-1">Crítico</div></div>
            <div className="rounded-xl border border-status-red/50 bg-status-red/10 p-3"><div className="text-status-red font-display text-xl font-bold">100'</div><div className="text-[10px] uppercase mt-1">Bloqueio</div></div>
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
          <h2 className="font-display text-2xl font-bold">Entrar na plataforma</h2>
          <p className="text-sm text-muted-foreground mt-1">Use as credenciais demo já preenchidas para entrar.</p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <Label>E-mail</Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div>
              <Label>Senha</Label>
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" size="lg">
              Entrar <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 flex items-start gap-2 text-xs">
              <Sparkles className="h-4 w-4 text-primary mt-0.5" />
              <div>
                <div className="font-semibold">Modo Demonstração</div>
                <div className="text-muted-foreground">Esta é uma demo navegável com dados fictícios. Nenhum dado real é processado.</div>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
