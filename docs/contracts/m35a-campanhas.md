# Contrato de campanhas de comissão — m35a v1

## Objetivo e escopo
Back-end de campanhas: período (dias locais da loja), produtos e/ou categorias, bônus em pontos-base somado à taxa da regra (m12a) nos itens elegíveis, entrando na estimativa e na apuração. Sem telas (m35b), sem pagamento.

## Decisões (registradas em `docs/DECISIONS.md`)
- Bônus é taxa adicional em pontos-base sobre a base do item (mesma base e arredondamento do m12a: `commissionOf(base, regra + bônus)`).
- Campanhas sobrepostas não se somam: vale o maior bônus; empate, a que começou antes, depois a de menor id.
- Sem retroatividade: início a partir de hoje (fuso da empresa); só meses encerrados são apurados, então apuração já feita não muda.
- Devolução e cancelamento estornam com o bônus do dia da venda original, como a taxa.
- Encerrar: antes do início, cancela; depois, o fim passa a ser hoje (vendas de hoje mantêm o bônus). Não há edição: muda-se encerrando e criando outra.

## Arquivos
`src/db/schema/campaigns.ts`, `src/db/schema/commissions.ts` (linhas: `campaign_id`, `bonus_rate_bps`), `src/db/schema/index.ts`, `drizzle/0060_*`, `drizzle/0061_force_rls_campaigns.sql`, `src/server/commissions/{campaigns,campaign-schemas,calculate}.ts`, `src/server/audit/labels.ts`, `tests/integration/campaigns.test.ts`, `src/server/commissions/campaign-schemas.test.ts`, `docs/data-model.md`, `docs/DECISIONS.md`.

## APIs
```ts
createCampaign(context, { name, storeId?, startsOn, endsOn, bonusRateBps, productIds[], categoryIds[] }): Promise<{ id }>
endCampaign(context, campaignId, { reason }): Promise<{ status: "cancelled" | "ended" }>
listCampaigns(context, { status?: "scheduled" | "active" | "ended", page? })
getCampaign(context, campaignId)
campaignBonus(campaigns, storeId, day, productId, categoryId) // puro
```

## Segurança e aceite
`commissions.manage` para criar/encerrar, `commissions.read` para ler; loja no escopo ou campanha da empresa só por quem tem acesso à empresa toda; fora do escopo = não encontrado. Auditoria `commission_campaign.created|cancelled|ended`. RLS forçada nas duas tabelas. Teste: bônus aplicado só no período/loja/item elegíveis, maior bônus vence, estorno com o bônus da venda, escopo e outra empresa.
