import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import PageHead from "@/components/PageHead";
import { usePortal, fmtDateTime, OCCURRENCE_LABEL, PortalError } from "@/lib/portal";
import { cn } from "@/lib/utils";

type Filter = "open" | "resolved" | "all";

export default function PortalOccurrences() {
  const { call } = usePortal();
  const [filter, setFilter] = useState<Filter>("all");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await call<any>("occurrences", { status: filter });
      setData(res); setErr(null);
    } catch (e) {
      setErr(e instanceof PortalError ? e.code : "network_error");
    } finally { setLoading(false); }
  }, [call, filter]);

  useEffect(() => { load(); }, [load]);

  const notesFor = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const n of data?.notes ?? []) {
      if (!map.has(n.occurrence_id)) map.set(n.occurrence_id, []);
      map.get(n.occurrence_id)!.push(n);
    }
    return map;
  }, [data]);

  const list = data?.occurrences ?? [];

  return (
    <div className="space-y-4">
      <PageHead title="Ocorrências — Portal do colaborador FrioSafe" description="Ocorrências de SST registradas no seu nome, com status e resolução." />
      <h1 className="font-display text-xl font-bold">Minhas ocorrências</h1>

      <div className="flex gap-2">
        {([["open", "Abertas"], ["resolved", "Resolvidas"], ["all", "Todas"]] as const).map(([f, label]) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "flex-1 h-9 rounded-full text-[13px] font-medium border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              filter === f ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground",
            )}
          >{label}</button>
        ))}
      </div>

      {loading && !data ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
      ) : err && !data ? (
        <Card className="p-5 text-sm text-muted-foreground">
          Não foi possível carregar as ocorrências. <button className="text-primary underline" onClick={load}>Tentar novamente</button>
        </Card>
      ) : list.length === 0 ? (
        <Card className="p-8 text-center">
          <CheckCircle2 className="h-8 w-8 mx-auto text-status-ok/70" />
          <p className="mt-3 text-sm text-muted-foreground">Nenhuma ocorrência registrada — tudo certo por aqui.</p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {list.map((o: any) => {
            const isOpen = o.status === "open";
            const notes = notesFor.get(o.id) ?? [];
            const expanded = open === o.id;
            return (
              <li key={o.id}>
                <Card className={cn("overflow-hidden border", isOpen ? "border-status-orange/40" : "border-border")}>
                  <button className="w-full text-left p-4 active:bg-muted/40 transition" onClick={() => setOpen(expanded ? null : o.id)}>
                    <div className="flex items-start gap-3">
                      <span className={cn("h-9 w-9 rounded-xl grid place-items-center shrink-0",
                        isOpen ? "bg-status-orange/15 text-status-orange" : "bg-status-ok/15 text-status-ok")}>
                        {isOpen ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-[15px] leading-snug">
                          {OCCURRENCE_LABEL[o.category] ?? OCCURRENCE_LABEL.other}
                        </div>
                        <div className="text-[12px] text-muted-foreground mt-0.5">{fmtDateTime(o.created_at)}</div>
                        <div className="mt-2 flex items-center gap-2">
                          <Badge variant="outline" className={cn("text-[10px]",
                            isOpen ? "border-status-orange/50 text-status-orange" : "border-status-ok/50 text-status-ok")}>
                            {isOpen ? "Aberta" : "Resolvida"}
                          </Badge>
                          {!isOpen && o.resolved_at && <span className="text-[11px] text-muted-foreground">em {fmtDateTime(o.resolved_at)}</span>}
                        </div>
                      </div>
                      <ChevronDown className={cn("h-4 w-4 text-muted-foreground shrink-0 transition-transform", expanded && "rotate-180")} />
                    </div>
                    {!expanded && (
                      <p className="mt-3 text-[13px] text-muted-foreground line-clamp-2">{o.description}</p>
                    )}
                  </button>

                  {expanded && (
                    <div className="px-4 pb-4 space-y-3 text-[13px]">
                      <p className="leading-relaxed">{o.description}</p>
                      {!isOpen && o.resolution && (
                        <div className="rounded-xl bg-muted/40 p-3">
                          <div className="text-[11px] uppercase text-muted-foreground">Resolução</div>
                          <p className="mt-1 leading-relaxed">{o.resolution}</p>
                          <div className="text-[11px] text-muted-foreground mt-1.5">por {o.resolved_by || "Sistema"}</div>
                        </div>
                      )}
                      {notes.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-[11px] uppercase text-muted-foreground">Notas</div>
                          {notes.map((n) => (
                            <div key={n.id} className="rounded-xl border border-border/60 p-3">
                              <p className="leading-relaxed">{n.text}</p>
                              <div className="text-[11px] text-muted-foreground mt-1">{n.author} · {fmtDateTime(n.created_at)}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground text-center px-4">
        <ShieldCheck className="h-3.5 w-3.5" /> A resolução de ocorrências é feita pelo seu gestor ou pela equipe de SST.
      </p>
    </div>
  );
}
