import { useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { FileDown, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useTenantScoped, useDemo } from "@/lib/demo-store";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type TenantSettings = {
  tenant_id: string;
  biometric_retention_days: number;
  logs_retention_days: number;
  occurrences_retention_days: number;
  consent_version: number;
  consent_text: string;
  lawful_basis: string;
  dpo_name: string;
  dpo_email: string;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  settings: TenantSettings | null;
  defaultEmployeeId?: string;
  requestedBy?: string;
};

type Section =
  | "profile"
  | "consents"
  | "access_events"
  | "thermal_breaks"
  | "occurrences"
  | "alerts"
  | "authorizations";

const SECTION_LABELS: Record<Section, string> = {
  profile: "Cadastro do colaborador",
  consents: "Consentimentos LGPD",
  access_events: "Eventos de acesso (logs)",
  thermal_breaks: "Pausas térmicas",
  occurrences: "Ocorrências e evidências",
  alerts: "Alertas operacionais",
  authorizations: "Autorizações por área fria",
};

const ALL_SECTIONS: Section[] = [
  "profile", "consents", "access_events", "thermal_breaks",
  "occurrences", "alerts", "authorizations",
];

function retentionFor(section: Section, s: TenantSettings | null): number | null {
  if (!s) return null;
  if (section === "consents" || section === "profile") return null;
  if (section === "access_events" || section === "alerts" || section === "authorizations") return s.logs_retention_days;
  if (section === "thermal_breaks") return s.logs_retention_days;
  if (section === "occurrences") return s.occurrences_retention_days;
  return null;
}

function withinRetention(ts: number | string | null | undefined, days: number | null): boolean {
  if (days == null) return true;
  if (!ts) return true;
  const d = typeof ts === "number" ? ts : new Date(ts).getTime();
  if (Number.isNaN(d)) return true;
  return d >= Date.now() - days * 86400_000;
}

export function EmployeeDataExportDialog({
  open, onOpenChange, settings, defaultEmployeeId, requestedBy,
}: Props) {
  const { employees, events, alerts, breaks, occurrences, employeeColdAreaAuth, coldAreas, units, departments } = useTenantScoped();
  const { activeTenantId } = useDemo();

  const [empId, setEmpId] = useState<string>(defaultEmployeeId || "");
  const [selected, setSelected] = useState<Set<Section>>(new Set(ALL_SECTIONS));
  const [reason, setReason] = useState<string>("titular_solicitou");
  const [generating, setGenerating] = useState(false);

  const employee = useMemo(() => employees.find(e => e.id === empId) || null, [employees, empId]);

  const toggle = (s: Section) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  };

  const generate = async () => {
    if (!employee) { toast.error("Selecione um colaborador."); return; }
    setGenerating(true);
    try {
      // Buscar consentimentos diretamente do banco (mais autoridade que o cache local)
      const { data: consentRows } = await supabase
        .from("employee_consents")
        .select("*")
        .eq("tenant_id", activeTenantId)
        .eq("employee_id", employee.id)
        .order("accepted_at", { ascending: false });

      const unit = units.find(u => u.id === employee.unit_id);
      const dept = departments.find(d => d.id === employee.department_id);
      const empAuthAreas = employeeColdAreaAuth
        .filter(a => a.employee_id === employee.id)
        .map(a => {
          const area = coldAreas.find(c => c.id === a.cold_area_id);
          return {
            cold_area_id: a.cold_area_id,
            cold_area_name: area?.name || a.cold_area_id,
            authorized_by: a.authorized_by,
            authorized_at: new Date(a.authorized_at).toISOString(),
          };
        });

      const filterByRet = <T extends { occurred_at?: number; triggered_at?: number; started_at?: number; created_at?: string | number }>(
        items: T[], section: Section, tsKey: keyof T,
      ) => {
        const days = retentionFor(section, settings);
        return items.filter(it => withinRetention(it[tsKey] as any, days));
      };

      const empEvents = filterByRet(events.filter(e => e.employee_id === employee.id), "access_events", "occurred_at");
      const empAlerts = filterByRet(alerts.filter(a => a.employee_id === employee.id), "alerts", "triggered_at");
      const empBreaks = filterByRet(breaks.filter(b => b.employee_id === employee.id), "thermal_breaks", "started_at");
      const empOccs = filterByRet(occurrences.filter(o => o.employee_id === employee.id), "occurrences", "created_at");

      const now = new Date();
      const payload: Record<string, any> = {
        metadata: {
          format: "frio-safe-data-subject-export/1.0",
          generated_at: now.toISOString(),
          tenant_id: activeTenantId,
          requested_by: requestedBy || "operação",
          reason,
          scope: Array.from(selected),
          retention_policy_days: settings ? {
            biometric: settings.biometric_retention_days,
            logs: settings.logs_retention_days,
            occurrences: settings.occurrences_retention_days,
          } : null,
          controller: settings ? {
            lawful_basis: settings.lawful_basis,
            dpo_name: settings.dpo_name,
            dpo_email: settings.dpo_email,
          } : null,
          notice: "Dados anteriores ao período de retenção foram expurgados/omitidos conforme a política do tenant.",
        },
      };

      if (selected.has("profile")) {
        payload.profile = {
          id: employee.id,
          name: employee.name,
          registration_number: employee.registration_number,
          position: employee.position,
          status: employee.status,
          unit: unit ? { id: unit.id, name: unit.name, city: unit.city, state: unit.state } : null,
          department: dept ? { id: dept.id, name: dept.name } : null,
        };
      }
      if (selected.has("consents")) {
        payload.consents = (consentRows || []).map(c => ({
          id: c.id,
          consent_version: c.consent_version,
          status: c.status,
          scope: c.scope,
          accepted_at: c.accepted_at,
          accepted_by: c.accepted_by,
          signature_text: c.signature_text,
          ip_origin: c.ip_origin,
          user_agent: c.user_agent,
          consent_text_snapshot: c.consent_text_snapshot,
          revoked_at: c.revoked_at,
          revocation_reason: c.revocation_reason,
        }));
      }
      if (selected.has("access_events")) {
        payload.access_events = empEvents.map(e => ({
          id: e.id,
          occurred_at: new Date(e.occurred_at).toISOString(),
          event_type: e.event_type,
          source: e.source,
          cold_area_id: e.cold_area_id,
          cold_area_name: coldAreas.find(c => c.id === e.cold_area_id)?.name || null,
          validation_status: e.validation_status,
          status_before: e.status_before ?? null,
          status_after: e.status_after ?? null,
          accumulated_at_event: e.accumulated_at_event ?? null,
          ip_origin: e.ip_origin ?? null,
          user_agent: e.user_agent ?? null,
          record_hash: e.record_hash ?? null,
          previous_hash: e.previous_hash ?? null,
        }));
      }
      if (selected.has("thermal_breaks")) {
        payload.thermal_breaks = empBreaks.map(b => ({
          id: b.id,
          started_at: new Date(b.started_at).toISOString(),
          ended_at: b.ended_at ? new Date(b.ended_at).toISOString() : null,
          completed: b.completed,
          source: b.source,
          interrupted: b.interrupted ?? false,
          interrupted_at: b.interrupted_at ? new Date(b.interrupted_at).toISOString() : null,
          interruption_reason: b.interruption_reason ?? null,
        }));
      }
      if (selected.has("occurrences")) {
        payload.occurrences = empOccs.map(o => ({
          id: o.id,
          title: o.title,
          category: o.category,
          priority: o.priority,
          status: o.status,
          description: o.description,
          created_at: typeof o.created_at === "number" ? new Date(o.created_at).toISOString() : o.created_at,
          created_by: o.created_by,
          resolved_at: o.resolved_at ? (typeof o.resolved_at === "number" ? new Date(o.resolved_at).toISOString() : o.resolved_at) : null,
          resolved_by: o.resolved_by ?? null,
          resolution: o.resolution ?? null,
          notes: (o.notes || []).map(n => ({ author: n.author, text: n.text, created_at: new Date(n.created_at).toISOString() })),
          attachments: (o.attachments || []).map(a => ({ name: a.name, mime: a.mime, size: a.size, storage_path: a.storage_path })),
        }));
      }
      if (selected.has("alerts")) {
        payload.alerts = empAlerts.map(a => ({
          id: a.id,
          alert_type: a.alert_type,
          severity: a.severity,
          message: a.message,
          triggered_at: new Date(a.triggered_at).toISOString(),
          status: a.status,
        }));
      }
      if (selected.has("authorizations")) {
        payload.authorizations = empAuthAreas;
      }

      const stamp = format(now, "yyyyMMdd-HHmm", { locale: ptBR });
      const safeName = employee.name.replace(/[^\w\d]+/g, "_");
      const fileName = `titular-${safeName}-${stamp}.json`;
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);

      toast.success(`Arquivo gerado: ${fileName}`);
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Falha ao gerar: " + (e?.message || "tente novamente"));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" /> Solicitação do titular (LGPD)
          </DialogTitle>
          <DialogDescription>
            Gera um arquivo consolidado com os dados do colaborador conforme o escopo e a política de retenção
            configurada para o tenant. Registros anteriores ao período permitido são omitidos.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Colaborador</Label>
            <Select value={empId} onValueChange={setEmpId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione o titular" /></SelectTrigger>
              <SelectContent>
                {employees.map(e => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name} — {e.registration_number}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Finalidade da solicitação</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="titular_solicitou">Solicitação do próprio titular (Art. 18 LGPD)</SelectItem>
                <SelectItem value="autoridade">Atendimento a autoridade / ANPD</SelectItem>
                <SelectItem value="auditoria_interna">Auditoria interna</SelectItem>
                <SelectItem value="portabilidade">Portabilidade</SelectItem>
                <SelectItem value="ministerio_trabalho">Inspeção do trabalho / NR-36</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Escopo do arquivo</Label>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ALL_SECTIONS.map(s => {
                const days = retentionFor(s, settings);
                return (
                  <label key={s} className="flex items-start gap-2 rounded-md border p-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={selected.has(s)}
                      onCheckedChange={() => toggle(s)}
                    />
                    <div className="flex-1">
                      <div>{SECTION_LABELS[s]}</div>
                      {days != null && (
                        <div className="text-xs text-muted-foreground">
                          Retenção: últimos {days} dias
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {settings && (
            <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground flex items-start gap-2">
              <ShieldCheck className="h-4 w-4 mt-0.5 text-status-ok" />
              <div>
                Arquivo emitido sob base legal{" "}
                <Badge variant="outline" className="ml-1 mr-1">{settings.lawful_basis}</Badge>
                — DPO: {settings.dpo_name || "—"} {settings.dpo_email ? `<${settings.dpo_email}>` : ""}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={generate} disabled={!empId || selected.size === 0 || generating}>
            <FileDown className="h-4 w-4 mr-2" />
            {generating ? "Gerando..." : "Gerar arquivo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
