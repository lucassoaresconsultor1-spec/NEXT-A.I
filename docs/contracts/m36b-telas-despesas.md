# Contrato das telas de despesas — m36b v1

> OpenCode (Executor), 22/10/2026. Risco **SENSÍVEL** (dinheiro, permissões financeiras). Nível **I** (telas sobre serviço já integrado). Migração: nenhuma (usa 0041/0042 do m36a).

## 1. Objetivo
Telas para consultar despesas por competência/loja/categoria/situação, criar e editar despesas em aberto, pagar e cancelar. Somente arquivos novos em `src/app/(app)/despesas/**`; não alterar m36a, banco, menu, shell, proxy ou next.config.ts.

## 2. Allowlist
SOMENTE arquivos novos em `src/app/(app)/despesas/**` (page.tsx, actions.ts, loading.tsx, error.tsx e pastas de detalhamento/novo se houver).

## 3. APIs reais (apenas estas)
```ts
// src/server/expenses/service.ts
listCategories(context)                                    // expenses.read
saveCategory(context, { name }, categoryId?)               // expenses.manage
setCategoryActive(context, categoryId, active)             // expenses.manage
createExpense(context, { storeId, categoryId, competenceDate, description, amountCents, dueDate? })  // expenses.manage
updateExpense(context, id, mesmo input)                    // expenses.manage, só open
payExpense(context, id, { paidOn })                        // expenses.manage, open -> paid
cancelExpense(context, id, { reason })                     // expenses.manage, open|paid -> cancelled
listExpenses(context, { from, to, storeId?, categoryId?, status?, page })  // expenses.read
```

Schemas reais: `categorySchema`, `expenseSchema`, `paySchema`, `cancelSchema`, `expenseFiltersSchema`; estados/rótulos `EXPENSE_STATUSES` e `EXPENSE_STATUS_LABELS`, de `src/server/expenses/schemas.ts`.

## 4. Interface e textos (pt-BR)
- Listagem: filtros de período (de/até por competência), loja, categoria e situação. Tabela com loja, categoria, data de competência, descrição, valor (centavos exibidos com `formatCurrencyCents`), situação, vencimento e pagamento. Total do período ignora canceladas.
- Nova despesa: loja, categoria ativa, data de competência, descrição, valor em reais (convertido com `parseBrlToCents`), vencimento opcional.
- Edição: só despesas em aberto; campos iguais à criação.
- Pagar: data do pagamento. Cancelar: motivo. Não oferecer exclusão nem rateio.
- Estados: vazio, carregando, erro, sem permissão (`AccessDenied`). Nenhum valor calculado no cliente.

## 5. Permissões e segurança
- `expenses.read`: listagem e detalhe. `expenses.manage`: criar, editar, pagar e cancelar categorias e despesas.
- Toda ação chama `requireTenantContext()` primeiro, usa `pick()` + schemas existentes, delega auditoria/escopo/transições ao serviço. Fora do escopo = não encontrado. Sem consulta direta ao banco.
