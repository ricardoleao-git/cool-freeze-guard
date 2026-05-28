import { useEffect, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@components/ui/button";
import {
  Smartphone,
  Share2,
  PlusSquare,
  Download,
  X,
  CheckCircle2,
  ChevronRight,
  Home,
} from "lucide-react";

// Detecta se o app está rodando como PWA instalado
function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true
  );
}

function detectPlatform(): "ios" | "android" | "desktop" | "unknown" {
  if (typeof window === "undefined") return "unknown";
  const ua = window.navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

const STORAGE_KEY = "friosafe_install_banner_dismissed";

export default function InstallPWA() {
  const [visible, setVisible] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "android" | "desktop" | "unknown">("unknown");
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    // Se já instalado, não mostra
    if (isStandalone()) {
      setIsInstalled(true);
      return;
    }

    // Verifica se usuário já dispensou
    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (dismissed === "true") return;

    setPlatform(detectPlatform());
    setVisible(true);

    // Listener para Android Chrome beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // Listener para mudança no display mode
    const mql = window.matchMedia("(display-mode: standalone)");
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        setIsInstalled(true);
        setVisible(false);
      }
    };
    mql.addEventListener("change", onChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      mql.removeEventListener("change", onChange);
    };
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    localStorage.setItem(STORAGE_KEY, "true");
  }, []);

  const handleInstallClick = useCallback(async () => {
    if (!deferredPrompt) {
      setExpanded(true);
      return;
    }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setIsInstalled(true);
      setVisible(false);
    }
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  if (!visible || isInstalled) return null;

  const isMobile = platform === "ios" || platform === "android";

  return (
    <Card className="border border-primary/20 bg-gradient-to-br from-primary/5 to-transparent relative overflow-hidden">
      <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -translate-y-1/2 translate-x-1/2" />
      
      <CardContent className="pt-5 pb-5 relative">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Smartphone className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Instale o FrioSafe no seu celular
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Acesse o Meu Dia mais rápido, mesmo offline.
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 -mr-1 -mt-1"
            onClick={dismiss}
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {!expanded ? (
          <div className="mt-4 flex flex-col sm:flex-row gap-2">
            {deferredPrompt && (
              <Button size="sm" className="gap-2" onClick={handleInstallClick}>
                <Download className="h-3.5 w-3.5" />
                Instalar agora
              </Button>
            )}
            <Button
              size="sm"
              variant={deferredPrompt ? "outline" : "default"}
              className="gap-2"
              onClick={() => setExpanded(true)}
            >
              <ChevronRight className="h-3.5 w-3.5" />
              Ver passo a passo
            </Button>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {platform === "ios" && <IOSInstructions />}
            {platform === "android" && <AndroidInstructions />}
            {platform === "desktop" && <DesktopInstructions />}
            {platform === "unknown" && isMobile && <GenericInstructions />}

            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={() => setExpanded(false)}>
                Ocultar passo a passo
              </Button>
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={dismiss}>
                Não mostrar novamente
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Step({ number, icon, title, children }: { number: number; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center gap-1">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
          {number}
        </div>
        <div className="w-px flex-1 bg-border/60 min-h-[12px]" />
      </div>
      <div className="pb-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          {icon}
          {title}
        </div>
        <div className="text-xs text-muted-foreground mt-1 leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

function IOSInstructions() {
  return (
    <div className="space-y-1">
      <Step number={1} icon={<Share2 className="h-3.5 w-3.5 text-primary" />} title="Toque em Compartilhar">
        Na barra inferior do Safari, toque no ícone <Share2 className="inline h-3 w-3 mx-0.5" /> de compartilhamento.
      </Step>
      <Step number={2} icon={<PlusSquare className="h-3.5 w-3.5 text-primary" />} title="Escolha 'Adicionar à Tela de Início'">
        Role as opções até encontrar <strong>Adicionar à Tela de Início</strong> e toque nela.
      </Step>
      <Step number={3} icon={<Home className="h-3.5 w-3.5 text-primary" />} title="Confirme e pronto">
        Toque em <strong>Adicionar</strong> no canto superior direito. O ícone do FrioSafe aparecerá na sua tela inicial.
      </Step>
      <div className="flex gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center">
          <CheckCircle2 className="h-5 w-5 text-status-ok" />
        </div>
        <p className="text-xs text-status-ok font-medium">
          Da próxima vez, abra o app pelo ícone. Você entrará direto no Meu Dia, mesmo sem internet.
        </p>
      </div>
    </div>
  );
}

function AndroidInstructions() {
  return (
    <div className="space-y-1">
      <Step number={1} icon={<Download className="h-3.5 w-3.5 text-primary" />} title="Toque em 'Instalar app'">
        No Chrome, toque no menu <span className="font-mono text-[10px] border border-border rounded px-1">⋮</span> e selecione <strong>Instalar app</strong> ou aguarde o banner nativo aparecer.
      </Step>
      <Step number={2} icon={<CheckCircle2 className="h-3.5 w-3.5 text-primary" />} title="Confirme a instalação">
        Toque em <strong>Instalar</strong> no dialogo que aparecer. O Chrome baixará e criará o atalho.
      </Step>
      <Step number={3} icon={<Home className="h-3.5 w-3.5 text-primary" />} title="Abra pelo ícone">
        Encontre o ícone <strong>FrioSafe</strong> na sua tela inicial ou gaveta de apps. Toque para abrir direto no Meu Dia.
      </Step>
      <div className="flex gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center">
          <CheckCircle2 className="h-5 w-5 text-status-ok" />
        </div>
        <p className="text-xs text-status-ok font-medium">
          O app funciona offline e abre em tela cheia, sem barra de endereço do navegador.
        </p>
      </div>
    </div>
  );
}

function DesktopInstructions() {
  return (
    <div className="space-y-1">
      <Step number={1} icon={<Download className="h-3.5 w-3.5 text-primary" />} title="Clique no ícone de instalação">
        Na barra de endereço do Chrome/Edge, clique no ícone de instalação <Download className="inline h-3 w-3 mx-0.5" /> ou vá em Menu → Instalar FrioSafe.
      </Step>
      <Step number={2} icon={<CheckCircle2 className="h-3.5 w-3.5 text-primary" />} title="Confirme a instalação">
        Clique em <strong>Instalar</strong> no dialogo. O app será adicionado à área de trabalho e à barra de tarefas.
      </Step>
      <div className="flex gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center">
          <CheckCircle2 className="h-5 w-5 text-status-ok" />
        </div>
        <p className="text-xs text-status-ok font-medium">
          O FrioSafe abrirá como um app nativo, sem barra de endereço, direto no Meu Dia.
        </p>
      </div>
    </div>
  );
}

function GenericInstructions() {
  return (
    <div className="space-y-1">
      <Step number={1} icon={<Share2 className="h-3.5 w-3.5 text-primary" />} title="Abra no navegador">
        Use Chrome (Android) ou Safari (iPhone/iPad) para acessar o FrioSafe.
      </Step>
      <Step number={2} icon={<PlusSquare className="h-3.5 w-3.5 text-primary" />} title="Adicione à tela inicial">
        No menu do navegador, procure <strong>Adicionar à tela inicial</strong> ou <strong>Instalar app</strong>.
      </Step>
      <Step number={3} icon={<Home className="h-3.5 w-3.5 text-primary" />} title="Acesse pelo ícone">
        Da próxima vez, abra pelo ícone na tela inicial. Você entrará direto no Meu Dia.
      </Step>
    </div>
  );
}
