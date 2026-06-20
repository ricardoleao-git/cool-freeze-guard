
DROP POLICY IF EXISTS "demo upload attachments" ON storage.objects;
DROP POLICY IF EXISTS "demo delete attachments" ON storage.objects;

-- Anon: somente dentro de demo-tenant/
CREATE POLICY "occ attachments demo insert"
ON storage.objects
FOR INSERT
TO anon
WITH CHECK (
  bucket_id = 'occurrence-attachments'
  AND (storage.foldername(name))[1] = 'demo-tenant'
);

CREATE POLICY "occ attachments demo delete"
ON storage.objects
FOR DELETE
TO anon
USING (
  bucket_id = 'occurrence-attachments'
  AND (storage.foldername(name))[1] = 'demo-tenant'
);

-- Authenticated: escopado por tenant via can_write_tenant
CREATE POLICY "occ attachments insert tenant"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'occurrence-attachments'
  AND public.can_write_tenant(auth.uid(), (storage.foldername(name))[1])
);

CREATE POLICY "occ attachments update tenant"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'occurrence-attachments'
  AND public.can_write_tenant(auth.uid(), (storage.foldername(name))[1])
)
WITH CHECK (
  bucket_id = 'occurrence-attachments'
  AND public.can_write_tenant(auth.uid(), (storage.foldername(name))[1])
);

CREATE POLICY "occ attachments delete tenant"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'occurrence-attachments'
  AND public.can_write_tenant(auth.uid(), (storage.foldername(name))[1])
);
