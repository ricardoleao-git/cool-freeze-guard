import { Outlet } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { TenantSwitcher } from "@/components/TenantSwitcher";
import { SoundToggle } from "@/components/SoundToggle";
import { Bell, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useTenantScoped } from "@/lib/demo-store";
import { Link } from "react-router-dom";

export default function AppLayout() {
  const { alerts } = useTenantScoped();
  const open = alerts.filter(a => a.status === "open").length;
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
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
              <Button asChild variant="ghost" size="sm" className="relative">
                <Link to="/alertas">
                  <Bell className="h-4 w-4" />
                  {open > 0 && (
                    <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-status-red text-[10px] font-bold grid place-items-center text-white">
                      {open}
                    </span>
                  )}
                </Link>
              </Button>
              <TenantSwitcher />
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
