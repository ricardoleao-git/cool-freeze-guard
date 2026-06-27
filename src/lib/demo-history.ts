import { supabase } from "@/integrations/supabase/client";

/**
 * Orquestra a geração de 3 meses de histórico no demo-tenant, chamando a
 * edge function `demo-seed-history` em fases (uma semana por vez para os
 * eventos, mais 5 fases auxiliares). Reporta progresso ao chamador.
 */
export type SeedPhaseReport = { phase: string; ok: boolean; info?: any; error?: string };

export async function generateDemoHistory(
  onProgress: (pct: number, label: string, last?: SeedPhaseReport) => void,
  opts: { year?: number; density?: "light" | "medium" | "heavy" } = {},
) {
  const year = opts.year ?? 2026;
  const density = opts.density ?? "heavy";

  const weekChunks: Array<{ from: string; to: string }> = [];
  const start = new Date(Date.UTC(year, 4, 1));   // 1º maio
  const end = new Date(Date.UTC(year, 6, 31));    // 31 jul
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 7)) {
    const to = new Date(d); to.setUTCDate(to.getUTCDate() + 6);
    if (to > end) to.setTime(end.getTime());
    weekChunks.push({ from: iso(d), to: iso(to) });
  }

  const totalSteps = 1 /*reset*/ + weekChunks.length + 4 /*corrections,statements,inconsistencies,closures,integration -> 5 na verdade*/;
  const steps = 1 + weekChunks.length + 5;
  let done = 0;
  const reports: SeedPhaseReport[] = [];

  async function call(phase: string, body: Record<string, any> = {}) {
    const { data, error } = await supabase.functions.invoke("demo-seed-history", { body: { phase, ...body } });
    const r: SeedPhaseReport = error
      ? { phase, ok: false, error: error.message }
      : { phase, ok: true, info: data };
    reports.push(r);
    done++;
    onProgress(Math.round((done / steps) * 100), labelFor(phase, body), r);
    if (error) throw new Error(`${phase}: ${error.message}`);
    return data;
  }

  await call("reset");
  for (const w of weekChunks) await call("events", { ...w, density });
  await call("corrections");
  await call("statements");
  await call("inconsistencies");
  await call("closures");
  await call("integration");

  return reports;
}

const iso = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const pad = (n: number) => String(n).padStart(2, "0");

function labelFor(phase: string, body: Record<string, any>) {
  switch (phase) {
    case "reset": return "Limpando histórico anterior…";
    case "events": return `Gerando eventos ${body.from} → ${body.to}…`;
    case "corrections": return "Criando correções RH/SST…";
    case "statements": return "Gerando confirmações de extrato (mai/jun)…";
    case "inconsistencies": return "Inserindo revisões de inconsistências…";
    case "closures": return "Fechando mai/jun e abrindo jul (assinaturas)…";
    case "integration": return "Populando logs e erros da integração GuardIA…";
    default: return phase;
  }
}
