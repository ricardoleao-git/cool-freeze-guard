import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import {
  MonitorPlay, Plus, Copy, ShieldAlert, Trash2, RefreshCw, CheckCircle2, Clock, KeyRound, Link2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

type Item = {
  id: string;
  label: string | null;
  active: boolean;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
  created_by: string | null;
  token_hint: string | null;
  pairing_code: string | null;
  pairing_expires_at: string | null;
  paired_at: string | null;
  paired_ip: string | null;
  paired_user_agent: string | null;
};

function formatUserAgent(ua: string | null): string {
  if (!ua) return "—";
  // Heurística leve: mostra a "família" mais reconhecível
  if (/Silk|Fire/i.test(ua)) return "Fire Stick / Silk";
  if (/Chrome\/(\d+)/i.test(ua)) return `Chrome ${(ua.match(/Chrome\/(\d+)/i) ?? [])[1] ?? ""}`.trim();
  if (/Safari/i.test(ua)) return "Safari";
  if (/Firefox/i.test(ua)) return "Firefox";
  return ua.slice(0, 40) + (ua.length > 40 ? "…" : "");
}

function useCountdown(iso: string | null): string | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!iso) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [iso]);
  if (!iso) return null;
  const diff = new Date(iso).getTime() - now;
  if (diff <= 0) return "expirado";
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export default function KioskTokens() {
  const { profile, roles } = useAuth();
  const tenantId = profile?.tenant_id ?? "";
  const canManage =
    roles?.includes("super_admin") || roles?.includes("administrador");

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [generated, setGenerated] = useState<{ code: string; expiresAt: string } | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);

  const kioskLoginUrl = `${window.location.origin}/loginpainel`;

  async function refresh() {
    if (!tenantId) return;
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("kiosk-token-manage", {
      body: { tenant_id: tenantId, action: "list" },
    });
    setLoading(false);
    if (error || !data?.ok) {
      toast.error("Não foi possível carregar os dispositivos.");
      return;
    }
    setItems(data.items ?? []);
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [tenantId]);

  async function handleCreate() {
    if (!label.trim()) {
      toast.error("Informe um rótulo para identificar a TV.");
      return;
    }
    setCreating(true);
    const { data, error } = await supabase.functions.invoke("kiosk-token-manage", {
      body: { tenant_id: tenantId, action: "create", payload: { label: label.trim() } },
    });
    setCreating(false);
    if (error || !data?.ok) {
      toast.error("Não foi possível gerar o código.");
      return;
    }
    setGenerated({ code: data.pairing_code, expiresAt: data.pairing_expires_at });
    setLabel("");
    refresh();
  }

  async function handleRegenerate(id: string) {
    const { data, error } = await supabase.functions.invoke("kiosk-token-manage", {
      body: { tenant_id: tenantId, action: "regenerate_code", payload: { token_id: id } },
    });
    if (error || !data?.ok) {
      toast.error("Não foi possível regenerar o código.");
      return;
    }
    toast.success(`Novo código: ${data.pairing_code}`);
    refresh();
  }

  async function handleRevoke() {
    if (!revokeId) return;
    const { data, error } = await supabase.functions.invoke("kiosk-token-manage", {
      body: { tenant_id: tenantId, action: "revoke", payload: { token_id: revokeId } },
    });
    if (error || !data?.ok) {
      toast.error("Não foi possível revogar.");
      return;
    }
    toast.success("Dispositivo revogado.");
    setRevokeId(null);
    refresh();
  }

  function copy(text: string, what: string) {
    navigator.clipboard.writeText(text)
      .then(() => toast.success(`${what} copiado.`))
      .catch(() => toast.error("Falha ao copiar."));
  }

  const pending = useMemo(
    () => items.filter(i => i.active && !i.paired_at && i.pairing_code),
    [items],
  );
  const paired = useMemo(
    () => items.filter(i => i.active && i.paired_at),
    [items],
  );

  if (!canManage) {
    return (
      <div className="p-6">
        <PageHeader title="Configurações do painel" icon={<MonitorPlay className="h-5 w-5" />} />
        <Card className="glass-card mt-6">
          <CardContent className="py-10 text-center text-muted-foreground">
            Apenas administradores podem gerenciar códigos de pareamento do painel.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Configurações do painel"
        description="Códigos de pareamento e dispositivos autorizados a exibir o painel operacional"
        icon={<MonitorPlay className="h-5 w-5" />}
      />

      <Card className="glass-card border-primary/30 bg-primary/5">
        <CardContent className="py-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex items-start gap-3 flex-1">
            <KeyRound className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div className="text-sm text-muted-foreground">
              Na TV/quiosque, abra <code className="text-foreground font-mono">{kioskLoginUrl}</code> e digite o
              código de 6 dígitos. Após pareado, o dispositivo permanece autorizado até ser revogado aqui.
            </div>
          </div>
          <Button variant="outline" size="sm" className="gap-2 shrink-0" onClick={() => copy(kioskLoginUrl, "URL")}>
            <Link2 className="h-4 w-4" /> Copiar URL
          </Button>
        </CardContent>
      </Card>

      <Card className="glass-card border-amber-500/30 bg-amber-500/5">
        <CardContent className="py-4 flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
          <div className="text-sm text-muted-foreground">
            O painel exibe apenas <strong>primeiro nome e foto</strong> do colaborador (LGPD — minimização de dados).
            Códigos expiram em 15 minutos e são de uso único.
          </div>
        </CardContent>
      </Card>

      {/* Códigos pendentes */}
      <Card className="glass-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="font-display flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-400" /> Códigos aguardando pareamento
          </CardTitle>
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Gerar código
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-muted-foreground text-sm">Carregando…</div>
          ) : pending.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              Nenhum código aguardando. Gere um novo para conectar uma TV.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {pending.map(it => <PendingCard key={it.id} item={it} onRegenerate={handleRegenerate} onCopy={copy} onRevoke={setRevokeId} />)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dispositivos pareados */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" /> Dispositivos pareados
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? null : paired.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              Nenhum dispositivo pareado ainda.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rótulo</TableHead>
                  <TableHead>Pareado em</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Dispositivo</TableHead>
                  <TableHead>Último uso</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paired.map(it => (
                  <TableRow key={it.id}>
                    <TableCell className="font-medium">{it.label ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {it.paired_at ? new Date(it.paired_at).toLocaleString("pt-BR") : "—"}
                    </TableCell>
                    <TableCell className="text-sm font-mono text-muted-foreground">{it.paired_ip ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatUserAgent(it.paired_user_agent)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {it.last_used_at ? new Date(it.last_used_at).toLocaleString("pt-BR") : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" className="text-rose-400 hover:text-rose-300" onClick={() => setRevokeId(it.id)}>
                        <Trash2 className="h-4 w-4 mr-1" /> Revogar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Dialog: gerar código */}
      <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) setGenerated(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">
              {generated ? "Código de pareamento" : "Gerar código de pareamento"}
            </DialogTitle>
            <DialogDescription>
              {generated
                ? `Digite este código em ${kioskLoginUrl} na TV/quiosque. Válido por 15 minutos.`
                : "Identifique a TV/monitor que será conectado."}
            </DialogDescription>
          </DialogHeader>

          {!generated ? (
            <div className="space-y-3">
              <Label htmlFor="lbl">Rótulo</Label>
              <Input
                id="lbl"
                placeholder="Ex.: TV Doca 1"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={120}
                autoFocus
              />
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="flex items-center justify-center gap-2 py-4">
                {generated.code.split("").map((d, i) => (
                  <div key={i} className="h-14 w-11 rounded-lg border-2 border-primary/40 bg-primary/5 grid place-items-center font-mono text-2xl font-bold text-primary">
                    {d}
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 gap-2" onClick={() => copy(generated.code, "Código")}>
                  <Copy className="h-4 w-4" /> Copiar código
                </Button>
                <Button variant="outline" className="flex-1 gap-2" onClick={() => copy(kioskLoginUrl, "URL")}>
                  <Link2 className="h-4 w-4" /> Copiar URL
                </Button>
              </div>
              <p className="text-xs text-center text-muted-foreground">
                Expira {new Date(generated.expiresAt).toLocaleTimeString("pt-BR")} · uso único
              </p>
            </div>
          )}

          <DialogFooter>
            {!generated ? (
              <>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
                <Button onClick={handleCreate} disabled={creating}>
                  {creating ? "Gerando…" : "Gerar código"}
                </Button>
              </>
            ) : (
              <Button onClick={() => { setCreateOpen(false); setGenerated(null); }}>Concluído</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke confirm */}
      <AlertDialog open={!!revokeId} onOpenChange={(o) => !o && setRevokeId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revogar dispositivo?</AlertDialogTitle>
            <AlertDialogDescription>
              A TV correspondente deixará de exibir o painel imediatamente. Esta ação não pode ser desfeita —
              para reconectar será necessário parear novamente com um novo código.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleRevoke} className="bg-rose-600 hover:bg-rose-500">
              Revogar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PendingCard({
  item, onRegenerate, onCopy, onRevoke,
}: {
  item: Item;
  onRegenerate: (id: string) => void;
  onCopy: (text: string, what: string) => void;
  onRevoke: (id: string) => void;
}) {
  const countdown = useCountdown(item.pairing_expires_at);
  const expired = countdown === "expirado";
  return (
    <div className="rounded-xl border border-border/60 bg-card/60 p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium text-sm">{item.label ?? "Sem rótulo"}</div>
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider mt-0.5">
            Aguardando pareamento
          </div>
        </div>
        <Badge variant="outline" className={expired ? "border-rose-500/50 text-rose-300" : "border-amber-500/50 text-amber-300"}>
          <Clock className="h-3 w-3 mr-1" /> {countdown ?? "—"}
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        {(item.pairing_code ?? "").split("").map((d, i) => (
          <div key={i} className="h-10 w-8 rounded border border-border bg-muted/30 grid place-items-center font-mono text-lg font-semibold">
            {d}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1 gap-1" onClick={() => onCopy(item.pairing_code ?? "", "Código")} disabled={expired}>
          <Copy className="h-3.5 w-3.5" /> Copiar
        </Button>
        <Button variant="outline" size="sm" className="flex-1 gap-1" onClick={() => onRegenerate(item.id)}>
          <RefreshCw className="h-3.5 w-3.5" /> Novo código
        </Button>
        <Button variant="ghost" size="sm" className="text-rose-400 hover:text-rose-300" onClick={() => onRevoke(item.id)}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
