
ALTER TABLE public.thermal_breaks
  ADD COLUMN IF NOT EXISTS interrupted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS interrupted_at timestamptz,
  ADD COLUMN IF NOT EXISTS interruption_reason text;

CREATE INDEX IF NOT EXISTS idx_thermal_breaks_tenant_emp_started
  ON public.thermal_breaks(tenant_id, employee_id, started_at DESC);
