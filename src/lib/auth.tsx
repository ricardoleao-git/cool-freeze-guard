import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
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
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  user: null, session: null, profile: null, roles: [], loading: true,
  refresh: async () => {}, signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (uid: string) => {
    const [{ data: prof }, { data: rls }] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", uid).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", uid),
    ]);
    setProfile((prof as Profile) ?? null);
    setRoles((rls ?? []).map((r: any) => r.role as AppRole));
  }, []);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s?.user) {
        // defer to avoid deadlocks inside the callback
        setTimeout(() => { loadProfile(s.user.id); }, 0);
      } else {
        setProfile(null);
        setRoles([]);
      }
      setLoading(false);
    });
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session?.user) await loadProfile(data.session.user.id);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const refresh = useCallback(async () => {
    if (session?.user) await loadProfile(session.user.id);
  }, [session, loadProfile]);

  return (
    <Ctx.Provider value={{
      user: session?.user ?? null,
      session,
      profile,
      roles,
      loading,
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

  // Sem papéis: usuário ainda não foi liberado por um administrador
  if (roles.length === 0) {
    return <Navigate to="/sem-permissao" replace />;
  }
  // Sem tenant e não é super admin: precisa ser convidado para uma empresa
  if (!profile?.tenant_id && !roles.includes("super_admin")) {
    return <Navigate to="/sem-permissao" replace />;
  }
  if (!canAccess(pathname, roles)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
