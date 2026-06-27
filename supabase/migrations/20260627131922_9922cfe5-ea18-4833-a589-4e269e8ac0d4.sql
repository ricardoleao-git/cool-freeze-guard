ALTER TABLE public.integration_config
  ADD COLUMN IF NOT EXISTS stale_error_threshold_minutes integer NOT NULL DEFAULT 15
  CHECK (stale_error_threshold_minutes BETWEEN 1 AND 1440);