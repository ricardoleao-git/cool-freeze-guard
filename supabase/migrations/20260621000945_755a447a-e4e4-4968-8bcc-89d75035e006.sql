-- Remove broad SELECT policy on storage.objects that allowed any authenticated user
-- to read files from any tenant in employee-avatars / occurrence-attachments.
DROP POLICY IF EXISTS "avatars read authenticated" ON storage.objects;

-- Tenant-scoped SELECT for employee-avatars (path: <tenant_id>/<...> OR <employee_id>/<...>).
-- We use can_read_tenant() against the first folder segment when it matches a tenant.
-- For backwards compat where path starts with employee_id, we additionally allow reads
-- whose employee belongs to the user's tenant.
CREATE POLICY "employee-avatars read tenant-scoped"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'employee-avatars'
  AND (
    public.can_read_tenant(auth.uid(), (storage.foldername(name))[1])
    OR EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = (storage.foldername(name))[1]
        AND public.can_read_tenant(auth.uid(), e.tenant_id)
    )
  )
);

-- Tenant-scoped SELECT for occurrence-attachments (path: <tenant_id>/<...>).
CREATE POLICY "occurrence-attachments read tenant-scoped"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'occurrence-attachments'
  AND public.can_read_tenant(auth.uid(), (storage.foldername(name))[1])
);

-- Allow anon to SELECT occurrence-attachments only under demo-tenant/ (mirrors INSERT/DELETE).
CREATE POLICY "occurrence-attachments anon read demo"
ON storage.objects FOR SELECT TO anon
USING (
  bucket_id = 'occurrence-attachments'
  AND (storage.foldername(name))[1] = 'demo-tenant'
);

-- Allow anon to SELECT employee-avatars only under demo-tenant/ (demo route renders avatars).
CREATE POLICY "employee-avatars anon read demo"
ON storage.objects FOR SELECT TO anon
USING (
  bucket_id = 'employee-avatars'
  AND (
    (storage.foldername(name))[1] = 'demo-tenant'
    OR EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = (storage.foldername(name))[1]
        AND e.tenant_id = 'demo-tenant'
    )
  )
);