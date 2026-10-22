# Contrato do módulo `m36a-despesas` — v1

> Arquiteto (Opus), 22/10/2026. Risco **SENSÍVEL** (dinheiro, permissões financeiras). Nível **A**. Migração **18ª** (`0041`/`0042`).

## 1. Objetivo
Despesas das lojas por período e categoria, em centavos, com situação `open` → `paid` (data do pagamento) ou `cancelled` (motivo; nada é apagado), para o lucro do m16b.

## 2. Fora de escopo
Telas (m36b), rateio entre lojas, recorrência automática, contas a pagar com boleto/integração bancária.

## 3. Allowlist
`src/db/schema/expenses.ts`, `src/db/schema/index.ts`, `drizzle/**`, `src/server/expenses/schemas.ts`, `src/server/expenses/service.ts`, `src/server/authz/permissions.ts`, `src/server/authz/system-roles.ts`, `src/server/audit/labels.ts`, `src/server/audit/service.ts`, `tests/integration/expenses.test.ts`, `docs/data-model.md`, `docs/security.md`, `docs/contracts/m36a-despesas.md`.

## 4. Interface (`src/server/expenses/service.ts`)
```ts
saveCategory(context, { name }, categoryId?); setCategoryActive(context, categoryId, active); listCategories(context)   // expenses.manage / expenses.read
createExpense(context, { storeId, categoryId, competenceDate, description, amountCents, dueDate? }): Promise<{ id }>     // expenses.manage
updateExpense(context, id, mesmos campos)          // só `open`
payExpense(context, id, { paidOn })                 // open -> paid
cancelExpense(context, id, { reason })              // open|paid -> cancelled
listExpenses(context, { from, to, storeId?, categoryId?, status?, page }): Page & { totalCents }   // expenses.read, competência no período
sumExpensesInTx(tx, organizationId, { from, to, storeIds? }): Promise<number>   // m16b: soma das não canceladas por competência
```

## 5. Dados
`expense_categories` (nome único por empresa, ativa). `expenses` (loja, categoria, competência `date`, descrição até 160, valor > 0, vencimento opcional, situação com `paid_on`/`cancelled_at`+motivo, criado por; check de coerência). FKs compostas, FORCE RLS.

## 6. Regras
- Permissões: `expenses.read` (Financeiro, Coordenador, Gerente de loja), `expenses.manage` (Financeiro); Dono/Admin todas. Loja no escopo; fora = não encontrado. Categoria inativa não recebe despesa nova.
- Auditoria: `expense.created|updated|paid|cancelled`, `expense_category.saved|status_changed`.

## 9. Critérios de aceite
Integração: total do período por competência ignora canceladas; editar só aberta; pagar e cancelar; categoria inativa recusada; gerente lê e não grava; escopo de lojas; isolamento.
