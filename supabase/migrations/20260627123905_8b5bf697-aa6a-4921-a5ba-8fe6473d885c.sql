
ALTER TABLE public.integration_config
  ADD COLUMN IF NOT EXISTS auth_header_name text NOT NULL DEFAULT 'X-GuardIA-Token',
  ADD COLUMN IF NOT EXISTS auth_scheme text NOT NULL DEFAULT 'header',
  ADD COLUMN IF NOT EXISTS api_base_path text NOT NULL DEFAULT '/guardiaapi',
  ADD COLUMN IF NOT EXISTS events_endpoint text,
  ADD COLUMN IF NOT EXISTS last_event_poll_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_event_cursor text,
  ADD COLUMN IF NOT EXISTS last_push_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_push_count integer DEFAULT 0;
