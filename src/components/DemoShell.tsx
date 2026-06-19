import { useLayoutEffect } from "react";
import { useDemo } from "@/lib/demo-store";
import AppLayout from "@/components/AppLayout";

/**
 * Shell público de demonstração. Reaproveita o AppLayout completo (sidebar +
 * todos os menus), porém sem exigir login e forçando o tenant para
 * 'demo-tenant'. As policies anon liberam leitura/escrita apenas nesse escopo.
 */
export default function DemoShell() {
  const { activeTenantId, setActiveTenantId } = useDemo();

  useLayoutEffect(() => {
    if (activeTenantId !== "demo-tenant") setActiveTenantId("demo-tenant");
  }, [activeTenantId, setActiveTenantId]);

  if (activeTenantId !== "demo-tenant") {
    return (
      <div className="min-h-screen grid place-items-center text-muted-foreground text-sm">
        Carregando ambiente de demonstração…
      </div>
    );
  }

  return <AppLayout />;
}
