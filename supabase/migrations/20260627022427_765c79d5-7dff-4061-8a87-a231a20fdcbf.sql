
-- =========================================
-- period_closures
-- =========================================
CREATE TABLE public.period_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period_type text NOT NULL CHECK (period_type IN ('week','month')),
  reference_start date NOT NULL,
  reference_end date NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','supervisor_signed','rh_signed','legal_sealed','reopened')),
  consolidated jsonb,
  consolidated_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, period_type, reference_start)
);

GRANT SELECT ON public.period_closures TO authenticated;
GRANT ALL ON public.period_closures TO service_role;

ALTER TABLE public.period_closures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read period_closures by tenant"
  ON public.period_closures FOR SELECT
  TO authenticated
  USING (public.can_read_tenant(auth.uid(), tenant_id));

CREATE TRIGGER period_closures_touch_updated_at
  BEFORE UPDATE ON public.period_closures
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX period_closures_tenant_idx
  ON public.period_closures (tenant_id, period_type, reference_start DESC);

-- =========================================
-- closure_signatures (append-only, chained)
-- =========================================
CREATE TABLE public.closure_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  closure_id uuid NOT NULL REFERENCES public.period_closures(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('supervisor','rh','legal')),
  signed_by_user_id uuid,
  signed_by_name text NOT NULL,
  signed_by_role text,
  clickwrap_text text NOT NULL,
  clickwrap_text_hash text NOT NULL,
  content_hash text NOT NULL,
  signature_method text NOT NULL DEFAULT 'clickwrap'
    CHECK (signature_method IN ('clickwrap','icp')),
  ip_origin inet,
  user_agent text,
  previous_hash text,
  record_hash text,
  signed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, closure_id, stage)
);

GRANT SELECT ON public.closure_signatures TO authenticated;
GRANT ALL ON public.closure_signatures TO service_role;

ALTER TABLE public.closure_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read closure_signatures by tenant"
  ON public.closure_signatures FOR SELECT
  TO authenticated
  USING (public.can_read_tenant(auth.uid(), tenant_id));

CREATE INDEX closure_signatures_closure_idx
  ON public.closure_signatures (closure_id, signed_at);

-- =========================================
-- Immutability trigger
-- =========================================
CREATE OR REPLACE FUNCTION public.closure_signatures_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF current_user IN ('service_role','postgres','supabase_admin') THEN
    IF TG_OP = 'UPDATE' THEN RETURN NEW; ELSE RETURN OLD; END IF;
  END IF;
  IF TG_OP = 'DELETE' AND OLD.tenant_id = 'demo-tenant' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'closure_signatures é imutável: UPDATE bloqueado';
  ELSE
    RAISE EXCEPTION 'closure_signatures é imutável: DELETE bloqueado';
  END IF;
END;
$$;

CREATE TRIGGER closure_signatures_immutable_trg
  BEFORE UPDATE OR DELETE ON public.closure_signatures
  FOR EACH ROW EXECUTE FUNCTION public.closure_signatures_immutable();

-- =========================================
-- Forensic chain trigger
-- previous_hash = record_hash da última assinatura do mesmo closure (por signed_at)
-- record_hash   = sha256( id | tenant | closure_id | stage | content_hash
--                          | clickwrap_text_hash | signed_at | previous_hash )
-- =========================================
CREATE OR REPLACE FUNCTION public.closure_signatures_forensic()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_prev text;
  v_payload text;
BEGIN
  IF NEW.ip_origin IS NULL THEN
    BEGIN NEW.ip_origin := inet_client_addr();
    EXCEPTION WHEN OTHERS THEN NEW.ip_origin := NULL;
    END;
  END IF;

  SELECT record_hash INTO v_prev
  FROM public.closure_signatures
  WHERE closure_id = NEW.closure_id
  ORDER BY signed_at DESC, created_at DESC
  LIMIT 1;

  NEW.previous_hash := v_prev;

  v_payload := concat_ws('|',
    NEW.id::text, NEW.tenant_id, NEW.closure_id::text,
    NEW.stage, NEW.content_hash, NEW.clickwrap_text_hash,
    NEW.signed_at::text, COALESCE(v_prev, '')
  );

  NEW.record_hash := encode(extensions.digest(v_payload, 'sha256'), 'hex');
  RETURN NEW;
END;
$$;

CREATE TRIGGER closure_signatures_forensic_trg
  BEFORE INSERT ON public.closure_signatures
  FOR EACH ROW EXECUTE FUNCTION public.closure_signatures_forensic();
