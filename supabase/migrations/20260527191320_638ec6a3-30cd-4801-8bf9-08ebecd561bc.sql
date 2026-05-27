INSERT INTO storage.buckets (id, name, public) VALUES ('employee-avatars', 'employee-avatars', true) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Employee avatars are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'employee-avatars');

CREATE POLICY "Anyone can upload employee avatars"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'employee-avatars');

CREATE POLICY "Anyone can update employee avatars"
ON storage.objects FOR UPDATE
USING (bucket_id = 'employee-avatars');

CREATE POLICY "Anyone can delete employee avatars"
ON storage.objects FOR DELETE
USING (bucket_id = 'employee-avatars');