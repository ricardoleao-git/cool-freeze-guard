
-- 1) Enum de papéis
CREATE TYPE public.app_role AS ENUM ('super_admin','administrador','gestor','rh_sst','visualizador');

-- 2) Profiles (1 por usuário, vinculado a 1 tenant; super_admin tem tenant_id NULL)
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id text REFERENCES public.tenants(id) ON DELETE SET NULL,
  email text NOT NULL,
  full_name text NOT NULL DEFAULT '',
  avatar_url text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3) Papéis (separado, multi-role por usuário)
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  tenant_id text REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role, tenant_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 4) Convites
CREATE TABLE public.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24),'hex'),
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invitations TO authenticated;
GRANT ALL ON public.invitations TO service_role;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- 5) Funções security definer
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'super_admin');
$$;

CREATE OR REPLACE FUNCTION public.get_user_tenant(_user_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM public.profiles WHERE user_id = _user_id LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles public.app_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = ANY(_roles));
$$;

CREATE OR REPLACE FUNCTION public.can_manage_tenant(_user_id uuid, _tenant_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(_user_id)
      OR EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = _user_id AND role = 'administrador' AND tenant_id = _tenant_id
      );
$$;

-- 6) Trigger: criar profile + (se for o super admin alvo) atribuir role
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_invite public.invitations%ROWTYPE;
BEGIN
  -- procura convite pendente
  SELECT * INTO v_invite FROM public.invitations
   WHERE lower(email) = lower(NEW.email) AND status = 'pending' AND expires_at > now()
   ORDER BY created_at DESC LIMIT 1;

  INSERT INTO public.profiles (user_id, email, full_name, tenant_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    v_invite.tenant_id
  );

  IF v_invite.id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role, tenant_id)
    VALUES (NEW.id, v_invite.role, v_invite.tenant_id);
    UPDATE public.invitations SET status='accepted', accepted_at=now() WHERE id = v_invite.id;
  END IF;

  -- bootstrap super admin
  IF lower(NEW.email) = 'ricardo.leao@zenite.tech' THEN
    INSERT INTO public.user_roles (user_id, role, tenant_id)
    VALUES (NEW.id, 'super_admin', NULL)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at em profiles
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 7) Policies de profiles / user_roles / invitations
CREATE POLICY "own profile read" ON public.profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin(auth.uid())
         OR (tenant_id IS NOT NULL AND tenant_id = public.get_user_tenant(auth.uid())));
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin(auth.uid())
         OR public.can_manage_tenant(auth.uid(), tenant_id))
  WITH CHECK (user_id = auth.uid() OR public.is_super_admin(auth.uid())
         OR public.can_manage_tenant(auth.uid(), tenant_id));
CREATE POLICY "super admin insert profile" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY "super admin delete profile" ON public.profiles FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY "roles read self or admin" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin(auth.uid())
         OR (tenant_id IS NOT NULL AND public.can_manage_tenant(auth.uid(), tenant_id)));
CREATE POLICY "roles insert by admin" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid())
         OR (tenant_id IS NOT NULL AND public.can_manage_tenant(auth.uid(), tenant_id) AND role <> 'super_admin'));
CREATE POLICY "roles delete by admin" ON public.user_roles FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid())
         OR (tenant_id IS NOT NULL AND public.can_manage_tenant(auth.uid(), tenant_id) AND role <> 'super_admin'));

CREATE POLICY "invites read by admin" ON public.invitations FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.can_manage_tenant(auth.uid(), tenant_id));
CREATE POLICY "invites insert by admin" ON public.invitations FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid())
         OR (public.can_manage_tenant(auth.uid(), tenant_id) AND role <> 'super_admin'));
CREATE POLICY "invites update by admin" ON public.invitations FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.can_manage_tenant(auth.uid(), tenant_id));
CREATE POLICY "invites delete by admin" ON public.invitations FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.can_manage_tenant(auth.uid(), tenant_id));

-- 8) Helpers de permissão para domínio
CREATE OR REPLACE FUNCTION public.can_read_tenant(_user_id uuid, _tenant_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(_user_id)
      OR (_tenant_id IS NOT NULL AND _tenant_id = public.get_user_tenant(_user_id)
          AND public.has_any_role(_user_id,
              ARRAY['administrador','gestor','rh_sst','visualizador']::public.app_role[]));
$$;

CREATE OR REPLACE FUNCTION public.can_write_tenant(_user_id uuid, _tenant_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(_user_id)
      OR (_tenant_id IS NOT NULL AND _tenant_id = public.get_user_tenant(_user_id)
          AND public.has_any_role(_user_id,
              ARRAY['administrador','gestor','rh_sst']::public.app_role[]));
$$;

-- 9) Substituir todas as policies abertas das tabelas de domínio
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'tenants','units','departments','cold_areas','devices','employees',
    'access_events','alerts','occurrences','occurrence_notes','occurrence_attachments','thermal_breaks'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS "demo open read" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "demo open insert" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "demo open update" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "demo open delete" ON public.%I', t);
  END LOOP;
END $$;

-- Tenants: super admin tudo; demais só leem o próprio tenant
CREATE POLICY "tenants read" ON public.tenants FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR id = public.get_user_tenant(auth.uid()));
CREATE POLICY "tenants insert super" ON public.tenants FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY "tenants update super or admin" ON public.tenants FOR UPDATE TO authenticated
  USING (public.can_manage_tenant(auth.uid(), id))
  WITH CHECK (public.can_manage_tenant(auth.uid(), id));
CREATE POLICY "tenants delete super" ON public.tenants FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- Função genérica para aplicar policies tenant-scoped
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'units','departments','cold_areas','devices','employees',
    'access_events','alerts','occurrences','thermal_breaks'
  ]) LOOP
    EXECUTE format($f$CREATE POLICY "%1$s read" ON public.%1$I FOR SELECT TO authenticated
      USING (public.can_read_tenant(auth.uid(), tenant_id))$f$, t);
    EXECUTE format($f$CREATE POLICY "%1$s insert" ON public.%1$I FOR INSERT TO authenticated
      WITH CHECK (public.can_write_tenant(auth.uid(), tenant_id))$f$, t);
    EXECUTE format($f$CREATE POLICY "%1$s update" ON public.%1$I FOR UPDATE TO authenticated
      USING (public.can_write_tenant(auth.uid(), tenant_id))
      WITH CHECK (public.can_write_tenant(auth.uid(), tenant_id))$f$, t);
    EXECUTE format($f$CREATE POLICY "%1$s delete" ON public.%1$I FOR DELETE TO authenticated
      USING (public.can_write_tenant(auth.uid(), tenant_id))$f$, t);
  END LOOP;
END $$;

-- occurrence_notes / occurrence_attachments: derivam tenant da occurrence
CREATE POLICY "occ_notes read" ON public.occurrence_notes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.occurrences o WHERE o.id = occurrence_id
                 AND public.can_read_tenant(auth.uid(), o.tenant_id)));
CREATE POLICY "occ_notes write" ON public.occurrence_notes FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.occurrences o WHERE o.id = occurrence_id
                 AND public.can_write_tenant(auth.uid(), o.tenant_id)));
CREATE POLICY "occ_notes update" ON public.occurrence_notes FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.occurrences o WHERE o.id = occurrence_id
                 AND public.can_write_tenant(auth.uid(), o.tenant_id)));
CREATE POLICY "occ_notes delete" ON public.occurrence_notes FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.occurrences o WHERE o.id = occurrence_id
                 AND public.can_write_tenant(auth.uid(), o.tenant_id)));

CREATE POLICY "occ_att read" ON public.occurrence_attachments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.occurrences o WHERE o.id = occurrence_id
                 AND public.can_read_tenant(auth.uid(), o.tenant_id)));
CREATE POLICY "occ_att write" ON public.occurrence_attachments FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.occurrences o WHERE o.id = occurrence_id
                 AND public.can_write_tenant(auth.uid(), o.tenant_id)));
CREATE POLICY "occ_att update" ON public.occurrence_attachments FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.occurrences o WHERE o.id = occurrence_id
                 AND public.can_write_tenant(auth.uid(), o.tenant_id)));
CREATE POLICY "occ_att delete" ON public.occurrence_attachments FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.occurrences o WHERE o.id = occurrence_id
                 AND public.can_write_tenant(auth.uid(), o.tenant_id)));
