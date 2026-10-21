# Contrato do módulo `m07-pagamentos` — v1

> Escrito pelo Arquiteto (Opus) em 22/10/2026. O agente implementa o que está aqui e nada além.
> Se algo estiver ambíguo, o agente PERGUNTA (ver seção 10); não presume.
> Risco: **SENSÍVEL** (terceiros, webhook, segredos, dinheiro). Nível: **A** (Opus).
> **Ordem de migração: 7ª da fila A** (ADR-010), depois da do m06a integrada.

## 1. Objetivo
Pagamentos por **provedor** (PIX e cartão integrado) no PDV, por uma **porta** (`PaymentProvider`) com adaptadores, sem nenhum provedor real ligado nesta entrega (ADR-005): intenção de pagamento, confirmação **só** por webhook autenticado ou consulta ao provedor, uso da intenção confirmada na finalização da venda (m06a) e estorno pelo provedor para o m08.

## 2. Fora de escopo
- Escolher, contratar ou configurar um provedor real (pendência do Lucas: credenciais, homologação). Sem credencial = método indisponível, com mensagem clara.
- Telas do PDV para PIX/cartão (entram no m06b v2 depois desta entrega), conciliação (m37a), boleto, parcelamento com juros, split.
- Guardar qualquer dado sensível de cartão (PAN, CVV, validade): proibido.

## 3. Allowlist de arquivos
```
src/db/schema/payments.ts
src/db/schema/index.ts
drizzle/**                                   (só esta migração + custom FORCE RLS + meta)
src/server/payments/port.ts                  (interface PaymentProvider e tipos)
src/server/payments/registry.ts              (resolve o adaptador configurado; nenhum por padrão)
src/server/payments/schemas.ts
src/server/payments/schemas.test.ts
src/server/payments/intents.ts               (criar, consultar, cancelar intenção)
src/server/payments/webhook.ts               (processar evento autenticado, idempotente)
src/server/sales/complete.ts                 (aceitar pagamentos pix/card_provider ligados a intenção confirmada)
src/server/sales/schemas.ts                  (método pix/card_provider com paymentIntentId)
src/server/sales/schemas.test.ts
src/app/api/pagamentos/webhook/[provider]/route.ts
src/lib/env-schema.ts                        (só variáveis opcionais PAYMENT_PROVIDER e PAYMENT_WEBHOOK_SECRET, sem valores)
src/server/authz/permissions.ts
src/server/audit/labels.ts
src/server/audit/service.ts
tests/integration/payments.test.ts
tests/support/fake-payment-provider.ts       (adaptador de TESTE, nunca registrado fora dos testes)
.env.example                                  (só os nomes das variáveis, comentados, sem valores)
docs/data-model.md
docs/security.md
docs/onboarding.md                            (como configurar um provedor quando houver)
```
Veredito esperado: `PASS+REVIEW` com a integração verde.

## 4. Interface pública
### 4.1 Porta (`port.ts`)
```ts
export type ProviderMethod = "pix" | "card_provider";
export type ProviderStatus = "pending" | "confirmed" | "failed" | "cancelled" | "refunded";
export interface CreateChargeInput { method: ProviderMethod; amountCents: number; reference: string; description: string; expiresInSeconds: number }
export interface ChargeResult { providerReference: string; status: ProviderStatus; pix?: { qrCode: string; copyPaste: string; expiresAt: Date } }
export interface PaymentProvider {
  readonly key: string;                                          // ex.: "mercado_pago" (só quando existir)
  createCharge(input: CreateChargeInput): Promise<ChargeResult>;
  getStatus(providerReference: string): Promise<{ status: ProviderStatus; amountCents: number }>;
  refund(providerReference: string, amountCents: number, idempotencyKey: string): Promise<{ status: "refunded" | "pending" | "failed"; refundReference: string }>;
  /** Verifies signature/authentication of a webhook; returns the normalized event or null when invalid. */
  verifyWebhook(headers: Headers, rawBody: string): Promise<{ eventId: string; providerReference: string; status: ProviderStatus; amountCents: number } | null>;
}
```
`registry.ts`: `getPaymentProvider(): PaymentProvider | null` — lê `PAYMENT_PROVIDER` do ambiente validado; **nenhum adaptador real existe nesta entrega**, então devolve `null`; em testes, `setPaymentProviderForTests(provider | null)` (exportado só para testes, com nome explícito) injeta o adaptador falso de `tests/support/`.

### 4.2 Intenções (`intents.ts`)
```ts
export async function createPaymentIntent(context, input: unknown): Promise<{ intentId; status; pix?: {...}; replayed: boolean }>;
// sales.create; loja no escopo e sessão de caixa própria aberta; { storeId, method, amountCents > 0, idempotencyKey: uuid }
// sem provedor → invalid("Pagamento por PIX/cartão integrado ainda não está configurado nesta empresa.")
// grava payment_intents (pending) ANTES de chamar o provedor; chama createCharge fora da transação; grava providerReference e o QR em seguida
export async function refreshPaymentIntent(context, intentId): Promise<{ status }>;   // consulta getStatus e aplica a transição (mesma regra do webhook)
export async function cancelPaymentIntent(context, intentId): Promise<void>;          // pendente → cancelled (não usada em venda)
```
### 4.3 Webhook (`webhook.ts` + `route.ts`)
- `POST /api/pagamentos/webhook/[provider]`: `provider` diferente do configurado → 404; corpo lido como texto (máx. 64 KB), `verifyWebhook` → inválido = 401 **sem** detalhes; válido → `applyProviderEvent` numa transação com `withScope` da empresa dona da intenção (encontrada por `providerReference`, consulta pela função de sistema descrita na 5), **idempotente por `eventId`** (`payment_events` com `UNIQUE (provider, event_id)`); responde 200 em evento repetido.
- Transições permitidas: `pending → confirmed | failed | cancelled`; `confirmed → refunded`; qualquer outra é registrada e ignorada. Valor do evento diferente do valor da intenção → intenção `failed` com motivo `amount_mismatch`, auditado.
- Nada de log do corpo; logar só `provider`, `eventId` e resultado.

### 4.4 Venda (m06a, alteração mínima)
`completeSaleSchema` aceita `{ method: "pix" | "card_provider", amountCents, paymentIntentId: uuid }`. `completeSale` trava cada intenção (`FOR UPDATE`): precisa ser da mesma loja e operador, `confirmed`, mesmo valor e ainda não usada (`sale_id` nulo); grava `sale_payments` com `status: "confirmed"` e `provider_reference`, e marca `payment_intents.sale_id`. Intenção pendente → `invalid("Aguardando a confirmação do pagamento.")`. Nenhum outro comportamento do m06a muda (os testes `sales*.test.ts` continuam verdes sem alteração).

### 4.5 Permissões e auditoria
Sem permissão nova (usa `sales.create`). Ações: `payment_intent.created`, `.confirmed`, `.failed`, `.cancelled`, `.refunded`; entidade `payment_intent` "Pagamento integrado".

## 5. Dados e esquemas (`src/db/schema/payments.ts`)
```
payment_intents
  id, organization_id, store_id, cash_session_id, operator_user_id, method (payment_method), amount_cents > 0,
  status (payment_status) DEFAULT 'pending', provider varchar(40), provider_reference varchar(120) NULL,
  pix_qr_code text NULL, pix_copy_paste text NULL, expires_at, failure_reason varchar(40) NULL,
  idempotency_key uuid, sale_id uuid NULL, timestamps
  UNIQUE (organization_id, id); UNIQUE (organization_id, idempotency_key); UNIQUE (provider, provider_reference)
  FKs compostas: stores, cash_sessions, sales; tenantIsolationPolicy()
payment_events            (somente inserção e leitura)
  id, organization_id, intent_id, provider, event_id varchar(120), status, amount_cents, received_at DEFAULT clock_timestamp()
  UNIQUE (provider, event_id); FK composta payment_intents
```
O webhook chega **sem** sessão de usuário: a descoberta da empresa pela `provider_reference` usa uma função SQL `SECURITY DEFINER` mínima (`payment_intent_owner(provider, reference) returns uuid`), criada na migration custom, que devolve só o `organization_id`; todo o resto roda com `withScope({ organizationId })`. Custom: FORCE RLS nas duas tabelas + a função + `REVOKE ALL ... FROM PUBLIC` e `GRANT EXECUTE` só ao papel da aplicação.

## 6. Invariantes
- Pagamento externo só vira `confirmed` por webhook autenticado ou por `getStatus` do provedor — nunca pelo cliente.
- Uma intenção paga no máximo uma venda; venda só usa intenção confirmada da mesma loja/operador e do mesmo valor.
- Sem segredo no código ou no repositório; `PAYMENT_WEBHOOK_SECRET` só por variável de ambiente; `.env.example` só com o nome.
- Sem retry automático de cobrança; retentativa de criação usa a mesma `idempotencyKey`.

## 7. Erros e casos de borda
| Situação | Comportamento esperado |
|----------|------------------------|
| Sem provedor configurado | Método indisponível com mensagem; nenhuma linha gravada |
| Webhook com assinatura inválida, provedor errado ou corpo > 64 KB | 401 / 404 / 413, sem gravar |
| Evento repetido | 200, sem efeito |
| Valor do evento ≠ intenção | `failed` (`amount_mismatch`), auditado |
| Intenção já usada por outra venda; de outro operador; pendente | `invalid` |
| Provedor fora do ar ao criar | Intenção `failed` (`provider_unavailable`), mensagem genérica ao operador |

## 8. Segurança
Assinatura do webhook verificada antes de qualquer leitura de dados; função `SECURITY DEFINER` mínima e sem parâmetros livres de tabela; RLS forçado; nada de cartão armazenado; corpo do webhook fora de log; limites de tamanho.

## 9. Critérios de aceite
- [ ] Unitários (`schemas.test.ts` de pagamentos e de vendas): método e valores; `paymentIntentId` obrigatório para pix/card_provider.
- [ ] Integração (`payments.test.ts`, com o adaptador falso de `tests/support/`): criar intenção (sem provedor → erro e nada gravado; com provedor → pending com QR); confirmar por webhook válido; webhook inválido não muda nada; evento repetido sem efeito; valor divergente → failed; `refreshPaymentIntent` confirma por consulta; venda com intenção confirmada (soma com dinheiro) grava `sale_payments` com `provider_reference` e marca a intenção; mesma intenção em segunda venda → erro; intenção pendente → erro; isolamento entre empresas e por `withScope`; `sales.test.ts` e `sales-suspend.test.ts` verdes sem alteração.
- [ ] `lint`, `typecheck`, `lint:rules`, `test`, `build`; integração verde no gate; `db:generate` sem pendências.
- [ ] `docs/security.md` (webhook, função `SECURITY DEFINER`), `docs/data-model.md`, `docs/onboarding.md` (passo a passo para quando houver provedor) atualizados.

## 10. Política de dúvida
Dúvidas ao Maestro, em lote, com proposta. Sem `git add`, sem commit, sem branch.

## 11. Dependências
Nenhuma nova (webhook com `crypto` do Node para HMAC no adaptador de teste).

## 12. Comandos de verificação
Os do m06a, com `-Module m07-pagamentos` e a allowlist da seção 3.
