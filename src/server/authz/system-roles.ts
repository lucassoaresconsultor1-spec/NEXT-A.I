import { ALL_PERMISSIONS, type Permission } from "./permissions";

// System roles are created for every organization. Their permissions are
// resolved from this file at request time, so new releases update them
// without data migrations. Custom roles keep permissions in role_permissions.

export type StoreAccess = "all" | "regions" | "stores";

export interface SystemRoleDefinition {
  key: string;
  name: string;
  description: string;
  rank: number;
  defaultStoreAccess: StoreAccess;
  permissions: readonly Permission[];
}

export const OWNER_ROLE_KEY = "owner";

export const SYSTEM_ROLES: readonly SystemRoleDefinition[] = [
  {
    key: OWNER_ROLE_KEY,
    name: "Proprietário",
    description: "Acesso total à empresa, inclusive outros proprietários.",
    rank: 100,
    defaultStoreAccess: "all",
    permissions: ALL_PERMISSIONS,
  },
  {
    key: "admin",
    name: "Administrador da empresa",
    description: "Configura lojas, equipe, perfis e regras da empresa.",
    rank: 90,
    defaultStoreAccess: "all",
    permissions: ALL_PERMISSIONS,
  },
  {
    key: "regional_manager",
    name: "Gestor regional",
    description: "Acompanha as lojas das regiões autorizadas e suas equipes.",
    rank: 70,
    defaultStoreAccess: "regions",
    permissions: [
      "organization.settings.read",
      "stores.read",
      "regions.read",
      "departments.read",
      "members.read",
      "members.manage",
      "roles.read",
    ],
  },
  {
    key: "store_manager",
    name: "Gerente de loja",
    description: "Gerencia a equipe e a operação das lojas autorizadas.",
    rank: 50,
    defaultStoreAccess: "stores",
    permissions: ["stores.read", "departments.read", "members.read", "members.manage", "roles.read"],
  },
  {
    key: "supervisor",
    name: "Supervisor",
    description: "Monitora equipe, atendimento e indicadores da loja.",
    rank: 40,
    defaultStoreAccess: "stores",
    permissions: ["stores.read", "departments.read", "members.read"],
  },
  {
    key: "salesperson",
    name: "Vendedor",
    description: "Consulta o próprio desempenho e os atendimentos atribuídos.",
    rank: 20,
    defaultStoreAccess: "stores",
    permissions: ["stores.read"],
  },
  {
    key: "cashier",
    name: "Operador de caixa",
    description: "Opera o PDV e o próprio caixa.",
    rank: 20,
    defaultStoreAccess: "stores",
    permissions: ["stores.read"],
  },
];

export function findSystemRole(key: string) {
  return SYSTEM_ROLES.find((role) => role.key === key);
}
