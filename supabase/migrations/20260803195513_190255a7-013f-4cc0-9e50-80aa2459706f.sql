DO $$
DECLARE
  emp record;
  d date;
  base timestamptz;
  s int;
  dur int;
  cur timestamptz;
  acc numeric;
  st_before text;
  st_after text;
  n int := 0;
BEGIN
  DELETE FROM public.occurrence_notes WHERE occurrence_id IN (SELECT id FROM public.occurrences WHERE tenant_id='demo-tenant');
  DELETE FROM public.occurrences WHERE tenant_id='demo-tenant';
  DELETE FROM public.thermal_breaks WHERE tenant_id='demo-tenant';
  DELETE FROM public.access_events WHERE tenant_id='demo-tenant' AND source='demo_simulation';

  FOR emp IN SELECT id, unit_id FROM public.employees WHERE tenant_id='demo-tenant' ORDER BY id LOOP
    n := n + 1;
    FOR d IN SELECT generate_series(current_date - interval '70 days', current_date, interval '1 day')::date LOOP
      CONTINUE WHEN extract(dow from d) IN (0,6);
      base := d::timestamptz + interval '11 hours' + (n * interval '7 minutes');
      acc := 0;
      FOR s IN 1..3 LOOP
        dur := 35 + ((n * 13 + s * 29 + extract(day from d)::int * 17) % 60);
        cur := base + ((s - 1) * interval '150 minutes');
        IF cur > now() THEN CONTINUE; END IF;
        st_before := CASE WHEN acc >= 90 THEN 'orange' WHEN acc >= 80 THEN 'yellow' ELSE 'outside' END;
        acc := acc + dur;
        st_after := CASE WHEN acc >= 100 THEN 'blocked' WHEN acc >= 90 THEN 'orange' WHEN acc >= 80 THEN 'yellow' ELSE 'inside' END;

        INSERT INTO public.access_events (tenant_id, unit_id, cold_area_id, employee_id, event_type, source, occurred_at, status_before, status_after, accumulated_at_event, device_id)
        VALUES ('demo-tenant', emp.unit_id, 'demo-c1', emp.id, 'entry', 'demo_simulation', cur, st_before, 'inside', acc - dur, 'demo-dev-01');

        IF cur + (dur * interval '1 minute') <= now() THEN
          INSERT INTO public.access_events (tenant_id, unit_id, cold_area_id, employee_id, event_type, source, occurred_at, status_before, status_after, accumulated_at_event, device_id)
          VALUES ('demo-tenant', emp.unit_id, 'demo-c1', emp.id, 'exit', 'demo_simulation', cur + (dur * interval '1 minute'), 'inside', st_after, acc, 'demo-dev-01');

          INSERT INTO public.thermal_breaks (tenant_id, employee_id, started_at, ended_at, completed, source, interrupted, interrupted_at, interruption_reason)
          VALUES (
            'demo-tenant', emp.id,
            cur + (dur * interval '1 minute') + interval '2 minutes',
            cur + (dur * interval '1 minute') + interval '22 minutes',
            (n + s) % 5 <> 0, 'automatic',
            (n + s) % 5 = 0,
            CASE WHEN (n + s) % 5 = 0 THEN cur + (dur * interval '1 minute') + interval '9 minutes' ELSE NULL END,
            CASE WHEN (n + s) % 5 = 0 THEN 'Retorno antecipado à câmara fria' ELSE NULL END
          );
          IF acc >= 100 THEN acc := 0; END IF;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  -- Colaborador de demonstração (Carla Lima) atualmente dentro da câmara
  UPDATE public.employees SET current_status='yellow', inside_since = now() - interval '82 minutes', current_area_id='demo-c1', accumulated_minutes=82
  WHERE id='demo-e3';
  INSERT INTO public.access_events (tenant_id, unit_id, cold_area_id, employee_id, event_type, source, occurred_at, status_before, status_after, accumulated_at_event, device_id)
  VALUES ('demo-tenant','demo-u1','demo-c1','demo-e3','entry','demo_simulation', now() - interval '82 minutes','outside','inside',0,'demo-dev-01');

  UPDATE public.employees SET current_status='on_break', break_started_at = now() - interval '8 minutes', current_area_id='demo-c1'
  WHERE id='demo-e5';
  INSERT INTO public.thermal_breaks (tenant_id, employee_id, started_at, completed, source)
  VALUES ('demo-tenant','demo-e5', now() - interval '8 minutes', false, 'automatic');
END $$;

WITH ins AS (
  INSERT INTO public.occurrences (tenant_id, employee_id, category, priority, title, description, status, created_by, created_at, resolved_at, resolved_by, resolution)
  VALUES
  ('demo-tenant','demo-e3','manual_exit','high','Tempo de exposição excedido','Colaboradora permaneceu 108 minutos na Câmara Fria 01 sem registrar pausa térmica. Alerta vermelho disparado pelo painel.', 'open','gestor.demo', now() - interval '2 days', NULL, NULL, NULL),
  ('demo-tenant','demo-e3','interrupted_break','medium','Pausa térmica interrompida','Retorno à câmara fria após 9 minutos de pausa (mínimo 20 minutos).','open','sst.demo', now() - interval '6 days', NULL, NULL, NULL),
  ('demo-tenant','demo-e3','missed_exit','medium','Saída não registrada','Não houve leitura facial de saída no fim do turno; encerramento manual pelo supervisor.','resolved','gestor.demo', now() - interval '18 days', now() - interval '17 days','Marina R. (RH)','Saída ajustada às 17:12 com base na escala e confirmada pela colaboradora.'),
  ('demo-tenant','demo-e1','manual_exit','high','Tempo de exposição excedido','Exposição acumulada de 104 minutos registrada no dia.','resolved','sst.demo', now() - interval '25 days', now() - interval '24 days','Carlos M. (SST)','Realizado treinamento de reciclagem sobre pausas térmicas (NR-36).'),
  ('demo-tenant','demo-e2','other','low','Uniforme térmico danificado','Colaborador relatou zíper da japona térmica com defeito.','resolved','gestor.demo', now() - interval '30 days', now() - interval '29 days','Almoxarifado','Novo EPI entregue e registrado na ficha de EPI.')
  RETURNING id, employee_id, category
)
INSERT INTO public.occurrence_notes (occurrence_id, author, text, created_at)
SELECT id, 'gestor.demo', 'Ocorrência aberta automaticamente pelo detector de inconsistências.', now() - interval '2 days' FROM ins WHERE category='manual_exit'
UNION ALL
SELECT id, 'sst.demo', 'Orientação registrada: aguardar os 20 minutos completos fora da câmara antes de retornar.', now() - interval '5 days' FROM ins WHERE category='interrupted_break'
UNION ALL
SELECT id, 'Marina R. (RH)', 'Colaboradora confirmou o horário de saída no extrato individual.', now() - interval '17 days' FROM ins WHERE category='missed_exit';