import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, ClipboardCheck, Check, X, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useDemo, useTenantScoped } from "@/lib/demo-store";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type Correction = {
  id: string;
  employee_id: string;
  reason_category: string;
  reason_detail: string;
  status: string;
  approved_by_name: string | null;
  rejection_reason: string | null;
  employee_response: string | null;
  employee_responded_at: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

const REASON_LABEL: Record<string, string> = {
  esquecimento_saida: "Esquecimento de saída",
  esquecimento_entrada: "Esquecimento de entrada",
  falha_dispositivo: "Falha de dispositivo",
  leitura_duplicada: "Leitura duplicada",
  horario_incorreto: "Horário incorreto",
  tipo_incorreto: "Tipo incorreto",
  outro: "Outro motivo",
};

const STATUS_META: Record<string, { label: string; cls: string; icon: typeof Check }> = {
  pending: { label: "Aguardando colaborador", cls: "border-status-yellow/40 text-status-yellow", icon: ClipboardCheck },
  employee_accepted: { label: "Colaborador aceitou", cls: "border-status-ok/40 text-status-ok", icon: Check },
  employee_contested: { label: "Colaborador contestou", cls: "border-status-red/40 text-status-red", icon: MessageSquare },
  approved: { label: "Aprovada pelo supervisor", cls: "border-status-ok/40 text-status-ok", icon: Check },
  rejected: { label: "Rejeitada pelo supervisor", cls: "border-muted-foreground/30 text-muted-foreground", icon: X },
};

const SUPERVISOR_FINAL = new Set(["approved", "rejected"]);
const NEEDS_SUPERVISOR_REVIEW = new Set(["employee_accepted", "employee_contested"]);

export function NotificationsBell() {
  const { activeTenantId } = useDemo();
  const { employees } = useTenantScoped();
  const { roles } = useAuth();
  const [items, setItems] = useState<Correction[]>([]);
  const [open, setOpen] = useState(false);
  const seen = useRef<Map<string, string>>(new Map()); // id -> status
  const bootstrapped = useRef(false);

  const isSupervisor = roles.some(r => ["super_admin", "administrador", "gestor", "rh_sst"].includes(r));

  const employeeName = (id: string) => employees.find(e => e.id === id)?.name || id;

  const load = async () => {
    const { data } = await supabase
      .from("access_event_corrections")
      .select("id,employee_id,reason_category,reason_detail,status,approved_by_name,rejection_reason,employee_response,employee_responded_at,approved_at,created_at,updated_at")
      .eq("tenant_id", activeTenantId)
      .order("updated_at", { ascending: false })
      .limit(30);
    const list = (data || []) as Correction[];
    // emit toasts for changes after first load
    if (bootstrapped.current) {
      for (const c of list) {
        const prev = seen.current.get(c.id);
        if (!prev) {
          if (c.status === "pending") {
            toast(`Nova correção pendente — ${employeeName(c.employee_id)}`, {
              description: REASON_LABEL[c.reason_category] || c.reason_category,
              action: { label: "Abrir", onClick: () => window.location.assign(isSupervisor ? "/ajustes" : "/meu-dia") },
            });
          }
        } else if (prev !== c.status) {
          if (SUPERVISOR_FINAL.has(c.status)) {
            (c.status === "approved" ? toast.success : toast.error)(
              `Correção ${c.status === "approved" ? "aprovada" : "rejeitada"} — ${employeeName(c.employee_id)}`,
              {
                description: c.status === "approved"
                  ? `Validada por ${c.approved_by_name || "supervisor"}.`
                  : `Motivo: ${c.rejection_reason || "não informado"}.`,
                action: { label: "Ver", onClick: () => window.location.assign(isSupervisor ? "/ajustes" : "/meu-dia") },
              }
            );
          } else if (NEEDS_SUPERVISOR_REVIEW.has(c.status) && isSupervisor) {
            toast(`Colaborador ${c.status === "employee_accepted" ? "aceitou" : "contestou"} — ${employeeName(c.employee_id)}`, {
              description: c.employee_response || REASON_LABEL[c.reason_category] || "",
              action: { label: "Validar", onClick: () => window.location.assign("/ajustes") },
            });
          }
        }
      }
    }
    seen.current = new Map(list.map(c => [c.id, c.status]));
    setItems(list);
    bootstrapped.current = true;
  };

  useEffect(() => {
    bootstrapped.current = false;
    seen.current = new Map();
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line
  }, [activeTenantId]);

  const unread = items.filter(c =>
    isSupervisor
      ? NEEDS_SUPERVISOR_REVIEW.has(c.status) || c.status === "pending"
      : c.status === "pending" || SUPERVISOR_FINAL.has(c.status)
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="relative">
          <Bell className="h-4 w-4" />
          {unread.length > 0 && (
            <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-primary text-[10px] font-bold grid place-items-center text-primary-foreground">
              {unread.length}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[360px] p-0">
        <div className="px-3 py-2.5 border-b border-border/60 flex items-center justify-between">
          <span className="text-sm font-semibold">Notificações</span>
          <Badge variant="outline" className="text-[10px]">{unread.length} pendente(s)</Badge>
        </div>
        <ScrollArea className="max-h-[420px]">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground px-3 py-6 text-center">Sem notificações.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {items.slice(0, 15).map(c => {
                const meta = STATUS_META[c.status] || STATUS_META.pending;
                const Icon = meta.icon;
                const when = c.approved_at || c.employee_responded_at || c.updated_at || c.created_at;
                return (
                  <li key={c.id} className="px-3 py-2.5 hover:bg-muted/30">
                    <Link
                      to={isSupervisor ? "/ajustes" : "/meu-dia"}
                      onClick={() => setOpen(false)}
                      className="block space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium truncate">{employeeName(c.employee_id)}</span>
                        <Badge variant="outline" className={`text-[10px] ${meta.cls}`}>
                          <Icon className="h-3 w-3 mr-1" />{meta.label}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground line-clamp-2">
                        {REASON_LABEL[c.reason_category] || c.reason_category}
                        {c.status === "rejected" && c.rejection_reason ? ` · ${c.rejection_reason}` : ""}
                        {c.status === "employee_contested" && c.employee_response ? ` · ${c.employee_response}` : ""}
                      </p>
                      <span className="text-[10px] text-muted-foreground">
                        {format(new Date(when), "dd/MM HH:mm", { locale: ptBR })}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
        <div className="px-3 py-2 border-t border-border/60 flex justify-between">
          <Link to="/meu-dia" onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">Meu Dia</Link>
          {isSupervisor && (
            <Link to="/ajustes" onClick={() => setOpen(false)} className="text-xs text-primary hover:underline">Abrir ajustes</Link>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
