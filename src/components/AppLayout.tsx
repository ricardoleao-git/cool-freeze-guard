import { Outlet, useNavigate, Link } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { TenantSwitcher } from "@/components/TenantSwitcher";
import { SoundToggle } from "@/components/SoundToggle";
import { NotificationsBell } from "@/components/NotificationsBell";
import { Bell, Search, LogOut, User as UserIcon, Sparkles, LogIn } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTenantScoped } from "@/lib/demo-store";
import { useAuth } from "@/lib/auth";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export default function AppLayout() {
  const { alerts } = useTenantScoped();
  const { user, signOut, isDemo } = useAuth();
  const nav = useNavigate();
  const handleLogout = async () => { await signOut(); nav("/login", { replace: true }); };
  const open = alerts.filter(a => a.status === "open").length;
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          {isDemo && (
            <div className="bg-status-yellow/15 border-b border-status-yellow/40 text-foreground/90 px-4 py-1.5 text-[12px] flex items-center gap-2 flex-wrap">
              <Sparkles className="h-3.5 w-3.5 text-status-yellow" />
              <span><strong>Modo demonstração</strong> — dados simulados públicos no tenant <code className="px-1 rounded bg-background/60">demo-tenant</code>. Sem login necessário.</span>
              <Button asChild size="sm" variant="outline" className="ml-auto h-7 text-[11px]">
                <Link to="/login"><LogIn className="h-3 w-3 mr-1" /> Entrar com minha conta</Link>
              </Button>
            </div>
          )}
          <header className="h-14 flex items-center gap-3 border-b border-border/60 px-3 md:px-5 bg-background/70 backdrop-blur sticky top-0 z-30">
            <SidebarTrigger className="text-foreground" />
            <div className="hidden md:flex items-center gap-2 max-w-md flex-1">
              <div className="relative w-full">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Buscar colaborador, ambiente, dispositivo…" className="pl-8 bg-muted/30 border-border/60" />
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <SoundToggle />
              <NotificationsBell />
              <Button asChild variant="ghost" size="sm" className="relative">
                <Link to={isDemo ? "/demo/alertas" : "/alertas"}>
                  <Bell className="h-4 w-4" />
                  {open > 0 && (
                    <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-status-red text-[10px] font-bold grid place-items-center text-white">
                      {open}
                    </span>
                  )}
                </Link>
              </Button>
              {!isDemo && <TenantSwitcher />}
              {isDemo ? (
                <Badge variant="outline" className="border-status-yellow/60 text-status-yellow gap-1">
                  <Sparkles className="h-3 w-3" /> demo-tenant
                </Badge>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-2">
                      <UserIcon className="h-4 w-4" />
                      <span className="hidden md:inline text-xs max-w-[140px] truncate">{user?.email}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel className="truncate">{user?.email}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleLogout} className="text-status-red focus:text-status-red">
                      <LogOut className="h-4 w-4 mr-2" /> Sair
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </header>
          <main className="flex-1 min-w-0">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
