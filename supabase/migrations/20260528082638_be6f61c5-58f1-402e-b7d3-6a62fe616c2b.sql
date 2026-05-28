
-- 1. Add ICP-Brasil columns
ALTER TABLE public.monthly_report_signatures
  ADD COLUMN IF NOT EXISTS signature_type text NOT NULL DEFAULT 'clickwrap',
  ADD COLUMN IF NOT EXISTS icp_signed_file_path text,
  ADD COLUMN IF NOT EXISTS icp_signed_file_hash text,
  ADD COLUMN IF NOT EXISTS icp_signed_file_size bigint,
  ADD COLUMN IF NOT EXISTS icp_signer_name text,
  ADD COLUMN IF NOT EXISTS icp_signer_cpf text,
  ADD COLUMN IF NOT EXISTS icp_certificate_issuer text,
  ADD COLUMN IF NOT EXISTS icp_certificate_valid_until timestamptz,
  ADD COLUMN IF NOT EXISTS icp_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS icp_notes text;

-- 2. Allow updates so ICP evidence can be attached to a previously created signature
GRANT UPDATE ON public.monthly_report_signatures TO authenticated;
GRANT UPDATE ON public.monthly_report_signatures TO anon;

DROP POLICY IF EXISTS "mrs update icp" ON public.monthly_report_signatures;
CREATE POLICY "mrs update icp"
  ON public.monthly_report_signatures
  FOR UPDATE TO authenticated
  USING (public.can_write_tenant(auth.uid(), tenant_id))
  WITH CHECK (public.can_write_tenant(auth.uid(), tenant_id));

DROP POLICY IF EXISTS "mrs demo update" ON public.monthly_report_signatures;
CREATE POLICY "mrs demo update"
  ON public.monthly_report_signatures
  FOR UPDATE TO anon
  USING (tenant_id = 'demo-tenant')
  WITH CHECK (tenant_id = 'demo-tenant');

-- 3. Private storage bucket for ICP-signed PDFs
INSERT INTO storage.buckets (id, name, public)
VALUES ('monthly-report-signatures', 'monthly-report-signatures', false)
ON CONFLICT (id) DO NOTHING;

-- 4. Storage policies: tenant-scoped folders <tenant_id>/<employee_id>/<file>
DROP POLICY IF EXISTS "mrs storage read" ON storage.objects;
CREATE POLICY "mrs storage read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'monthly-report-signatures'
    AND public.can_read_tenant(auth.uid(), (storage.foldername(name))[1])
  );

DROP POLICY IF EXISTS "mrs storage insert" ON storage.objects;
CREATE POLICY "mrs storage insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'monthly-report-signatures'
    AND public.can_write_tenant(auth.uid(), (storage.foldername(name))[1])
  );

DROP POLICY IF EXISTS "mrs storage update" ON storage.objects;
CREATE POLICY "mrs storage update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'monthly-report-signatures'
    AND public.can_write_tenant(auth.uid(), (storage.foldername(name))[1])
  );

DROP POLICY IF EXISTS "mrs storage demo read" ON storage.objects;
CREATE POLICY "mrs storage demo read"
  ON storage.objects FOR SELECT TO anon
  USING (
    bucket_id = 'monthly-report-signatures'
    AND (storage.foldername(name))[1] = 'demo-tenant'
  );

DROP POLICY IF EXISTS "mrs storage demo insert" ON storage.objects;
CREATE POLICY "mrs storage demo insert"
  ON storage.objects FOR INSERT TO anon
  WITH CHECK (
    bucket_id = 'monthly-report-signatures'
    AND (storage.foldername(name))[1] = 'demo-tenant'
  );
