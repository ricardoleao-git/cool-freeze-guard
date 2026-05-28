
-- Tenant de demonstração
INSERT INTO public.tenants (id, name, legal_name, document_number, status, plan)
VALUES ('demo-tenant', 'FrioSafe Demo', 'FrioSafe Demonstração LTDA', '00.000.000/0001-00', 'active', 'Demo')
ON CONFLICT (id) DO NOTHING;

-- Configurações do tenant (dispensa consentimento para o demo)
INSERT INTO public.tenant_settings (tenant_id, require_consent_before_capture, lawful_basis, consent_text, dpo_name, dpo_email, privacy_policy_url)
VALUES ('demo-tenant', false, 'legitimo_interesse', 'Ambiente de demonstração — dados fictícios.', 'Demo DPO', 'dpo@demo.local', 'https://demo.local/privacy')
ON CONFLICT (tenant_id) DO UPDATE SET require_consent_before_capture = EXCLUDED.require_consent_before_capture;

-- Unidade
INSERT INTO public.units (id, tenant_id, name, city, state, manager_name, status)
VALUES ('demo-u1', 'demo-tenant', 'Unidade Demonstração', 'São Paulo', 'SP', 'Gestor Demo', 'active')
ON CONFLICT (id) DO NOTHING;

-- Departamento
INSERT INTO public.departments (id, tenant_id, unit_id, name)
VALUES ('demo-d1', 'demo-tenant', 'demo-u1', 'Açougue / Câmara')
ON CONFLICT (id) DO NOTHING;

-- Câmara fria
INSERT INTO public.cold_areas (id, tenant_id, unit_id, department_id, name, type, average_temperature, exposure_limit_minutes, warning_yellow_minutes, warning_orange_minutes, break_minutes, counting_mode, status)
VALUES ('demo-c1', 'demo-tenant', 'demo-u1', 'demo-d1', 'Câmara Fria 01', 'Câmara Fria', -18, 100, 80, 90, 20, 'accumulated', 'active')
ON CONFLICT (id) DO NOTHING;

-- Dispositivos (entrada + saída)
INSERT INTO public.devices (id, tenant_id, unit_id, cold_area_id, name, device_type, external_device_id, status)
VALUES
  ('demo-dev-in',  'demo-tenant', 'demo-u1', 'demo-c1', 'Leitor Facial — Entrada', 'entry', 'DEMO-IN-001',  'online'),
  ('demo-dev-out', 'demo-tenant', 'demo-u1', 'demo-c1', 'Leitor Facial — Saída',   'exit',  'DEMO-OUT-001', 'online')
ON CONFLICT (id) DO NOTHING;

-- Colaboradores fictícios
INSERT INTO public.employees (id, tenant_id, unit_id, department_id, name, registration_number, position, status, current_status, accumulated_minutes)
VALUES
  ('demo-e1','demo-tenant','demo-u1','demo-d1','Ana Pereira',   'DEMO-001','Açougueira','active','outside',0),
  ('demo-e2','demo-tenant','demo-u1','demo-d1','Bruno Santos',  'DEMO-002','Auxiliar','active','outside',0),
  ('demo-e3','demo-tenant','demo-u1','demo-d1','Carla Lima',    'DEMO-003','Açougueira','active','outside',0),
  ('demo-e4','demo-tenant','demo-u1','demo-d1','Diego Souza',   'DEMO-004','Açougueiro','active','outside',0),
  ('demo-e5','demo-tenant','demo-u1','demo-d1','Eliana Costa',  'DEMO-005','Supervisora','active','outside',0),
  ('demo-e6','demo-tenant','demo-u1','demo-d1','Fábio Almeida', 'DEMO-006','Auxiliar','active','outside',0)
ON CONFLICT (id) DO NOTHING;

-- Autorizações na câmara
INSERT INTO public.employee_cold_areas (employee_id, cold_area_id, tenant_id)
SELECT e.id, 'demo-c1', 'demo-tenant'
FROM public.employees e
WHERE e.tenant_id = 'demo-tenant'
ON CONFLICT DO NOTHING;
