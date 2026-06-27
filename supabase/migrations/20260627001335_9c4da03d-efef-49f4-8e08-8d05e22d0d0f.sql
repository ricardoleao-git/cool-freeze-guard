
-- =========================================================================
-- 1) integration_config
-- =========================================================================
CREATE TABLE public.integration_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  guardia_url text,
  guardia_token text,
  sync_interval text NOT NULL DEFAULT '1h',
  active boolean NOT NULL DEFAULT false,
  last_sync_at timestamptz,
  last_sync_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_config TO authenticated;
GRANT ALL ON public.integration_config TO service_role;

ALTER TABLE public.integration_config ENABLE ROW LEVEL SECURITY;

-- Apenas administradores do tenant (e super_admin) podem ler/escrever.
-- O token fica protegido por essa policy estrita.
CREATE POLICY "integration_config select for tenant managers"
  ON public.integration_config FOR SELECT
  TO authenticated
  USING (public.can_manage_tenant(auth.uid(), tenant_id));

CREATE POLICY "integration_config insert for tenant managers"
  ON public.integration_config FOR INSERT
  TO authenticated
  WITH CHECK (public.can_manage_tenant(auth.uid(), tenant_id));

CREATE POLICY "integration_config update for tenant managers"
  ON public.integration_config FOR UPDATE
  TO authenticated
  USING (public.can_manage_tenant(auth.uid(), tenant_id))
  WITH CHECK (public.can_manage_tenant(auth.uid(), tenant_id));

CREATE POLICY "integration_config delete for tenant managers"
  ON public.integration_config FOR DELETE
  TO authenticated
  USING (public.can_manage_tenant(auth.uid(), tenant_id));

CREATE TRIGGER trg_integration_config_touch
  BEFORE UPDATE ON public.integration_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =========================================================================
-- 2) guardia_events  (buffer dos eventos crus recebidos do GuardIA)
--    Nome diferente de access_events para não conflitar com a tabela
--    forense existente.
-- =========================================================================
CREATE TABLE public.guardia_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  evento_id text NOT NULL,
  colaborador_id text NOT NULL,
  colaborador_nome text,
  local_id text,
  local_nome text,
  tipo text NOT NULL,
  event_timestamp timestamptz NOT NULL,
  dispositivo_id text,
  processed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guardia_events_tipo_check CHECK (tipo IN ('entrada','saida')),
  CONSTRAINT guardia_events_evento_unique UNIQUE (tenant_id, evento_id)
);

CREATE INDEX guardia_events_tenant_ts_idx
  ON public.guardia_events (tenant_id, event_timestamp DESC);
CREATE INDEX guardia_events_tenant_processed_idx
  ON public.guardia_events (tenant_id, processed)
  WHERE processed = false;
CREATE INDEX guardia_events_colaborador_idx
  ON public.guardia_events (tenant_id, colaborador_id);

GRANT SELECT ON public.guardia_events TO authenticated;
GRANT ALL ON public.guardia_events TO service_role;

ALTER TABLE public.guardia_events ENABLE ROW LEVEL SECURITY;

-- Leitura: papéis operacionais do próprio tenant.
CREATE POLICY "guardia_events select for tenant readers"
  ON public.guardia_events FOR SELECT
  TO authenticated
  USING (public.can_read_tenant(auth.uid(), tenant_id));

-- INSERT/UPDATE/DELETE: somente service_role (edge function).
-- Nenhuma policy concedida ao papel authenticated para mutações.

-- =========================================================================
-- 3) employees.origem
-- =========================================================================
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'manual';

COMMENT ON COLUMN public.employees.origem
  IS 'Origem do cadastro: manual | guardia (sincronizado da integração GuardIA)';
