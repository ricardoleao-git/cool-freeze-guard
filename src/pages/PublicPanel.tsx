import { useEffect } from "react";
import { useDemo } from "@/lib/demo-store";
import OperationalPanel from "./OperationalPanel";

/**
 * Painel público para TV/monitor operacional.
 * Rota: /painel-demo — não exige login e opera apenas no tenant 'demo-tenant'
 * (policies anon permitem leitura). Ideal para deixar exibindo numa TV.
 */
export default function PublicPanel() {
  const { setActiveTenantId } = useDemo();
  useEffect(() => { setActiveTenantId("demo-tenant"); }, [setActiveTenantId]);
  return <OperationalPanel />;
}
