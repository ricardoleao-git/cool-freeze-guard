
-- Acesso anônimo restrito ao tenant 'demo-tenant' para o Modo Experimentação
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.tenants, public.units, public.departments, public.cold_areas,
  public.devices, public.employees, public.access_events, public.alerts,
  public.occurrences, public.occurrence_notes, public.occurrence_attachments,
  public.thermal_breaks TO anon;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'units','departments','cold_areas','devices','employees',
    'access_events','alerts','occurrences','thermal_breaks'
  ]) LOOP
    EXECUTE format($f$CREATE POLICY "demo anon read" ON public.%I FOR SELECT TO anon
      USING (tenant_id = 'demo-tenant')$f$, t);
    EXECUTE format($f$CREATE POLICY "demo anon insert" ON public.%I FOR INSERT TO anon
      WITH CHECK (tenant_id = 'demo-tenant')$f$, t);
    EXECUTE format($f$CREATE POLICY "demo anon update" ON public.%I FOR UPDATE TO anon
      USING (tenant_id = 'demo-tenant')
      WITH CHECK (tenant_id = 'demo-tenant')$f$, t);
    EXECUTE format($f$CREATE POLICY "demo anon delete" ON public.%I FOR DELETE TO anon
      USING (tenant_id = 'demo-tenant')$f$, t);
  END LOOP;
END $$;

CREATE POLICY "demo anon read" ON public.tenants FOR SELECT TO anon
  USING (id = 'demo-tenant');

CREATE POLICY "demo anon read" ON public.occurrence_notes FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM public.occurrences o WHERE o.id = occurrence_id AND o.tenant_id = 'demo-tenant'));
CREATE POLICY "demo anon write" ON public.occurrence_notes FOR INSERT TO anon
  WITH CHECK (EXISTS (SELECT 1 FROM public.occurrences o WHERE o.id = occurrence_id AND o.tenant_id = 'demo-tenant'));
CREATE POLICY "demo anon update" ON public.occurrence_notes FOR UPDATE TO anon
  USING (EXISTS (SELECT 1 FROM public.occurrences o WHERE o.id = occurrence_id AND o.tenant_id = 'demo-tenant'));
CREATE POLICY "demo anon delete" ON public.occurrence_notes FOR DELETE TO anon
  USING (EXISTS (SELECT 1 FROM public.occurrences o WHERE o.id = occurrence_id AND o.tenant_id = 'demo-tenant'));

CREATE POLICY "demo anon read" ON public.occurrence_attachments FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM public.occurrences o WHERE o.id = occurrence_id AND o.tenant_id = 'demo-tenant'));
CREATE POLICY "demo anon write" ON public.occurrence_attachments FOR INSERT TO anon
  WITH CHECK (EXISTS (SELECT 1 FROM public.occurrences o WHERE o.id = occurrence_id AND o.tenant_id = 'demo-tenant'));
CREATE POLICY "demo anon update" ON public.occurrence_attachments FOR UPDATE TO anon
  USING (EXISTS (SELECT 1 FROM public.occurrences o WHERE o.id = occurrence_id AND o.tenant_id = 'demo-tenant'));
CREATE POLICY "demo anon delete" ON public.occurrence_attachments FOR DELETE TO anon
  USING (EXISTS (SELECT 1 FROM public.occurrences o WHERE o.id = occurrence_id AND o.tenant_id = 'demo-tenant'));
