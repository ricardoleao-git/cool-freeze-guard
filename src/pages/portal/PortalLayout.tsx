import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { Home, ListOrdered, AlertTriangle, User, Snowflake, WifiOff } from "lucide-react";
import { usePortal } from "@/lib/portal";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/colaborador/inicio", label: "Início", icon: Home },
  { to: "/colaborador/extrato", label: "Extrato", icon: ListOrdered },
  { to: "/colaborador/ocorrencias", label: "Ocorrências", icon: AlertTriangle },
  { to: "/colaborador/perfil", label: "Perfil", icon: User },
];

export default function PortalLayout() {
  const { token, link, links, ready, mustChangePassword, offline } = usePortal();
  const loc = useLocation();

  if (!ready) {
    return <div className="min-h-[100dvh] grid place-items-center text-sm text-muted-foreground">Carregando…</div>;
  }
  if (!token || mustChangePassword || (!link && links.length !== 1)) {
    return <Navigate to="/colaborador" state={{ from: loc.pathname }} replace />;
  }

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto w-full max-w-2xl px-4 py-3 flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-primary to-primary-glow grid place-items-center shrink-0">
            <Snowflake className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display font-semibold text-sm leading-tight truncate">{link?.short_name ?? "Colaborador"}</div>
            <div className="text-[11px] text-muted-foreground truncate">
              {[link?.tenant_name, link?.unit_name].filter(Boolean).join(" · ")}
            </div>
          </div>
        </div>
        {offline && (
          <div className="flex items-center justify-center gap-2 bg-status-yellow/15 text-[12px] py-1.5 px-4 text-status-yellow">
            <WifiOff className="h-3.5 w-3.5" /> Sem conexão — mostrando os últimos dados carregados
          </div>
        )}
      </header>

      <main className="flex-1 mx-auto w-full max-w-2xl px-4 py-4 pb-28">
        <Outlet />
      </main>

      <nav
        aria-label="Navegação principal"
        className="fixed bottom-0 left-0 right-0 z-30 border-t border-border/60 bg-background/95 backdrop-blur"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="mx-auto max-w-2xl grid grid-cols-4">
          {TABS.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) => cn(
                  "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg",
                  isActive ? "text-primary" : "text-muted-foreground",
                )}
              >
                {({ isActive }) => (
                  <>
                    <Icon className={cn("h-5 w-5", isActive && "drop-shadow")} />
                    {label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
