# Contrato do módulo `m10a-vendedores` — v1

> Escrito pelo Arquiteto (Opus) em 22/10/2026. Risco: **SENSÍVEL** (tabela com RLS, migração, dados de pessoas). Nível: **A** (Opus).
> **Ordem de migração:** depois do m32a (usa o calendário). Se algo estiver ambíguo, o agente PERGUNTA.

## 1. Objetivo
Cadastro de **vendedores** como vínculo de um membro da empresa com uma ou mais lojas (sem cadastro de pessoa duplicado: o vendedor **é** o usuário do membro), com código curto para o PDV e a fila, e a **escala** por período (dias trabalhados na loja), calculada com o m01 e o calendário do m32a.

## 2. Allowlist
```
src/db/schema/salespeople.ts
src/db/schema/index.ts
drizzle/**
src/server/salespeople/schemas.ts
src/server/salespeople/schemas.test.ts
src/server/salespeople/service.ts
src/server/salespeople/schedules.ts
src/server/sales/checks.ts                   (assertSalesperson passa a exigir vendedor ativo da loja, quando o cadastro existir)
src/server/authz/permissions.ts
src/server/authz/system-roles.ts
src/server/audit/labels.ts
src/server/audit/service.ts
tests/integration/salespeople.test.ts
tests/integration/sales.test.ts              (só se a regra nova do vendedor exigir ajuste de fixture)
docs/data-model.md
docs/security.md
```

## 3. Dados
- `salespeople`: empresa, membro (`membership_id`, FK composta, único por empresa), código (`code` 1..10, único por empresa, maiúsculas), apelido para tela (2..40), ativo/inativo. Sem dados pessoais novos (nome e e-mail vêm do usuário).
- `salesperson_stores`: vendedor × loja (FK compostas), PK `(organization_id, salesperson_id, store_id)`.
- `work_schedules`: vendedor, loja, mês (`YYYY-MM`), dias de folga (`date[]` até 31), ou "segue a semana da loja"; `UNIQUE (organization_id, salesperson_id, store_id, month)`.
Todas com FORCE RLS.

## 4. Interface
```ts
export async function listSalespeople(context, filters);         // members.read; escopo de lojas
export async function saveSalesperson(context, input);           // salespeople.manage; o membro precisa ter a loja no escopo dele e o gestor só gerencia nível inferior (regra de hierarquia existente)
export async function setSalespersonActive(context, id, active);
export async function setSchedule(context, input);               // salespeople.manage; folgas validadas com isValidCalendarDay e dentro do mês
/** Days the salesperson works in the store in [from, to]: business days of the store (m01 + m32a) minus days off. For goals (m11a). */
export async function workingDays(tx, organizationId, salespersonId, storeId, from, to): Promise<number>;
```
- Permissões novas: `salespeople.manage` (Gerente, Coordenador; Dono/Admin). Leitura por `members.read`.
- PDV (m06a): `assertSalesperson` passa a aceitar só vendedor **ativo** vinculado à loja quando a empresa tiver vendedores cadastrados; sem cadastro, mantém a regra atual (membro ativo que alcança a loja).
- Auditoria: `salesperson.saved`, `salesperson.status_changed`, `work_schedule.set`; entidade `salesperson`.

## 5. Critérios de aceite
- [ ] Integração: cadastrar, vincular lojas, código único; membro sem a loja no escopo recusado; hierarquia respeitada; escala de um mês com folgas e feriado da loja → `workingDays` igual ao esperado; venda com vendedor inativo ou de outra loja recusada; isolamento.
- [ ] `lint`, `typecheck`, `lint:rules`, `test`, `build`; integração verde no gate; `sales*.test.ts` verdes.

## 6. Dependências
m01, m32a.
