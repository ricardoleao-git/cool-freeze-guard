
-- 1) Add PIN columns to employees
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS pin_hash text NULL,
  ADD COLUMN IF NOT EXISTS pin_set_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS pin_failed_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_until timestamptz NULL;

-- 2) daily_statement_confirmations
CREATE TABLE IF NOT EXISTS public.daily_statement_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id text NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  reference_date date NOT NULL,
  content_hash text NOT NULL,
  content_snapshot jsonb NOT NULL,
  clickwrap_text text NOT NULL,
  clickwrap_text_hash text NOT NULL,
  signature_method text NOT NULL DEFAULT 'pin',
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  ip_origin inet,
  user_agent text,
  previous_hash text,
  record_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id, reference_date)
);

CREATE INDEX IF NOT EXISTS idx_dsc_tenant_employee_date
  ON public.daily_statement_confirmations (tenant_id, employee_id, reference_date DESC);

GRANT SELECT ON public.daily_statement_confirmations TO authenticated;
GRANT ALL ON public.daily_statement_confirmations TO service_role;

ALTER TABLE public.daily_statement_confirmations ENABLE ROW LEVEL SECURITY;

-- Read: any tenant role
CREATE POLICY "dsc_read_tenant" ON public.daily_statement_confirmations
  FOR SELECT TO authenticated
  USING (public.can_read_tenant(auth.uid(), tenant_id));

-- Write: only service_role (edge function). No INSERT/UPDATE/DELETE policy for authenticated.

-- Immutability trigger
CREATE OR REPLACE FUNCTION public.dsc_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('service_role','postgres','supabase_admin') THEN
    IF TG_OP = 'UPDATE' THEN RETURN NEW; ELSE RETURN OLD; END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'daily_statement_confirmations é imutável: UPDATE bloqueado';
  ELSE
    RAISE EXCEPTION 'daily_statement_confirmations é imutável: DELETE bloqueado';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS dsc_immutable_trg ON public.daily_statement_confirmations;
CREATE TRIGGER dsc_immutable_trg
  BEFORE UPDATE OR DELETE ON public.daily_statement_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.dsc_immutable();

-- Forensic chain trigger
CREATE OR REPLACE FUNCTION public.dsc_forensic()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
  FROM public.daily_statement_confirmations
  WHERE tenant_id = NEW.tenant_id
    AND employee_id = NEW.employee_id
  ORDER BY reference_date DESC, confirmed_at DESC
  LIMIT 1;

  NEW.previous_hash := v_prev;

  v_payload := concat_ws('|',
    NEW.id::text, NEW.tenant_id, NEW.employee_id,
    NEW.reference_date::text, NEW.content_hash,
    NEW.clickwrap_text_hash, NEW.confirmed_at::text,
    COALESCE(v_prev, '')
  );

  NEW.record_hash := encode(extensions.digest(v_payload, 'sha256'), 'hex');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dsc_forensic_trg ON public.daily_statement_confirmations;
CREATE TRIGGER dsc_forensic_trg
  BEFORE INSERT ON public.daily_statement_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.dsc_forensic();
