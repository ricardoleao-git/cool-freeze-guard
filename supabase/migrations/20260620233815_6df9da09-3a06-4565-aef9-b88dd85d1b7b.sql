
-- Restringe upload/update/delete em employee-avatars a usuários autenticados
-- com escrita no tenant (pasta = tenant_id). Antes, qualquer visitante podia
-- sobrescrever ou apagar avatares.
DROP POLICY IF EXISTS "Anyone can delete employee avatars" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can update employee avatars" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload employee avatars" ON storage.objects;

CREATE POLICY "employee avatars insert tenant"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'employee-avatars'
  AND public.can_write_tenant(auth.uid(), (storage.foldername(name))[1])
);

CREATE POLICY "employee avatars update tenant"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'employee-avatars'
  AND public.can_write_tenant(auth.uid(), (storage.foldername(name))[1])
)
WITH CHECK (
  bucket_id = 'employee-avatars'
  AND public.can_write_tenant(auth.uid(), (storage.foldername(name))[1])
);

CREATE POLICY "employee avatars delete tenant"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'employee-avatars'
  AND public.can_write_tenant(auth.uid(), (storage.foldername(name))[1])
);
