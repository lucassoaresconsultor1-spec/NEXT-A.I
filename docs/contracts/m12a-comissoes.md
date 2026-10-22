# Contrato do módulo `m12a-comissoes` — v1

> Escrito pelo Arquiteto (Opus) em 22/10/2026, a pedido do Maestro (revisão junto com a implementação no gate). Risco: **SENSÍVEL** (dinheiro, aprovação, migração). Nível: **A**. Ordem de migração: **15ª da fila A** (`0035`/`0036`).

## 1. Objetivo
Comissão de vendedores em centavos: **regras versionadas** (taxa padrão e por categoria, da empresa ou da loja, com vigência), **estimativa** sem gravar, e **apuração** por vendedor × loja × mês com máquina de estados `calculated → approved → paid` (ou `cancelled` para recalcular), auditada, com **estorno por devolução e cancelamento** (m08).

## 2. Fora de escopo
Telas (m12b, Codex), campanhas e bônus (m35a), pagamento real (só se registra a referência do pagamento feito fora), metas como gatilho de comissão.

## 3. Allowlist
```
src/db/schema/commissions.ts
src/db/schema/index.ts
drizzle/**
src/server/commissions/schemas.ts
src/server/commissions/schemas.test.ts
src/server/commissions/rules.ts
src/server/commissions/calculate.ts
src/server/commissions/statements.ts
src/server/authz/permissions.ts
src/server/authz/system-roles.ts
src/server/audit/labels.ts
src/server/audit/service.ts
tests/integration/commissions.test.ts
tests/integration/roles.test.ts            (só se a lista fixa de um perfil mudar)
docs/data-model.md
docs/security.md
docs/contracts/m12a-comissoes.md
```

## 4. Interface pública
```ts
// rules.ts
export async function createRule(context, input: { storeId?: string; effectiveFrom: CalendarDay; defaultRateBps: number; categoryRates?: { categoryId: string; rateBps: number }[]; reason?: string }): Promise<{ id: string; version: number }>;
export async function listRules(context, filters: { storeId?: string }): Promise<RuleVersion[]>;          // commissions.read
// calculate.ts
export async function estimateCommission(context, input: { salespersonId: string; storeId: string; month: string }): Promise<CommissionResult>; // commissions.read no escopo, ou o próprio vendedor
// statements.ts
export async function calculateStatement(context, input: { salespersonId; storeId; month }): Promise<{ id: string }>;   // commissions.manage
export async function approveStatement(context, statementId): Promise<void>;                                         // commissions.approve
export async function payStatement(context, statementId, input: { paymentReference: string }): Promise<void>;        // commissions.pay
export async function cancelStatement(context, statementId, input: { reason: string }): Promise<void>;               // commissions.manage
export async function listStatements(context, filters: { month; storeId?; status?; page }); export async function getStatement(context, id);
```
`CommissionResult = { baseCents; commissionCents; lines: { kind: "sale" | "refund"; saleId; saleItemId; refundId; baseCents; rateBps; commissionCents }[] }` (base e comissão com sinal).

## 5. Dados
- `commission_rules` (somente inserção): loja (NULL = empresa), versão por (empresa, loja), `effective_from` (data), `default_rate_bps` 0..10000, motivo obrigatório a partir da versão 2. `commission_rule_rates` (somente inserção): regra × categoria → `rate_bps`.
- `commission_statements`: vendedor, loja, mês, situação (`calculated`, `approved`, `paid`, `cancelled`), base e comissão (centavos, com sinal), quem/quando calculou, aprovou, pagou (com referência) e cancelou (com motivo). Índice único parcial: uma apuração não cancelada por (vendedor, loja, mês).
- `commission_statement_lines` (somente inserção): venda, item, devolução (quando estorno), tipo, base, taxa, comissão e regra aplicada.
FKs compostas, FORCE RLS.

## 6. Regras
- **Base por item** = valor líquido do item ajustado pelo desconto/acréscimo da venda (`effectiveLineCents` do m08); comissão = `floor(base × taxa ÷ 10000)`.
- **Taxa** = regra vigente na data local da venda (fuso da loja): a de maior `effective_from` ≤ data (empate: maior versão), da loja se existir, senão da empresa; taxa da categoria do produto se houver, senão a padrão. Sem regra vigente, taxa 0.
- **Linhas do mês M** (datas locais da loja): vendas do vendedor na loja finalizadas em M (inclusive as canceladas depois) e **estornos** (itens de cancelamento e devolução) registrados em M de vendas do vendedor, com base negativa e a **mesma taxa da venda original**. Cancelar no mesmo mês zera; devolver depois reduz o mês da devolução (inclusive de venda já paga).
- **Estados:** calcular só mês encerrado; recalcular uma apuração `calculated` substitui (a anterior vira `cancelled` na mesma transação); `approved` exige outro membro que não quem calculou (exceto o dono); `paid` é final; `cancelled` aceita de `calculated` ou `approved`.
- **Regra nova** só vale a partir do mês corrente (sem retroatividade); regra da empresa exige acesso a todas as lojas; de loja, a loja no escopo.
- Permissões: `commissions.read` (Financeiro, Coordenador, Gerente de loja), `commissions.manage` (Financeiro, Coordenador), `commissions.approve` e `commissions.pay` (Financeiro); Dono/Admin todas. O vendedor só estima a própria comissão.
- Auditoria: `commission_rule.created`, `commission_statement.calculated|approved|paid|cancelled`.

## 7. Casos de borda
| Situação | Comportamento |
|---|---|
| Mês corrente ou futuro na apuração | `invalid` |
| Apuração aprovada/paga existente ao recalcular | `invalid` (cancelar antes; paga não cancela) |
| Duas apurações simultâneas | uma vence; a outra `conflict` |
| Quem calculou tenta aprovar | `forbidden` |

## 8. Segurança
Escopo de lojas em todas as operações; fora do escopo = não encontrado; nada de dados pessoais em log; valores só do servidor.

## 9. Critérios de aceite
- [ ] Unitários: taxa vigente (loja × empresa × data × categoria), arredondamento.
- [ ] Integração: estimativa = apuração; taxa por categoria; regra nova não retroage; cancelamento no mês zera; devolução no mês seguinte vira estorno com a mesma taxa; máquina de estados (recalcular substitui, segregação calcular/aprovar, paga final); escopo; vendedor só a própria estimativa; isolamento.
- [ ] `lint`, `typecheck`, `lint:rules`, `test`, `build`; integração verde no gate.

## 11. Dependências
Nenhuma nova.
