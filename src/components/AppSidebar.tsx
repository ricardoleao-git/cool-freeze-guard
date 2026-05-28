import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard, MonitorPlay, Users, Snowflake, Cpu, Activity, Timer,
  AlertTriangle, FileBarChart2, PlugZap, Building2, Sparkles, BookOpenCheck, ShieldCheck, FileWarning, UserCog, ClipboardList, FileLock2,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { canAccess, ROLE_LABELS } from "@/lib/permissions";

const groups = [
  {
    label: "Operação",
    items: [
      { to: "/", title: "Dashboard", icon: LayoutDashboard },
      { to: "/painel", title: "Painel Operacional", icon: MonitorPlay },
      { to: "/alertas", title: "Alertas & Ocorrências", icon: AlertTriangle },
      { to: "/ocorrencias", title: "Ocorrências (RH/SST)", icon: FileWarning },
      { to: "/historico", title: "Histórico RH/SST", icon: ClipboardList },
      { to: "/pausas", title: "Pausas Térmicas", icon: Timer },
      { to: "/eventos", title: "Eventos de Acesso", icon: Activity },
    ],
  },
  {
    label: "Cadastros",
    items: [
      { to: "/colaboradores", title: "Colaboradores", icon: Users },
      { to: "/ambientes", title: "Ambientes Frios", icon: Snowflake },
      { to: "/dispositivos", title: "Dispositivos", icon: Cpu },
    ],
  },
  {
    label: "Gestão",
    items: [
      { to: "/relatorios", title: "Relatórios", icon: FileBarChart2 },
      { to: "/integracoes", title: "Integrações / API", icon: PlugZap },
      { to: "/usuarios", title: "Usuários & Permissões", icon: UserCog },
      { to: "/empresas", title: "Empresas (Multi-tenant)", icon: Building2 },
    ],
  },
  {
    label: "Apresentação",
    items: [
      { to: "/demo", title: "Modo Experimentação", icon: Sparkles },
      { to: "/como-funciona", title: "Como Funciona", icon: BookOpenCheck },
    ],
  },
];

export function AppSidebar() {
  const { pathname } = useLocation();
  const { roles } = useAuth();
  const visibleGroups = groups
    .map(g => ({ ...g, items: g.items.filter(i => i.to === "/demo" || canAccess(i.to, roles)) }))
    .filter(g => g.items.length > 0);
  const primaryRole = roles[0];
  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="px-4 py-5">
        <div className="flex items-center gap-2.5">
          <div className="relative h-9 w-9 rounded-xl bg-gradient-to-br from-primary to-primary-glow grid place-items-center shadow-glow">
            <Snowflake className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="leading-tight">
            <div className="font-display font-bold text-[15px]">FrioSafe</div>
            <div className="text-[10.5px] text-muted-foreground uppercase tracking-wider">Controle Térmico</div>
          </div>
          {primaryRole && (
            <Badge variant="outline" className="ml-auto border-primary/40 text-primary text-[9px] px-1.5">
              {ROLE_LABELS[primaryRole].toUpperCase()}
            </Badge>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent className="px-2">
        {visibleGroups.map(g => (
          <SidebarGroup key={g.label}>
            <SidebarGroupLabel className="text-[10.5px] uppercase tracking-wider text-muted-foreground/80">{g.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map(item => {
                  const active = pathname === item.to;
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={active}>
                        <NavLink to={item.to} className="flex items-center gap-2.5">
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="px-4 py-4">
        <div className="rounded-xl border border-sidebar-border bg-sidebar-accent/40 p-3 text-xs leading-relaxed">
          <div className="flex items-center gap-1.5 font-medium mb-1"><ShieldCheck className="h-3.5 w-3.5 text-primary" /> Compliance ocupacional</div>
          <p className="text-muted-foreground">Independente do ponto eletrônico. Evidência para SST, RH e Jurídico.</p>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
