// pt-BR labels for audit actions. Unknown actions fall back to the raw key.
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "organization.created": "Empresa criada",
  "organization.updated": "Dados da empresa alterados",
  "organization.plan_changed": "Plano alterado pela plataforma",
  "organization.status_changed": "Situação da empresa alterada pela plataforma",
  "region.created": "Região criada",
  "region.updated": "Região alterada",
  "region.deleted": "Região excluída",
  "store.created": "Loja criada",
  "store.updated": "Loja alterada",
  "store.status_changed": "Situação da loja alterada",
  "department.created": "Departamento criado",
  "department.updated": "Departamento alterado",
  "department.deleted": "Departamento excluído",
  "member.added": "Membro adicionado",
  "member.updated": "Acesso de membro alterado",
  "member.status_changed": "Situação de membro alterada",
  "member.removed": "Membro removido",
  "member.password_reset": "Senha provisória definida para membro",
  "role.created": "Perfil criado",
  "role.updated": "Perfil alterado",
  "role.deleted": "Perfil excluído",
};

export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  organization: "Empresa",
  region: "Região",
  store: "Loja",
  department: "Departamento",
  member: "Membro",
  role: "Perfil",
};

export function auditActionLabel(action: string) {
  return AUDIT_ACTION_LABELS[action] ?? action;
}
