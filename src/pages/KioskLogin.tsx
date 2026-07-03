import { useState } from "react";
import { KeyRound, Monitor, Clock, Tv, Snowflake, Loader2 } from "lucide-react";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Button } from "@/components/ui/button";

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/kiosk-pair-code`;
const ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

/**
 * Rota pública /loginpainel — usada para parear TVs/quiosques (Fully Kiosk).
 * O admin gera um código de 6 dígitos em "Configurações do painel" e o
 * operador digita aqui. Ao confirmar, trocamos o código pelo token longo e
 * redirecionamos para /painelgeral?boot=<token>. O Fully Kiosk memoriza essa
 * URL e nas próximas reinicializações abre direto o painel, sem login.
 */
export default function KioskLogin() {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (code.length !== 6) {
      setError("Digite os 6 dígitos do código.");
      return;
    }
    setLoading(true);
    try {
      const resp = await fetch(FN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: ANON,
          Authorization: `Bearer ${ANON}`,
        },
        body: JSON.stringify({ code }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || !json?.token) {
        const err = json?.error as string | undefined;
        if (err === "code_expired") setError("Código expirado. Gere um novo em Configurações do painel.");
        else if (err === "code_already_used") setError("Este código já foi utilizado. Gere um novo.");
        else if (err === "rate_limited") setError("Muitas tentativas. Aguarde alguns segundos.");
        else setError("Código inválido. Verifique os 6 dígitos.");
        setLoading(false);
        return;
      }
      // Persistimos na URL para que o Fully Kiosk memorize a URL final.
      window.location.replace(`/painelgeral?boot=${encodeURIComponent(json.token)}`);
    } catch {
      setError("Falha ao conectar. Verifique a rede e tente novamente.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 grid lg:grid-cols-[minmax(0,340px)_1fr]">
      {/* Coluna esquerda: instruções */}
      <aside className="hidden lg:flex flex-col justify-start gap-8 border-r border-border/60 bg-card/40 px-8 py-12">
        <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground/70">Como conectar</div>
        <ol className="space-y-6 text-sm">
          <li className="flex gap-3">
            <span className="mt-0.5 h-6 w-6 shrink-0 rounded-full border border-primary/40 text-primary text-xs grid place-items-center">1</span>
            <div className="space-y-1.5">
              <Monitor className="h-4 w-4 text-primary" />
              <p className="text-muted-foreground leading-relaxed">
                Um administrador acessa <strong className="text-foreground">Configurações do painel</strong> no FrioSafe e clica em "Gerar código".
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="mt-0.5 h-6 w-6 shrink-0 rounded-full border border-primary/40 text-primary text-xs grid place-items-center">2</span>
            <div className="space-y-1.5">
              <Clock className="h-4 w-4 text-primary" />
              <p className="text-muted-foreground leading-relaxed">
                Um código de <strong className="text-foreground">6 dígitos</strong> é exibido — válido por 15 minutos e de uso único.
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="mt-0.5 h-6 w-6 shrink-0 rounded-full border border-primary/40 text-primary text-xs grid place-items-center">3</span>
            <div className="space-y-1.5">
              <Tv className="h-4 w-4 text-primary" />
              <p className="text-muted-foreground leading-relaxed">
                Digite o código ao lado. A TV será pareada e passa a exibir o painel em tempo real.
              </p>
            </div>
          </li>
        </ol>
      </aside>

      {/* Coluna direita: autenticação */}
      <main className="flex flex-col items-center justify-center px-6 py-12">
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary to-primary-glow grid place-items-center shadow-glow">
            <Snowflake className="h-6 w-6 text-primary-foreground" />
          </div>
          <div className="text-center">
            <h1 className="font-display font-bold text-2xl">FrioSafe</h1>
            <p className="text-xs text-muted-foreground uppercase tracking-widest">Painel Operacional</p>
          </div>
        </div>

        <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card/60 backdrop-blur-sm p-8 shadow-xl">
          <div className="text-center space-y-1 mb-6">
            <h2 className="font-display font-semibold text-lg">Autenticação do painel</h2>
            <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5" /> Insira o código de 6 dígitos
            </p>
          </div>

          <div className="flex justify-center mb-6">
            <InputOTP
              maxLength={6}
              value={code}
              onChange={(v) => {
                setError(null);
                setCode(v.replace(/\D/g, ""));
              }}
              autoFocus
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </div>

          <Button
            className="w-full font-semibold tracking-wide"
            size="lg"
            onClick={submit}
            disabled={loading || code.length !== 6}
          >
            {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Conectando…</> : "Conectar"}
          </Button>

          {error && (
            <p className="mt-4 text-sm text-center text-destructive">{error}</p>
          )}

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Código expirado?{" "}
            <span className="text-primary">Peça um novo em Configurações do painel.</span>
          </p>
        </div>
      </main>
    </div>
  );
}
