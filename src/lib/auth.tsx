import { createContext, useContext, useEffect, useState, ReactNode, useCallback, useRef } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { AppRole, canAccess } from "@/lib/permissions";

export type Profile = {
  id: string;
  user_id: string;
  tenant_id: string | null;
  email: string;
  full_name: string;
  avatar_url: string;
  status: string;
};

type AuthCtx = {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  roles: AppRole[];
  loading: boolean;
  isDemo: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  user: null, session: null, profile: null, roles: [], loading: true, isDemo: false,
  refresh: async () => {}, signOut: async () => {},
});

// Identidade virtual exposta enquanto o visitante navega pelas rotas /demo/*.
const DEMO_USER = {
  id: "demo-user",
  email: "demo@frio-safe.app",
  user_metadata: { full_name: "Visitante (Demo)" },
} as unknown as User;

const DEMO_PROFILE: Profile = {
  id: "demo-user",
  user_id: "demo-user",
  tenant_id: "demo-tenant",
  email: "demo@frio-safe.app",
  full_name: "Visitante (Demo)",
  avatar_url: "",
  status: "active",
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);
  const authLoadSeq = useRef(0);
  const { pathname } = useLocation();
  const isDemo = pathname === "/demo" || pathname.startsWith("/demo/");

  const loadProfile = useCallback(async (uid: string) => {
    const [{ data: prof }, { data: rls }] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", uid).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", uid),
    ]);
    setProfile((prof as Profile) ?? null);
    setRoles((rls ?? []).map((r: any) => r.role as AppRole));
  }, []);

  const clearIdentity = useCallback(() => {
    setSession(null);
    setProfile(null);
    setRoles([]);
  }, []);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      const seq = ++authLoadSeq.current;
      if (s?.user) {
        setLoading(true);
        setSession(s);
        setTimeout(() => {
          loadProfile(s.user.id).finally(() => {
            if (authLoadSeq.current === seq) setLoading(false);
          });
        }, 0);
      } else {
        clearIdentity();
        setLoading(false);
      }
    });
    supabase.auth.getSession().then(async ({ data }) => {
      const seq = ++authLoadSeq.current;
      setSession(data.session);
      if (data.session?.user) await loadProfile(data.session.user.id);
      if (authLoadSeq.current === seq) setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, [clearIdentity, loadProfile]);

  const refresh = useCallback(async () => {
    if (session?.user) await loadProfile(session.user.id);
  }, [session, loadProfile]);

  // Em rotas /demo/* injetamos uma identidade virtual com role super_admin
  // para que sidebar/badges/guards de UI funcionem sem sessão real.
  const effectiveUser = isDemo ? DEMO_USER : (session?.user ?? null);
  const effectiveProfile = isDemo ? DEMO_PROFILE : profile;
  const effectiveRoles: AppRole[] = isDemo ? ["super_admin"] : roles;
  const effectiveLoading = isDemo ? false : loading;

  return (
    <Ctx.Provider value={{
      user: effectiveUser,
      session,
      profile: effectiveProfile,
      roles: effectiveRoles,
      loading: effectiveLoading,
      isDemo,
      refresh,
      signOut: async () => { await supabase.auth.signOut(); },
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground text-sm">Carregando…</div>;
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  }
  return <>{children}</>;
}

/** Bloqueia rota conforme matriz de permissões. Use dentro de ProtectedRoute. */
export function RoleGuard({ children }: { children: ReactNode }) {
  const { roles, loading, profile } = useAuth();
  const { pathname } = useLocation();
  if (loading) return null;

  if (roles.length === 0) {
    return <Navigate to="/sem-permissao" replace />;
  }
  if (!profile?.tenant_id && !roles.includes("super_admin")) {
    return <Navigate to="/sem-permissao" replace />;
  }
  if (!canAccess(pathname, roles)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
