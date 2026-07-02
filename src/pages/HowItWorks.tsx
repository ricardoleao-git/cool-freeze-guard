import { PageHeader } from "@/components/PageHeader";
import PageHead from "@/components/PageHead";
import { BookOpenCheck, ShieldCheck, Snowflake, Timer, AlertTriangle, FileBarChart2, Wifi } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const steps = [
  { icon: Snowflake, title: "Registro de entrada e saída", text: "Leitores faciais identificam o colaborador na entrada e na saída de cada câmara fria, açougue ou ambiente refrigerado." },
  { icon: Timer, title: "Acúmulo no ciclo", text: "O motor soma o tempo acumulado de exposição no ciclo. Múltiplas entradas curtas (5, 10, 30 min) somam até o limite configurado." },
  { icon: AlertTriangle, title: "Alertas progressivos", text: "Aos 80 min: atenção (amarelo). Aos 90 min: crítico (laranja). Aos 100 min: bloqueio preventivo (vermelho)." },
  { icon: ShieldCheck, title: "Bloqueio preventivo", text: "Ao atingir o limite, o sistema impede nova entrada e exige pausa térmica obrigatória de 20 minutos fora do ambiente frio." },
  { icon: Wifi, title: "Recuperação térmica", text: "Após 20 min completos fora, o ciclo reinicia automaticamente. Intervalo de almoço configurado também reinicia o ciclo." },
  { icon: FileBarChart2, title: "Evidência e compliance", text: "Toda entrada, saída, pausa, alerta e justificativa é registrada com trilha de auditoria para RH, SST e Jurídico." },
];

export default function HowItWorks() {
  return (
    <div className="container py-6 md:py-10">
      <PageHead
        title="Como funciona o FrioSafe — Controle de Exposição ao Frio"
        description="Entenda o fluxo do FrioSafe: leitura facial, acúmulo de ciclo, alertas progressivos, bloqueio preventivo e pausa térmica auditável."
      />
      <PageHeader
        eyebrow="Como funciona"
        title="Controle ocupacional de exposição ao frio"
        description="Solução independente do ponto eletrônico. Não substitui registro de jornada nem intervalo intrajornada — é um controle preventivo, auditável e em tempo real da exposição ao frio e da pausa térmica."
        icon={<BookOpenCheck className="h-5 w-5" />}
      />

      <div className="relative rounded-3xl overflow-hidden border border-border bg-gradient-hero p-8 md:p-12 mb-8">
        <div className="absolute inset-0 bg-grid opacity-30 pointer-events-none" />
        <div className="relative grid md:grid-cols-2 gap-8 items-center">
          <div>
            <h2 className="font-display text-3xl md:text-4xl font-bold leading-tight">
              Protege o colaborador. <br />
              <span className="text-gradient">Comprova compliance.</span>
            </h2>
            <p className="text-muted-foreground mt-4 max-w-lg">
              O FrioSafe monitora a exposição cumulativa em ambientes artificialmente frios e aciona automaticamente alertas, bloqueios e pausas térmicas — gerando evidências defensáveis para auditorias, fiscalização e ações trabalhistas.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-2xl border border-status-yellow/40 bg-status-yellow/10 p-4"><div className="text-status-yellow font-display text-3xl font-bold">80'</div><div className="text-xs uppercase tracking-wider mt-1">Atenção</div></div>
            <div className="rounded-2xl border border-status-orange/40 bg-status-orange/10 p-4"><div className="text-status-orange font-display text-3xl font-bold">90'</div><div className="text-xs uppercase tracking-wider mt-1">Crítico</div></div>
            <div className="rounded-2xl border border-status-red/50 bg-status-red/10 p-4"><div className="text-status-red font-display text-3xl font-bold">100'</div><div className="text-xs uppercase tracking-wider mt-1">Bloqueio</div></div>
            <div className="col-span-3 rounded-2xl border border-status-break/50 bg-status-break/10 p-4 flex items-center justify-center gap-2"><Timer className="h-5 w-5 text-status-break" /> <span className="font-display font-bold text-status-break text-lg">20 min</span> de pausa térmica obrigatória</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {steps.map((s, i) => (
          <Card key={s.title} className="glass-card">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/30 text-primary grid place-items-center"><s.icon className="h-5 w-5" /></div>
                <CardTitle className="font-display text-base">{i + 1}. {s.title}</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{s.text}</CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-8 glass-card p-6 border-primary/30">
        <div className="flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 text-primary mt-0.5" />
          <div>
            <div className="font-display font-semibold">Importante: não é ponto eletrônico</div>
            <p className="text-sm text-muted-foreground mt-1">
              O FrioSafe é um sistema de <strong>controle ocupacional complementar</strong>. Ele <strong>não substitui</strong> o registro de jornada, intervalo intrajornada ou ponto eletrônico oficial. Sua finalidade é saúde ocupacional, segurança do trabalho e compliance.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
