
-- 1) Add write policies for closure_signatures (immutable triggers prevent UPDATE/DELETE)
CREATE POLICY "write closure_signatures by tenant" ON public.closure_signatures
  FOR INSERT TO authenticated
  WITH CHECK (public.can_write_tenant(auth.uid(), tenant_id));

-- 2) Add write policies for daily_statement_confirmations
CREATE POLICY "dsc_insert_tenant" ON public.daily_statement_confirmations
  FOR INSERT TO authenticated
  WITH CHECK (public.can_write_tenant(auth.uid(), tenant_id));

-- 3) Add write policies for inconsistency_reviews
CREATE POLICY "ir_insert_tenant" ON public.inconsistency_reviews
  FOR INSERT TO authenticated
  WITH CHECK (public.can_write_tenant(auth.uid(), tenant_id));
CREATE POLICY "ir_update_tenant" ON public.inconsistency_reviews
  FOR UPDATE TO authenticated
  USING (public.can_write_tenant(auth.uid(), tenant_id))
  WITH CHECK (public.can_write_tenant(auth.uid(), tenant_id));
CREATE POLICY "ir_delete_tenant" ON public.inconsistency_reviews
  FOR DELETE TO authenticated
  USING (public.can_manage_tenant(auth.uid(), tenant_id));

-- 4) Add write policies for period_closures
CREATE POLICY "pc_insert_tenant" ON public.period_closures
  FOR INSERT TO authenticated
  WITH CHECK (public.can_write_tenant(auth.uid(), tenant_id));
CREATE POLICY "pc_update_tenant" ON public.period_closures
  FOR UPDATE TO authenticated
  USING (public.can_write_tenant(auth.uid(), tenant_id))
  WITH CHECK (public.can_write_tenant(auth.uid(), tenant_id));
CREATE POLICY "pc_delete_tenant" ON public.period_closures
  FOR DELETE TO authenticated
  USING (public.can_manage_tenant(auth.uid(), tenant_id));

-- 5) Stop exposing employees.pin_hash to anon (demo tenant).
-- Revoke column-level SELECT on pin_hash from anon and authenticated; PIN verification
-- only happens through SECURITY DEFINER edge functions / RPCs with service_role.
REVOKE SELECT (pin_hash) ON public.employees FROM anon;
REVOKE SELECT (pin_hash) ON public.employees FROM authenticated;
