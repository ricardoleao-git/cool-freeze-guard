-- Policies for authenticated users to access demo-tenant data
-- This allows the public demo panel (/painel-demo) to work even when the user has an active session

CREATE POLICY "demo tenant read for authenticated"
  ON public.employees FOR SELECT TO authenticated
  USING (tenant_id = 'demo-tenant');

CREATE POLICY "demo tenant insert for authenticated"
  ON public.employees FOR INSERT TO authenticated
  WITH CHECK (tenant_id = 'demo-tenant');

CREATE POLICY "demo tenant update for authenticated"
  ON public.employees FOR UPDATE TO authenticated
  USING (tenant_id = 'demo-tenant')
  WITH CHECK (tenant_id = 'demo-tenant');

CREATE POLICY "demo tenant delete for authenticated"
  ON public.employees FOR DELETE TO authenticated
  USING (tenant_id = 'demo-tenant');

CREATE POLICY "demo tenant read for authenticated"
  ON public.units FOR SELECT TO authenticated
  USING (tenant_id = 'demo-tenant');

CREATE POLICY "demo tenant read for authenticated"
  ON public.departments FOR SELECT TO authenticated
  USING (tenant_id = 'demo-tenant');

CREATE POLICY "demo tenant read for authenticated"
  ON public.cold_areas FOR SELECT TO authenticated
  USING (tenant_id = 'demo-tenant');

CREATE POLICY "demo tenant read for authenticated"
  ON public.devices FOR SELECT TO authenticated
  USING (tenant_id = 'demo-tenant');

CREATE POLICY "demo tenant read for authenticated"
  ON public.access_events FOR SELECT TO authenticated
  USING (tenant_id = 'demo-tenant');

CREATE POLICY "demo tenant insert for authenticated"
  ON public.access_events FOR INSERT TO authenticated
  WITH CHECK (tenant_id = 'demo-tenant');

CREATE POLICY "demo tenant update for authenticated"
  ON public.access_events FOR UPDATE TO authenticated
  USING (tenant_id = 'demo-tenant')
  WITH CHECK (tenant_id = 'demo-tenant');

CREATE POLICY "demo tenant delete for authenticated"
  ON public.access_events FOR DELETE TO authenticated
  USING (tenant_id = 'demo-tenant');

CREATE POLICY "demo tenant read for authenticated"
  ON public.alerts FOR SELECT TO authenticated
  USING (tenant_id = 'demo-tenant');

CREATE POLICY "demo tenant insert for authenticated"
  ON public.alerts FOR INSERT TO authenticated
  WITH CHECK (tenant_id = 'demo-tenant');

CREATE POLICY "demo tenant update for authenticated"
  ON public.alerts FOR UPDATE TO authenticated
  USING (tenant_id = 'demo-tenant')
  WITH CHECK (tenant_id = 'demo-tenant');

CREATE POLICY "demo tenant delete for authenticated"
  ON public.alerts FOR DELETE TO authenticated
  USING (tenant_id = 'demo-tenant');

CREATE POLICY "demo tenant read for authenticated"
  ON public.thermal_breaks FOR SELECT TO authenticated
  USING (tenant_id = 'demo-tenant');

CREATE POLICY "demo tenant insert for authenticated"
  ON public.thermal_breaks FOR INSERT TO authenticated
  WITH CHECK (tenant_id = 'demo-tenant');

CREATE POLICY "demo tenant update for authenticated"
  ON public.thermal_breaks FOR UPDATE TO authenticated
  USING (tenant_id = 'demo-tenant')
  WITH CHECK (tenant_id = 'demo-tenant');

CREATE POLICY "demo tenant delete for authenticated"
  ON public.thermal_breaks FOR DELETE TO authenticated
  USING (tenant_id = 'demo-tenant');

CREATE POLICY "demo tenant read for authenticated"
  ON public.occurrences FOR SELECT TO authenticated
  USING (tenant_id = 'demo-tenant');

CREATE POLICY "demo tenant read for authenticated"
  ON public.occurrence_notes FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.occurrences o WHERE o.id = occurrence_id AND o.tenant_id = 'demo-tenant'
  ));

CREATE POLICY "demo tenant read for authenticated"
  ON public.occurrence_attachments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.occurrences o WHERE o.id = occurrence_id AND o.tenant_id = 'demo-tenant'
  ));

CREATE POLICY "demo tenant read for authenticated"
  ON public.employee_cold_areas FOR SELECT TO authenticated
  USING (tenant_id = 'demo-tenant');

CREATE POLICY "demo tenant read for authenticated"
  ON public.tenant_settings FOR SELECT TO authenticated
  USING (tenant_id = 'demo-tenant');

CREATE POLICY "demo tenant read for authenticated"
  ON public.employee_consents FOR SELECT TO authenticated
  USING (tenant_id = 'demo-tenant');