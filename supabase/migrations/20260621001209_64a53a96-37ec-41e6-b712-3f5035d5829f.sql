DROP POLICY IF EXISTS "employee-avatars anon read demo" ON storage.objects;

CREATE POLICY "employee-avatars anon read demo"
ON storage.objects FOR SELECT TO anon
USING (
  bucket_id = 'employee-avatars'
  AND (storage.foldername(name))[1] = 'demo-tenant'
);