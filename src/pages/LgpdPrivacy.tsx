import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ShieldCheck, FileLock2, Trash2, RotateCcw, Save, UserCheck, AlertTriangle, FileDown } from "lucide-react";
import { EmployeeDataExportDialog } from "@/components/EmployeeDataExportDialog";
import { useDemo, useTenantScoped } from "@/lib/demo-store";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
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
  privacy_policy_url: string;
  require_consent_before_capture: boolean;
};

type EmployeeConsent = {
  id: string;
  tenant_id: string;
  employee_id: string;
  consent_version: number;
  scope: string[];
  status: "active" | "revoked";
  accepted_at: string;
  accepted_by: string;
  signature_text: string;
  consent_text_snapshot: string;
  ip_origin: string | null;
  user_agent: string | null;
  revoked_at: string | null;
  revocation_reason: string | null;
};

const DEFAULT_CONSENT = `Autorizo a empresa, na qualidade de Controladora, a tratar meus dados pessoais e biométricos (reconhecimento facial e logs de acesso) com a finalidade exclusiva de controle de exposição ao frio, cumprimento da NR-36/NR-15 e segurança do trabalho, pelo prazo de retenção definido nesta política. Estou ciente do meu direito de revogar este consentimento e solicitar exclusão dos dados a qualquer momento.`;

const LAWFUL_BASIS: Array<{ value: string; label: string }> = [
  { value: "obrigacao_legal", label: "Obrigação legal e regulatória (NR-36 / NR-15)" },
  { value: "consentimento", label: "Consentimento do titular" },
  { value: "execucao_contrato", label: "Execução de contrato de trabalho" },
  { value: "legitimo_interesse", label: "Legítimo interesse do controlador" },
];

const SCOPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "biometric_facial", label: "Biometria facial" },
  { value: "access_logs", label: "Logs de acesso" },
  { value: "thermal_breaks", label: "Pausas térmicas" },
  { value: "occurrences", label: "Ocorrências e evidências" },
];

export default function LgpdPrivacy() {
  const { activeTenantId } = useDemo();
  const { employees } = useTenantScoped();
  const { profile, roles } = useAuth();
  const canManage = roles.some(r => ["super_admin", "administrador", "gestor", "rh_sst"].includes(r));

  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [draft, setDraft] = useState<TenantSettings | null>(null);
  const [consents, setConsents] = useState<EmployeeConsent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Diálogo de captura
  const [openCapture, setOpenCapture] = useState(false);
  const [captureEmp, setCaptureEmp] = useState<string>("");
  const [captureScope, setCaptureScope] = useState<string[]>(["biometric_facial", "access_logs"]);
  const [signatureText, setSignatureText] = useState("");

  // Diálogo de exportação de dados do titular
  const [openExport, setOpenExport] = useState(false);
  const [exportEmp, setExportEmp] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [{ data: tsRows }, { data: ecRows }] = await Promise.all([
        supabase.from("tenant_settings").select("*").eq("tenant_id", activeTenantId).maybeSingle(),
        supabase.from("employee_consents").select("*").eq("tenant_id", activeTenantId)
          .order("accepted_at", { ascending: false }).limit(500),
      ]);
      if (cancelled) return;
      const ts: TenantSettings = (tsRows as any) || {
        tenant_id: activeTenantId,
        biometric_retention_days: 180,
        logs_retention_days: 730,
        occurrences_retention_days: 1825,
        consent_version: 1,
        consent_text: DEFAULT_CONSENT,
        lawful_basis: "obrigacao_legal",
        dpo_name: "",
        dpo_email: "",
        privacy_policy_url: "",
        require_consent_before_capture: true,
      };
      setSettings(ts);
      setDraft(ts);
      setConsents((ecRows as any) || []);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [activeTenantId]);

  const consentByEmp = useMemo(() => {
    const map = new Map<string, EmployeeConsent>();
    for (const c of consents) {
      if (!map.has(c.employee_id)) map.set(c.employee_id, c);
    }
    return map;
  }, [consents]);

  const stats = useMemo(() => {
    const total = employees.length;
    let activeCount = 0;
    let outdated = 0;
    employees.forEach(e => {
      const c = consentByEmp.get(e.id);
      if (c && c.status === "active") {
        activeCount++;
        if (settings && c.consent_version < settings.consent_version) outdated++;
      }
    });
    return { total, activeCount, outdated, missing: total - activeCount };
  }, [employees, consentByEmp, settings]);

  const updateDraft = (patch: Partial<TenantSettings>) =>
    setDraft(d => (d ? { ...d, ...patch } : d));

  const saveSettings = async () => {
    if (!draft || !canManage) return;
    setSaving(true);
    try {
      const versionBumped = !!settings && draft.consent_text.trim() !== settings.consent_text.trim()
        ? Math.max(settings.consent_version + 1, draft.consent_version)
        : draft.consent_version;
      const payload = { ...draft, consent_version: versionBumped };
      const { error } = await supabase.from("tenant_settings").upsert(payload as any, { onConflict: "tenant_id" });
      if (error) throw error;
      setSettings(payload);
      setDraft(payload);
      toast.success("Configurações de privacidade salvas.");
    } catch (e: any) {
      toast.error("Falha ao salvar: " + (e?.message || "tente novamente"));
    } finally {
      setSaving(false);
    }
  };

  const writeAudit = async (entry: {
    employee_id: string;
    consent_id: string | null;
    event_type: "consent_given" | "consent_revoked" | "consent_renewed";
    consent_version: number | null;
    reason?: string | null;
    snapshot?: Record<string, unknown>;
  }) => {
    try {
      await supabase.from("consent_audit_log").insert({
        tenant_id: activeTenantId,
        employee_id: entry.employee_id,
        consent_id: entry.consent_id,
        event_type: entry.event_type,
        consent_version: entry.consent_version,
        acted_by_user_id: profile?.user_id ?? null,
        acted_by_email: profile?.email ?? null,
        acted_by_name: profile?.full_name || profile?.email || "operação",
        reason: entry.reason ?? null,
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
        snapshot: entry.snapshot ?? {},
      } as any);
    } catch (e) {
      console.error("Falha ao gravar trilha de consentimento", e);
    }
  };

  const recordConsent = async () => {
    if (!settings || !captureEmp || !signatureText.trim()) {
      toast.error("Selecione o colaborador e assine para registrar o aceite.");
      return;
    }
    const previous = consentByEmp.get(captureEmp);
    const isRenewal = !!previous;
    const payload = {
      tenant_id: activeTenantId,
      employee_id: captureEmp,
      consent_version: settings.consent_version,
      scope: captureScope.length ? captureScope : ["biometric_facial", "access_logs"],
      status: "active",
      accepted_at: new Date().toISOString(),
      accepted_by: profile?.full_name || profile?.email || "operação",
      signature_text: signatureText.trim(),
      consent_text_snapshot: settings.consent_text || DEFAULT_CONSENT,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
    };
    const { data, error } = await supabase.from("employee_consents").insert(payload as any).select().single();
    if (error) { toast.error("Falha ao registrar: " + error.message); return; }
    setConsents(prev => [data as any, ...prev]);
    await writeAudit({
      employee_id: captureEmp,
      consent_id: (data as any).id,
      event_type: isRenewal ? "consent_renewed" : "consent_given",
      consent_version: settings.consent_version,
      snapshot: {
        scope: payload.scope,
        signature_text_length: payload.signature_text.length,
        previous_version: previous?.consent_version ?? null,
        previous_status: previous?.status ?? null,
      },
    });
    setOpenCapture(false);
    setCaptureEmp(""); setSignatureText(""); setCaptureScope(["biometric_facial", "access_logs"]);
    toast.success("Consentimento registrado.");
  };

  const revokeConsent = async (c: EmployeeConsent) => {
    const reason = window.prompt("Motivo da revogação (opcional):") || "";
    const { error } = await supabase.from("employee_consents").update({
      status: "revoked", revoked_at: new Date().toISOString(), revocation_reason: reason,
    } as any).eq("id", c.id);
    if (error) { toast.error("Falha ao revogar: " + error.message); return; }
    setConsents(prev => prev.map(x => x.id === c.id
      ? { ...x, status: "revoked", revoked_at: new Date().toISOString(), revocation_reason: reason }
      : x));
    await writeAudit({
      employee_id: c.employee_id,
      consent_id: c.id,
      event_type: "consent_revoked",
      consent_version: c.consent_version,
      reason,
      snapshot: { scope: c.scope, previous_status: "active" },
    });
    toast.success("Consentimento revogado.");
  };

  if (loading || !draft) {
    return (
      <div className="p-4 md:p-8">
        <PageHeader
          eyebrow="LGPD"
          icon={<ShieldCheck className="h-5 w-5" />}
          title="Privacidade & Retenção"
          description="Carregando configurações..."
        />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 space-y-6">
      <PageHeader
        eyebrow="LGPD"
        icon={<ShieldCheck className="h-5 w-5" />}
        title="Privacidade & Retenção"
        description="Defina a política de retenção dos dados biométricos e de logs, registre o consentimento dos titulares e mantenha rastreabilidade dos aceites."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => { setExportEmp(""); setOpenExport(true); }}>
              <FileDown className="h-4 w-4 mr-2" /> Exportar dados do titular
            </Button>
            {canManage && (
              <Button onClick={saveSettings} disabled={saving}>
                <Save className="h-4 w-4 mr-2" /> Salvar alterações
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <StatTile label="Colaboradores" value={stats.total} />
        <StatTile label="Consentimento ativo" value={stats.activeCount} tone="ok" />
        <StatTile label="Pendentes" value={stats.missing} tone={stats.missing ? "warn" : "muted"} />
        <StatTile label="Versão desatualizada" value={stats.outdated} tone={stats.outdated ? "warn" : "muted"} />
      </div>

      <Tabs defaultValue="retention" className="w-full">
        <TabsList>
          <TabsTrigger value="retention"><FileLock2 className="h-4 w-4 mr-2" /> Retenção</TabsTrigger>
          <TabsTrigger value="consent"><ShieldCheck className="h-4 w-4 mr-2" /> Consentimento</TabsTrigger>
          <TabsTrigger value="registry"><UserCheck className="h-4 w-4 mr-2" /> Registros</TabsTrigger>
          <TabsTrigger value="purge"><Trash2 className="h-4 w-4 mr-2" /> Purga & Auditoria</TabsTrigger>
          <TabsTrigger value="trail"><FileLock2 className="h-4 w-4 mr-2" /> Trilha de consentimentos</TabsTrigger>
        </TabsList>

        <TabsContent value="retention" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Política de retenção</CardTitle>
              <CardDescription>
                Define por quantos dias cada categoria de dado pode ser mantida antes do expurgo automático.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <RetField label="Biometria facial (dias)" value={draft.biometric_retention_days}
                onChange={v => updateDraft({ biometric_retention_days: v })} disabled={!canManage} />
              <RetField label="Logs de acesso (dias)" value={draft.logs_retention_days}
                onChange={v => updateDraft({ logs_retention_days: v })} disabled={!canManage} />
              <RetField label="Ocorrências e evidências (dias)" value={draft.occurrences_retention_days}
                onChange={v => updateDraft({ occurrences_retention_days: v })} disabled={!canManage} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Governança</CardTitle>
              <CardDescription>Encarregado pelo Tratamento (DPO), base legal e link da política pública.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>Base legal aplicável</Label>
                <Select value={draft.lawful_basis} onValueChange={v => updateDraft({ lawful_basis: v })} disabled={!canManage}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LAWFUL_BASIS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Política pública (URL)</Label>
                <Input className="mt-1" value={draft.privacy_policy_url}
                  placeholder="https://..." disabled={!canManage}
                  onChange={e => updateDraft({ privacy_policy_url: e.target.value })} />
              </div>
              <div>
                <Label>Nome do DPO</Label>
                <Input className="mt-1" value={draft.dpo_name} disabled={!canManage}
                  onChange={e => updateDraft({ dpo_name: e.target.value })} />
              </div>
              <div>
                <Label>E-mail do DPO</Label>
                <Input className="mt-1" type="email" value={draft.dpo_email} disabled={!canManage}
                  onChange={e => updateDraft({ dpo_email: e.target.value })} />
              </div>
              <div className="md:col-span-2 flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label className="text-sm">Exigir consentimento antes da captura</Label>
                  <p className="text-xs text-muted-foreground">Bloqueia o cadastro de biometria sem aceite vigente do titular.</p>
                </div>
                <Switch checked={draft.require_consent_before_capture}
                  onCheckedChange={v => updateDraft({ require_consent_before_capture: v })}
                  disabled={!canManage} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="consent" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Texto do consentimento
                <Badge variant="outline">v{draft.consent_version}</Badge>
              </CardTitle>
              <CardDescription>
                Toda alteração relevante incrementa a versão. Aceites antigos ficam marcados como desatualizados até nova captura.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea rows={10} value={draft.consent_text} disabled={!canManage}
                onChange={e => updateDraft({ consent_text: e.target.value })}
                className="font-mono text-[13px] leading-relaxed" />
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => updateDraft({ consent_text: DEFAULT_CONSENT })} disabled={!canManage}>
                  <RotateCcw className="h-4 w-4 mr-2" /> Restaurar texto padrão
                </Button>
                <span className="text-xs text-muted-foreground">
                  Base legal: {LAWFUL_BASIS.find(b => b.value === draft.lawful_basis)?.label}
                </span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="registry" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Registros de aceite</CardTitle>
                <CardDescription>Cada aceite preserva versão do texto, assinatura, IP e dispositivo.</CardDescription>
              </div>
              {canManage && (
                <Button onClick={() => setOpenCapture(true)}>
                  <UserCheck className="h-4 w-4 mr-2" /> Registrar consentimento
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Colaborador</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Versão</TableHead>
                    <TableHead>Aceite</TableHead>
                    <TableHead>Escopo</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employees.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      Nenhum colaborador cadastrado.
                    </TableCell></TableRow>
                  )}
                  {employees.map(emp => {
                    const c = consentByEmp.get(emp.id);
                    const outdated = c && settings && c.status === "active" && c.consent_version < settings.consent_version;
                    return (
                      <TableRow key={emp.id}>
                        <TableCell>
                          <div className="font-medium">{emp.name}</div>
                          <div className="text-xs text-muted-foreground">{emp.registration_number}</div>
                        </TableCell>
                        <TableCell>
                          {!c && <Badge variant="outline" className="border-status-orange/40 text-status-orange">Sem aceite</Badge>}
                          {c?.status === "active" && !outdated && <Badge className="bg-status-ok/20 text-status-ok border border-status-ok/40">Ativo</Badge>}
                          {c?.status === "active" && outdated && <Badge className="bg-status-yellow/20 text-status-yellow border border-status-yellow/40">Desatualizado</Badge>}
                          {c?.status === "revoked" && <Badge variant="outline" className="border-status-red/40 text-status-red">Revogado</Badge>}
                        </TableCell>
                        <TableCell>{c ? `v${c.consent_version}` : "—"}</TableCell>
                        <TableCell className="text-xs">
                          {c ? (
                            <>
                              <div>{format(new Date(c.accepted_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</div>
                              <div className="text-muted-foreground">por {c.accepted_by}</div>
                            </>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {c?.scope?.length ? c.scope.join(", ") : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost"
                              title="Gerar arquivo do titular"
                              onClick={() => { setExportEmp(emp.id); setOpenExport(true); }}>
                              <FileDown className="h-4 w-4" />
                            </Button>
                            {canManage && (
                              <>
                                <Button size="sm" variant="outline"
                                  onClick={() => { setCaptureEmp(emp.id); setOpenCapture(true); }}>
                                  {c ? "Renovar" : "Registrar"}
                                </Button>
                                {c?.status === "active" && (
                                  <Button size="sm" variant="ghost" className="text-status-red"
                                    onClick={() => revokeConsent(c)}>
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {!canManage && (
                <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" /> Você está em modo somente leitura.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="purge" className="space-y-4">
          <PurgeAuditPanel tenantId={activeTenantId} canManage={canManage} />
        </TabsContent>
        <TabsContent value="trail" className="space-y-4">
          <ConsentAuditTrail tenantId={activeTenantId} employees={employees} />
        </TabsContent>
      </Tabs>

      <Dialog open={openCapture} onOpenChange={setOpenCapture}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Registrar consentimento LGPD</DialogTitle>
            <DialogDescription>
              O texto vigente (v{settings?.consent_version}) será preservado junto com a assinatura, IP e dispositivo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Colaborador</Label>
              <Select value={captureEmp} onValueChange={setCaptureEmp}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {employees.map(e => <SelectItem key={e.id} value={e.id}>{e.name} — {e.registration_number}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Escopo do tratamento</Label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {SCOPE_OPTIONS.map(s => {
                  const checked = captureScope.includes(s.value);
                  return (
                    <label key={s.value} className="flex items-center gap-2 rounded-md border p-2 text-sm cursor-pointer">
                      <Checkbox checked={checked} onCheckedChange={c => {
                        setCaptureScope(prev => c ? Array.from(new Set([...prev, s.value])) : prev.filter(x => x !== s.value));
                      }} />
                      {s.label}
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="rounded-md border bg-muted/40 p-3 max-h-40 overflow-auto text-[13px] leading-relaxed whitespace-pre-wrap">
              {settings?.consent_text || DEFAULT_CONSENT}
            </div>
            <div>
              <Label>Assinatura (nome completo do titular)</Label>
              <Input className="mt-1" value={signatureText} onChange={e => setSignatureText(e.target.value)}
                placeholder="Ex: João da Silva" />
              <p className="text-xs text-muted-foreground mt-1">
                Equivale ao "Li e concordo". Será armazenado junto com data/hora, IP e user-agent.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenCapture(false)}>Cancelar</Button>
            <Button onClick={recordConsent}><ShieldCheck className="h-4 w-4 mr-2" /> Registrar aceite</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EmployeeDataExportDialog
        open={openExport}
        onOpenChange={setOpenExport}
        settings={settings}
        defaultEmployeeId={exportEmp}
        requestedBy={profile?.full_name || profile?.email || "operação"}
      />
    </div>
  );
}

function StatTile({ label, value, tone = "primary" }: { label: string; value: number; tone?: "primary" | "ok" | "warn" | "muted" }) {
  const tones: Record<string, string> = {
    primary: "border-primary/30 text-primary",
    ok: "border-status-ok/40 text-status-ok",
    warn: "border-status-orange/40 text-status-orange",
    muted: "border-border text-muted-foreground",
  };
  return (
    <div className={`rounded-xl border ${tones[tone]} bg-card p-4`}>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-3xl font-display font-bold mt-1">{value}</div>
    </div>
  );
}

function RetField({ label, value, onChange, disabled }: {
  label: string; value: number; onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input type="number" min={1} className="mt-1" value={value} disabled={disabled}
        onChange={e => onChange(Math.max(1, Number(e.target.value) || 1))} />
      <p className="text-xs text-muted-foreground mt-1">
        {value >= 365 ? `${(value / 365).toFixed(1)} anos` : `${value} dias`}
      </p>
    </div>
  );
}

type PurgeLog = {
  id: string;
  run_at: string;
  triggered_by: string;
  cutoff_logs: string | null;
  cutoff_biometric: string | null;
  cutoff_occurrences: string | null;
  deleted_access_events: number;
  deleted_alerts: number;
  deleted_thermal_breaks: number;
  deleted_occurrences: number;
  deleted_consents: number;
  status: string;
  policy: any;
  notes: any;
};

function PurgeAuditPanel({ tenantId, canManage }: { tenantId: string; canManage: boolean }) {
  const [logs, setLogs] = useState<PurgeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("retention_purge_log")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("run_at", { ascending: false })
      .limit(50);
    setLogs((data as any) || []);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenantId]);

  const runNow = async (dryRun = false) => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("purge-retention", {
        body: { tenant_id: tenantId, triggered_by: "manual", dry_run: dryRun },
      });
      if (error) throw error;
      if (dryRun) {
        toast.success("Simulação concluída. Verifique janelas de corte no console.");
        console.info("purge dry-run", data);
      } else {
        const total = (data?.results || []).reduce((acc: number, r: any) =>
          acc + (r.deleted_access_events || 0) + (r.deleted_alerts || 0)
              + (r.deleted_thermal_breaks || 0) + (r.deleted_occurrences || 0)
              + (r.deleted_consents || 0), 0);
        toast.success(`Purga concluída. ${total} registros removidos.`);
        await load();
      }
    } catch (e: any) {
      toast.error("Falha ao executar purga: " + (e?.message || "tente novamente"));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Job de purga programado</CardTitle>
            <CardDescription>
              Executa todo dia às 03:10 UTC e remove dados expirados respeitando a política de retenção
              de cada tenant. Cada execução grava uma evidência auditável abaixo.
            </CardDescription>
          </div>
          {canManage && (
            <div className="flex gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={() => runNow(true)} disabled={running}>
                Simular
              </Button>
              <Button size="sm" onClick={() => runNow(false)} disabled={running}>
                <Trash2 className="h-4 w-4 mr-2" />
                {running ? "Executando..." : "Executar agora"}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground py-6 text-center">Carregando trilha...</div>
          ) : logs.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              Nenhuma execução registrada para este tenant.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Execução</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Logs</TableHead>
                  <TableHead className="text-right">Alertas</TableHead>
                  <TableHead className="text-right">Pausas</TableHead>
                  <TableHead className="text-right">Ocorrências</TableHead>
                  <TableHead className="text-right">Consentimentos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map(l => (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs">
                      <div>{format(new Date(l.run_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</div>
                      <div className="text-muted-foreground">
                        corte logs: {l.cutoff_logs ? format(new Date(l.cutoff_logs), "dd/MM/yy", { locale: ptBR }) : "—"}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">{l.triggered_by}</TableCell>
                    <TableCell>
                      {l.status === "ok" && <Badge className="bg-status-ok/20 text-status-ok border border-status-ok/40">OK</Badge>}
                      {l.status === "partial" && <Badge className="bg-status-yellow/20 text-status-yellow border border-status-yellow/40">Parcial</Badge>}
                      {l.status === "error" && <Badge variant="outline" className="border-status-red/40 text-status-red">Erro</Badge>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{l.deleted_access_events}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.deleted_alerts}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.deleted_thermal_breaks}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.deleted_occurrences}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.deleted_consents}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type AuditEntry = {
  id: string;
  employee_id: string;
  consent_id: string | null;
  event_type: string;
  consent_version: number | null;
  acted_by_email: string | null;
  acted_by_name: string | null;
  reason: string | null;
  ip_origin: string | null;
  user_agent: string | null;
  snapshot: any;
  occurred_at: string;
};

function ConsentAuditTrail({
  tenantId, employees,
}: { tenantId: string; employees: Array<{ id: string; name: string; registration_number: string }> }) {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterEmp, setFilterEmp] = useState<string>("all");
  const [filterEvent, setFilterEvent] = useState<string>("all");

  const empMap = useMemo(() => {
    const m = new Map<string, { name: string; registration_number: string }>();
    employees.forEach(e => m.set(e.id, e));
    return m;
  }, [employees]);

  const load = async () => {
    setLoading(true);
    let q = supabase
      .from("consent_audit_log")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("occurred_at", { ascending: false })
      .limit(300);
    if (filterEmp !== "all") q = q.eq("employee_id", filterEmp);
    if (filterEvent !== "all") q = q.eq("event_type", filterEvent);
    const { data } = await q;
    setRows((data as any) || []);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenantId, filterEmp, filterEvent]);

  const exportCsv = () => {
    const header = ["data","colaborador","matricula","evento","versao","executor","email","ip","motivo","user_agent"];
    const lines = rows.map(r => {
      const emp = empMap.get(r.employee_id);
      const cells = [
        format(new Date(r.occurred_at), "dd/MM/yyyy HH:mm:ss", { locale: ptBR }),
        emp?.name || r.employee_id,
        emp?.registration_number || "",
        r.event_type,
        r.consent_version ?? "",
        r.acted_by_name || "",
        r.acted_by_email || "",
        r.ip_origin || "",
        (r.reason || "").replace(/\s+/g, " "),
        (r.user_agent || "").replace(/\s+/g, " "),
      ];
      return cells.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",");
    });
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trilha-consentimentos-${format(new Date(), "yyyyMMdd-HHmm")}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const eventLabel = (t: string) => ({
    consent_given: "Concedido",
    consent_renewed: "Renovado",
    consent_revoked: "Revogado",
  } as Record<string, string>)[t] || t;

  const eventTone = (t: string) =>
    t === "consent_revoked"
      ? "bg-status-red/20 text-status-red border border-status-red/40"
      : t === "consent_renewed"
        ? "bg-status-yellow/20 text-status-yellow border border-status-yellow/40"
        : "bg-status-ok/20 text-status-ok border border-status-ok/40";

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 flex-wrap">
        <div>
          <CardTitle>Trilha de consentimentos</CardTitle>
          <CardDescription>
            Cada concessão, renovação ou revogação fica registrada com data/hora, IP, dispositivo e o usuário responsável.
            Esta trilha é a fonte de verdade para o RH/SST e para a ANPD.
          </CardDescription>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Select value={filterEmp} onValueChange={setFilterEmp}>
            <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os colaboradores</SelectItem>
              {employees.map(e => (
                <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterEvent} onValueChange={setFilterEvent}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os eventos</SelectItem>
              <SelectItem value="consent_given">Concedido</SelectItem>
              <SelectItem value="consent_renewed">Renovado</SelectItem>
              <SelectItem value="consent_revoked">Revogado</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
            <FileDown className="h-4 w-4 mr-2" /> Exportar CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground py-6 text-center">Carregando trilha...</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            Nenhum evento registrado ainda.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data/Hora</TableHead>
                <TableHead>Colaborador</TableHead>
                <TableHead>Evento</TableHead>
                <TableHead>Versão</TableHead>
                <TableHead>Executor</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Motivo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => {
                const emp = empMap.get(r.employee_id);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {format(new Date(r.occurred_at), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-sm">{emp?.name || r.employee_id}</div>
                      <div className="text-xs text-muted-foreground">{emp?.registration_number || "—"}</div>
                    </TableCell>
                    <TableCell>
                      <Badge className={eventTone(r.event_type)}>{eventLabel(r.event_type)}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">v{r.consent_version ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      <div>{r.acted_by_name || "—"}</div>
                      <div className="text-muted-foreground">{r.acted_by_email || ""}</div>
                    </TableCell>
                    <TableCell className="text-xs font-mono">{r.ip_origin || "—"}</TableCell>
                    <TableCell className="text-xs max-w-[260px] truncate" title={r.reason || ""}>
                      {r.reason || "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
