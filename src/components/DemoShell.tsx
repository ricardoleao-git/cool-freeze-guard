import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDemo } from "@/lib/demo-store";
import AppLayout from "@/components/AppLayout";
import { regenerateDemoSeed, getAutoRegenerate } from "@/lib/demo-seed";
import { toast } from "sonner";

/**
 * Shell público de demonstração. Reaproveita o AppLayout completo (sidebar +
 * todos os menus), porém sem exigir login e forçando o tenant para
 * 'demo-tenant'. As policies anon liberam leitura/escrita apenas nesse escopo.
 * Se o usuário ativou "Regenerar dados ao entrar", recria empresas/unidades/
 * colaboradores fictícios antes de exibir a interface.
 */
export default function DemoShell() {
  const { activeTenantId, setActiveTenantId } = useDemo();
  const [regenerating, setRegenerating] = useState(false);
  const ranRef = useRef(false);

  useLayoutEffect(() => {
    if (activeTenantId !== "demo-tenant") setActiveTenantId("demo-tenant");
  }, [activeTenantId, setActiveTenantId]);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    if (!getAutoRegenerate()) return;
    setRegenerating(true);
    regenerateDemoSeed()
      .then(() => {
        toast.success("Dados de demonstração regenerados.");
        setTimeout(() => window.location.reload(), 400);
      })
      .catch((err) => {
        console.error(err);
        toast.error("Não foi possível regenerar os dados de demonstração.");
        setRegenerating(false);
      });
  }, []);

  if (activeTenantId !== "demo-tenant" || regenerating) {
    return (
      <div className="min-h-screen grid place-items-center text-muted-foreground text-sm">
        {regenerating ? "Regenerando dados de demonstração…" : "Carregando ambiente de demonstração…"}
      </div>
    );
  }

  return <AppLayout />;
}
