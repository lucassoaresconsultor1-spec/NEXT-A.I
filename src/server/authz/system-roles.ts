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
    name: "Dono",
    description: "Acesso total à empresa, inclusive outros donos.",
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
    // Above the coordinator: only owners and administrators grant financial access.
    key: "finance",
    name: "Financeiro",
    description: "Faturamento, recebimentos, conciliação, caixa e despesas das lojas autorizadas, sem configurações operacionais.",
    rank: 80,
    defaultStoreAccess: "stores",
    permissions: [
      "organization.settings.read",
      "stores.read",
      "regions.read",
      "catalog.read",
      "catalog.costs.read",
      "inventory.read",
      "purchases.read",
      "sales.read",
      "fiscal.read",
      "cash.read",
      "customers.read",
      "customers.documents.read",
    ],
  },
  {
    key: "regional_manager",
    name: "Coordenador",
    description: "Acompanha a operação consolidada das lojas autorizadas, compara lojas e gerencia equipes.",
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
      "catalog.read",
      "catalog.costs.read",
      "inventory.read",
      "inventory.transfer.request",
      "inventory.transfer.approve",
      "purchases.read",
      "purchases.manage",
      "purchases.approve",
      "sales.read",
      "cash.read",
      "customers.read",
    ],
  },
  {
    key: "store_manager",
    name: "Gerente de loja",
    description: "Gerencia a equipe e a operação das lojas autorizadas.",
    rank: 50,
    defaultStoreAccess: "stores",
    permissions: [
      "stores.read",
      "departments.read",
      "members.read",
      "members.manage",
      "roles.read",
      "catalog.read",
      "inventory.read",
      "inventory.manage",
      "inventory.transfer.request",
      "inventory.transfer.approve",
      "inventory.transfer.execute",
      "purchases.read",
      "purchases.receive",
      "sales.create",
      "sales.read",
      "sales.discount",
      "sales.discount.override",
      "sales.surcharge",
      "sales.cancel",
      "sales.refund",
      "sales.refund.override",
      "fiscal.read",
      "cash.read",
      "cash.operate",
      "cash.manage",
      "customers.read",
      "customers.manage",
      "customers.documents.read",
    ],
  },
  {
    key: "supervisor",
    name: "Supervisor",
    description: "Monitora equipe, atendimento e indicadores da loja.",
    rank: 40,
    defaultStoreAccess: "stores",
    permissions: ["stores.read", "departments.read", "members.read", "catalog.read", "inventory.read", "sales.read", "cash.read", "customers.read"],
  },
  {
    key: "salesperson",
    name: "Vendedor",
    description: "Consulta o próprio desempenho e os atendimentos atribuídos.",
    rank: 20,
    defaultStoreAccess: "stores",
    // Front-line roles register the buyer at the sale (ADR-017).
    permissions: ["stores.read", "catalog.read", "inventory.read", "customers.read", "customers.manage"],
  },
  {
    key: "cashier",
    name: "Operador de caixa",
    description: "Opera o PDV e o próprio caixa.",
    rank: 20,
    defaultStoreAccess: "stores",
    // Front-line roles register the buyer at the sale (ADR-017).
    permissions: ["stores.read", "catalog.read", "inventory.read", "sales.create", "sales.discount", "sales.cancel", "cash.operate", "customers.read", "customers.manage"],
  },
];

export function findSystemRole(key: string) {
  return SYSTEM_ROLES.find((role) => role.key === key);
}
