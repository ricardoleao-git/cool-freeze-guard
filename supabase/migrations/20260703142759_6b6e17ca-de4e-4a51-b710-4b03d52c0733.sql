ALTER TABLE public.kiosk_tokens
  ADD COLUMN IF NOT EXISTS pairing_code text,
  ADD COLUMN IF NOT EXISTS pairing_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS paired_at timestamptz,
  ADD COLUMN IF NOT EXISTS paired_ip inet,
  ADD COLUMN IF NOT EXISTS paired_user_agent text;

CREATE UNIQUE INDEX IF NOT EXISTS kiosk_tokens_pairing_code_active_uidx
  ON public.kiosk_tokens (tenant_id, pairing_code)
  WHERE pairing_code IS NOT NULL;
