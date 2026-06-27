
CREATE TABLE public.kiosk_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  label text,
  active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX kiosk_tokens_token_idx ON public.kiosk_tokens (token);
CREATE INDEX kiosk_tokens_tenant_idx ON public.kiosk_tokens (tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.kiosk_tokens TO authenticated;
GRANT ALL ON public.kiosk_tokens TO service_role;

ALTER TABLE public.kiosk_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kiosk_tokens manage by tenant managers (select)"
  ON public.kiosk_tokens FOR SELECT TO authenticated
  USING (public.can_manage_tenant(auth.uid(), tenant_id));

CREATE POLICY "kiosk_tokens manage by tenant managers (insert)"
  ON public.kiosk_tokens FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_tenant(auth.uid(), tenant_id));

CREATE POLICY "kiosk_tokens manage by tenant managers (update)"
  ON public.kiosk_tokens FOR UPDATE TO authenticated
  USING (public.can_manage_tenant(auth.uid(), tenant_id))
  WITH CHECK (public.can_manage_tenant(auth.uid(), tenant_id));

CREATE POLICY "kiosk_tokens manage by tenant managers (delete)"
  ON public.kiosk_tokens FOR DELETE TO authenticated
  USING (public.can_manage_tenant(auth.uid(), tenant_id));
