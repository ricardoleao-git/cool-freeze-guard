import { useLayoutEffect } from "react";
import { useDemo } from "@/lib/demo-store";
import OperationalPanel from "./OperationalPanel";

/**
 * Painel público para TV/monitor operacional.
 * Rota: /painel-demo — não exige login e opera apenas no tenant 'demo-tenant'
 * (policies anon permitem leitura). Ideal para deixar exibindo numa TV.
 */
export default function PublicPanel() {
  const { activeTenantId, setActiveTenantId } = useDemo();

  useLayoutEffect(() => {
    if (activeTenantId !== "demo-tenant") {
      setActiveTenantId("demo-tenant");
    }
  }, [activeTenantId, setActiveTenantId]);

  if (activeTenantId !== "demo-tenant") {
    return (
      <div className="min-h-screen grid place-items-center text-muted-foreground text-sm">
        Carregando painel operacional…
      </div>
    );
  }

  return <OperationalPanel />;
}
