# Contrato do app do vendedor — m34 v1

## Objetivo e escopo
Interface móvel responsiva, somente leitura, para desempenho, metas, estimativa de comissões e atendimentos do próprio vendedor. Arquivos novos em `src/app/(app)/meu-desempenho/**`; sem alterar serviços, menu, banco ou permissões. Não oferecer edição de metas, regras, fila, presença ou apuração.

## APIs reais
```ts
// src/server/metrics/sales.ts
salesSummary(context, rawFilters); salesSeries(context, rawFilters);
salesDrillDown(context, rawFilters);
// src/server/targets/service.ts e progress.ts
listTargets(context, filters); targetHistory(context, targetId);
targetProgress(context, filters);
// src/server/commissions/calculate.ts e statements.ts
estimateCommission(context, rawKey);
listStatements(context, rawFilters); getStatement(context, statementId);
// src/server/queue/service.ts
getQueue(context, storeId)
```
Usar filtros e schemas existentes (`metricsFiltersSchema`, `seriesSchema`, `drillDownSchema`, `targetFiltersSchema`, `statementKeySchema`, `statementFiltersSchema`). Não introduzir APIs ou cálculos paralelos.

## Comportamento e privacidade
- Métricas usam período e escopo autorizados pelo serviço; sem `sales.read`, serviços de métricas limitam vendas ao próprio membro. Metas e progresso vêm de `listTargets`/`targetProgress`. Comissão própria é estimativa sem gravação; não exibir apurações de terceiros.
- `getQueue(context, storeId)` retorna a fila aberta da loja e exige `queue.read`; filtrar no servidor pelo `salespersonId` associado ao membro antes de renderizar atendimentos próprios. Nunca enviar ao cliente dados de outros clientes ou vendedores. Se a pessoa não tiver `queue.read`, omitir a seção de atendimentos com estado sem acesso.
- Valores vêm dos serviços em centavos, formatados apenas na apresentação. Recurso de vendas indisponível no plano aparece como pendente/indisponível, sem dados de demonstração.

## Segurança e aceite
- Toda página chama `requireTenantContext()`; respeitar permissões e escopo definidos pelos serviços. Não aceitar identidade de vendedor fornecida pelo cliente: derivá-la do contexto autenticado e do vínculo carregado no servidor. Nenhuma Server Action mutável.
- Aceite: vendedor vê somente seus indicadores, metas, estimativa de comissão e atendimentos; navegação cabe em celular, com estados vazios/erro acessíveis; chamadas sem autorização não revelam dados de outra pessoa. Somente serviços listados, sem acesso direto ao banco.

## v2 (Opus, 22/10/2026): desvios verificados no código
- O papel Vendedor não tem `sales.read` nem `sales.create`: `salesSummary`/`salesSeries`/`salesDrillDown` o recusam, e sem `sales.read` a visibilidade filtra pelo operador do caixa, não pelo vendedor. Por isso entra `src/server/salespeople/self.ts`: `ownSalesperson(context)` (o vendedor sai só do usuário autenticado; lojas vinculadas dentro do acesso) e `ownSalesMetrics(context, período)` (`computeSalesMetrics` com `salespersonUserId` = eu e as lojas do meu acesso; exige o recurso `pos`). Teste: `tests/integration/salesperson-self.test.ts`.
- `listStatements`/`getStatement` exigem `commissions.read`: o vendedor vê só `estimateCommission` própria por loja vinculada, marcada como estimativa.
- Metas: `targetProgress` com `scope: "salesperson"`, filtrado no servidor pelo meu `salespersonId` (também para quem tem `sales.read`).
- Fila: `getQueue` por loja vinculada, filtrada no servidor pelos meus atendimentos e minha presença.
- Arquivos: `src/app/(app)/meu-desempenho/page.tsx`, `src/server/salespeople/self.ts`, o teste acima. Recurso fora do plano aparece como indisponível. Menu: `/meu-desempenho` sem permissão extra (a página mostra estado vazio a quem não é vendedor) — a cargo do Maestro.
