
CREATE TABLE public.inconsistency_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  signature_key text NOT NULL,
  reviewed_by_user_id uuid,
  reviewed_by_name text,
  note text,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, signature_key)
);

GRANT SELECT ON public.inconsistency_reviews TO authenticated;
GRANT ALL ON public.inconsistency_reviews TO service_role;

ALTER TABLE public.inconsistency_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ir_read_tenant" ON public.inconsistency_reviews
  FOR SELECT TO authenticated
  USING (public.can_read_tenant(auth.uid(), tenant_id));

CREATE INDEX ix_inconsistency_reviews_tenant ON public.inconsistency_reviews(tenant_id, signature_key);
