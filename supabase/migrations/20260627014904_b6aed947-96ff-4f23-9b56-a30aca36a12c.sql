
-- GuardIA presence model evolution
ALTER TABLE public.guardia_device_map
  ADD COLUMN IF NOT EXISTS funcao text NOT NULL DEFAULT 'entrada',
  ADD COLUMN IF NOT EXISTS janela_tolerancia_segundos integer NULL;

ALTER TABLE public.guardia_device_map
  DROP CONSTRAINT IF EXISTS guardia_device_map_funcao_check;
ALTER TABLE public.guardia_device_map
  ADD CONSTRAINT guardia_device_map_funcao_check CHECK (funcao IN ('entrada','externo'));

ALTER TABLE public.integration_config
  ADD COLUMN IF NOT EXISTS janela_tolerancia_segundos integer NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS sessao_longa_alerta_minutos integer NOT NULL DEFAULT 240;

ALTER TABLE public.guardia_events
  ADD COLUMN IF NOT EXISTS process_note text NULL;
