# Contrato do módulo `m08-cancelamentos` — v2

> Escrito pelo Arquiteto (Opus) em 22/10/2026. Risco: **SENSÍVEL** (dinheiro, estoque, autorização). Nível: **A** (Opus).
> **Ordem de migração: 9ª da fila A**, depois da do m09 integrada (usa o estorno do m07 e o estado fiscal do m09).
> Se algo estiver ambíguo, o agente PERGUNTA; não presume.

## 1. Objetivo
**Cancelamento** (venda inteira, no mesmo dia da sessão de caixa) e **devolução** (itens e quantidades, em qualquer dia, até 90 dias por padrão) com permissão específica, motivo, estorno do pagamento (dinheiro pelo caixa aberto; maquininha com registro manual do estorno e NSU; provedor pelo `refund` do m07), retorno ao estoque (opcional por item: produto bom volta, avariado vira perda) e auditoria.

## 2. Fora de escopo
Troca (devolução + nova venda é feita em duas operações), crédito em loja/vale-troca, cancelamento fiscal real (só aciona `cancel` da porta fiscal quando houver provedor), telas (entram no m06c v2 e no PDV).

## 3. Allowlist
```
src/db/schema/refunds.ts
src/db/schema/index.ts
drizzle/**
src/server/sales/cancel.ts
src/server/sales/refund.ts
src/server/sales/refund-schemas.ts
src/server/sales/refund-schemas.test.ts
src/server/sales/queries.ts                  (detalhe da venda passa a listar devoluções e saldo devolvível por item)
src/server/sales/suspend.ts                  (v2, backlog do m06a: suspensão idempotente e lista sem consulta por linha)
src/server/sales/schemas.ts                  (v2: suspensionKey no suspendSaleSchema)
src/db/schema/sales.ts                       (v2: coluna suspension_key)
tests/integration/sales-suspend.test.ts      (v2: casos novos de idempotência)
src/server/authz/permissions.ts
src/server/authz/system-roles.ts
src/server/authz/system-roles.test.ts
src/server/audit/labels.ts
src/server/audit/service.ts
tests/integration/refunds.test.ts
tests/integration/roles.test.ts
docs/data-model.md
docs/security.md
```

## 4. Interface
```ts
export async function cancelSale(context, saleId, input: unknown): Promise<{ refundId: string; replayed: boolean }>;
// sales.cancel; venda completed da loja no escopo; a sessão de caixa da venda ainda aberta (senão "Venda de caixa já fechado: use devolução.");
// { reason 3..240, idempotencyKey, restock: boolean (padrão true) }; devolve tudo; status da venda -> cancelled
export async function refundSale(context, saleId, input: unknown): Promise<{ refundId: string; replayed: boolean }>;
// sales.refund; { idempotencyKey, reason, items: [{ line, quantity > 0, restock: boolean }], refundMethod: "cash" | "card_external" | "provider", nsu? }
// quantidade ≤ vendido − já devolvido por linha; valor = proporcional ao total líquido da linha (arredondado para baixo, a última devolução da linha leva o resto);
// dinheiro: postCashMovementInTx(type "refund") na sessão aberta do operador (não da venda); card_external: exige NSU do estorno; provider: chama refund do m07 fora da transação e grava o estado
// prazo: refundWindowDays (90) — acima exige sales.refund.override
```
- Estoque: `restock` → `postLedgerEntry` `entry` ("Devolução da venda nº X"); sem `restock` → nada no livro (registrado como não reposto).
- Comissões (m12a) leem as devoluções para estornar; este módulo só registra.
- Permissões novas: `sales.cancel` ("Cancelar venda do caixa aberto"), `sales.refund` ("Registrar devolução de venda"), `sales.refund.override` ("Devolver fora do prazo"). Gerente: as três; Operador de caixa: `sales.cancel` só das próprias vendas (regra no serviço); Dono/Admin: todas.
- Auditoria: `sale.cancelled`, `sale.refunded`; entidade `sale_refund` "Devolução".

## 4.1 Backlog do m06a (v2)
- `sales.suspension_key uuid NULL` com `UNIQUE (organization_id, suspension_key)`; `suspendSaleSchema` exige `suspensionKey` (uuid); `suspendSale` com chave repetida devolve a mesma venda suspensa (sem reservar de novo), inclusive em corrida (violação de unicidade = releitura).
- `listSuspendedSales` passa a calcular `itemCount` e `estimatedTotalCents` numa consulta agregada só.
- Testes novos em `sales-suspend.test.ts`: mesma chave duas vezes (em sequência e em paralelo) = uma suspensa e uma reserva.

## 5. Dados (`refunds.ts`)
```
sale_refunds            (somente inserção e leitura)
  id, organization_id, sale_id, store_id, kind ('cancellation' | 'return'), reason, refund_method, nsu NULL,
  amount_cents > 0, idempotency_key UNIQUE por empresa, cash_session_id NULL, provider_status NULL, created_by, created_at
sale_refund_items       (somente inserção e leitura)
  id, organization_id, refund_id, sale_item_id, quantity > 0, amount_cents ≥ 0, restocked boolean, movement_id NULL
```
FKs compostas para vendas, itens, sessões e movimentos; FORCE RLS em migration custom.

## 6. Invariantes
Σ devolvido por linha ≤ quantidade vendida (verificado em transação com trava da venda); Σ valores devolvidos ≤ total da venda; idempotência por chave; caixa nunca negativo (o m05a recusa devolução em dinheiro acima do esperado — mensagem clara para usar outro meio).

## 7. Critérios de aceite
- [ ] Integração (`refunds.test.ts`): cancelamento com caixa aberto devolve estoque e dinheiro e marca a venda `cancelled`; cancelamento com caixa fechado é recusado; devolução parcial em duas etapas até zerar a linha; terceira devolução acima do saldo recusada; arredondamento (última leva o resto, soma = total da linha); sem `restock` não mexe no livro; dinheiro acima do caixa recusado; NSU exigido no estorno de maquininha; fora do prazo exige override; mesma chave = mesmo estorno; concorrência de duas devoluções da mesma linha; operador só cancela as próprias vendas; escopo e isolamento.
- [ ] `lint`, `typecheck`, `lint:rules`, `test`, `build`; integração verde no gate; docs atualizados.

## 8. Dependências
Nenhuma nova.
