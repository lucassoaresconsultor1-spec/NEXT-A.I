# Contrato do módulo `m37a-conciliacao-fechamento` — v1

> Arquiteto (Opus), 22/10/2026. Risco **SENSÍVEL** (dinheiro, provedor externo). Nível **A**. Migração **19ª** (`0043`/`0044`).

## 1. Objetivo
**Fechamento diário por loja**: retrato (somente inserção, com versões) do dia local da loja com vendas, cancelamentos, devoluções, recebimentos por meio de pagamento e diferença de caixa; e **conciliação** dos pagamentos integrados (Pix/cartão pelo provedor do m07) com o estado e o valor que o provedor informa (`getStatus` da porta), listando as divergências. Sem provedor configurado a conciliação fica `not_configured` (pendente na tela, nada simulado).

## 2. Fora de escopo
Telas (m37b), extrato de recebíveis/taxas do adquirente (a porta do m07 não tem esse método; entra quando houver provedor real), conciliação de maquininha externa.

## 3. Allowlist
`src/db/schema/closings.ts`, `src/db/schema/index.ts`, `drizzle/**`, `src/server/closings/service.ts`, `src/server/authz/permissions.ts`, `src/server/authz/system-roles.ts`, `src/server/audit/labels.ts`, `src/server/audit/service.ts`, `tests/integration/closings.test.ts`, `docs/data-model.md`, `docs/security.md`, `docs/contracts/m37a-conciliacao-fechamento.md`.

## 4. Interface (`src/server/closings/service.ts`)
```ts
closeDay(context, { storeId, day }): Promise<{ id; version }>   // closings.manage
getClosing(context, storeId, day)                             // closings.read: versão mais recente + divergências
listClosings(context, { from, to, storeId?, page })           // closings.read
```

## 5. Dados
`daily_closings` (loja, dia, versão; vendas e total; cancelado; devolvido; recebido por meio `cash`/`card_external`/`pix`/`card_provider`; diferença dos caixas fechados no dia; situação da conciliação `not_configured`/`no_payments`/`reconciled`/`divergent` e contagens; quem/quando). `reconciliation_divergences` (fechamento, intenção, referência, tipo `status_mismatch`/`amount_mismatch`/`unreachable`, nosso e do provedor). Somente inserção, FORCE RLS.

## 6. Regras
- Dia local da loja (fuso da loja ou da empresa); só dia passado ou o de hoje sem caixa aberto; recusa se houver sessão de caixa da loja aberta até o fim do dia.
- Totais em SQL, em centavos: vendas finalizadas no dia (as canceladas depois entram no total e no cancelado do dia do cancelamento); recebimentos = pagamentos das vendas finalizadas no dia; devolvido e cancelado pela data do registro; diferença = Σ das sessões fechadas no dia.
- Conciliação: para cada intenção do provedor ligada a venda do dia, consulta o provedor **fora da transação** e compara estado e valor; falha de consulta vira `unreachable`.
- Fechar de novo cria nova versão (o retrato anterior fica). Permissões: `closings.read` (Financeiro, Coordenador, Gerente de loja), `closings.manage` (Financeiro, Gerente de loja); loja no escopo. Auditoria `daily_closing.closed`.

## 9. Critérios de aceite
Integração: totais de um dia conhecido; caixa aberto impede; versão 2 depois de devolução; conciliação com provedor falso (casa, diverge em valor e em estado) e `not_configured` sem provedor; escopo e isolamento.
