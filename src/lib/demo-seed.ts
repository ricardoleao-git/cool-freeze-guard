import { supabase } from "@/integrations/supabase/client";

/**
 * Regenera dados simulados realistas no tenant público "demo-tenant".
 * As policies anon permitem escrita apenas neste escopo.
 *
 * Estratégia: purga todas as linhas operacionais do demo-tenant e re-insere
 * empresas/unidades/departamentos/áreas frias/colaboradores/dispositivos com
 * IDs estáveis (prefixo "demo-") + variação pseudo-aleatória a cada execução
 * (nomes, matrículas, gestores), garantindo que cada nova sessão veja um
 * conjunto coerente porém diferente.
 */

const TENANT_ID = "demo-tenant";
const AVATAR = (seed: string) =>
  `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(seed)}&backgroundType=gradientLinear&backgroundColor=0ea5e9,06b6d4,22d3ee`;

const FIRST_NAMES = [
  "Ana", "Bruno", "Carla", "Daniel", "Eduarda", "Felipe", "Gabriela", "Henrique",
  "Isabela", "João", "Karla", "Lucas", "Mariana", "Nicolas", "Olívia", "Paulo",
  "Quésia", "Rafael", "Sofia", "Thiago", "Úrsula", "Vinícius", "Wagner", "Yara",
];
const LAST_NAMES = [
  "Silva", "Souza", "Oliveira", "Santos", "Pereira", "Costa", "Rodrigues", "Almeida",
  "Nascimento", "Lima", "Araújo", "Fernandes", "Carvalho", "Gomes", "Martins", "Rocha",
  "Ribeiro", "Moreira", "Barbosa", "Pinto", "Cavalcanti", "Tavares", "Andrade", "Mendes",
];
const POSITIONS = [
  "Açougueiro(a)", "Aux. de Câmara Fria", "Encarregado(a)", "Operador(a)",
  "Aux. de Expedição", "Desossador(a)", "Aux. de Frigorífico", "Supervisor(a)",
];

const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const uniqueName = (used: Set<string>) => {
  for (let i = 0; i < 50; i++) {
    const n = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    if (!used.has(n)) { used.add(n); return n; }
  }
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)} ${used.size}`;
};

type Built = {
  tenant: any;
  units: any[];
  departments: any[];
  coldAreas: any[];
  employees: any[];
  devices: any[];
  authorizations: any[];
};

function buildSeed(): Built {
  const tenant = {
    id: TENANT_ID,
    name: "FrioSafe Demo",
    legal_name: "FrioSafe Demonstração Ltda.",
    document_number: "00.000.000/0001-00",
    status: "active",
    plan: "Demo",
  };

  const units = [
    { id: "demo-u1", tenant_id: TENANT_ID, name: "Loja Recife — Boa Viagem", city: "Recife", state: "PE", manager_name: pick(["Ricardo Mendes", "Sandra Lopes", "Eduardo Tavares"]), status: "active" },
    { id: "demo-u2", tenant_id: TENANT_ID, name: "Centro de Distribuição Jaboatão", city: "Jaboatão dos Guararapes", state: "PE", manager_name: pick(["Patrícia Gomes", "Marcos Oliveira", "Camila Duarte"]), status: "active" },
  ];

  const departments = [
    { id: "demo-d1", tenant_id: TENANT_ID, unit_id: "demo-u1", name: "Açougue" },
    { id: "demo-d2", tenant_id: TENANT_ID, unit_id: "demo-u1", name: "Câmara Fria" },
    { id: "demo-d3", tenant_id: TENANT_ID, unit_id: "demo-u1", name: "Padaria Refrigerada" },
    { id: "demo-d4", tenant_id: TENANT_ID, unit_id: "demo-u2", name: "Desossa" },
    { id: "demo-d5", tenant_id: TENANT_ID, unit_id: "demo-u2", name: "Expedição Congelados" },
  ];

  const rule = { exposure_limit_minutes: 100, warning_yellow_minutes: 80, warning_orange_minutes: 90, break_minutes: 20, counting_mode: "accumulated", status: "active" };
  const coldAreas = [
    { id: "demo-ca1", tenant_id: TENANT_ID, unit_id: "demo-u1", department_id: "demo-d1", name: "Câmara do Açougue", type: "Câmara Fria", average_temperature: 2, ...rule },
    { id: "demo-ca2", tenant_id: TENANT_ID, unit_id: "demo-u1", department_id: "demo-d2", name: "Câmara Fria Principal", type: "Câmara Fria", average_temperature: -2, ...rule },
    { id: "demo-ca3", tenant_id: TENANT_ID, unit_id: "demo-u1", department_id: "demo-d3", name: "Depósito Refrigerado", type: "Depósito Refrigerado", average_temperature: 5, ...rule },
    { id: "demo-ca4", tenant_id: TENANT_ID, unit_id: "demo-u2", department_id: "demo-d4", name: "Sala de Desossa", type: "Desossa", average_temperature: 8, ...rule },
    { id: "demo-ca5", tenant_id: TENANT_ID, unit_id: "demo-u2", department_id: "demo-d5", name: "Câmara de Congelados", type: "Frigorífico", average_temperature: -18, ...rule },
  ];

  // 15 colaboradores distribuídos pelas áreas
  const used = new Set<string>();
  const baseReg = 100000 + Math.floor(Math.random() * 800000);
  const employees: any[] = [];
  const assignments: Array<[string, string]> = [
    ["demo-u1", "demo-d1"], ["demo-u1", "demo-d1"], ["demo-u1", "demo-d1"],
    ["demo-u1", "demo-d2"], ["demo-u1", "demo-d2"], ["demo-u1", "demo-d2"],
    ["demo-u1", "demo-d3"], ["demo-u1", "demo-d3"],
    ["demo-u2", "demo-d4"], ["demo-u2", "demo-d4"], ["demo-u2", "demo-d4"],
    ["demo-u2", "demo-d5"], ["demo-u2", "demo-d5"], ["demo-u2", "demo-d5"], ["demo-u2", "demo-d5"],
  ];
  assignments.forEach(([unit_id, department_id], i) => {
    const name = uniqueName(used);
    employees.push({
      id: `demo-e${i + 1}`,
      tenant_id: TENANT_ID,
      unit_id, department_id,
      name,
      registration_number: String(baseReg + i),
      position: pick(POSITIONS),
      avatar: AVATAR(name),
      status: "active",
      current_status: "outside",
      accumulated_minutes: 0,
      inside_since: null,
      current_area_id: null,
      break_started_at: null,
    });
  });

  // 2 leitores (entrada/saída) por área fria
  const devices: any[] = [];
  coldAreas.forEach((ca, idx) => {
    const code = String(idx + 1).padStart(2, "0");
    devices.push(
      {
        id: `demo-dv${idx * 2 + 1}`, tenant_id: TENANT_ID, unit_id: ca.unit_id, cold_area_id: ca.id,
        name: `Leitor Facial — ${ca.name} (ENTRADA)`, device_type: "entry",
        external_device_id: `DEMO-IN-${code}`, status: "online", last_seen_at: new Date().toISOString(),
      },
      {
        id: `demo-dv${idx * 2 + 2}`, tenant_id: TENANT_ID, unit_id: ca.unit_id, cold_area_id: ca.id,
        name: `Leitor Facial — ${ca.name} (SAÍDA)`, device_type: "exit",
        external_device_id: `DEMO-OUT-${code}`, status: idx === 1 ? "offline" : "online",
        last_seen_at: idx === 1 ? new Date(Date.now() - 3600_000).toISOString() : new Date().toISOString(),
      },
    );
  });

  // Autorização: cada colaborador é autorizado na área fria do seu departamento.
  const authorizations = employees.map(e => {
    const area = coldAreas.find(a => a.unit_id === e.unit_id && a.department_id === e.department_id)!;
    return {
      employee_id: e.id, cold_area_id: area.id, tenant_id: TENANT_ID,
      authorized_by: "sistema.demo",
    };
  });

  return { tenant, units, departments, coldAreas, employees, devices, authorizations };
}

async function purgeDemoTenant() {
  // Ordem segura (não há FKs, mas mantemos coerência lógica).
  const tables = [
    "access_event_corrections",
    "access_events",
    "alerts",
    "thermal_breaks",
    "occurrence_attachments",
    "occurrence_notes",
    "occurrences",
    "employee_consents",
    "employee_cold_areas",
    "devices",
    "employees",
    "cold_areas",
    "departments",
    "units",
  ] as const;
  for (const t of tables) {
    await supabase.from(t).delete().eq("tenant_id", TENANT_ID);
  }
}

export async function regenerateDemoSeed(): Promise<void> {
  const seed = buildSeed();
  await purgeDemoTenant();

  await supabase.from("tenants").upsert(seed.tenant, { onConflict: "id" });
  await supabase.from("tenant_settings").upsert({
    tenant_id: TENANT_ID,
    biometric_retention_days: 180,
    logs_retention_days: 730,
    occurrences_retention_days: 1825,
    consent_version: 1,
    consent_text: "Termo de uso de dados biométricos — versão demonstrativa.",
    lawful_basis: "obrigacao_legal",
    dpo_name: "DPO Demonstração",
    dpo_email: "dpo@friosafe.demo",
    privacy_policy_url: "https://friosafe.demo/privacidade",
    require_consent_before_capture: false,
  }, { onConflict: "tenant_id" });

  await supabase.from("units").insert(seed.units);
  await supabase.from("departments").insert(seed.departments);
  await supabase.from("cold_areas").insert(seed.coldAreas);
  await supabase.from("employees").insert(seed.employees);
  await supabase.from("devices").insert(seed.devices);
  await supabase.from("employee_cold_areas").insert(seed.authorizations);
}

const AUTO_KEY = "friosafe.demo.autoRegenerate";
export const getAutoRegenerate = () =>
  typeof window !== "undefined" && window.localStorage.getItem(AUTO_KEY) === "1";
export const setAutoRegenerate = (on: boolean) => {
  if (typeof window === "undefined") return;
  if (on) window.localStorage.setItem(AUTO_KEY, "1");
  else window.localStorage.removeItem(AUTO_KEY);
};
