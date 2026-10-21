# Contrato do módulo `m16a-metricas-vendas` — v1

> Escrito pelo Arquiteto (Opus) em 22/10/2026. Risco: **SENSÍVEL** (consultas sobre tenant, dinheiro). Nível: **A** (Opus). Sem migração (só leitura; índices novos só se a medição pedir, numa migração da fila A).
> Se algo estiver ambíguo, o agente PERGUNTA; não presume.

## 1. Objetivo
Criar `src/server/metrics/`, a **fonte única** dos números de vendas (ADR-012) que metas (m11a), app do vendedor (m34), dashboards (m17), relatórios (m18) e IA (m20/m21) vão usar: faturamento bruto e líquido, devoluções, quantidade de vendas, ticket médio e itens por venda, por período, loja, vendedor e operador, com **drill-down** para as vendas que compõem cada número.

## 2. Definições (fórmulas únicas, documentadas no código e em `docs/architecture.md`)
| Métrica | Fórmula | Origem |
|---|---|---|
| `grossRevenueCents` (faturamento bruto) | Σ `sales.subtotal_cents + surcharge_cents` das vendas `completed` e `cancelled` no período | `sales` |
| `discountCents` | Σ `sales.discount_cents` das mesmas vendas | `sales` |
| `cancelledCents` | Σ `total_cents` das vendas `cancelled` cujo cancelamento foi no período | `sale_refunds` (`cancellation`) |
| `returnedCents` | Σ `amount_cents` das devoluções (`return`) registradas no período | `sale_refunds` |
| `netRevenueCents` (faturamento líquido) | bruto − desconto − cancelado − devolvido | — |
| `saleCount` | nº de vendas `completed` no período (canceladas não contam) | `sales` |
| `averageTicketCents` | `netRevenueCents ÷ saleCount`, arredondado para baixo; 0 sem vendas | — |
| `itemsPerSale` | Σ quantidade (milésimos) das vendas `completed` ÷ `saleCount`, como string com 2 casas | `sale_items` |

Período: datas de calendário no **fuso da loja** (ou da empresa quando a loja não tem), pela `completed_at` da venda e pela `created_at` da devolução; intervalo `[from, to]` inclusive, até 366 dias por consulta.

## 3. Allowlist
```
src/server/metrics/definitions.ts            (fórmulas puras e tipos; sem banco)
src/server/metrics/definitions.test.ts
src/server/metrics/sales.ts                  (consultas agregadas e drill-down)
src/server/metrics/filters.ts                (schema de filtros: período, lojas, vendedor, operador, agrupamento)
tests/integration/metrics-sales.test.ts
docs/architecture.md                         (seção "Métricas": tabela da seção 2)
```

## 4. Interface
```ts
export async function salesSummary(context, filters): Promise<SalesMetrics & { period; storeIds: string[] }>;
export async function salesSeries(context, filters & { groupBy: "day" | "week" | "month" | "store" | "salesperson" | "operator" }): Promise<{ key: string; label: string; metrics: SalesMetrics }[]>;
export async function salesDrillDown(context, filters & { metric: keyof SalesMetrics; page }): Promise<Page<{ saleId; number; storeName; completedAt; totalCents; contributionCents }>>;
```
- Permissão: `sales.read` com escopo de lojas; sem `sales.read`, quem tem `sales.create` vê só as próprias vendas (mesma visibilidade do m06a). O vendedor (m34) usa uma variante com o próprio `salespersonUserId` fixado no servidor.
- Toda agregação em SQL (`sum`/`count` em centavos inteiros e milésimos), dentro de `withScope` com `organization_id` explícito; nenhum número calculado no cliente.
- Plano: `assertFeature(tx, orgId, "pos")`.

## 5. Critérios de aceite
- [ ] Unitários das fórmulas (`definitions.test.ts`): ticket com e sem vendas, arredondamento, itens por venda.
- [ ] Integração com **conjunto conhecido** (fixtures diretas): 3 lojas, 2 fusos, vendas, desconto, acréscimo, um cancelamento e duas devoluções; resumo, série por dia/loja/vendedor e drill-down batem com os valores esperados escritos no teste; a soma das contribuições do drill-down = a métrica; venda às 23h30 de São Paulo cai no dia certo; escopo parcial vê só as lojas dele; operador sem `sales.read` vê só as próprias; isolamento entre empresas.
- [ ] `lint`, `typecheck`, `lint:rules`, `test`, `build`; integração verde no gate.

## 6. Dependências
Nenhuma nova.
