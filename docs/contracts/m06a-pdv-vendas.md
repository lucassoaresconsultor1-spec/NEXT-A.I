# Contrato do módulo `m06a-pdv-vendas` — v1

> Escrito pelo Arquiteto (Opus) em 22/10/2026. O agente implementa o que está aqui e nada além.
> Se algo estiver ambíguo, o agente PERGUNTA (ver seção 10); não presume.
> Risco: **SENSÍVEL** (dinheiro, estoque, idempotência, tabelas com RLS, migração, permissões novas). Nível: **A** (Opus).
> **Ordem de migração: 6ª da fila A** (ADR-010), depois da do m05a integrada.

## 1. Objetivo
Serviço de **vendas do PDV**: finalizar venda com itens, descontos e acréscimos autorizados, cliente conforme a regra da loja (m27), pagamentos locais (dinheiro com troco e cartão em maquininha externa com NSU), baixa de estoque, entrada no caixa e número sequencial por loja, tudo numa transação idempotente (ADR-013, ADR-014); suspender e retomar venda com reserva de estoque (ADR-015); dados do comprovante não fiscal.

## 2. Fora de escopo
- Telas (m06b PDV, m06c histórico). Pagamento por provedor (PIX/cartão integrado, m07), fiscal (m09), cancelamento e devolução (m08), vendedor com escala e comissão (m10a/m12a), fila (m13a).
- Preço por loja, promoções automáticas, combos, troca de produto.
- `nav.ts`/`shell.ts` (ADR-009).

## 3. Allowlist de arquivos
```
src/db/schema/sales.ts
src/db/schema/index.ts
drizzle/**                                  (só os arquivos desta migração + custom de FORCE RLS + meta)
src/server/sales/schemas.ts
src/server/sales/schemas.test.ts
src/server/sales/pricing.ts                 (cálculo puro de totais e do teto de desconto)
src/server/sales/pricing.test.ts
src/server/sales/complete.ts
src/server/sales/suspend.ts
src/server/sales/queries.ts
src/server/sales/receipt.ts
src/server/authz/permissions.ts
src/server/authz/system-roles.ts
src/server/authz/system-roles.test.ts
src/server/audit/labels.ts
src/server/audit/service.ts
tests/integration/sales.test.ts
tests/integration/sales-suspend.test.ts
tests/integration/roles.test.ts             (só se a lista esperada de algum perfil mudar)
tests/integration/fixtures.ts               (só acrescentar fixtures de preço e sessão de caixa)
docs/data-model.md
docs/security.md
```
Veredito esperado: `PASS+REVIEW` com a integração verde.

## 4. Interface pública
### 4.1 Permissões novas (grupo `sales`, rótulo "Vendas")
| Chave | Rótulo |
|-------|--------|
| `sales.create` | `Vender no PDV (finalizar e suspender vendas) com o próprio caixa aberto` |
| `sales.read` | `Ver as vendas das lojas do escopo` |
| `sales.discount` | `Dar desconto até o teto da loja` |
| `sales.discount.override` | `Dar desconto acima do teto da loja` |
| `sales.surcharge` | `Aplicar acréscimo na venda` |

Perfis: Dono/Administrador (todas); Gerente de loja: todas; Operador de caixa: `sales.create`, `sales.discount`; Supervisor, Coordenador e Financeiro: `sales.read`; Vendedor: nenhuma (vê as próprias vendas no m34). Sem `sales.read`, quem tem `sales.create` lista e lê **só as vendas que ele mesmo finalizou**. Plano: `assertFeature(tx, orgId, "pos")` em toda leitura e escrita.

### 4.2 Cálculo (`pricing.ts`, puro, sem banco)
```ts
export interface PricedLine { quantityMilli: bigint; unitPriceCents: number; discountCents: number }
/** Line gross = round_half_up(unit price × quantity); line net = gross − discount (≥ 0). */
export function lineTotals(line: PricedLine): { grossCents: number; netCents: number };
/** subtotal = Σ gross; discount = Σ line discounts + sale discount; total = subtotal − discount + surcharge (≥ 0). */
export function saleTotals(lines: PricedLine[], saleDiscountCents: number, surchargeCents: number): { subtotalCents: number; discountCents: number; surchargeCents: number; totalCents: number };
/** Discount in basis points of the subtotal, rounded up (so 10,001 % never passes a 10 % ceiling). */
export function discountBps(discountCents: number, subtotalCents: number): number;
/** Cash: change = tendered − amount (tendered ≥ amount). */
export function cashChange(amountCents: number, tenderedCents: number): number;
```
Tudo em inteiros (`bigint` no produto preço × quantidade em milésimos).

### 4.3 Validação (`schemas.ts`, puro)
```ts
export const PAYMENT_METHODS = ["cash", "card_external", "pix", "card_provider"] as const;  // m06a aceita só cash e card_external
export const PAYMENT_METHOD_LABELS;  // Dinheiro, Cartão (maquininha), PIX, Cartão
export const MAX_SALE_ITEMS = 300;
export const completeSaleSchema;
// {
//   completionKey: uuid,                            // gerada pelo cliente ao abrir a finalização (ADR-013)
//   storeId: uuid,
//   suspendedSaleId?: uuid,                         // quando retoma uma venda suspensa
//   customerId?: uuid | "",
//   salespersonUserId?: uuid | "",                  // membro ativo da empresa com a loja no escopo
//   items: [{ variantId: uuid, quantity: string|number (> 0), expectedUnitPriceCents: int ≥ 0, discountCents?: int ≥ 0 }] 1..300,
//   saleDiscountCents?: int ≥ 0, surchargeCents?: int ≥ 0,
//   payments: [{ method: "cash", amountCents: int > 0, tenderedCents: int ≥ amount }
//            | { method: "card_external", amountCents: int > 0, nsu: string 4..20 [A-Za-z0-9], brand?: ≤ 30 }] 1..10,
//   notes?: ≤ 500
// }
export const suspendSaleSchema;      // { storeId, customerId?, salespersonUserId?, items (mesmo formato, sem desconto de venda), note?: ≤ 240 }
export const discardSchema;          // { reason: 3..240 }
export const saleFiltersSchema;      // { storeId?, status?, number?, from?, to? (dias), operatorUserId?, customerId?, page }
```
Variação repetida → erro em `items.{i}.variantId`. Erros de linha usam `items.{i}.campo`; de pagamento, `payments.{i}.campo`.

### 4.4 Finalização (`complete.ts`)
```ts
export async function completeSale(context: TenantContext, input: unknown): Promise<{ saleId: string; number: number; totalCents: number; changeCents: number; replayed: boolean }>;
export async function findSaleByCompletionKey(context: TenantContext, completionKey: string): Promise<{ saleId: string; number: number } | null>;  // para o PDV confirmar uma finalização pendente
```
Em **uma** transação, nesta ordem:
1. `sales.create`; loja ativa no escopo; plano `pos`.
2. Idempotência: se já existe venda com essa `completionKey` na empresa, devolve a mesma (`replayed: true`) sem fazer nada — inclusive em corrida (único `UNIQUE (organization_id, completion_key)`; violação vira releitura numa transação nova e devolve `replayed`).
3. Sessão de caixa **aberta do próprio operador** nesta loja (`findOpenSessionForOperator` de `@/server/cash/session-queries`, m05a); sem sessão → `invalid("Abra o caixa antes de vender.")`.
4. Regras da loja (`loadEffectiveSettings`, m27): `required` sem cliente → erro em `customerId`; cliente informado precisa estar ativo (`loadActiveCustomer`, m28a) senão erro em `customerId`.
5. Preço: para cada item, preço vigente no servidor; sem preço → erro no item (`Produto sem preço de venda.`); `expectedUnitPriceCents` diferente do vigente → `conflict("O preço de um ou mais itens mudou. Revise a venda.", { "items.{i}.expectedUnitPriceCents": [novo preço] })`. Produto ou variação inativa → erro no item.
6. Desconto e acréscimo: qualquer desconto exige `sales.discount`; `discountBps(desconto total, subtotal)` acima de `maxDiscountBps` da loja exige `sales.discount.override` (`forbidden("Desconto acima do teto da loja ({teto}). Peça a um gerente.")`); desconto de linha maior que o bruto da linha → erro; acréscimo exige `sales.surcharge`.
7. Pagamentos: soma = total exato (senão `invalid` em `payments`); em dinheiro, `tenderedCents ≥ amountCents`; troco total = soma dos trocos.
8. Se `suspendedSaleId`: a venda suspensa precisa ser desta loja, estar `suspended` e ter os mesmos itens e quantidades (senão `invalid("A venda suspensa foi alterada; retome-a de novo.")`); as reservas dela são **consumidas** (`consumeReservation`) antes da baixa. A venda suspensa vira a própria venda finalizada (mesmo id, status `completed`).
9. Número: `nextDocumentNumber(tx, orgId, "sale:" + storeId)`.
10. Estoque: `postLedgerEntry` tipo `exit` por item, em ordem crescente de `variantId`, motivo `Venda nº {número}`; saldo disponível insuficiente → erro no item (venda inteira desfeita).
11. Caixa: `postCashMovementInTx` de `@/server/cash/ledger` com `{ type: "sale", amountCents: soma do dinheiro aplicado, reference: { kind: "sale", id } }` quando houver dinheiro. Como `findOpenSessionForOperator` abre a própria transação, a finalização relê a sessão dentro da transação da venda: `postCashMovementInTx` trava a sessão e recusa se ela foi fechada no meio.
12. Grava `sales` (com snapshot do cabeçalho/rodapé do comprovante da loja), `sale_items` (com snapshot de nome, SKU, unidade, preço e **custo vigente** — ADR-016 —, desconto, total e o id do movimento de saída), `sale_payments` (`status = "confirmed"`), e audita `sale.completed`.

### 4.5 Suspensão (`suspend.ts`)
```ts
export async function suspendSale(context, input: unknown): Promise<{ saleId: string }>;        // sales.create; reserva cada item (reserveStock source "sale"); status suspended, sem número
export async function listSuspendedSales(context, storeId: string): Promise<{ id; createdAt; operatorName; customerName: string | null; itemCount; estimatedTotalCents; note }[]>; // sales.create na loja do escopo
export async function getSuspendedSale(context, saleId: string): Promise<null | { id; storeId; customerId; salespersonUserId; items: { variantId; quantity: string; productName; variantName; sku; unit; currentUnitPriceCents: number | null }[]; note }>;
export async function discardSuspendedSale(context, saleId: string, input: unknown): Promise<void>; // sales.create; libera as reservas; status discarded com motivo; audita
```
Qualquer operador da loja com `sales.create` pode retomar ou descartar uma venda suspensa da loja (passagem de turno). Sem expiração automática nesta versão (pendência registrada: limpeza de suspensas antigas).

### 4.6 Consulta e comprovante (`queries.ts`, `receipt.ts`)
```ts
export async function listSales(context, filters: unknown): Promise<Page<{ id; number: number | null; status; storeId; storeName; completedAt: Date | null; totalCents; itemCount; operatorName; customerName: string | null; paymentMethods: string[] }>>;
export async function getSale(context, saleId: string): Promise<null | SaleDetail>;   // itens, pagamentos (NSU só os 4 últimos), totais, cliente (nome; CPF mascarado sem customers.documents.read), operador, vendedor; custo dos itens só com catalog.costs.read
export async function getReceipt(context, saleId: string): Promise<null | ReceiptData>; // venda completed: loja (nome, CNPJ formatado, endereço se houver), número, data/hora no fuso da loja/empresa, itens, totais, pagamentos, troco, cabeçalho e rodapé do snapshot, a frase fixa "Documento sem valor fiscal"
```
Escopo: `sales.read` → lojas do escopo; só `sales.create` → apenas as próprias. Fora = null.

### 4.7 Auditoria
Ações: `sale.completed` "Venda finalizada", `sale.suspended` "Venda suspensa", `sale.discarded` "Venda suspensa descartada". Entidade `sale` "Venda". `changes` com número, total, desconto, acréscimo, quantidade de itens, métodos de pagamento e ids; sem dados pessoais do cliente (só o id).

## 5. Dados e esquemas (`src/db/schema/sales.ts`)
```
enum sale_status (suspended, completed, discarded, cancelled)        -- cancelled é usado pelo m08
enum payment_method (cash, card_external, pix, card_provider)        -- pix/card_provider pelo m07
enum payment_status (pending, confirmed, failed, cancelled, refunded) -- m06a grava só confirmed

sales
  id, organization_id, store_id, number integer NULL (só completed), status, completion_key uuid NULL,
  cash_session_id uuid NULL, operator_user_id uuid NOT NULL, salesperson_user_id uuid NULL, customer_id uuid NULL,
  subtotal_cents, discount_cents, surcharge_cents, total_cents bigint NOT NULL DEFAULT 0 (≥ 0), change_cents bigint DEFAULT 0,
  receipt_header varchar(240), receipt_footer varchar(240), note varchar(500),
  suspended_at, completed_at, discarded_at, discard_reason varchar(240), timestamps
  UNIQUE (organization_id, id); UNIQUE (organization_id, completion_key); UNIQUE (organization_id, store_id, number)
  FKs compostas: stores, cash_sessions, customers; users simples (operador, vendedor)
  CHECK: completed ⇔ number, completion_key, completed_at e cash_session_id não nulos; total = subtotal − discount + surcharge
  INDEX (organization_id, store_id, completed_at), (organization_id, operator_user_id, completed_at)
  tenantIsolationPolicy()   (UPDATE necessário para suspensa → completed/discarded)

sale_items
  id, organization_id, sale_id, line smallint, variant_id, product_name varchar(120), variant_name varchar(80), sku varchar(40), unit,
  quantity numeric(14,3) > 0, unit_price_cents bigint ≥ 0, unit_cost_cents bigint NULL, discount_cents bigint ≥ 0, total_cents bigint ≥ 0,
  reservation_id uuid NULL, movement_id uuid NULL
  UNIQUE (organization_id, id); UNIQUE (sale_id, line); FKs compostas (sem cascata): sales, product_variants, inventory_reservations, inventory_movements
  tenantIsolationPolicy()   (UPDATE só para gravar movement_id quando a suspensa é finalizada; itens de suspensa não são substituídos)

sale_payments              (appendOnlyTenantPolicies(); o m07 acrescenta política de UPDATE só do status)
  id, organization_id, sale_id, method, status, amount_cents > 0, tendered_cents NULL, change_cents NULL, nsu varchar(20) NULL, brand varchar(30) NULL,
  provider_reference varchar(120) NULL, created_by, created_at DEFAULT clock_timestamp()
  CHECK cash ⇒ tendered ≥ amount e change = tendered − amount; card_external ⇒ nsu não nulo
```
Custom: `FORCE ROW LEVEL SECURITY` nas três tabelas.

## 6. Invariantes
- Preço, custo, totais, troco, número e saldo calculados só no servidor; o cliente só envia intenção (itens, quantidades, descontos pedidos, pagamentos).
- Uma `completionKey` = no máximo uma venda; retentativa devolve a mesma, sem baixar estoque nem lançar caixa de novo; sem retry automático no servidor.
- Venda finalizada não muda (só o m08 a cancela, com estorno); suspensa não muda (retomar = finalizar ou descartar).
- `Σ sale_items.total_cents − discount de venda + surcharge = total_cents`; `Σ pagamentos = total_cents` (teste de integração).
- `withScope` + `organization_id` explícito + escopo de loja; operador sem `sales.read` só vê as próprias vendas.

## 7. Erros e casos de borda
| Situação | Comportamento esperado |
|----------|------------------------|
| Sem caixa aberto do operador na loja | `invalid("Abra o caixa antes de vender.")` |
| Mesma `completionKey` reenviada (sequencial ou simultânea) | Mesma venda, `replayed: true`; um só número, uma só baixa, um só lançamento de caixa |
| Preço mudou desde que o item entrou no carrinho | `conflict` com o preço novo por item |
| Desconto acima do teto sem `sales.discount.override` | `forbidden` com o teto |
| Soma de pagamentos ≠ total; dinheiro recebido < valor | Erro em `payments` |
| Estoque disponível insuficiente (inclusive reservado por outra suspensa) | Erro no item; nada gravado |
| Cliente obrigatório ausente; cliente inativo ou de outra empresa | Erro em `customerId` |
| Retomar suspensa de outra loja, já finalizada ou descartada | "Venda não encontrada." / `invalid` |
| Plano sem `pos` | `limitReached` |

## 8. Segurança
Permissões e escopo no serviço; autorização de desconto pelo teto do m27; idempotência por chave; atomicidade entre venda, estoque e caixa; RLS forçado; dados do cliente fora da auditoria; NSU mostrado só com os 4 últimos dígitos fora da tela de detalhe do gerente.

## 9. Critérios de aceite
### 9.1 Unitários (`pricing.test.ts`, `schemas.test.ts`)
- [ ] `lineTotals`: 3 × R$ 12,90 = 3870; 0,355 kg × R$ 49,90/kg = 1771 (arredondamento meio para cima de 1771,45); desconto de linha maior que o bruto recusado pelo schema/serviço.
- [ ] `saleTotals` e `discountBps`: subtotal 10 000, descontos 1 001 → 1001 bps (arredonda para cima); acréscimo somado; total nunca negativo.
- [ ] `cashChange`: 5 000 recebidos para 3 870 → 1 130.
- [ ] Schemas: variação repetida, quantidade 0, NSU com 3 caracteres, método `pix` (recusado no m06a), 11 pagamentos, 301 itens → recusados no caminho certo.

### 9.2 Integração (`sales.test.ts`, `sales-suspend.test.ts`)
- [ ] Venda com 2 itens, desconto dentro do teto, pagamento misto (dinheiro com troco + cartão com NSU): número 1 da loja; saldo baixado; livro com `exit` e motivo; caixa com movimento `sale` igual ao dinheiro aplicado (não ao recebido); `sale_items` com preço e custo do momento; auditoria; `Σ itens − desconto + acréscimo = total = Σ pagamentos`.
- [ ] Segunda venda na mesma loja = número 2; venda em outra loja = número 1 daquela loja.
- [ ] Idempotência: mesma chave duas vezes em sequência → `replayed`; duas em paralelo → uma venda, uma baixa, um lançamento de caixa.
- [ ] Concorrência de estoque: duas vendas simultâneas que juntas passam do disponível → uma conclui, a outra falha no item.
- [ ] Preço alterado entre carrinho e finalização → `conflict` com o preço novo.
- [ ] Desconto acima do teto: operador → `forbidden`; gerente (`override`) → ok. Acréscimo sem `sales.surcharge` → `forbidden`.
- [ ] Sem caixa aberto → erro; caixa de outro operador não serve.
- [ ] Cliente obrigatório na loja (m27) → erro sem cliente; cliente inativo → erro.
- [ ] Suspensão: reserva os itens (disponível cai); retomar e finalizar consome as reservas e baixa o estoque uma vez; descartar libera; outra suspensa não deixa vender o que está reservado.
- [ ] `getReceipt`: dados do snapshot, "Documento sem valor fiscal", data no fuso; `getSale` com CPF mascarado para operador sem permissão de documento e custo só com `catalog.costs.read`.
- [ ] Escopo: operador só vê as próprias vendas; gerente vê as da loja; outra loja/empresa = null; RLS por `withScope` direto nas três tabelas.
- [ ] Plano sem `pos` → `limit`.

### 9.3 Gerais
- [ ] `lint`, `typecheck`, `lint:rules`, `test`, `build`; integração verde no gate; `db:generate` sem pendências; arquivos ≤ 350 linhas.
- [ ] Gate `PASS+REVIEW`; revisão do Maestro (dinheiro, idempotência, corrida, autorização de desconto).
- [ ] `docs/data-model.md` e `docs/security.md` atualizados.

## 10. Política de dúvida
Dúvidas ao Maestro, em lote, com proposta. PLANO antes de editar e `DEC-xxx` antes de começar. Sem `git add`, sem commit, sem branch.

## 11. Dependências
Nenhuma nova. Reaproveita: `nextDocumentNumber` (m29a), `postLedgerEntry` (m29a), `reserveStock`/`releaseReservation`/`consumeReservation` (m30a), `findOpenSessionForOperator` (`@/server/cash/session-queries`) e `postCashMovementInTx` (`@/server/cash/ledger`) do m05a, `loadEffectiveSettings` (m27), `loadActiveCustomer` (m28a), `currentPriceCents`/`currentCostCents` (catálogo).

## 12. Comandos de verificação
```
lint/typecheck/rules/test/build: corepack pnpm lint | typecheck | lint:rules | test | build
schema:      corepack pnpm db:generate   (de novo depois: "No schema changes")
integração:  pwsh -NoProfile -File tools/gate/with-test-db.ps1 corepack pnpm test:integration
gate:        pwsh -NoProfile -Command "& tools/gate/gate.ps1 -Module m06a-pdv-vendas -Allowed @('src/db/schema/sales.ts','src/db/schema/index.ts','drizzle/**','src/server/sales/**','src/server/authz/permissions.ts','src/server/authz/system-roles.ts','src/server/authz/system-roles.test.ts','src/server/audit/labels.ts','src/server/audit/service.ts','tests/integration/sales.test.ts','tests/integration/sales-suspend.test.ts','tests/integration/roles.test.ts','tests/integration/fixtures.ts','docs/data-model.md','docs/security.md')"
```
