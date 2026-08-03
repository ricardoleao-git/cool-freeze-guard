// employee-portal: backend do aplicativo do colaborador (login por CPF + senha).
// Autenticação própria (não usa auth.users): o colaborador é uma linha em
// public.employees. Sessão = token HMAC assinado no servidor.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { hashPin, verifyPin } from "../_shared/pin.ts";
import { signSession, verifySession, onlyDigits } from "../_shared/portal-session.ts";
import { buildStatement } from "../_shared/statement.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-portal-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 dias (celular pessoal); totem encerra no cliente
const svc = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const EMP_COLS = "id, tenant_id, unit_id, name, registration_number, position, avatar, status, current_status, accumulated_minutes, inside_since, current_area_id, break_started_at, cpf, portal_password_hash, portal_must_change_password, portal_failed_attempts, portal_locked_until";

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Nome abreviado: "João V." — mesma regra de privacidade do painel. */
const shortName = (full: string) => {
  const parts = String(full ?? "").trim().split(/\s+/);
  return parts.length < 2 ? parts[0] ?? "" : `${parts[0]} ${parts[parts.length - 1][0]}.`;
};

async function linksFor(db: any, rows: any[]) {
  const tenantIds = [...new Set(rows.map((r) => r.tenant_id))];
  const unitIds = [...new Set(rows.map((r) => r.unit_id).filter(Boolean))];
  const [{ data: tenants }, { data: units }] = await Promise.all([
    db.from("tenants").select("id, name").in("id", tenantIds),
    unitIds.length ? db.from("units").select("id, name, city, state").in("id", unitIds) : Promise.resolve({ data: [] }),
  ]);
  const tMap: Record<string, any> = {}; for (const t of tenants ?? []) tMap[t.id] = t;
  const uMap: Record<string, any> = {}; for (const u of units ?? []) uMap[u.id] = u;
  return rows.map((r) => ({
    employee_id: r.id,
    tenant_id: r.tenant_id,
    tenant_name: tMap[r.tenant_id]?.name ?? r.tenant_id,
    unit_id: r.unit_id,
    unit_name: uMap[r.unit_id]?.name ?? null,
    unit_location: uMap[r.unit_id] ? `${uMap[r.unit_id].city}/${uMap[r.unit_id].state}` : null,
    name: r.name,
    short_name: shortName(r.name),
    position: r.position,
    avatar: r.avatar,
  }));
}

/** Resolve a sessão e o colaborador ativo do request. */
async function resolveEmployee(db: any, token: string | null, employeeId: unknown) {
  const claims = await verifySession(token);
  if (!claims) return { error: json({ error: "session_expired" }, 401) };
  const id = String(employeeId ?? claims.ids[0]);
  if (!claims.ids.includes(id)) return { error: json({ error: "forbidden" }, 403) };
  const { data: emp } = await db.from("employees").select(EMP_COLS).eq("id", id).maybeSingle();
  if (!emp) return { error: json({ error: "employee_not_found" }, 404) };
  if (emp.status !== "active") return { error: json({ error: "employee_inactive" }, 403) };
  return { claims, emp };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const action = String(body?.action ?? "");
  const token = req.headers.get("x-portal-session") ?? body?.session_token ?? null;
  const db = svc();

  try {
    // ---------- LOGIN ----------
    if (action === "login") {
      const cpf = onlyDigits(body?.cpf);
      const password = String(body?.password ?? "");
      if (cpf.length !== 11 || password.length < 4) return json({ error: "invalid_credentials" }, 401);

      const { data: rows } = await db.from("employees").select(EMP_COLS).eq("cpf", cpf);
      const actives = (rows ?? []).filter((r: any) => r.status === "active");
      if (!rows?.length) return json({ error: "invalid_credentials" }, 401);

      const locked = rows.find((r: any) => r.portal_locked_until && new Date(r.portal_locked_until).getTime() > Date.now());
      if (locked) return json({ error: "locked", locked_until: locked.portal_locked_until }, 423);

      const provisional = cpf.slice(0, 6);
      let ok = false; let mustChange = false;
      for (const r of rows) {
        if (r.portal_password_hash) {
          if (await verifyPin(password, r.portal_password_hash)) { ok = true; mustChange = !!r.portal_must_change_password; break; }
        } else if (password === provisional) { ok = true; mustChange = true; break; }
      }

      if (!ok) {
        for (const r of rows) {
          const attempts = (r.portal_failed_attempts ?? 0) + 1;
          const patch: Record<string, unknown> = { portal_failed_attempts: attempts };
          if (attempts >= MAX_ATTEMPTS) { patch.portal_locked_until = new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString(); patch.portal_failed_attempts = 0; }
          await db.from("employees").update(patch).eq("id", r.id);
        }
        return json({ error: "invalid_credentials" }, 401);
      }

      const ids = (actives.length ? actives : rows).map((r: any) => r.id);
      for (const id of ids) {
        await db.from("employees").update({ portal_failed_attempts: 0, portal_locked_until: null, portal_last_login_at: new Date().toISOString() }).eq("id", id);
      }
      const session = await signSession({ cpf, ids }, SESSION_TTL);
      return json({
        session_token: session,
        must_change_password: mustChange,
        cpf_masked: `${cpf.slice(0, 3)}.***.***-${cpf.slice(9)}`,
        links: await linksFor(db, actives),
      });
    }

    // ---------- TROCA DE SENHA ----------
    if (action === "change_password") {
      const claims = await verifySession(token);
      if (!claims) return json({ error: "session_expired" }, 401);
      const next = String(body?.new_password ?? "");
      if (next.length < 6 || next.length > 64) return json({ error: "weak_password" }, 400);
      if (onlyDigits(next) === claims.cpf.slice(0, 6)) return json({ error: "password_is_provisional" }, 400);
      const hash = await hashPin(next);
      for (const id of claims.ids) {
        await db.from("employees").update({
          portal_password_hash: hash, portal_password_set_at: new Date().toISOString(),
          portal_must_change_password: false, portal_failed_attempts: 0, portal_locked_until: null,
        }).eq("id", id);
      }
      return json({ ok: true });
    }

    // ---------- VÍNCULOS ----------
    if (action === "links") {
      const claims = await verifySession(token);
      if (!claims) return json({ error: "session_expired" }, 401);
      const { data: rows } = await db.from("employees").select(EMP_COLS).in("id", claims.ids);
      const actives = (rows ?? []).filter((r: any) => r.status === "active");
      return json({ links: await linksFor(db, actives), cpf_masked: `${claims.cpf.slice(0, 3)}.***.***-${claims.cpf.slice(9)}` });
    }

    // ---------- HOME ----------
    if (action === "home") {
      const r = await resolveEmployee(db, token, body?.employee_id);
      if ("error" in r) return r.error!;
      const emp: any = r.emp;
      const now = new Date();
      const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const refDate = dayStart.toISOString().slice(0, 10);

      const [today, month, { data: area }, { data: occ }] = await Promise.all([
        buildStatement(db, emp.tenant_id, emp.id, "day", refDate),
        buildStatement(db, emp.tenant_id, emp.id, "month", monthStart.toISOString().slice(0, 10)),
        emp.current_area_id
          ? db.from("cold_areas").select("id, name, exposure_limit_minutes, warning_yellow_minutes, warning_orange_minutes, break_minutes").eq("id", emp.current_area_id).maybeSingle()
          : Promise.resolve({ data: null }),
        db.from("occurrences").select("id, status").eq("tenant_id", emp.tenant_id).eq("employee_id", emp.id).eq("status", "open"),
      ]);

      const lastExit = [...(today.sessions ?? [])].reverse().find((s: any) => s.exit_at)?.exit_at ?? null;
      return json({
        server_time: now.toISOString(),
        employee: {
          id: emp.id, name: emp.name, short_name: shortName(emp.name), position: emp.position, avatar: emp.avatar,
          current_status: emp.current_status, inside_since: emp.inside_since,
          accumulated_minutes: Number(emp.accumulated_minutes ?? 0), break_started_at: emp.break_started_at,
        },
        area: area ?? null,
        today: {
          reference_date: refDate,
          total_exposure_minutes: today.totals.total_exposure_minutes,
          entries_count: today.totals.entries_count,
          breaks_completed: today.totals.breaks_completed,
          has_alert: (today.inconsistencies ?? []).length > 0,
          last_exit_at: lastExit,
          confirmed: !!today.confirmation?.exists,
        },
        month: {
          reference_month: monthStart.toISOString().slice(0, 7),
          total_exposure_minutes: month.totals.total_exposure_minutes,
          entries_count: month.totals.entries_count,
          breaks_completed: month.totals.breaks_completed,
        },
        open_occurrences: (occ ?? []).length,
      });
    }

    // ---------- EXTRATO ----------
    if (action === "statement") {
      const r = await resolveEmployee(db, token, body?.employee_id);
      if ("error" in r) return r.error!;
      const emp: any = r.emp;
      const period = ["day", "week", "month"].includes(body?.period) ? body.period : "month";
      const refDate = /^\d{4}-\d{2}-\d{2}$/.test(body?.reference_date ?? "") ? body.reference_date : new Date().toISOString().slice(0, 10);

      const st = await buildStatement(db, emp.tenant_id, emp.id, period, refDate);
      const start = st.range.start, end = st.range.end;

      const [{ data: events }, { data: corrections }, { data: occ }] = await Promise.all([
        db.from("access_events")
          .select("id, event_type, occurred_at, source, cold_area_id, device_id, validation_status")
          .eq("tenant_id", emp.tenant_id).eq("employee_id", emp.id)
          .gte("occurred_at", start).lt("occurred_at", end).order("occurred_at", { ascending: true }),
        db.from("access_event_corrections")
          .select("id, event_id, original_event_type, original_occurred_at, new_event_type, new_occurred_at, reason_category, reason_detail, status, approved_by_name, approved_at, employee_response, employee_responded_at, created_at")
          .eq("tenant_id", emp.tenant_id).eq("employee_id", emp.id)
          .gte("original_occurred_at", start).lt("original_occurred_at", end),
        db.from("occurrences").select("id, status").eq("tenant_id", emp.tenant_id).eq("employee_id", emp.id)
          .gte("created_at", start).lt("created_at", end),
      ]);

      const areaIds = [...new Set((events ?? []).map((e: any) => e.cold_area_id).filter(Boolean))];
      const areaMap: Record<string, string> = {};
      if (areaIds.length) {
        const { data: areas } = await db.from("cold_areas").select("id, name").in("id", areaIds);
        for (const a of areas ?? []) areaMap[a.id] = a.name;
      }

      // duração da sessão: casada no evento de saída
      const openStack: any[] = [];
      const durations: Record<string, number> = {};
      for (const e of events ?? []) {
        if (e.event_type === "entry") openStack.push(e);
        else if (e.event_type === "exit" && openStack.length) {
          const entry = openStack.pop();
          durations[e.id] = Math.max(0, Math.round((new Date(e.occurred_at).getTime() - new Date(entry.occurred_at).getTime()) / 60000));
        }
      }

      return json({
        period, reference_date: refDate, range: st.range,
        totals: st.totals, content_hash: st.content_hash, confirmation: st.confirmation,
        occurrences_count: (occ ?? []).length,
        open_occurrences_count: (occ ?? []).filter((o: any) => o.status === "open").length,
        events: (events ?? []).map((e: any) => ({
          id: e.id, event_type: e.event_type, occurred_at: e.occurred_at, source: e.source,
          cold_area_name: e.cold_area_id ? areaMap[e.cold_area_id] ?? null : null,
          device_id: e.device_id,
          duration_minutes: durations[e.id] ?? null,
          synthetic: e.source === "system_timeout" || e.source === "system",
        })),
        corrections: corrections ?? [],
      });
    }

    // ---------- CONFIRMAR EXTRATO (clickwrap) ----------
    if (action === "confirm_statement") {
      const r = await resolveEmployee(db, token, body?.employee_id);
      if ("error" in r) return r.error!;
      const emp: any = r.emp;
      const refDate = String(body?.reference_date ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(refDate)) return json({ error: "invalid_date" }, 400);
      const clickwrap = String(body?.clickwrap_text ?? "");
      if (clickwrap.length < 20) return json({ error: "missing_clickwrap" }, 400);

      const computed = await buildStatement(db, emp.tenant_id, emp.id, "day", refDate);
      if (body?.content_hash && body.content_hash !== computed.content_hash) {
        return json({ error: "statement_changed", content_hash: computed.content_hash }, 409);
      }
      if (computed.confirmation?.exists) return json({ error: "already_confirmed", confirmed_at: computed.confirmation.confirmed_at }, 409);

      const { error } = await db.from("daily_statement_confirmations").insert({
        tenant_id: emp.tenant_id, employee_id: emp.id, reference_date: refDate,
        content_hash: computed.content_hash, content_snapshot: computed,
        clickwrap_text: clickwrap, clickwrap_text_hash: await sha256Hex(clickwrap),
        signature_method: "portal_password",
        user_agent: req.headers.get("user-agent") ?? null,
      });
      if (error) { console.error("confirm_insert_failed", error.message); return json({ error: "server_error" }, 500); }
      return json({ ok: true, content_hash: computed.content_hash });
    }

    // ---------- OCORRÊNCIAS ----------
    if (action === "occurrences") {
      const r = await resolveEmployee(db, token, body?.employee_id);
      if ("error" in r) return r.error!;
      const emp: any = r.emp;
      let q = db.from("occurrences")
        .select("id, category, priority, title, description, status, created_at, resolved_at, resolved_by, resolution")
        .eq("tenant_id", emp.tenant_id).eq("employee_id", emp.id)
        .order("created_at", { ascending: false }).limit(100);
      if (body?.status === "open") q = q.eq("status", "open");
      if (body?.status === "resolved") q = q.neq("status", "open");
      const { data: rows } = await q;
      const ids = (rows ?? []).map((o: any) => o.id);
      let notes: any[] = [];
      if (ids.length) {
        const { data } = await db.from("occurrence_notes").select("id, occurrence_id, author, text, created_at").in("occurrence_id", ids).order("created_at", { ascending: true });
        notes = data ?? [];
      }
      return json({ occurrences: rows ?? [], notes });
    }

    // ---------- RESPONDER CORREÇÃO ----------
    if (action === "respond_correction") {
      const r = await resolveEmployee(db, token, body?.employee_id);
      if ("error" in r) return r.error!;
      const emp: any = r.emp;
      const response = body?.response === "contested" ? "contested" : body?.response === "accepted" ? "accepted" : null;
      if (!response) return json({ error: "invalid_response" }, 400);
      const { data: corr } = await db.from("access_event_corrections")
        .select("id, employee_response").eq("id", body?.correction_id)
        .eq("tenant_id", emp.tenant_id).eq("employee_id", emp.id).maybeSingle();
      if (!corr) return json({ error: "correction_not_found" }, 404);
      if (corr.employee_response) return json({ error: "already_responded" }, 409);
      const { error } = await db.from("access_event_corrections").update({
        employee_response: response, employee_responded_at: new Date().toISOString(),
      }).eq("id", corr.id);
      if (error) { console.error("respond_failed", error.message); return json({ error: "server_error" }, 500); }
      return json({ ok: true });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error("portal_error", action, (e as Error).message);
    return json({ error: "server_error" }, 500);
  }
});
