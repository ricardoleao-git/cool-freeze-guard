UPDATE public.employees
SET current_status='inside',
    current_area_id='demo-c1',
    inside_since = now() - interval '173 minutes'
WHERE id='demo-e6' AND tenant_id='demo-tenant';

INSERT INTO public.access_events
  (tenant_id, unit_id, cold_area_id, device_id, employee_id, event_type, source, occurred_at, validation_status, status_before, status_after)
SELECT 'demo-tenant', 'demo-u1', 'demo-c1', 'demo-dev-in', 'demo-e6', 'entry', 'device',
       now() - interval '173 minutes', 'valid', 'outside', 'inside'
WHERE NOT EXISTS (
  SELECT 1 FROM public.access_events
   WHERE employee_id='demo-e6' AND event_type='entry'
     AND occurred_at > now() - interval '4 hours'
);