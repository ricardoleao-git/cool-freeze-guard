import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { RefreshCw, Plus, Pencil, Trash2, Cpu, MapPin, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type ColdArea = { id: string; name: string };
type DeviceMap = {
  id: string;
  guardia_device_id: string;
  cold_area_id: string;
  guardia_local_id: string | null;
  label: string | null;
  active: boolean;
  funcao: "entrada" | "externo";
  janela_tolerancia_segundos: number | null;
};
type UnmappedDevice = { dispositivo_id: string; local_nome: string | null; last_seen: string; count: number };

interface Props { tenantId: string }

const emptyForm = {
  id: "", guardia_device_id: "", cold_area_id: "", guardia_local_id: "", label: "", active: true,
  funcao: "entrada" as "entrada" | "externo", janela_tolerancia_segundos: "" as string,
};

export default function GuardiaDeviceMapTab({ tenantId }: Props) {
  const [maps, setMaps] = useState<DeviceMap[]>([]);
  const [areas, setAreas] = useState<ColdArea[]>([]);
  const [unmapped, setUnmapped] = useState<UnmappedDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const reload = async () => {
    setLoading(true);
    const [m, a, e] = await Promise.all([
      supabase.from("guardia_device_map")
        .select("id, guardia_device_id, cold_area_id, guardia_local_id, label, active, funcao, janela_tolerancia_segundos")
        .eq("tenant_id", tenantId).order("created_at", { ascending: false }),
      supabase.from("cold_areas")
        .select("id, name").eq("tenant_id", tenantId).order("name"),
      supabase.from("guardia_events")
        .select("dispositivo_id, local_nome, event_timestamp")
        .eq("tenant_id", tenantId)
        .gte("event_timestamp", new Date(Date.now() - 7 * 86400_000).toISOString())
        .not("dispositivo_id", "is", null)
        .order("event_timestamp", { ascending: false })
        .limit(500),
    ]);
    setMaps((m.data ?? []) as DeviceMap[]);
    setAreas((a.data ?? []) as ColdArea[]);

    const mapped = new Set((m.data ?? []).map((x: any) => x.guardia_device_id));
    const grouped = new Map<string, UnmappedDevice>();
    for (const ev of (e.data ?? []) as Array<{ dispositivo_id: string; local_nome: string | null; event_timestamp: string }>) {
      if (mapped.has(ev.dispositivo_id)) continue;
      const cur = grouped.get(ev.dispositivo_id);
      if (cur) cur.count++;
      else grouped.set(ev.dispositivo_id, { dispositivo_id: ev.dispositivo_id, local_nome: ev.local_nome, last_seen: ev.event_timestamp, count: 1 });
    }
    setUnmapped(Array.from(grouped.values()));
    setLoading(false);
  };

  useEffect(() => { if (tenantId) reload(); /* eslint-disable-next-line */ }, [tenantId]);

  const areaName = useMemo(() => {
    const m = new Map(areas.map(a => [a.id, a.name]));
    return (id: string) => m.get(id) ?? id;
  }, [areas]);

  const openNew = (deviceId = "") => {
    setForm({ ...emptyForm, guardia_device_id: deviceId });
    setDialogOpen(true);
  };

  const openEdit = (row: DeviceMap) => {
    setForm({
      id: row.id,
      guardia_device_id: row.guardia_device_id,
      cold_area_id: row.cold_area_id,
      guardia_local_id: row.guardia_local_id ?? "",
      label: row.label ?? "",
      active: row.active,
      funcao: row.funcao ?? "entrada",
      janela_tolerancia_segundos: row.janela_tolerancia_segundos == null ? "" : String(row.janela_tolerancia_segundos),
    });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.guardia_device_id.trim() || !form.cold_area_id) {
      toast.error("Informe o ID do leitor e selecione a câmara.");
      return;
    }
    const janelaRaw = form.janela_tolerancia_segundos.trim();
    let janela: number | null = null;
    if (janelaRaw !== "") {
      const n = Number(janelaRaw);
      if (!Number.isFinite(n) || n < 0) { toast.error("Janela de tolerância inválida."); return; }
      janela = Math.floor(n);
    }
    setSaving(true);
    const payload = {
      tenant_id: tenantId,
      guardia_device_id: form.guardia_device_id.trim(),
      cold_area_id: form.cold_area_id,
      guardia_local_id: form.guardia_local_id.trim() || null,
      label: form.label.trim() || null,
      active: form.active,
      funcao: form.funcao,
      janela_tolerancia_segundos: janela,
    };
    const { error } = form.id
      ? await supabase.from("guardia_device_map").update(payload).eq("id", form.id)
      : await supabase.from("guardia_device_map").insert(payload);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(form.id ? "Mapeamento atualizado" : "Leitor mapeado");
    setDialogOpen(false);
    reload();
  };

  const toggleActive = async (row: DeviceMap, v: boolean) => {
    const { error } = await supabase.from("guardia_device_map").update({ active: v }).eq("id", row.id);
    if (error) { toast.error(error.message); return; }
    setMaps(ms => ms.map(m => m.id === row.id ? { ...m, active: v } : m));
  };

  const remove = async (row: DeviceMap) => {
    if (!confirm(`Remover o mapeamento do leitor "${row.label || row.guardia_device_id}"?`)) return;
    const { error } = await supabase.from("guardia_device_map").delete().eq("id", row.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Mapeamento removido");
    reload();
  };

  return (
    <div className="space-y-4">
      <Card className="glass-card">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="font-display flex items-center gap-2">
            <Cpu className="h-4 w-4 text-primary" /> Mapeamento Leitor → Câmara
          </CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={reload}><RefreshCw className="h-4 w-4 mr-1.5" /> Atualizar</Button>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" onClick={() => openNew()}><Plus className="h-4 w-4 mr-1.5" /> Novo mapeamento</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>{form.id ? "Editar mapeamento" : "Novo mapeamento"}</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs">ID do leitor no GuardIA (dispositivo_id)</Label>
                    <Input value={form.guardia_device_id} onChange={e => setForm(f => ({ ...f, guardia_device_id: e.target.value }))} placeholder="FR-CF-IN-01" />
                  </div>
                  <div>
                    <Label className="text-xs">Apelido / Identificação</Label>
                    <Input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="Leitor Câmara Laticínios" />
                  </div>
                  <div>
                    <Label className="text-xs">Câmara fria mapeada</Label>
                    <Select value={form.cold_area_id} onValueChange={v => setForm(f => ({ ...f, cold_area_id: v }))}>
                      <SelectTrigger><SelectValue placeholder="Selecione a câmara" /></SelectTrigger>
                      <SelectContent>
                        {areas.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Função do leitor</Label>
                    <Select value={form.funcao} onValueChange={(v: "entrada" | "externo") => setForm(f => ({ ...f, funcao: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="entrada">Entrada (dentro da câmara)</SelectItem>
                        <SelectItem value="externo">Externo (fora da câmara)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      Define o estado do colaborador a cada leitura. A função do mapeamento prevalece sobre o campo "tipo" enviado pelo dispositivo.
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs">Local GuardIA (opcional)</Label>
                    <Input value={form.guardia_local_id} onChange={e => setForm(f => ({ ...f, guardia_local_id: e.target.value }))} placeholder="local_id de referência" />
                  </div>
                  <div>
                    <Label className="text-xs">Janela de tolerância (segundos)</Label>
                    <Input
                      type="number" min={0}
                      value={form.janela_tolerancia_segundos}
                      onChange={e => setForm(f => ({ ...f, janela_tolerancia_segundos: e.target.value }))}
                      placeholder="usar padrão global"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Opcional. Substitui a janela global apenas para este leitor.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={form.active} onCheckedChange={v => setForm(f => ({ ...f, active: v }))} />
                    <Label className="text-sm">Ativo</Label>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                  <Button onClick={save} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Leitor</TableHead>
                  <TableHead>Função</TableHead>
                  <TableHead>Câmara mapeada</TableHead>
                  <TableHead>Local GuardIA</TableHead>
                  <TableHead>Ativo</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">Carregando…</TableCell></TableRow>
                )}
                {!loading && maps.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">
                    Nenhum leitor mapeado ainda.
                  </TableCell></TableRow>
                )}
                {maps.map(row => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="font-medium text-sm">{row.label || <span className="text-muted-foreground italic">sem apelido</span>}</div>
                      <div className="text-xs text-muted-foreground font-mono">{row.guardia_device_id}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={row.funcao === "externo"
                        ? "border-amber-500/40 text-amber-500"
                        : "border-primary/40 text-primary"}>
                        {row.funcao === "externo" ? "Externo" : "Entrada"}
                      </Badge>
                      {row.janela_tolerancia_segundos != null && (
                        <div className="text-xs text-muted-foreground mt-1">tolerância: {row.janela_tolerancia_segundos}s</div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      <Badge variant="outline" className="gap-1 border-primary/40 text-primary"><MapPin className="h-3 w-3" />{areaName(row.cold_area_id)}</Badge>
                    </TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">{row.guardia_local_id || "—"}</TableCell>
                    <TableCell><Switch checked={row.active} onCheckedChange={v => toggleActive(row, v)} /></TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(row)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => remove(row)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card border-amber-500/30">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-amber-500">
            <AlertCircle className="h-4 w-4" /> Leitores detectados sem mapeamento (últimos 7 dias)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {unmapped.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum leitor desconhecido recebido nos últimos 7 dias.</p>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dispositivo</TableHead>
                    <TableHead>Último local reportado</TableHead>
                    <TableHead>Eventos</TableHead>
                    <TableHead>Último evento</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unmapped.map(u => (
                    <TableRow key={u.dispositivo_id}>
                      <TableCell className="font-mono text-xs">{u.dispositivo_id}</TableCell>
                      <TableCell className="text-sm">{u.local_nome || <span className="text-muted-foreground italic">—</span>}</TableCell>
                      <TableCell className="tabular-nums text-sm">{u.count}</TableCell>
                      <TableCell className="text-xs tabular-nums">{new Date(u.last_seen).toLocaleString("pt-BR")}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => openNew(u.dispositivo_id)}>
                          <Plus className="h-4 w-4 mr-1.5" /> Mapear
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
