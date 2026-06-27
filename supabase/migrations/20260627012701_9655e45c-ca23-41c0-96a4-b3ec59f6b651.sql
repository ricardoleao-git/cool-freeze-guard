
CREATE TABLE public.guardia_device_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  guardia_device_id text NOT NULL,
  cold_area_id text NOT NULL REFERENCES public.cold_areas(id) ON DELETE CASCADE,
  guardia_local_id text,
  label text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, guardia_device_id)
);

CREATE INDEX idx_guardia_device_map_tenant_active
  ON public.guardia_device_map (tenant_id, active);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.guardia_device_map TO authenticated;
GRANT ALL ON public.guardia_device_map TO service_role;

ALTER TABLE public.guardia_device_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "guardia_device_map_read"
  ON public.guardia_device_map FOR SELECT
  TO authenticated
  USING (public.can_read_tenant(auth.uid(), tenant_id));

CREATE POLICY "guardia_device_map_insert"
  ON public.guardia_device_map FOR INSERT
  TO authenticated
  WITH CHECK (public.can_manage_tenant(auth.uid(), tenant_id));

CREATE POLICY "guardia_device_map_update"
  ON public.guardia_device_map FOR UPDATE
  TO authenticated
  USING (public.can_manage_tenant(auth.uid(), tenant_id))
  WITH CHECK (public.can_manage_tenant(auth.uid(), tenant_id));

CREATE POLICY "guardia_device_map_delete"
  ON public.guardia_device_map FOR DELETE
  TO authenticated
  USING (public.can_manage_tenant(auth.uid(), tenant_id));

CREATE TRIGGER trg_guardia_device_map_touch
  BEFORE UPDATE ON public.guardia_device_map
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
