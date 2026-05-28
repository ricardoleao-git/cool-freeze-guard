// Demo data + types for FrioSafe (frontend-only demo)
export type Role = "super_admin" | "tenant_admin" | "manager" | "hr_sst" | "viewer";
export type EmployeeStatus = "outside" | "inside" | "yellow" | "orange" | "blocked" | "thermal_break";

export interface Tenant { id: string; name: string; legal_name: string; document_number: string; status: "active" | "inactive"; plan: string; }
export interface Unit { id: string; tenant_id: string; name: string; city: string; state: string; manager_name: string; status: "active" | "inactive"; }
export interface Department { id: string; tenant_id: string; unit_id: string; name: string; }
export interface ColdArea {
  id: string; tenant_id: string; unit_id: string; department_id: string;
  name: string; type: string; average_temperature: number;
  exposure_limit_minutes: number; warning_yellow_minutes: number; warning_orange_minutes: number;
  break_minutes: number; counting_mode: "accumulated" | "continuous"; status: "active" | "inactive";
}
export interface Employee {
  id: string; tenant_id: string; unit_id: string; department_id: string;
  name: string; registration_number: string; position: string; avatar: string;
  status: "active" | "inactive"; current_status: EmployeeStatus;
  accumulated_minutes: number; inside_since: number | null; // ts ms
  current_area_id: string | null;
  break_started_at: number | null;
}
export interface Device {
  id: string; tenant_id: string; unit_id: string; cold_area_id: string;
  name: string; device_type: "entry" | "exit"; external_device_id: string;
  status: "online" | "offline" | "maintenance"; last_seen_at: number;
}
export interface EmployeeColdAreaAuthorization {
  id: string; employee_id: string; cold_area_id: string; tenant_id: string;
  authorized_by: string; authorized_at: number;
}
export interface AccessEvent {
  id: string; tenant_id: string; unit_id: string; cold_area_id: string;
  device_id: string; employee_id: string; event_type: "entry" | "exit";
  source: "facial_reader" | "manual" | "demo_simulation" | "api";
  occurred_at: number; validation_status: "valid" | "pending" | "rejected";
  confidence_score: number;
}
export interface Alert {
  id: string; tenant_id: string; employee_id: string;
  alert_type: "yellow" | "orange" | "red_block" | "break_completed" | "device_offline" | "missing_exit" | "cycle_reset_meal" | "cycle_reset_shift";
  severity: "info" | "warning" | "critical";
  message: string; triggered_at: number; status: "open" | "acknowledged" | "resolved";
}
export interface ThermalBreak { id: string; tenant_id: string; employee_id: string; started_at: number; ended_at: number | null; completed: boolean; source: "automatic" | "manual"; }
export type OccurrenceCategory = "missing_exit" | "missing_entry" | "device_failure" | "manual_correction" | "false_reading" | "other";
export type OccurrencePriority = "low" | "medium" | "high";
export interface OccurrenceAttachment { id: string; name: string; size: number; mime: string; storage_path: string; data_url?: string; }
export interface OccurrenceNote { id: string; author: string; created_at: number; text: string; }
export interface Occurrence {
  id: string; tenant_id: string; employee_id: string;
  category: OccurrenceCategory; priority: OccurrencePriority;
  title: string; description: string;
  status: "open" | "in_review" | "resolved";
  created_at: number; created_by: string;
  resolved_at?: number; resolved_by?: string; resolution?: string;
  related_event_id?: string;
  attachments: OccurrenceAttachment[];
  notes: OccurrenceNote[];
}

export const TENANTS: Tenant[] = [
  { id: "t1", name: "Supermercado Modelo Brasil", legal_name: "Modelo Brasil Comércio Ltda", document_number: "12.345.678/0001-90", status: "active", plan: "Enterprise" },
  { id: "t2", name: "Frigorífico Nordeste Demo", legal_name: "Nordeste Demo Frigoríficos S.A.", document_number: "98.765.432/0001-10", status: "active", plan: "Plus" },
];

export const UNITS: Unit[] = [
  { id: "u1", tenant_id: "t1", name: "Loja Recife Boa Viagem", city: "Recife", state: "PE", manager_name: "Ricardo Mendes", status: "active" },
  { id: "u2", tenant_id: "t1", name: "Loja Olinda Centro", city: "Olinda", state: "PE", manager_name: "Sandra Lopes", status: "active" },
  { id: "u3", tenant_id: "t2", name: "Planta Jaboatão", city: "Jaboatão dos Guararapes", state: "PE", manager_name: "Eduardo Tavares", status: "active" },
];

export const DEPARTMENTS: Department[] = [
  { id: "d1", tenant_id: "t1", unit_id: "u1", name: "Açougue" },
  { id: "d2", tenant_id: "t1", unit_id: "u1", name: "Câmara Fria" },
  { id: "d3", tenant_id: "t1", unit_id: "u2", name: "Depósito Refrigerado" },
  { id: "d4", tenant_id: "t2", unit_id: "u3", name: "Desossa" },
  { id: "d5", tenant_id: "t2", unit_id: "u3", name: "Expedição Fria" },
];

const baseRule = { exposure_limit_minutes: 100, warning_yellow_minutes: 80, warning_orange_minutes: 90, break_minutes: 20, counting_mode: "accumulated" as const, status: "active" as const };
export const COLD_AREAS: ColdArea[] = [
  { id: "ca1", tenant_id: "t1", unit_id: "u1", department_id: "d1", name: "Câmara do Açougue", type: "Câmara Fria", average_temperature: 2, ...baseRule },
  { id: "ca2", tenant_id: "t1", unit_id: "u1", department_id: "d2", name: "Câmara Fria Principal", type: "Câmara Fria", average_temperature: -2, ...baseRule },
  { id: "ca3", tenant_id: "t1", unit_id: "u2", department_id: "d3", name: "Depósito Refrigerado", type: "Depósito Refrigerado", average_temperature: 5, ...baseRule },
  { id: "ca4", tenant_id: "t2", unit_id: "u3", department_id: "d4", name: "Sala de Desossa", type: "Desossa", average_temperature: 8, ...baseRule },
  { id: "ca5", tenant_id: "t2", unit_id: "u3", department_id: "d5", name: "Câmara Congelada", type: "Frigorífico", average_temperature: -18, ...baseRule, exposure_limit_minutes: 100 },
];

const av = (seed: string) => `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(seed)}&backgroundType=gradientLinear&backgroundColor=0ea5e9,06b6d4,22d3ee`;

const positions = ["Açougueiro", "Aux. Câmara Fria", "Encarregada", "Operadora", "Aux. Expedição", "Desossador", "Aux. Frigorífico"];

const employeeSeeds: Array<[string, string, string, string]> = [
  // [name, tenant, unit, dept]
  ["João Silva", "t1", "u1", "d1"],
  ["Maria Souza", "t1", "u1", "d2"],
  ["Carlos Almeida", "t1", "u1", "d2"],
  ["Ana Beatriz", "t1", "u1", "d1"],
  ["Pedro Lima", "t1", "u1", "d2"],
  ["Fernanda Costa", "t1", "u2", "d3"],
  ["Rafael Santos", "t1", "u2", "d3"],
  ["Juliana Rocha", "t1", "u2", "d3"],
  ["Marcos Oliveira", "t1", "u1", "d1"],
  ["Bruna Martins", "t1", "u1", "d2"],
  ["Tiago Ferreira", "t2", "u3", "d4"],
  ["Patrícia Gomes", "t2", "u3", "d5"],
  ["Lucas Pereira", "t2", "u3", "d4"],
  ["Camila Duarte", "t2", "u3", "d5"],
  ["Roberto Nunes", "t2", "u3", "d4"],
  ["Vanessa Lima", "t2", "u3", "d5"],
  ["Diego Barbosa", "t2", "u3", "d4"],
  ["Larissa Cunha", "t2", "u3", "d5"],
  ["Henrique Melo", "t2", "u3", "d4"],
  ["Sabrina Ribeiro", "t2", "u3", "d5"],
];

export const EMPLOYEES: Employee[] = employeeSeeds.map(([name, t, u, d], i) => ({
  id: `e${i + 1}`,
  tenant_id: t, unit_id: u, department_id: d,
  name,
  registration_number: String(100000 + i),
  position: positions[i % positions.length],
  avatar: av(name),
  status: "active",
  current_status: "outside",
  accumulated_minutes: 0,
  inside_since: null,
  current_area_id: null,
  break_started_at: null,
}));

export const DEVICES: Device[] = [
  { id: "dv1", tenant_id: "t1", unit_id: "u1", cold_area_id: "ca1", name: "Leitor Facial — Açougue ENTRADA", device_type: "entry", external_device_id: "FR-AC-IN-01", status: "online", last_seen_at: Date.now() },
  { id: "dv2", tenant_id: "t1", unit_id: "u1", cold_area_id: "ca1", name: "Leitor Facial — Açougue SAÍDA", device_type: "exit", external_device_id: "FR-AC-OUT-01", status: "online", last_seen_at: Date.now() },
  { id: "dv3", tenant_id: "t1", unit_id: "u1", cold_area_id: "ca2", name: "Leitor Facial — Câmara Fria ENTRADA", device_type: "entry", external_device_id: "FR-CF-IN-01", status: "online", last_seen_at: Date.now() },
  { id: "dv4", tenant_id: "t1", unit_id: "u1", cold_area_id: "ca2", name: "Leitor Facial — Câmara Fria SAÍDA", device_type: "exit", external_device_id: "FR-CF-OUT-01", status: "offline", last_seen_at: Date.now() - 3600_000 },
  { id: "dv5", tenant_id: "t1", unit_id: "u2", cold_area_id: "ca3", name: "Leitor — Depósito ENTRADA", device_type: "entry", external_device_id: "FR-DP-IN-02", status: "online", last_seen_at: Date.now() },
  { id: "dv6", tenant_id: "t1", unit_id: "u2", cold_area_id: "ca3", name: "Leitor — Depósito SAÍDA", device_type: "exit", external_device_id: "FR-DP-OUT-02", status: "online", last_seen_at: Date.now() },
  { id: "dv7", tenant_id: "t2", unit_id: "u3", cold_area_id: "ca5", name: "Leitor — Câmara Congelada ENTRADA", device_type: "entry", external_device_id: "FR-CG-IN-03", status: "online", last_seen_at: Date.now() },
  { id: "dv8", tenant_id: "t2", unit_id: "u3", cold_area_id: "ca5", name: "Leitor — Câmara Congelada SAÍDA", device_type: "exit", external_device_id: "FR-CG-OUT-03", status: "online", last_seen_at: Date.now() },
];

export const STATUS_LABEL: Record<EmployeeStatus, string> = {
  outside: "Fora da área fria",
  inside: "Dentro — OK",
  yellow: "Atenção (80 min)",
  orange: "Crítico (90 min)",
  blocked: "Bloqueado (100 min)",
  thermal_break: "Em pausa térmica",
};

export const STATUS_COLOR: Record<EmployeeStatus, string> = {
  outside: "bg-status-outside",
  inside: "bg-status-ok",
  yellow: "bg-status-yellow",
  orange: "bg-status-orange",
  blocked: "bg-status-red",
  thermal_break: "bg-status-break",
};
