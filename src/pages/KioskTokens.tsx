import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { MonitorPlay, Plus, Copy, Link2, Trash2, ShieldAlert, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
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
};

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
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [showQR, setShowQR] = useState(false);

  async function refresh() {
    if (!tenantId) return;
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("kiosk-token-manage", {
      body: { tenant_id: tenantId, action: "list" },
    });
    setLoading(false);
    if (error || !data?.ok) {
      toast.error("Não foi possível carregar os tokens.");
      return;
    }
    setItems(data.items ?? []);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function handleCreate() {
    if (!label.trim()) {
      toast.error("Informe um rótulo para identificar a TV.");
      return;
    }
    setCreating(true);
    const { data, error } = await supabase.functions.invoke("kiosk-token-manage", {
      body: {
        tenant_id: tenantId,
        action: "create",
        payload: { label: label.trim() },
      },
    });
    setCreating(false);
    if (error || !data?.ok) {
      toast.error("Não foi possível gerar o token.");
      return;
    }
    setCreatedToken(data.token);
    setLabel("");
    refresh();
  }

  async function handleRevoke() {
    if (!revokeId) return;
    const { data, error } = await supabase.functions.invoke("kiosk-token-manage", {
      body: {
        tenant_id: tenantId,
        action: "revoke",
        payload: { token_id: revokeId },
      },
    });
    if (error || !data?.ok) {
      toast.error("Não foi possível revogar o token.");
      return;
    }
    toast.success("Token revogado.");
    setRevokeId(null);
    refresh();
  }

  function copy(text: string, what: string) {
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success(`${what} copiado.`))
      .catch(() => toast.error("Falha ao copiar."));
  }

  if (!canManage) {
    return (
      <div className="p-6">
        <PageHeader title="Painel Externo (Quiosque)" icon={<MonitorPlay className="h-5 w-5" />} />
        <Card className="glass-card mt-6">
          <CardContent className="py-10 text-center text-muted-foreground">
            Apenas administradores podem gerenciar tokens do painel externo.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Painel Externo (Quiosque)"
        description="Tokens de acesso para TVs/monitores sem login"
        icon={<MonitorPlay className="h-5 w-5" />}
      />


      <Card className="glass-card border-amber-500/30 bg-amber-500/5">
        <CardContent className="py-4 flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
          <div className="text-sm text-muted-foreground">
            O painel externo exibe apenas <strong>primeiro nome e foto</strong> do
            colaborador, conforme a política de minimização de dados (LGPD). Cada
            token deve ficar restrito a uma TV específica e pode ser revogado a
            qualquer momento.
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="font-display">Tokens ativos</CardTitle>
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Gerar novo token
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              Carregando…
            </div>
          ) : items.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              Nenhum token gerado ainda.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rótulo</TableHead>
                  <TableHead>Token</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Criado por</TableHead>
                  <TableHead>Último uso</TableHead>
                  <TableHead>Criado em</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it) => (
                  <TableRow key={it.id}>
                    <TableCell className="font-medium">
                      {it.label ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {it.token_hint ?? "—"}
                    </TableCell>
                    <TableCell>
                      {it.active ? (
                        <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/40">
                          Ativo
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          Revogado
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {it.created_by ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {it.last_used_at
                        ? new Date(it.last_used_at).toLocaleString("pt-BR")
                        : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(it.created_at).toLocaleString("pt-BR")}
                    </TableCell>
                    <TableCell className="text-right">
                      {it.active && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-rose-400 hover:text-rose-300"
                          onClick={() => setRevokeId(it.id)}
                        >
                          <Trash2 className="h-4 w-4 mr-1" /> Revogar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o) setCreatedToken(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display">
              {createdToken ? "Token gerado" : "Gerar novo token"}
            </DialogTitle>
            <DialogDescription>
              {createdToken
                ? "Copie agora — o token não será exibido novamente."
                : "Identifique a TV/monitor que receberá este acesso."}
            </DialogDescription>
          </DialogHeader>

          {!createdToken ? (
            <div className="space-y-3">
              <Label htmlFor="lbl">Rótulo</Label>
              <Input
                id="lbl"
                placeholder="Ex.: TV Doca 1"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={120}
              />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-200">
                Este token concede acesso de leitura ao painel externo. Guarde com
                cuidado. Ele <strong>não será exibido novamente</strong>.
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Token</Label>
                <div className="mt-1 flex gap-2">
                  <Input readOnly value={createdToken} className="font-mono text-xs" />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copy(createdToken, "Token")}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">
                  Link do painel
                </Label>
                <div className="mt-1 flex gap-2">
                  <Input
                    readOnly
                    value={`${window.location.origin}/painel?token=${createdToken}`}
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() =>
                      copy(
                        `${window.location.origin}/painel?token=${createdToken}`,
                        "Link",
                      )
                    }
                  >
                    <Link2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setShowQR((v) => !v)}
                    title="Mostrar QR code"
                  >
                    <QrCode className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {showQR && (
                <div className="flex flex-col items-center gap-2 rounded-lg border border-zinc-700 bg-white p-4">
                  <QRCodeSVG
                    value={`${window.location.origin}/painel?token=${createdToken}`}
                    size={220}
                    includeMargin
                  />
                  <p className="text-xs text-zinc-700 text-center">
                    Aponte a câmera do quiosque para abrir o painel
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            {!createdToken ? (
              <>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleCreate} disabled={creating}>
                  {creating ? "Gerando…" : "Gerar token"}
                </Button>
              </>
            ) : (
              <Button
                onClick={() => {
                  setCreateOpen(false);
                  setCreatedToken(null);
                }}
              >
                Concluído
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke confirm */}
      <AlertDialog open={!!revokeId} onOpenChange={(o) => !o && setRevokeId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revogar token?</AlertDialogTitle>
            <AlertDialogDescription>
              A TV correspondente deixará de exibir o painel imediatamente. Esta
              ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevoke}
              className="bg-rose-600 hover:bg-rose-500"
            >
              Revogar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
