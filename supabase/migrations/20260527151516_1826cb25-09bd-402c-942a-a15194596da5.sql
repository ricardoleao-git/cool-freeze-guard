
-- ==========================================
-- FrioSafe schema
-- ==========================================

CREATE TABLE public.tenants (
  id text PRIMARY KEY,
  name text NOT NULL,
  legal_name text NOT NULL,
  document_number text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  plan text NOT NULL DEFAULT 'Plus',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.units (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  city text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT '',
  manager_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.units(tenant_id);

CREATE TABLE public.departments (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  unit_id text NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.departments(tenant_id);
CREATE INDEX ON public.departments(unit_id);

CREATE TABLE public.cold_areas (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  unit_id text NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  department_id text NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'Câmara Fria',
  average_temperature numeric NOT NULL DEFAULT 0,
  exposure_limit_minutes integer NOT NULL DEFAULT 100,
  warning_yellow_minutes integer NOT NULL DEFAULT 80,
  warning_orange_minutes integer NOT NULL DEFAULT 90,
  break_minutes integer NOT NULL DEFAULT 20,
  counting_mode text NOT NULL DEFAULT 'accumulated',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.cold_areas(tenant_id);

CREATE TABLE public.employees (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  unit_id text NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  department_id text NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  name text NOT NULL,
  registration_number text NOT NULL,
  position text NOT NULL DEFAULT '',
  avatar text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  current_status text NOT NULL DEFAULT 'outside',
  accumulated_minutes numeric NOT NULL DEFAULT 0,
  inside_since timestamptz,
  current_area_id text REFERENCES public.cold_areas(id) ON DELETE SET NULL,
  break_started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.employees(tenant_id);

CREATE TABLE public.devices (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  unit_id text NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  cold_area_id text NOT NULL REFERENCES public.cold_areas(id) ON DELETE CASCADE,
  name text NOT NULL,
  device_type text NOT NULL,
  external_device_id text NOT NULL,
  status text NOT NULL DEFAULT 'online',
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.devices(tenant_id);

CREATE TABLE public.access_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  unit_id text NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  cold_area_id text NOT NULL REFERENCES public.cold_areas(id) ON DELETE CASCADE,
  device_id text,
  employee_id text NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  source text NOT NULL DEFAULT 'demo_simulation',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  validation_status text NOT NULL DEFAULT 'valid',
  confidence_score numeric NOT NULL DEFAULT 0.95,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.access_events(tenant_id, occurred_at DESC);
CREATE INDEX ON public.access_events(employee_id, occurred_at DESC);

CREATE TABLE public.alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id text NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  alert_type text NOT NULL,
  severity text NOT NULL,
  message text NOT NULL,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.alerts(tenant_id, triggered_at DESC);

CREATE TABLE public.thermal_breaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id text NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  completed boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'automatic',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.thermal_breaks(tenant_id, started_at DESC);

CREATE TABLE public.occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  employee_id text NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  category text NOT NULL,
  priority text NOT NULL DEFAULT 'medium',
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open',
  created_by text NOT NULL DEFAULT 'gestor.demo',
  related_event_id uuid,
  resolved_at timestamptz,
  resolved_by text,
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.occurrences(tenant_id, created_at DESC);

CREATE TABLE public.occurrence_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id uuid NOT NULL REFERENCES public.occurrences(id) ON DELETE CASCADE,
  author text NOT NULL DEFAULT 'gestor.demo',
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.occurrence_notes(occurrence_id);

CREATE TABLE public.occurrence_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id uuid NOT NULL REFERENCES public.occurrences(id) ON DELETE CASCADE,
  name text NOT NULL,
  size bigint NOT NULL DEFAULT 0,
  mime text NOT NULL DEFAULT '',
  storage_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.occurrence_attachments(occurrence_id);

-- ==========================================
-- GRANTS — open mode (no auth yet)
-- ==========================================
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'tenants','units','departments','cold_areas','employees','devices',
    'access_events','alerts','thermal_breaks','occurrences','occurrence_notes','occurrence_attachments'
  ])
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "demo open read" ON public.%I FOR SELECT USING (true)', t);
    EXECUTE format('CREATE POLICY "demo open insert" ON public.%I FOR INSERT WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY "demo open update" ON public.%I FOR UPDATE USING (true) WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY "demo open delete" ON public.%I FOR DELETE USING (true)', t);
  END LOOP;
END $$;

-- ==========================================
-- Realtime
-- ==========================================
ALTER PUBLICATION supabase_realtime ADD TABLE
  public.employees,
  public.access_events,
  public.alerts,
  public.thermal_breaks,
  public.occurrences,
  public.occurrence_notes,
  public.occurrence_attachments;

ALTER TABLE public.employees REPLICA IDENTITY FULL;
ALTER TABLE public.access_events REPLICA IDENTITY FULL;
ALTER TABLE public.alerts REPLICA IDENTITY FULL;
ALTER TABLE public.thermal_breaks REPLICA IDENTITY FULL;
ALTER TABLE public.occurrences REPLICA IDENTITY FULL;
ALTER TABLE public.occurrence_notes REPLICA IDENTITY FULL;
ALTER TABLE public.occurrence_attachments REPLICA IDENTITY FULL;

-- ==========================================
-- Storage bucket for occurrence attachments
-- ==========================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('occurrence-attachments', 'occurrence-attachments', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "demo read attachments"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'occurrence-attachments');
CREATE POLICY "demo upload attachments"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'occurrence-attachments');
CREATE POLICY "demo delete attachments"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'occurrence-attachments');

-- ==========================================
-- Seed data
-- ==========================================
INSERT INTO public.tenants (id, name, legal_name, document_number, status, plan) VALUES
  ('t1', 'Supermercado Modelo Brasil', 'Modelo Brasil Comércio Ltda', '12.345.678/0001-90', 'active', 'Enterprise'),
  ('t2', 'Frigorífico Nordeste Demo', 'Nordeste Demo Frigoríficos S.A.', '98.765.432/0001-10', 'active', 'Plus');

INSERT INTO public.units (id, tenant_id, name, city, state, manager_name) VALUES
  ('u1', 't1', 'Loja Recife Boa Viagem', 'Recife', 'PE', 'Ricardo Mendes'),
  ('u2', 't1', 'Loja Olinda Centro', 'Olinda', 'PE', 'Sandra Lopes'),
  ('u3', 't2', 'Planta Jaboatão', 'Jaboatão dos Guararapes', 'PE', 'Eduardo Tavares');

INSERT INTO public.departments (id, tenant_id, unit_id, name) VALUES
  ('d1', 't1', 'u1', 'Açougue'),
  ('d2', 't1', 'u1', 'Câmara Fria'),
  ('d3', 't1', 'u2', 'Depósito Refrigerado'),
  ('d4', 't2', 'u3', 'Desossa'),
  ('d5', 't2', 'u3', 'Expedição Fria');

INSERT INTO public.cold_areas (id, tenant_id, unit_id, department_id, name, type, average_temperature) VALUES
  ('ca1', 't1', 'u1', 'd1', 'Câmara do Açougue', 'Câmara Fria', 2),
  ('ca2', 't1', 'u1', 'd2', 'Câmara Fria Principal', 'Câmara Fria', -2),
  ('ca3', 't1', 'u2', 'd3', 'Depósito Refrigerado', 'Depósito Refrigerado', 5),
  ('ca4', 't2', 'u3', 'd4', 'Sala de Desossa', 'Desossa', 8),
  ('ca5', 't2', 'u3', 'd5', 'Câmara Congelada', 'Frigorífico', -18);

INSERT INTO public.devices (id, tenant_id, unit_id, cold_area_id, name, device_type, external_device_id, status) VALUES
  ('dv1','t1','u1','ca1','Leitor Facial — Açougue ENTRADA','entry','FR-AC-IN-01','online'),
  ('dv2','t1','u1','ca1','Leitor Facial — Açougue SAÍDA','exit','FR-AC-OUT-01','online'),
  ('dv3','t1','u1','ca2','Leitor Facial — Câmara Fria ENTRADA','entry','FR-CF-IN-01','online'),
  ('dv4','t1','u1','ca2','Leitor Facial — Câmara Fria SAÍDA','exit','FR-CF-OUT-01','offline'),
  ('dv5','t1','u2','ca3','Leitor — Depósito ENTRADA','entry','FR-DP-IN-02','online'),
  ('dv6','t1','u2','ca3','Leitor — Depósito SAÍDA','exit','FR-DP-OUT-02','online'),
  ('dv7','t2','u3','ca5','Leitor — Câmara Congelada ENTRADA','entry','FR-CG-IN-03','online'),
  ('dv8','t2','u3','ca5','Leitor — Câmara Congelada SAÍDA','exit','FR-CG-OUT-03','online');

INSERT INTO public.employees (id, tenant_id, unit_id, department_id, name, registration_number, position, avatar) VALUES
  ('e1', 't1','u1','d1','João Silva','100000','Açougueiro','https://api.dicebear.com/7.x/initials/svg?seed=Jo%C3%A3o%20Silva&backgroundType=gradientLinear&backgroundColor=0ea5e9,06b6d4,22d3ee'),
  ('e2', 't1','u1','d2','Maria Souza','100001','Aux. Câmara Fria','https://api.dicebear.com/7.x/initials/svg?seed=Maria%20Souza&backgroundType=gradientLinear&backgroundColor=0ea5e9,06b6d4,22d3ee'),
  ('e3', 't1','u1','d2','Carlos Almeida','100002','Encarregada','https://api.dicebear.com/7.x/initials/svg?seed=Carlos%20Almeida&backgroundType=gradientLinear&backgroundColor=0ea5e9,06b6d4,22d3ee'),
  ('e4', 't1','u1','d1','Ana Beatriz','100003','Operadora','https://api.dicebear.com/7.x/initials/svg?seed=Ana%20Beatriz&backgroundType=gradientLinear&backgroundColor=0ea5e9,06b6d4,22d3ee'),
  ('e5', 't1','u1','d2','Pedro Lima','100004','Aux. Expedição','https://api.dicebear.com/7.x/initials/svg?seed=Pedro%20Lima&backgroundType=gradientLinear&backgroundColor=0ea5e9,06b6d4,22d3ee'),
  ('e6', 't1','u2','d3','Fernanda Costa','100005','Desossador','https://api.dicebear.com/7.x/initials/svg?seed=Fernanda%20Costa&backgroundType=gradientLinear&backgroundColor=0ea5e9,06b6d4,22d3ee'),
  ('e7', 't1','u2','d3','Rafael Santos','100006','Aux. Frigorífico','https://api.dicebear.com/7.x/initials/svg?seed=Rafael%20Santos&backgroundType=gradientLinear&backgroundColor=0ea5e9,06b6d4,22d3ee'),
  ('e8', 't1','u2','d3','Juliana Rocha','100007','Açougueiro','https://api.dicebear.com/7.x/initials/svg?seed=Juliana%20Rocha&backgroundType=gradientLinear&backgroundColor=0ea5e9,06b6d4,22d3ee'),
  ('e9', 't1','u1','d1','Marcos Oliveira','100008','Aux. Câmara Fria','https://api.dicebear.com/7.x/initials/svg?seed=Marcos%20Oliveira&backgroundType=gradientLinear&backgroundColor=0ea5e9,06b6d4,22d3ee'),
  ('e10','t1','u1','d2','Bruna Martins','100009','Encarregada','https://api.dicebear.com/7.x/initials/svg?seed=Bruna%20Martins&backgroundType=gradientLinear&backgroundColor=0ea5e9,06b6d4,22d3ee'),
  ('e11','t2','u3','d4','Tiago Ferreira','100010','Operadora','https://api.dicebear.com/7.x/initials/svg?seed=Tiago%20Ferreira&backgroundType=gradientLinear&backgroundColor=0ea5e9,06b6d4,22d3ee'),
  ('e12','t2','u3','d5','Patrícia Gomes','100011','Aux. Expedição','https://api.dicebear.com/7.x/initials/svg?seed=Patr%C3%ADcia%20Gomes&backgroundType=gradientLinear&backgroundColor=0ea5e9,06b6d4,22d3ee'),
  ('e13','t2','u3','d4','Lucas Pereira','100012','Desossador','https://api.dicebear.com/7.x/initials/svg?seed=Lucas%20Pereira&backgroundType=gradientLinear&backgroundColor=0ea5e9,06b6d4,22d3ee'),
  ('e14','t2','u3','d5','Camila Duarte','100013','Aux. Frigorífico','https://api.dicebear.com/7.x/initials/svg?seed=Camila%20Duarte&backgroundType=gradientLinear&backgroundColor=0ea5e9,06b6d4,22d3ee'),
  ('e15','t2','u3','d4','Roberto Nunes','100014','Açougueiro','https://api.dicebear.com/7.x/initials/svg?seed=Roberto%20Nunes&backgroundType=gradientLinear&backgroundColor=0ea5e9,06b6d4,22d3ee'),
  ('e16','t2','u3','d5','Vanessa Lima','100015','Aux. Câmara Fria','https://api.dicebear.com/7.x/initials/svg?seed=Vanessa%20Lima&backgroundType=gradientLinear&backgroundColor=0ea5e9,06b6d4,22d3ee'),
  ('e17','t2','u3','d4','Diego Barbosa','100016','Encarregada','https://api.dicebear.com/7.x/initials/svg?seed=Diego%20Barbosa&backgroundType=gradientLinear&backgroundColor=0ea5e9,06b6d4,22d3ee'),
  ('e18','t2','u3','d5','Larissa Cunha','100017','Operadora','https://api.dicebear.com/7.x/initials/svg?seed=Larissa%20Cunha&backgroundType=gradientLinear&backgroundColor=0ea5e9,06b6d4,22d3ee'),
  ('e19','t2','u3','d4','Henrique Melo','100018','Aux. Expedição','https://api.dicebear.com/7.x/initials/svg?seed=Henrique%20Melo&backgroundType=gradientLinear&backgroundColor=0ea5e9,06b6d4,22d3ee'),
  ('e20','t2','u3','d5','Sabrina Ribeiro','100019','Desossador','https://api.dicebear.com/7.x/initials/svg?seed=Sabrina%20Ribeiro&backgroundType=gradientLinear&backgroundColor=0ea5e9,06b6d4,22d3ee');

INSERT INTO public.occurrences (tenant_id, employee_id, category, priority, title, description, status, created_by, created_at) VALUES
  ('t1','e4','missing_exit','high','Saída não registrada — Câmara do Açougue','Colaboradora Ana Beatriz entrou às 08:14 mas o leitor de saída não capturou o registro. Confirmado por encarregado que ela saiu às 08:42.','open','supervisor.rh', now() - interval '3 hours'),
  ('t1','e7','device_failure','medium','Leitor FR-CF-OUT-01 offline','Dispositivo de saída ficou offline durante o turno da manhã, gerando registros pendentes.','in_review','ti.suporte', now() - interval '26 hours'),
  ('t1','e2','manual_correction','low','Ajuste manual de exposição','Maria Souza teve 12 minutos descontados após validação de pausa para reposição.','resolved','sst.gestor', now() - interval '48 hours');

UPDATE public.occurrences
SET resolved_at = now() - interval '47 hours',
    resolved_by = 'sst.gestor',
    resolution = 'Correção aplicada após assinatura física da justificativa pelo encarregado.'
WHERE status = 'resolved';
