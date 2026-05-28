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

  const recordConsent = async () => {
    if (!settings || !captureEmp || !signatureText.trim()) {
      toast.error("Selecione o colaborador e assine para registrar o aceite.");
      return;
    }
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
          canManage && (
            <Button onClick={saveSettings} disabled={saving}>
              <Save className="h-4 w-4 mr-2" /> Salvar alterações
            </Button>
          )
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
                          {canManage && (
                            <div className="flex justify-end gap-1">
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
                            </div>
                          )}
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
