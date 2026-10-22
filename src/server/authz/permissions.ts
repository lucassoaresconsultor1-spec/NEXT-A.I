// Permission catalog: the single source of truth for what can be granted.
// New modules add their keys here in the same change that implements them.

export const PERMISSION_GROUPS = [
  {
    key: "organization",
    label: "Empresa",
    permissions: [
      { key: "organization.settings.read", label: "Ver dados da empresa e do plano" },
      { key: "organization.settings.manage", label: "Editar dados da empresa" },
      { key: "imports.manage", label: "Importar produtos, clientes e saldo inicial por planilha CSV" },
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
      { key: "inventory.count.record", label: "Registrar quantidades em inventários abertos (contagem cega)" },
      { key: "inventory.count.manage", label: "Abrir e cancelar inventários nas lojas do escopo" },
      { key: "inventory.count.approve", label: "Revisar e aprovar inventários, ajustando o estoque" },
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
    key: "sales",
    label: "Vendas",
    permissions: [
      { key: "sales.create", label: "Vender no PDV (finalizar e suspender vendas) com o próprio caixa aberto" },
      { key: "sales.read", label: "Ver as vendas das lojas do escopo" },
      { key: "sales.discount", label: "Dar desconto até o teto da loja" },
      { key: "sales.discount.override", label: "Dar desconto acima do teto da loja" },
      { key: "sales.surcharge", label: "Aplicar acréscimo na venda" },
      { key: "sales.cancel", label: "Cancelar venda enquanto o caixa dela está aberto (operador: só as próprias)" },
      { key: "sales.refund", label: "Registrar devolução de venda" },
      { key: "sales.refund.override", label: "Registrar devolução fora do prazo" },
      { key: "fiscal.read", label: "Ver documentos fiscais das lojas do escopo" },
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
      { key: "salespeople.manage", label: "Cadastrar vendedores, lojas e escalas de membros de nível inferior" },
      { key: "targets.read", label: "Ver metas de venda e o progresso (vendedor: só as próprias)" },
      { key: "targets.manage", label: "Definir metas de venda da empresa, regiões, lojas e vendedores do escopo" },
      { key: "reports.read", label: "Gerar e baixar relatórios (com as permissões de cada assunto)" },
      { key: "reports.schedule", label: "Agendar relatórios recorrentes" },
      { key: "closings.read", label: "Ver fechamentos diários e a conciliação das lojas do escopo" },
      { key: "closings.manage", label: "Fechar o dia da loja e conciliar os pagamentos integrados" },
      { key: "expenses.read", label: "Ver despesas das lojas do escopo" },
      { key: "expenses.manage", label: "Lançar, pagar e cancelar despesas e manter as categorias" },
      { key: "commissions.read", label: "Ver regras, estimativas e apurações de comissão das lojas do escopo" },
      { key: "commissions.manage", label: "Criar regras de comissão e calcular ou cancelar apurações" },
      { key: "commissions.approve", label: "Aprovar apurações de comissão calculadas por outra pessoa" },
      { key: "commissions.pay", label: "Registrar o pagamento de comissões aprovadas" },
      { key: "queue.read", label: "Ver a fila de atendimento das lojas do escopo" },
      { key: "queue.operate", label: "Registrar chegadas, chamar pelo rodízio e encerrar atendimentos" },
      { key: "queue.assign_manual", label: "Atribuir atendimento manualmente, com motivo" },
      { key: "queue.devices.manage", label: "Parear e revogar tablets da fila e limpar PINs de fila de nível inferior" },
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
