# Contrato do módulo `m29a-compras` — v1

> Escrito pelo Arquiteto (Opus) em 21/10/2026. O agente implementa o que está aqui e nada além.
> Se algo estiver ambíguo, o agente PERGUNTA (ver seção 10); não presume.
> Risco: **SENSÍVEL** (estoque, custo, tabelas com RLS, migração, permissões novas). Nível: **A** (Opus).
> **Ordem de migração: 3ª da fila A** (ADR-010), depois das do m27 e do m28a integradas.

## 1. Objetivo
Pedidos de compra por loja e fornecedor e **recebimento contra pedido**: cada recebimento lança entradas no livro de estoque e grava o custo de reposição (ADR-016) na mesma transação, de forma idempotente. Cria também dois utilitários que os módulos seguintes reaproveitam: contador de documentos por empresa (ADR-014) e busca de variações para formulários.

## 2. Fora de escopo
- Telas (m29b). Contas a pagar, notas fiscais de entrada, impostos, frete, devolução ao fornecedor.
- Custo médio (ADR-016). Recebimento sem pedido (continua sendo uma "entrada" manual do m04).
- `nav.ts`/`shell.ts` (ADR-009).

## 3. Allowlist de arquivos
```
src/db/schema/purchasing.ts
src/db/schema/counters.ts
src/db/schema/index.ts
drizzle/**                                   (só os arquivos desta migração + custom de FORCE RLS + meta)
src/server/counters.ts
src/server/purchasing/schemas.ts
src/server/purchasing/schemas.test.ts
src/server/purchasing/service.ts
src/server/purchasing/receiving.ts
src/server/inventory/ledger.ts               (novo: lançamento dentro de transação existente)
src/server/inventory/service.ts              (só para usar ledger.ts, sem mudar comportamento)
src/server/catalog/pricing.ts                (só extrair recordCostInTx, sem mudar comportamento)
src/server/catalog/variant-search.ts
src/server/authz/permissions.ts
src/server/authz/system-roles.ts
src/server/authz/system-roles.test.ts
src/server/audit/labels.ts
src/server/audit/service.ts
tests/integration/purchasing.test.ts
tests/integration/variant-search.test.ts
tests/integration/fixtures.ts                (só acrescentar createSupplierFixture se não existir)
docs/data-model.md
docs/security.md
```
Veredito esperado: `PASS+REVIEW` com a integração verde pelo gate (a suíte inteira, inclusive `inventory.test.ts` e `catalog.test.ts`, precisa continuar verde depois das extrações).

## 4. Interface pública
### 4.1 Contador de documentos (`src/server/counters.ts`)
```ts
/** Next number for (organization, scope) inside the caller's transaction; row locked FOR UPDATE until commit. Starts at 1. */
export async function nextDocumentNumber(tx: Tx, organizationId: string, scope: string): Promise<number>;
```
`scope` é uma string estável (`"purchase_order"`, e no m06a `"sale:{storeId}"`). Implementação: `INSERT … ON CONFLICT DO NOTHING` + `SELECT … FOR UPDATE` + `UPDATE last_value = last_value + 1 RETURNING`. Só documento gravado consome número (rollback devolve).

### 4.2 Lançamento no livro dentro de transação (`src/server/inventory/ledger.ts`)
```ts
export interface LedgerEntryInput { storeId: string; variantId: string; type: MovementType; quantityMilli: bigint; reason: string }
/** Same rules as recordMovement (store active and in scope, variant exists, entries need active product/variant, "un" whole, no negative balance), audited as inventory.movement_recorded. Caller owns the transaction. */
export async function postLedgerEntry(tx: Tx, context: TenantContext, input: LedgerEntryInput): Promise<{ id: string; quantity: string; balanceAfter: string }>;
```
`recordMovement` passa a: checar permissão e plano, validar a entrada e chamar `postLedgerEntry` dentro do seu `withScope`. Nenhum comportamento observável muda (a suíte `inventory.test.ts` prova).

### 4.3 Custo dentro de transação (`src/server/catalog/pricing.ts`)
```ts
/** Inserts a cost record when it differs from the current one (locks the variant). Audits product_variant.cost_changed with { costRecordId, source }. No permission check: the caller authorized its own operation. */
export async function recordCostInTx(tx: Tx, organizationId: string, actorUserId: string, variantId: string, cents: number, source: "manual" | "purchase_receipt"): Promise<{ changed: boolean }>;
```
`setVariantCost` passa a usá-la com `source: "manual"`; a auditoria ganha o campo `source`. `tests/integration/catalog.test.ts` não está na allowlist: se ele quebrar por causa do campo novo, pergunte ao Maestro antes de seguir.

### 4.4 Busca de variações (`src/server/catalog/variant-search.ts`)
```ts
export interface VariantHit {
  variantId: string; productId: string; productName: string; variantName: string;
  sku: string; barcode: string | null; unit: "un" | "kg" | "l" | "m";
  isActive: boolean;                 // produto e variação ativos
  costCents?: number | null;         // só com catalog.costs.read
}
/** Needs catalog.read. q (≥ 2 chars after trim): exact barcode (digits), exact SKU (uppercased) or product/variant name ilike. Up to 20 hits, active first, then by name. */
export async function searchVariants(context: TenantContext, q: string, options?: { activeOnly?: boolean }): Promise<VariantHit[]>;
```

### 4.5 Permissões novas (grupo `purchasing`, rótulo "Compras")
| Chave | Rótulo |
|-------|--------|
| `purchases.read` | `Ver pedidos de compra e recebimentos das lojas do escopo` |
| `purchases.manage` | `Criar e editar pedidos de compra (exige ver custos)` |
| `purchases.approve` | `Aprovar, cancelar e encerrar pedidos de compra` |
| `purchases.receive` | `Registrar recebimento de mercadorias` |

Perfis: Dono/Administrador (todas). Financeiro: `purchases.read`. Coordenador: `purchases.read`, `purchases.manage`, `purchases.approve`. Gerente de loja: `purchases.read`, `purchases.receive`. Demais: nenhuma.

### 4.6 Validação (`src/server/purchasing/schemas.ts`, puro)
```ts
export const PURCHASE_ORDER_STATUSES = ["draft", "approved", "partially_received", "received", "cancelled"] as const;
export const PURCHASE_ORDER_STATUS_LABELS: Record<PurchaseOrderStatus, string>;
// draft "Rascunho", approved "Aprovado", partially_received "Recebido em parte", received "Recebido", cancelled "Cancelado"
export const MAX_ORDER_ITEMS = 200;

export const purchaseOrderInputSchema;   // { storeId: uuid, supplierId: uuid, expectedDate?: "YYYY-MM-DD"|undefined, notes?: string ≤ 500, items: [{ variantId: uuid, quantity: string|number (parseQuantityInput, > 0), unitCostCents: int 0..MAX_CENTS }] (1..200, variantId sem repetição) } -> quantities em milésimos
export const receiptInputSchema;         // { idempotencyKey: uuid, notes?: ≤ 500, items: [{ orderItemId: uuid, quantity: > 0 }] (1..200, sem repetição) }
export const reasonSchema;               // requiredText("o motivo", 240, 3)
export const purchaseOrderFiltersSchema; // { status?, storeId?, supplierId?, number? (inteiro > 0), page }
```
Erros por campo usam o caminho `items.{i}.campo`.

### 4.7 Serviço (`src/server/purchasing/service.ts` e `receiving.ts`)
```ts
export async function listPurchaseOrders(context, filters): Promise<Page<{ id; number; status; storeId; storeName; supplierId; supplierName; expectedDate: string | null; itemCount: number; totalCents?: number; createdAt: Date }>>; // totalCents só com catalog.costs.read
export async function getPurchaseOrder(context, id): Promise<null | {
  id; number; status; store: { id; code; name }; supplier: { id; name }; expectedDate; notes;
  createdBy; approvedBy; approvedAt; cancelledAt; cancelReason; closedAt; closeReason;
  items: { id; variantId; productName; variantName; sku; unit; quantityOrdered: string; quantityReceived: string; quantityPending: string; unitCostCents?: number }[];
  receipts: { id; receivedAt: Date; receivedByName: string | null; notes: string | null; items: { orderItemId; quantity: string }[] }[];
  totalCents?: number;
}>;
export async function createPurchaseOrder(context, input: unknown): Promise<{ id: string; number: number }>;   // draft; purchases.manage + catalog.costs.read
export async function updatePurchaseOrder(context, id, input: unknown): Promise<void>;                        // só draft; substitui cabeçalho e itens
export async function approvePurchaseOrder(context, id): Promise<void>;                                       // draft -> approved; purchases.approve
export async function cancelPurchaseOrder(context, id, reason: unknown): Promise<void>;                        // draft|approved sem recebimento -> cancelled
export async function closePurchaseOrder(context, id, reason: unknown): Promise<void>;                         // partially_received -> received (pendências encerradas)
// receiving.ts
export async function receiveGoods(context, orderId, input: unknown): Promise<{ receiptId: string; replayed: boolean }>;
```
Regras:
- Escopo: o pedido pertence à loja de destino; membro com escopo parcial só vê/age em pedidos das suas lojas (fora = "Pedido de compra não encontrado.").
- Criar/editar exige fornecedor **ativo** da empresa, loja **ativa** no escopo e variações existentes da empresa (inativas recusadas no campo `items.{i}.variantId`).
- `receiveGoods` (`purchases.receive`, loja no escopo, plano com `inventory`): em **uma** transação — trava o pedido (`FOR UPDATE`), exige `approved` ou `partially_received`, trava os itens, recusa quantidade acima do pendente (`items.{i}.quantity`: `Quantidade acima do pendente ({pendente}).`), grava `goods_receipts` e `goods_receipt_items`, chama `postLedgerEntry` (tipo `entry`, motivo `Recebimento do pedido de compra nº {número}`) por item em ordem crescente de `variantId` (evita deadlock), chama `recordCostInTx(..., unitCostCents, "purchase_receipt")`, atualiza `quantity_received` e o status (`partially_received` ou `received`), audita.
- **Idempotência:** `UNIQUE (organization_id, idempotency_key)` em `goods_receipts`; se a chave já existe para o mesmo pedido, devolve `{ receiptId, replayed: true }` sem lançar nada; se existe para outro pedido → `conflict("Chave de recebimento já usada.")`.
- Unidade `un` aceita só inteiros (vem de `postLedgerEntry`).
- Números: `nextDocumentNumber(tx, orgId, "purchase_order")` na criação.

### 4.8 Auditoria
Ações: `purchase_order.created` "Pedido de compra criado", `purchase_order.updated` "Pedido de compra alterado", `purchase_order.approved` "Pedido de compra aprovado", `purchase_order.cancelled` "Pedido de compra cancelado", `purchase_order.closed` "Pedido de compra encerrado com pendências", `goods_receipt.recorded` "Recebimento de mercadorias registrado". Entidades `purchase_order` "Pedido de compra", `goods_receipt` "Recebimento de mercadorias". `storeId` sempre preenchido. Custos **não** entram em `changes` (mesma regra do catálogo): registrar quantidades, número, motivo e ids.

## 5. Dados e esquemas
```
document_counters (src/db/schema/counters.ts)
  organization_id uuid FK organizations ON DELETE CASCADE, scope varchar(64), last_value bigint NOT NULL DEFAULT 0 CHECK >= 0
  PK (organization_id, scope); tenantIsolationPolicy()

enum purchase_order_status (draft, approved, partially_received, received, cancelled)

purchase_orders
  id, organization_id, number integer NOT NULL, store_id, supplier_id, status, expected_date date NULL, notes varchar(500) NULL,
  created_by, approved_by, approved_at, cancelled_by, cancelled_at, cancel_reason varchar(240), closed_by, closed_at, close_reason varchar(240), timestamps
  UNIQUE (organization_id, id); UNIQUE (organization_id, number)
  FK (organization_id, store_id) -> stores; FK (organization_id, supplier_id) -> suppliers   (sem cascata)
  INDEX (organization_id, store_id, status)
  CHECK coerência: cancelled ⇔ cancelled_at não nulo; closed_at só com status received
  tenantIsolationPolicy()

purchase_order_items
  id, organization_id, order_id, variant_id, quantity_ordered numeric(14,3) CHECK > 0, quantity_received numeric(14,3) NOT NULL DEFAULT 0 CHECK >= 0 AND <= quantity_ordered,
  unit_cost_cents bigint CHECK >= 0, timestamps
  UNIQUE (organization_id, id); UNIQUE (order_id, variant_id)
  FK (organization_id, order_id) -> purchase_orders ON DELETE CASCADE; FK (organization_id, variant_id) -> product_variants
  tenantIsolationPolicy()

goods_receipts            (somente inserção e leitura: appendOnlyTenantPolicies())
  id, organization_id, order_id, store_id, idempotency_key uuid NOT NULL, notes varchar(500), received_by, received_at timestamptz DEFAULT clock_timestamp()
  UNIQUE (organization_id, id); UNIQUE (organization_id, idempotency_key); FKs compostas para purchase_orders e stores

goods_receipt_items       (appendOnlyTenantPolicies())
  id, organization_id, receipt_id, order_item_id, variant_id, quantity numeric(14,3) CHECK > 0, unit_cost_cents bigint CHECK >= 0, movement_id uuid NOT NULL
  FKs compostas para goods_receipts, purchase_order_items, product_variants e inventory_movements
```
Custom: `FORCE ROW LEVEL SECURITY` nas cinco tabelas. Itens de pedido em rascunho são substituídos (delete + insert) só enquanto `draft`; a política `tenant_isolation` permite, e o serviço garante o estado.

## 6. Invariantes e regras de negócio
- Saldo só muda pelo `postLedgerEntry`, na transação do recebimento; nunca há recebimento sem movimento nem movimento sem recebimento.
- `quantity_received` = soma dos itens recebidos (verificado em teste).
- Custos fora da auditoria e fora dos DTOs sem `catalog.costs.read`.
- Todas as consultas com `withScope` + `organization_id` explícito + escopo de loja.
- Textos pt-BR; comentários em inglês; arquivos ≤ 350 linhas; sem `any`.

## 7. Erros e casos de borda
| Situação | Comportamento esperado |
|----------|------------------------|
| Fornecedor inativo ou de outra empresa | Erro no campo `supplierId` |
| Variação repetida no pedido | Erro em `items.{i}.variantId` |
| Editar pedido aprovado | `invalid("Só pedidos em rascunho podem ser alterados.")` |
| Aprovar sem itens (estado inconsistente) | `invalid` |
| Cancelar com recebimento | `invalid("Pedido com recebimento não pode ser cancelado; encerre as pendências.")` |
| Receber pedido em rascunho, cancelado ou recebido | `invalid("Este pedido não aceita recebimento.")` |
| Receber acima do pendente | Erro em `items.{i}.quantity` |
| Item de outro pedido no recebimento | `invalid` no campo `items.{i}.orderItemId` |
| Mesma chave reenviada | `replayed: true`, nada duplicado |
| Dois recebimentos simultâneos do mesmo pedido | Serializados pela trava; o segundo vê o pendente atualizado |
| Plano sem `inventory` | `limitReached` |

## 8. Segurança
- Permissões no serviço; escopo de loja; RLS forçado; FKs compostas.
- Idempotência por chave; sem retry automático.
- Nenhum custo em log ou auditoria.

## 9. Critérios de aceite
### 9.1 Unitários (`src/server/purchasing/schemas.test.ts`)
- [ ] `purchaseOrderInputSchema`: quantidade `"2,5"` vira 2500 milésimos; `0`, negativo, 12 dígitos inteiros recusados; custo negativo recusado; variação repetida gera erro em `items.1.variantId`; 201 itens recusados.
- [ ] `receiptInputSchema`: chave não-uuid recusada; item repetido recusado.

### 9.2 Integração (`tests/integration/purchasing.test.ts`, `variant-search.test.ts`)
- [ ] Ciclo: Coordenador cria (número 1, depois 2), edita o rascunho, aprova; Gerente recebe parte (status `partially_received`, saldo e livro com `entry` e motivo com o número, custo novo em `product_costs` com auditoria `source: "purchase_receipt"`), recebe o resto (`received`); `quantity_received` = soma dos recebimentos.
- [ ] Recebimento repetido com a mesma chave: `replayed: true`, um só movimento por item, saldo inalterado na segunda chamada.
- [ ] Concorrência: dois `receiveGoods` simultâneos com chaves diferentes que somam mais que o pendente → um sucesso e um erro de quantidade; saldo final = pendente recebido uma vez.
- [ ] Acima do pendente, pedido em rascunho, cancelado ou recebido → erros da seção 7.
- [ ] Custo igual ao vigente não cria novo registro de custo.
- [ ] Encerrar pedido parcialmente recebido grava motivo e status `received`; cancelar rascunho e aprovado sem recebimento.
- [ ] Permissões: Gerente não cria nem aprova; Coordenador (sem `purchases.receive`) não recebe; Financeiro só lê e vê `unitCostCents`/`totalCents` (tem `catalog.costs.read`); Gerente de loja (sem `catalog.costs.read`) **não** recebe `unitCostCents` nem `totalCents` em `getPurchaseOrder`/`listPurchaseOrders`.
- [ ] Escopo: gerente da loja A não vê pedido da loja B ("não encontrado"); isolamento entre empresas por serviço e por `withScope` direto.
- [ ] Plano sem `inventory` recusa recebimento.
- [ ] `searchVariants`: por código de barras exato, SKU exato (minúsculo digitado), parte do nome; inativos só sem `activeOnly`; custo só com `catalog.costs.read`; outra empresa nunca aparece; `q` de 1 caractere → lista vazia.
- [ ] `inventory.test.ts` e `catalog.test.ts` continuam verdes sem alteração (prova de que as extrações não mudaram comportamento).

### 9.3 Gerais
- [ ] `lint`, `typecheck`, `lint:rules`, `test`, `build`; integração verde no gate; `db:generate` sem pendências.
- [ ] Gate `PASS+REVIEW`; revisão do Maestro com o checklist (atomicidade, idempotência, corrida).
- [ ] `docs/data-model.md` (tabelas, contador) e `docs/security.md` (permissões) atualizados.

## 10. Política de dúvida
Dúvidas ao Maestro, em lote, com proposta. PLANO antes de editar e `DEC-xxx` antes de começar. Sem `git add`, sem commit, sem branch.

## 11. Dependências
- Permitidas: nenhuma nova.
- Proibidas: qualquer outra; nenhuma alteração em `package.json` nem em lockfile.

## 12. Comandos de verificação
```
lint/typecheck/rules/test/build: corepack pnpm lint | typecheck | lint:rules | test | build
schema:      corepack pnpm db:generate   (de novo depois: "No schema changes")
integração:  pwsh -NoProfile -File tools/gate/with-test-db.ps1 corepack pnpm test:integration
gate:        pwsh -NoProfile -Command "& tools/gate/gate.ps1 -Module m29a-compras -Allowed @('src/db/schema/purchasing.ts','src/db/schema/counters.ts','src/db/schema/index.ts','drizzle/**','src/server/counters.ts','src/server/purchasing/**','src/server/inventory/ledger.ts','src/server/inventory/service.ts','src/server/catalog/pricing.ts','src/server/catalog/variant-search.ts','src/server/authz/permissions.ts','src/server/authz/system-roles.ts','src/server/authz/system-roles.test.ts','src/server/audit/labels.ts','src/server/audit/service.ts','tests/integration/purchasing.test.ts','tests/integration/variant-search.test.ts','tests/integration/fixtures.ts','docs/data-model.md','docs/security.md')"
```
