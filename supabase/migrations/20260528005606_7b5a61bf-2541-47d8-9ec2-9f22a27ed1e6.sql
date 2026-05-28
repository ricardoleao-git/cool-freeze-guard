
CREATE TABLE public.employee_cold_areas (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id text NOT NULL,
  cold_area_id text NOT NULL,
  tenant_id text NOT NULL,
  authorized_by text NOT NULL DEFAULT 'sistema',
  authorized_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, cold_area_id)
);

CREATE INDEX idx_eca_employee ON public.employee_cold_areas (employee_id);
CREATE INDEX idx_eca_area ON public.employee_cold_areas (cold_area_id);
CREATE INDEX idx_eca_tenant ON public.employee_cold_areas (tenant_id);

GRANT SELECT ON public.employee_cold_areas TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_cold_areas TO authenticated;
GRANT ALL ON public.employee_cold_areas TO service_role;

ALTER TABLE public.employee_cold_areas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eca read" ON public.employee_cold_areas
  FOR SELECT TO authenticated
  USING (public.can_read_tenant(auth.uid(), tenant_id));

CREATE POLICY "eca insert" ON public.employee_cold_areas
  FOR INSERT TO authenticated
  WITH CHECK (public.can_write_tenant(auth.uid(), tenant_id));

CREATE POLICY "eca update" ON public.employee_cold_areas
  FOR UPDATE TO authenticated
  USING (public.can_write_tenant(auth.uid(), tenant_id))
  WITH CHECK (public.can_write_tenant(auth.uid(), tenant_id));

CREATE POLICY "eca delete" ON public.employee_cold_areas
  FOR DELETE TO authenticated
  USING (public.can_write_tenant(auth.uid(), tenant_id));

CREATE POLICY "demo anon read" ON public.employee_cold_areas
  FOR SELECT TO anon
  USING (tenant_id = 'demo-tenant');

CREATE POLICY "demo anon insert" ON public.employee_cold_areas
  FOR INSERT TO anon
  WITH CHECK (tenant_id = 'demo-tenant');

CREATE POLICY "demo anon update" ON public.employee_cold_areas
  FOR UPDATE TO anon
  USING (tenant_id = 'demo-tenant')
  WITH CHECK (tenant_id = 'demo-tenant');

CREATE POLICY "demo anon delete" ON public.employee_cold_areas
  FOR DELETE TO anon
  USING (tenant_id = 'demo-tenant');
