// demo-seed-history: gera um histórico denso de 3 meses (mai/jun/jul 2026)
// no tenant público "demo-tenant" para treinamentos e demos. Opera APENAS
// nesse tenant — qualquer outro tenant_id é rejeitado. Usa service role para
// poder escrever em tabelas com triggers immutables. Chamado em fases pelo
// cliente para caber no timeout de cada execução.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const TENANT_ID = "demo-tenant";
const YEAR = 2026;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

type Phase =
  | "reset"
  | "events"
  | "corrections"
  | "statements"
  | "inconsistencies"
  | "closures"
  | "integration";

// ---------- helpers ----------
const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfDayUTC = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
const isWeekend = (d: Date) => d.getUTCDay() === 0; // domingo descanso
const mulberry = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
async function sha256(s: string) {
  const b = new TextEncoder().encode(s);
  const h = await crypto.subtle.digest("SHA-256", b);
  return Array.from(new Uint8Array(h)).map(x => x.toString(16).padStart(2, "0")).join("");
}

// ---------- main ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const phase = body?.phase as Phase;
  if (!phase) return json({ error: "missing_phase" }, 400);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    switch (phase) {
      case "reset": return json(await phaseReset(sb));
      case "events": return json(await phaseEvents(sb, body.from, body.to, body.density ?? "heavy"));
      case "corrections": return json(await phaseCorrections(sb));
      case "statements": return json(await phaseStatements(sb));
      case "inconsistencies": return json(await phaseInconsistencies(sb));
      case "closures": return json(await phaseClosures(sb));
      case "integration": return json(await phaseIntegration(sb));
      default: return json({ error: "unknown_phase" }, 400);
    }
  } catch (e) {
    console.error("seed_history_error", phase, (e as Error).message);
    return json({ error: "server_error", phase, message: (e as Error).message }, 500);
  }
});

// ---------- phases ----------

async function phaseReset(sb: any) {
  // limpa tudo que esta função produz, mantendo estrutura (units/employees/etc.)
  await sb.from("access_event_corrections").delete().eq("tenant_id", TENANT_ID);
  await sb.from("access_events").delete().eq("tenant_id", TENANT_ID);
  await sb.from("alerts").delete().eq("tenant_id", TENANT_ID);
  await sb.from("thermal_breaks").delete().eq("tenant_id", TENANT_ID);
  await sb.from("daily_statement_confirmations").delete().eq("tenant_id", TENANT_ID);
  await sb.from("inconsistency_reviews").delete().eq("tenant_id", TENANT_ID);
  await sb.from("closure_signatures").delete().eq("tenant_id", TENANT_ID);
  await sb.from("period_closures").delete().eq("tenant_id", TENANT_ID);
  await sb.from("integration_audit_log").delete().eq("tenant_id", TENANT_ID);
  await sb.from("guardia_events").delete().eq("tenant_id", TENANT_ID);
  return { ok: true, message: "Histórico do demo limpo." };
}

async function loadStructure(sb: any) {
  const [{ data: emps }, { data: areas }, { data: devs }] = await Promise.all([
    sb.from("employees").select("id, name, unit_id, department_id, current_area_id").eq("tenant_id", TENANT_ID),
    sb.from("cold_areas").select("id, unit_id, department_id, exposure_limit_minutes, warning_yellow_minutes, warning_orange_minutes, break_minutes").eq("tenant_id", TENANT_ID),
    sb.from("devices").select("id, cold_area_id, device_type").eq("tenant_id", TENANT_ID),
  ]);
  if (!emps?.length || !areas?.length) {
    throw new Error("Estrutura do demo vazia. Use 'Regenerar agora' antes de gerar o histórico.");
  }
  return { emps, areas, devs: devs || [] };
}

async function phaseEvents(sb: any, fromStr: string, toStr: string, density: string) {
  if (!fromStr || !toStr) throw new Error("missing from/to");
  const { emps, areas, devs } = await loadStructure(sb);
  const from = new Date(fromStr + "T00:00:00Z");
  const to = new Date(toStr + "T00:00:00Z");
  const perDay = density === "heavy" ? 300 : density === "light" ? 30 : 120;

  const totals = { events: 0, alerts: 0, breaks: 0, days: 0 };
  for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
    if (isWeekend(d)) continue;
    totals.days++;
    const seed = d.getUTCFullYear() * 1000 + (d.getUTCMonth() + 1) * 50 + d.getUTCDate();
    const rng = mulberry(seed);

    // Plano de turnos: cada colaborador faz 4 a 7 ciclos entrada/saída no dia.
    // perDay define o teto total para o dia. Distribuímos ciclos pelos empregados.
    const targetEvents = perDay; // pares + algumas saídas esquecidas
    let dayEvents = 0;
    const events: any[] = [];
    const breaks: any[] = [];
    const alerts: any[] = [];

    // ordenar inserções por timestamp para coerência da cadeia forense por employee
    type Pending = { emp: any; area: any; entry: Date; exit: Date | null; cumulative: number; missed: boolean };
    const pendings: Pending[] = [];

    for (const emp of emps) {
      const empAreas = areas.filter((a: any) => a.unit_id === emp.unit_id && (a.department_id === emp.department_id || rng() < 0.15));
      if (!empAreas.length) continue;
      // 1 ou 2 colaboradores por dia podem cruzar 100 min (caso crítico)
      const willOverexpose = rng() < 0.08;
      // 5% chance de esquecer uma saída
      const willMissExit = rng() < 0.06;

      const shiftStart = new Date(d); shiftStart.setUTCHours(6 + Math.floor(rng() * 2), Math.floor(rng() * 30), 0, 0);
      let cumulative = 0;
      let cursor = new Date(shiftStart);
      const cycles = 4 + Math.floor(rng() * 4);
      for (let c = 0; c < cycles; c++) {
        if (dayEvents >= targetEvents) break;
        const area = empAreas[Math.floor(rng() * empAreas.length)];
        const limit = area.exposure_limit_minutes ?? 100;
        const breakMin = area.break_minutes ?? 20;
        const yellow = area.warning_yellow_minutes ?? 80;
        const orange = area.warning_orange_minutes ?? 90;

        // duração: maioria 30-60 min, mas se willOverexpose, um dos ciclos vai a 100+
        const isOverCycle = willOverexpose && c === Math.floor(cycles / 2);
        const dur = isOverCycle ? 100 + Math.floor(rng() * 25) : 25 + Math.floor(rng() * 40);
        const entry = new Date(cursor);
        const exit = new Date(entry.getTime() + dur * 60_000);
        cumulative += dur;

        const missed = willMissExit && c === cycles - 1;
        pendings.push({ emp, area, entry, exit: missed ? null : exit, cumulative, missed });

        if (cumulative >= yellow && cumulative < orange) {
          alerts.push({ tenant_id: TENANT_ID, employee_id: emp.id, alert_type: "exposicao", severity: "yellow",
            message: `Limite amarelo atingido (${cumulative} min acumulados)`, triggered_at: exit.toISOString(), status: "resolved" });
        }
        if (cumulative >= orange && cumulative < limit) {
          alerts.push({ tenant_id: TENANT_ID, employee_id: emp.id, alert_type: "exposicao", severity: "orange",
            message: `Limite laranja atingido (${cumulative} min acumulados)`, triggered_at: exit.toISOString(), status: "resolved" });
        }
        if (cumulative >= limit) {
          alerts.push({ tenant_id: TENANT_ID, employee_id: emp.id, alert_type: "bloqueio", severity: "red",
            message: `Bloqueio preventivo (${cumulative} min — acima de ${limit})`, triggered_at: exit.toISOString(), status: "resolved" });
          // pausa térmica
          const bStart = new Date(exit);
          const interrupted = rng() < 0.18; // 18% das pausas são interrompidas (não cumprida)
          const bEnd = new Date(bStart.getTime() + (interrupted ? (5 + rng() * 10) : breakMin + rng() * 5) * 60_000);
          breaks.push({
            tenant_id: TENANT_ID, employee_id: emp.id, started_at: bStart.toISOString(),
            ended_at: bEnd.toISOString(), completed: !interrupted, source: "simulation",
            interrupted, interrupted_at: interrupted ? bEnd.toISOString() : null,
            interruption_reason: interrupted ? "retorno antes de 20 min — necessário acompanhamento NR-36" : null,
          });
          cumulative = 0; // zera após pausa
          cursor = new Date(bEnd.getTime() + 5 * 60_000);
        } else {
          cursor = new Date(exit.getTime() + (10 + rng() * 30) * 60_000);
        }
        dayEvents += missed ? 1 : 2;
      }
    }

    // Achatar em eventos individuais ordenados por (employee_id, timestamp)
    const flat: any[] = [];
    for (const p of pendings) {
      const entryDev = devs.find((dv: any) => dv.cold_area_id === p.area.id && dv.device_type === "entry");
      const exitDev = devs.find((dv: any) => dv.cold_area_id === p.area.id && dv.device_type === "exit");
      flat.push({
        tenant_id: TENANT_ID, unit_id: p.area.unit_id, cold_area_id: p.area.id,
        device_id: entryDev?.id ?? null, employee_id: p.emp.id, event_type: "entry",
        source: "demo_simulation", occurred_at: p.entry.toISOString(),
        validation_status: "valid", confidence_score: 0.97,
        status_before: "outside", status_after: "inside",
        accumulated_at_event: p.cumulative,
      });
      if (!p.missed && p.exit) {
        flat.push({
          tenant_id: TENANT_ID, unit_id: p.area.unit_id, cold_area_id: p.area.id,
          device_id: exitDev?.id ?? null, employee_id: p.emp.id, event_type: "exit",
          source: "demo_simulation", occurred_at: p.exit.toISOString(),
          validation_status: "valid", confidence_score: 0.97,
          status_before: "inside", status_after: "outside",
          accumulated_at_event: p.cumulative,
        });
      }
    }
    // ordenar por employee_id então occurred_at — preserva integridade da cadeia forense por colaborador
    flat.sort((a, b) => a.employee_id === b.employee_id
      ? a.occurred_at.localeCompare(b.occurred_at)
      : a.employee_id.localeCompare(b.employee_id));

    // inserir em lotes de 200
    for (let i = 0; i < flat.length; i += 200) {
      const { error } = await sb.from("access_events").insert(flat.slice(i, i + 200));
      if (error) throw new Error("access_events: " + error.message);
    }
    if (alerts.length) await sb.from("alerts").insert(alerts);
    if (breaks.length) await sb.from("thermal_breaks").insert(breaks);
    totals.events += flat.length;
    totals.alerts += alerts.length;
    totals.breaks += breaks.length;
  }
  return { ok: true, ...totals, from: fromStr, to: toStr };
}

async function phaseCorrections(sb: any) {
  // procura eventos "entry" sem exit pareado e cria 25 correções (mix de status)
  const { data: events } = await sb.from("access_events")
    .select("id, employee_id, occurred_at, event_type, cold_area_id")
    .eq("tenant_id", TENANT_ID)
    .order("occurred_at", { ascending: false })
    .limit(2000);
  if (!events?.length) return { ok: true, created: 0, note: "sem eventos para corrigir" };

  // identificar entradas sem saída logo após (mesmo employee, mesmo dia)
  const byEmp: Record<string, any[]> = {};
  for (const e of events) (byEmp[e.employee_id] ||= []).push(e);
  const missing: any[] = [];
  for (const list of Object.values(byEmp)) {
    list.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    for (let i = 0; i < list.length; i++) {
      if (list[i].event_type !== "entry") continue;
      const next = list[i + 1];
      if (!next || next.event_type !== "exit") missing.push(list[i]);
    }
  }
  const picks = missing.slice(0, 25);
  const rng = mulberry(7777);
  const reasons = [
    ["esquecimento", "Colaborador esqueceu de bater saída — confirmado por supervisor."],
    ["falha_dispositivo", "Leitor offline no momento da saída — verificado no log da câmara."],
    ["evento_duplicado", "Catraca registrou duas vezes a mesma passagem."],
  ];
  const rows = picks.map((ev, i) => {
    const status = i < 8 ? "pending" : i < 18 ? "approved" : "rejected";
    const [cat, det] = reasons[i % reasons.length];
    const newExit = new Date(new Date(ev.occurred_at).getTime() + (30 + Math.floor(rng() * 40)) * 60_000).toISOString();
    return {
      tenant_id: TENANT_ID, event_id: ev.id, employee_id: ev.employee_id,
      original_event_type: "entry", original_occurred_at: ev.occurred_at,
      new_event_type: "exit", new_occurred_at: newExit,
      reason_category: cat, reason_detail: det, status,
      requested_by_name: "RH Demonstração",
      approved_by_name: status === "pending" ? null : "Supervisor Demo",
      approved_at: status === "pending" ? null : new Date().toISOString(),
      rejection_reason: status === "rejected" ? "Sem evidência suficiente — solicitar testemunha." : null,
    };
  });
  if (rows.length) {
    const { error } = await sb.from("access_event_corrections").insert(rows);
    if (error) throw new Error("corrections: " + error.message);
  }
  return { ok: true, created: rows.length };
}

async function phaseStatements(sb: any) {
  // Gera confirmações diárias para mai+jun (mês fechado), maioria confirmada, 5 contestações
  const { data: emps } = await sb.from("employees").select("id").eq("tenant_id", TENANT_ID).limit(8);
  if (!emps?.length) return { ok: true, created: 0 };

  const days: string[] = [];
  for (let m = 4; m <= 5; m++) { // mai (4) + jun (5)
    const last = new Date(Date.UTC(YEAR, m + 1, 0)).getUTCDate();
    for (let dd = 1; dd <= last; dd++) {
      const d = new Date(Date.UTC(YEAR, m, dd));
      if (d.getUTCDay() === 0) continue;
      days.push(isoDate(d));
    }
  }
  const clickwrap = "Confirmo, sob responsabilidade pessoal, que li o extrato e os tempos registrados refletem a minha jornada.";
  const clickHash = await sha256(clickwrap);

  const rows: any[] = [];
  let contests = 0;
  for (const emp of emps) {
    for (const day of days) {
      // 4% contestam, restante confirma
      const isContest = Math.random() < 0.04 && contests < 5;
      const snapshot = { reference_date: day, minutes_total: 60 + Math.floor(Math.random() * 200) };
      const contentHash = await sha256(`${emp.id}|${day}|${snapshot.minutes_total}`);
      rows.push({
        tenant_id: TENANT_ID, employee_id: emp.id, reference_date: day,
        content_hash: contentHash, content_snapshot: snapshot,
        clickwrap_text: isContest ? "CONTESTADO: tempos não refletem a jornada." : clickwrap,
        clickwrap_text_hash: clickHash,
        signature_method: "pin",
        confirmed_at: new Date(day + "T18:30:00Z").toISOString(),
      });
      if (isContest) contests++;
    }
  }
  // inserir em lotes
  for (let i = 0; i < rows.length; i += 300) {
    const { error } = await sb.from("daily_statement_confirmations").insert(rows.slice(i, i + 300));
    if (error) throw new Error("statements: " + error.message);
  }
  return { ok: true, created: rows.length, contests };
}

async function phaseInconsistencies(sb: any) {
  // grava revisões para uma amostra de chaves de inconsistência detectáveis (alguns dismissados)
  const { data: events } = await sb.from("access_events")
    .select("id, employee_id, occurred_at")
    .eq("tenant_id", TENANT_ID)
    .eq("event_type", "entry")
    .order("occurred_at", { ascending: false })
    .limit(40);
  const rows = (events || []).slice(0, 15).map((e: any, i: number) => ({
    tenant_id: TENANT_ID,
    signature_key: `long_stay:${e.id}`,
    reviewed_by_name: i % 2 === 0 ? "Gestor SST Demo" : "RH Demo",
    note: i % 3 === 0 ? "Justificado — manutenção urgente." : "Verificado com supervisor da unidade.",
    reviewed_at: new Date().toISOString(),
  }));
  if (rows.length) await sb.from("inconsistency_reviews").insert(rows);
  return { ok: true, created: rows.length };
}

async function phaseClosures(sb: any) {
  // cria 3 fechamentos mensais: maio (totalmente assinado), junho (totalmente assinado), julho (pendente)
  const months: Array<{ start: string; end: string; full: boolean; label: string }> = [
    { start: `${YEAR}-05-01`, end: `${YEAR}-05-31`, full: true, label: "Maio" },
    { start: `${YEAR}-06-01`, end: `${YEAR}-06-30`, full: true, label: "Junho" },
    { start: `${YEAR}-07-01`, end: `${YEAR}-07-31`, full: false, label: "Julho" },
  ];
  const clickwraps = {
    supervisor: "Como supervisor, confirmo a revisão das inconsistências e a consistência dos registros do período.",
    rh: "Como RH, confirmo a aderência da consolidação às políticas de jornada e à LGPD.",
    juridico: "Como Jurídico, confirmo o fechamento imutável do período para fins probatórios.",
  };
  const stageHashes = {
    supervisor: await sha256(clickwraps.supervisor),
    rh: await sha256(clickwraps.rh),
    juridico: await sha256(clickwraps.juridico),
  };
  const created: any[] = [];
  for (const m of months) {
    // consolidação simples baseada em contagens reais do período
    const { count: evCount } = await sb.from("access_events").select("*", { count: "exact", head: true })
      .eq("tenant_id", TENANT_ID).gte("occurred_at", m.start).lte("occurred_at", m.end + "T23:59:59Z");
    const { count: alertCount } = await sb.from("alerts").select("*", { count: "exact", head: true })
      .eq("tenant_id", TENANT_ID).gte("triggered_at", m.start).lte("triggered_at", m.end + "T23:59:59Z");
    const consolidated = {
      period: { start: m.start, end: m.end, label: m.label },
      counters: { access_events: evCount ?? 0, alerts: alertCount ?? 0 },
      generated_at: new Date().toISOString(),
    };
    const consolidated_hash = await sha256(JSON.stringify(consolidated));
    const status = m.full ? "closed" : "draft";

    const { data: ins, error } = await sb.from("period_closures").insert({
      tenant_id: TENANT_ID, period_type: "month",
      reference_start: m.start, reference_end: m.end,
      status, consolidated, consolidated_hash,
    }).select().single();
    if (error) throw new Error("closures: " + error.message);
    created.push(ins);

    if (m.full) {
      // 3 assinaturas em cadeia
      const sigs = [
        { stage: "supervisor", role: "gestor", name: "Marcos Oliveira (Supervisor)", click: clickwraps.supervisor, hash: stageHashes.supervisor },
        { stage: "rh", role: "rh_sst", name: "Camila Duarte (RH/SST)", click: clickwraps.rh, hash: stageHashes.rh },
        { stage: "juridico", role: "administrador", name: "Dra. Patrícia Mendes (Jurídico)", click: clickwraps.juridico, hash: stageHashes.juridico },
      ];
      const baseTs = new Date(m.end + "T20:00:00Z").getTime();
      for (let i = 0; i < sigs.length; i++) {
        const s = sigs[i];
        const { error: e2 } = await sb.from("closure_signatures").insert({
          tenant_id: TENANT_ID, closure_id: ins.id, stage: s.stage,
          signed_by_name: s.name, signed_by_role: s.role,
          clickwrap_text: s.click, clickwrap_text_hash: s.hash,
          content_hash: consolidated_hash, signature_method: "clickwrap",
          signed_at: new Date(baseTs + i * 3600_000).toISOString(),
        });
        if (e2) throw new Error("closure_signatures: " + e2.message);
      }
    } else {
      // julho: apenas supervisor já assinou
      await sb.from("closure_signatures").insert({
        tenant_id: TENANT_ID, closure_id: ins.id, stage: "supervisor",
        signed_by_name: "Marcos Oliveira (Supervisor)", signed_by_role: "gestor",
        clickwrap_text: clickwraps.supervisor, clickwrap_text_hash: stageHashes.supervisor,
        content_hash: consolidated_hash, signature_method: "clickwrap",
        signed_at: new Date().toISOString(),
      });
    }
  }
  return { ok: true, closures: created.length };
}

async function phaseIntegration(sb: any) {
  // ~120 entradas no audit log da GuardIA: maioria success, picos de erro
  const rows: any[] = [];
  const days = 92;
  const base = new Date(Date.UTC(YEAR, 4, 1));
  for (let i = 0; i < days; i++) {
    const day = addDays(base, i);
    // 1-2 sucessos por dia
    for (let s = 0; s < 2; s++) {
      const ts = new Date(day); ts.setUTCHours(6 + s * 6, Math.floor(Math.random() * 50), 0);
      rows.push({
        tenant_id: TENANT_ID, integration: "guardia", source: "poll", severity: "info",
        code: "poll.ok", message: "Polling concluído com sucesso",
        details: { batch: 1 + Math.floor(Math.random() * 50) },
        cursor_used: ts.toISOString(),
        fetched_count: 20 + Math.floor(Math.random() * 100),
        processed_count: 20 + Math.floor(Math.random() * 90),
        duration_ms: 400 + Math.floor(Math.random() * 1800),
        created_at: ts.toISOString(),
      });
    }
    // ~5% dos dias: cluster de erros
    if (Math.random() < 0.05) {
      const ts = new Date(day); ts.setUTCHours(14, 22, 0);
      const codes = [["auth.401", "Token rejeitado pela GuardIA"],
                     ["network.timeout", "Timeout ao consultar /events"],
                     ["normalize.error", "Campo dispositivo_id ausente em 3 registros"]];
      for (const [c, m] of codes) {
        rows.push({
          tenant_id: TENANT_ID, integration: "guardia", source: "poll", severity: "error",
          code: c, message: m, details: { sample: { evento_id: "evt_" + Math.random().toString(36).slice(2, 9) } },
          cursor_used: ts.toISOString(), fetched_count: 0, processed_count: 0, duration_ms: 30000,
          created_at: ts.toISOString(),
        });
      }
    }
  }
  // erro persistente recente (últimas 3h) para acender o alerta visual
  const now = new Date();
  for (let k = 0; k < 6; k++) {
    rows.push({
      tenant_id: TENANT_ID, integration: "guardia", source: "poll", severity: "error",
      code: "network.timeout", message: "Timeout ao consultar /events (retry esgotado)",
      details: { attempts: 4 }, cursor_used: now.toISOString(),
      fetched_count: 0, processed_count: 0, duration_ms: 30000,
      created_at: new Date(now.getTime() - k * 15 * 60_000).toISOString(),
    });
  }
  for (let i = 0; i < rows.length; i += 300) {
    const { error } = await sb.from("integration_audit_log").insert(rows.slice(i, i + 300));
    if (error) throw new Error("audit_log: " + error.message);
  }

  // alguns guardia_events recentes (já processados)
  const { data: emps } = await sb.from("employees").select("id, name").eq("tenant_id", TENANT_ID).limit(5);
  const gEvents = (emps || []).flatMap((e: any, i: number) => [
    {
      tenant_id: TENANT_ID, evento_id: `evt_${Date.now()}_${i}`,
      colaborador_id: e.id, colaborador_nome: e.name,
      local_id: "demo-ca1", local_nome: "Câmara do Açougue",
      tipo: "entrada", event_timestamp: new Date(Date.now() - 3600_000).toISOString(),
      dispositivo_id: "DEMO-IN-01", processed: true, process_note: "ok",
    },
  ]);
  if (gEvents.length) await sb.from("guardia_events").insert(gEvents);

  return { ok: true, audit_rows: rows.length, guardia_events: gEvents.length };
}
