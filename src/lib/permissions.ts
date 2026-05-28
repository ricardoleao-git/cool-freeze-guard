export type AppRole = "super_admin" | "administrador" | "gestor" | "rh_sst" | "visualizador";

export const ROLE_LABELS: Record<AppRole, string> = {
  super_admin: "Super Admin",
  administrador: "Administrador",
  gestor: "Gestor / Supervisor",
  rh_sst: "RH / SST",
  visualizador: "Visualizador",
};

export const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  super_admin: "Acesso global a todas as empresas e configurações da plataforma.",
  administrador: "Gestão completa da própria empresa, incluindo usuários e cadastros.",
  gestor: "Acompanha operação, dispositivos, ocorrências e relatórios da empresa.",
  rh_sst: "Gerencia colaboradores, ocorrências, pausas e evidências de SST.",
  visualizador: "Acesso somente leitura aos painéis e relatórios.",
};

// Mapa rota -> papéis permitidos. Super Admin sempre passa.
export const ROUTE_ACCESS: Record<string, AppRole[]> = {
  "/": ["administrador", "gestor", "rh_sst", "visualizador"],
  "/painel": ["administrador", "gestor", "rh_sst", "visualizador"],
  "/alertas": ["administrador", "gestor", "rh_sst", "visualizador"],
  "/ocorrencias": ["administrador", "gestor", "rh_sst"],
  "/historico": ["administrador", "gestor", "rh_sst"],
  "/pausas": ["administrador", "gestor", "rh_sst", "visualizador"],
  "/eventos": ["administrador", "gestor", "rh_sst", "visualizador"],
  "/ajustes": ["administrador", "gestor", "rh_sst"],
  "/meu-dia": ["administrador", "gestor", "rh_sst", "visualizador"],
  "/resumo-diario": ["administrador", "gestor", "rh_sst"],
  "/colaboradores": ["administrador", "gestor", "rh_sst"],
  "/ambientes": ["administrador", "gestor"],
  "/dispositivos": ["administrador", "gestor"],
  "/relatorios": ["administrador", "gestor", "rh_sst", "visualizador"],
  "/integracoes": ["administrador"],
  "/empresas": [], // só super_admin
  "/usuarios": ["administrador"],
  "/como-funciona": ["administrador", "gestor", "rh_sst", "visualizador"],
  "/lgpd": ["administrador", "gestor", "rh_sst", "visualizador"],
};

export function canAccess(path: string, roles: AppRole[]): boolean {
  if (roles.includes("super_admin")) return true;
  const allowed = ROUTE_ACCESS[path];
  if (!allowed) return true;
  return roles.some(r => allowed.includes(r));
}

export function canWrite(roles: AppRole[]): boolean {
  return roles.some(r => ["super_admin", "administrador", "gestor", "rh_sst"].includes(r));
}

export function isReadOnly(roles: AppRole[]): boolean {
  if (roles.length === 0) return true;
  return roles.every(r => r === "visualizador");
}
