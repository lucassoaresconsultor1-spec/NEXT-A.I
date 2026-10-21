// Permission catalog: the single source of truth for what can be granted.
// New modules add their keys here in the same change that implements them.

export const PERMISSION_GROUPS = [
  {
    key: "organization",
    label: "Empresa",
    permissions: [
      { key: "organization.settings.read", label: "Ver dados da empresa e do plano" },
      { key: "organization.settings.manage", label: "Editar dados da empresa" },
      {
        key: "settings.operations.manage",
        label: "Alterar regras de operação do caixa e do PDV (cliente, teto de desconto, comprovante)",
      },
    ],
  },
  {
    key: "structure",
    label: "Estrutura",
    permissions: [
      { key: "stores.read", label: "Ver lojas do escopo" },
      { key: "stores.manage", label: "Cadastrar e editar lojas" },
      { key: "regions.read", label: "Ver regiões" },
      { key: "regions.manage", label: "Cadastrar e editar regiões" },
      { key: "departments.read", label: "Ver departamentos" },
      { key: "departments.manage", label: "Cadastrar e editar departamentos" },
    ],
  },
  {
    key: "catalog",
    label: "Catálogo",
    permissions: [
      { key: "catalog.read", label: "Ver produtos, variações e preços" },
      { key: "catalog.manage", label: "Cadastrar e editar produtos, categorias, marcas, fornecedores e preços" },
      { key: "catalog.costs.read", label: "Ver custos de produtos (alterar exige também cadastrar produtos)" },
    ],
  },
  {
    key: "inventory",
    label: "Estoque",
    permissions: [
      { key: "inventory.read", label: "Ver saldos e movimentações das lojas do escopo" },
      { key: "inventory.manage", label: "Lançar entradas, saídas, ajustes, perdas e inventários nas lojas do escopo" },
      { key: "inventory.transfer.request", label: "Solicitar transferências de estoque para lojas do escopo" },
      { key: "inventory.transfer.approve", label: "Aprovar e cancelar transferências que saem de lojas do escopo" },
      { key: "inventory.transfer.execute", label: "Despachar e receber transferências nas lojas do escopo" },
    ],
  },
  {
    key: "purchasing",
    label: "Compras",
    permissions: [
      { key: "purchases.read", label: "Ver pedidos de compra e recebimentos das lojas do escopo" },
      { key: "purchases.manage", label: "Criar e editar pedidos de compra (exige ver custos)" },
      { key: "purchases.approve", label: "Aprovar, cancelar e encerrar pedidos de compra" },
      { key: "purchases.receive", label: "Registrar recebimento de mercadorias" },
    ],
  },
  {
    key: "cash",
    label: "Caixa",
    permissions: [
      { key: "cash.read", label: "Ver caixas e sessões das lojas do escopo" },
      { key: "cash.operate", label: "Abrir, movimentar e fechar o próprio caixa" },
      { key: "cash.manage", label: "Cadastrar caixas, fechar sessões de outros operadores e reabrir sessões" },
    ],
  },
  {
    key: "customers",
    label: "Clientes",
    permissions: [
      { key: "customers.read", label: "Ver clientes (CPF mascarado)" },
      { key: "customers.manage", label: "Cadastrar e editar clientes" },
      { key: "customers.documents.read", label: "Ver o CPF completo dos clientes" },
    ],
  },
  {
    key: "people",
    label: "Pessoas e acesso",
    permissions: [
      { key: "members.read", label: "Ver equipe do escopo" },
      { key: "members.manage", label: "Adicionar e editar membros de nível inferior" },
      { key: "roles.read", label: "Ver perfis de acesso" },
      { key: "roles.manage", label: "Criar e editar perfis personalizados" },
    ],
  },
  {
    key: "governance",
    label: "Governança",
    permissions: [{ key: "audit.read", label: "Ver trilha de auditoria" }],
  },
] as const;

export type Permission = (typeof PERMISSION_GROUPS)[number]["permissions"][number]["key"];

export const ALL_PERMISSIONS: readonly Permission[] = PERMISSION_GROUPS.flatMap((group) =>
  group.permissions.map((permission) => permission.key),
);

const permissionSet: ReadonlySet<string> = new Set(ALL_PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return permissionSet.has(value);
}

export function permissionLabel(key: Permission) {
  for (const group of PERMISSION_GROUPS) {
    const found = group.permissions.find((permission) => permission.key === key);
    if (found) return found.label;
  }
  return key;
}
