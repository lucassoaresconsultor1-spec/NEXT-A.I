# Contrato do módulo `m16b-metricas-completas` — v1

> Arquiteto (Opus), 22/10/2026. Risco **SENSÍVEL** (dinheiro, custos). Nível **A**. Sem migração.

## 1. Objetivo
Completar `src/server/metrics/` (ADR-012) com **margem** (custo do snapshot da venda), **lucro** (só com despesas lançadas), **conversão** (fila) e **comissões**, das mesmas fontes do m16a, e provar que o mesmo número é igual em todos os canais.

## 3. Allowlist
`src/server/metrics/sales.ts` (colunas de margem no mesmo UNION), `src/server/metrics/complete.ts`, `src/server/queue/service.ts` (`queueCountsInTx`, usado também por `queueStats`), `tests/integration/metrics-complete.test.ts`, `docs/architecture.md`, `docs/contracts/m16b-metricas-completas.md`.

## 4. Interface
`fullSalesSummary(context, filters)` = métricas do m16a + `margin` (`costedRevenueCents`, `cogsCents`, `grossMarginCents`, `marginPercent`, `uncostedItems`; exige `catalog.costs.read`) + `profit` (`expensesCents`, `netProfitCents`, `complete`; exige custos e `expenses.read`, só com despesas no período e sem filtro de pessoa) + `conversion` (contagens da fila e percentual; sem filtro de pessoa) + `commissions` (`commissionsCents` das apurações não canceladas dos meses do período; exige `commissions.read`). Bloco sem permissão = `null`.

## 6. Regras
Receita com custo = parte de cada item no total líquido da venda (mesmo rateio do m08) dos itens com custo; custo = custo unitário do snapshot × quantidade, arredondado ao centavo; devoluções e cancelamentos estornam receita e custo pelos itens devolvidos, na data do registro. Itens sem custo ficam fora da margem e são contados. Comissões têm granularidade de mês.

## 9. Critérios de aceite
Integração com conjunto conhecido: margem 400 sobre 1.000 com estornos; lucro só depois da despesa; líquido igual no resumo, no resumo completo e na meta; conversão igual à da fila; blocos nulos sem permissão.
