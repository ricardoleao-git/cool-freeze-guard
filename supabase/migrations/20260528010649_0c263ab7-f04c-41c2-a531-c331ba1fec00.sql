
ALTER TABLE public.access_events
  ADD COLUMN IF NOT EXISTS ip_origin inet,
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS status_before text,
  ADD COLUMN IF NOT EXISTS status_after text,
  ADD COLUMN IF NOT EXISTS accumulated_at_event numeric,
  ADD COLUMN IF NOT EXISTS record_hash text,
  ADD COLUMN IF NOT EXISTS previous_hash text;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS idx_access_events_tenant_emp_occurred
  ON public.access_events(tenant_id, employee_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.access_events_forensic()
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
    BEGIN
      NEW.ip_origin := inet_client_addr();
    EXCEPTION WHEN OTHERS THEN
      NEW.ip_origin := NULL;
    END;
  END IF;

  SELECT record_hash INTO v_prev
  FROM public.access_events
  WHERE tenant_id = NEW.tenant_id
    AND employee_id = NEW.employee_id
  ORDER BY occurred_at DESC NULLS LAST, created_at DESC
  LIMIT 1;

  NEW.previous_hash := v_prev;

  v_payload := concat_ws('|',
    NEW.id::text, NEW.tenant_id, NEW.unit_id, NEW.cold_area_id,
    COALESCE(NEW.device_id, ''), NEW.employee_id, NEW.event_type,
    NEW.source, NEW.occurred_at::text, NEW.validation_status,
    COALESCE(NEW.status_before, ''), COALESCE(NEW.status_after, ''),
    COALESCE(NEW.accumulated_at_event::text, ''),
    COALESCE(NEW.ip_origin::text, ''), COALESCE(NEW.user_agent, ''),
    COALESCE(v_prev, '')
  );

  NEW.record_hash := encode(extensions.digest(v_payload, 'sha256'), 'hex');
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.access_events_forensic() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_access_events_forensic ON public.access_events;
CREATE TRIGGER trg_access_events_forensic
BEFORE INSERT ON public.access_events
FOR EACH ROW EXECUTE FUNCTION public.access_events_forensic();

CREATE OR REPLACE FUNCTION public.access_events_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF current_user IN ('service_role','postgres','supabase_admin') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'access_events é imutável: UPDATE bloqueado (trilha forense)';
  ELSIF TG_OP = 'DELETE' THEN
    IF current_user IN ('service_role','postgres','supabase_admin') THEN
      RETURN OLD;
    END IF;
    IF OLD.tenant_id = 'demo-tenant' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'access_events é imutável: DELETE bloqueado (trilha forense)';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_access_events_immutable_upd ON public.access_events;
CREATE TRIGGER trg_access_events_immutable_upd
BEFORE UPDATE ON public.access_events
FOR EACH ROW EXECUTE FUNCTION public.access_events_immutable();

DROP TRIGGER IF EXISTS trg_access_events_immutable_del ON public.access_events;
CREATE TRIGGER trg_access_events_immutable_del
BEFORE DELETE ON public.access_events
FOR EACH ROW EXECUTE FUNCTION public.access_events_immutable();
