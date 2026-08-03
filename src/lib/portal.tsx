import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

const TOKEN_KEY = "friosafe.portal.session";
const LINK_KEY = "friosafe.portal.link";

export type PortalLink = {
  employee_id: string;
  tenant_id: string;
  tenant_name: string;
  unit_id: string | null;
  unit_name: string | null;
  unit_location: string | null;
  name: string;
  short_name: string;
  position: string;
  avatar: string;
};

export class PortalError extends Error {
  code: string;
  payload: any;
  constructor(code: string, payload?: any) {
    super(code);
    this.code = code;
    this.payload = payload;
  }
}

type Ctx = {
  token: string | null;
  links: PortalLink[];
  link: PortalLink | null;
  mustChangePassword: boolean;
  cpfMasked: string | null;
  ready: boolean;
  offline: boolean;
  login: (cpf: string, password: string) => Promise<{ mustChange: boolean; links: PortalLink[] }>;
  changePassword: (next: string) => Promise<void>;
  selectLink: (employeeId: string) => void;
  call: <T = any>(action: string, payload?: Record<string, unknown>) => Promise<T>;
  logout: () => void;
};

const PortalCtx = createContext<Ctx | null>(null);

export function PortalProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [links, setLinks] = useState<PortalLink[]>([]);
  const [linkId, setLinkId] = useState<string | null>(() => localStorage.getItem(LINK_KEY));
  const [mustChangePassword, setMustChange] = useState(false);
  const [cpfMasked, setCpfMasked] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  const raw = useCallback(async (action: string, payload: Record<string, unknown> = {}, sessionToken?: string | null) => {
    const t = sessionToken ?? token;
    const { data, error } = await supabase.functions.invoke("employee-portal", {
      body: { action, ...payload },
      headers: t ? { "x-portal-session": t } : undefined,
    });
    const body = (data ?? {}) as any;
    if (body?.error) throw new PortalError(body.error, body);
    if (error) {
      // Erros HTTP (401/409/…) chegam aqui sem corpo parseado
      const ctx = (error as any)?.context;
      if (ctx?.json) {
        try { const j = await ctx.json(); if (j?.error) throw new PortalError(j.error, j); } catch (e) { if (e instanceof PortalError) throw e; }
      }
      throw new PortalError("network_error", error);
    }
    return body;
  }, [token]);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(LINK_KEY);
    setToken(null); setLinks([]); setLinkId(null); setMustChange(false); setCpfMasked(null);
  }, []);

  const call = useCallback(async <T,>(action: string, payload: Record<string, unknown> = {}): Promise<T> => {
    try {
      return await raw(action, { employee_id: linkId ?? undefined, ...payload }) as T;
    } catch (e) {
      if (e instanceof PortalError && e.code === "session_expired") logout();
      throw e;
    }
  }, [raw, linkId, logout]);

  // Recarrega vínculos ao abrir o app com sessão salva
  useEffect(() => {
    let alive = true;
    if (!token) { setReady(true); return; }
    raw("links").then((res) => {
      if (!alive) return;
      setLinks(res.links ?? []);
      setCpfMasked(res.cpf_masked ?? null);
      if (res.links?.length === 1) { setLinkId(res.links[0].employee_id); localStorage.setItem(LINK_KEY, res.links[0].employee_id); }
    }).catch((e) => { if (e instanceof PortalError && e.code === "session_expired") logout(); })
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const login = useCallback(async (cpf: string, password: string) => {
    const res = await raw("login", { cpf, password }, null);
    localStorage.setItem(TOKEN_KEY, res.session_token);
    setToken(res.session_token);
    setLinks(res.links ?? []);
    setCpfMasked(res.cpf_masked ?? null);
    setMustChange(!!res.must_change_password);
    if ((res.links ?? []).length === 1) {
      setLinkId(res.links[0].employee_id);
      localStorage.setItem(LINK_KEY, res.links[0].employee_id);
    }
    return { mustChange: !!res.must_change_password, links: (res.links ?? []) as PortalLink[] };
  }, [raw]);

  const changePassword = useCallback(async (next: string) => {
    await raw("change_password", { new_password: next });
    setMustChange(false);
  }, [raw]);

  const selectLink = useCallback((employeeId: string) => {
    setLinkId(employeeId);
    localStorage.setItem(LINK_KEY, employeeId);
  }, []);

  const link = useMemo(() => links.find((l) => l.employee_id === linkId) ?? null, [links, linkId]);

  return (
    <PortalCtx.Provider value={{ token, links, link, mustChangePassword, cpfMasked, ready, offline, login, changePassword, selectLink, call, logout }}>
      {children}
    </PortalCtx.Provider>
  );
}

export function usePortal() {
  const ctx = useContext(PortalCtx);
  if (!ctx) throw new Error("usePortal deve ser usado dentro de PortalProvider");
  return ctx;
}

export const maskCpf = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
};

export const fmtMinutes = (m: number) => {
  const total = Math.max(0, Math.round(m || 0));
  const h = Math.floor(total / 60);
  const min = total % 60;
  return h > 0 ? `${h}h ${String(min).padStart(2, "0")}min` : `${min}min`;
};

export const fmtTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—";

export const fmtDateTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export const fmtDayHeader = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });

/** Cor semântica do status de exposição. */
export function statusTone(status?: string | null) {
  switch (status) {
    case "blocked": return { label: "Limite excedido", cls: "text-danger", bg: "bg-danger/10 border-danger/30" };
    case "orange": return { label: "Atenção alta", cls: "text-warning", bg: "bg-warning/10 border-warning/30" };
    case "yellow": return { label: "Atenção", cls: "text-warning", bg: "bg-warning/10 border-warning/30" };
    case "inside": return { label: "Em área fria", cls: "text-success", bg: "bg-success/10 border-success/30" };
    case "on_break": return { label: "Em pausa térmica", cls: "text-primary", bg: "bg-primary/10 border-primary/30" };
    default: return { label: "Fora de área fria", cls: "text-muted-foreground", bg: "bg-muted/40 border-border" };
  }
}

export const OCCURRENCE_LABEL: Record<string, string> = {
  manual_exit: "Tempo de exposição excedido",
  missed_exit: "Saída não registrada",
  interrupted_break: "Pausa térmica interrompida",
  other: "Outra ocorrência",
};
