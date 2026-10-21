# Contrato do módulo `m30a-transferencias-reservas` — v2

> Escrito pelo Arquiteto (Opus) em 22/10/2026. O agente implementa o que está aqui e nada além.
> Se algo estiver ambíguo, o agente PERGUNTA (ver seção 10); não presume.
> Risco: **SENSÍVEL** (estoque, concorrência, tabelas com RLS, migração que altera `inventory_balances`). Nível: **A** (Opus).
> **Ordem de migração: 4ª da fila A** (ADR-010), depois da do m29a integrada.

## 1. Objetivo
Transferências de estoque entre lojas da mesma empresa (solicitada → aprovada → em trânsito → recebida, ou cancelada) e **reservas** de saldo (ADR-015), que o PDV (m06a) também vai usar para vendas suspensas.

## 2. Fora de escopo
- Telas (m30b). Frete, nota fiscal de transferência, transferência entre empresas.
- Tipos novos no enum `inventory_movement_type`: **não** criar. Despacho e recebimento usam os tipos existentes `exit` e `entry`, com motivo que cita o número da transferência e o vínculo gravado nos itens (decisão registrada: `ALTER TYPE … ADD VALUE` não pode ser usado na mesma transação de migração em que o valor aparece num `CHECK`).
- `nav.ts`/`shell.ts` (ADR-009).

## 3. Allowlist de arquivos
```
src/db/schema/transfers.ts
src/db/schema/inventory.ts                  (só as colunas reserved/in_transit e seus checks)
src/db/schema/index.ts
drizzle/**                                  (só os arquivos desta migração + custom de FORCE RLS + meta)
src/server/inventory/ledger.ts              (regra de disponível = quantidade − reservado)
src/server/inventory/service.ts             (listBalances devolve reserved, inTransit, available)
src/server/inventory/reservations.ts
src/server/inventory/transfers.ts
src/server/inventory/transfer-queries.ts    (v2: listTransfers/getTransfer, para transfers.ts caber em 350 linhas)
src/server/inventory/transfer-schemas.ts
src/server/inventory/transfer-schemas.test.ts
src/server/authz/permissions.ts
src/server/authz/system-roles.ts
src/server/authz/system-roles.test.ts
src/server/audit/labels.ts
src/server/audit/service.ts
tests/integration/transfers.test.ts
tests/integration/reservations.test.ts
tests/integration/roles.test.ts             (só se a lista esperada de algum perfil mudar, como no m28a v2)
docs/data-model.md
docs/security.md
```
Veredito esperado: `PASS+REVIEW` com a integração verde (inclusive `inventory.test.ts` e `purchasing.test.ts`).

## 4. Interface pública
### 4.1 Saldo
`inventory_balances` ganha `reserved numeric(14,3) NOT NULL DEFAULT 0` e `in_transit numeric(14,3) NOT NULL DEFAULT 0`, com checks `reserved >= 0`, `in_transit >= 0` e `reserved <= quantity`. Disponível = `quantity − reserved`. `listBalances` acrescenta `reserved`, `inTransit` e `available` (strings no formato do banco) a cada linha; nada mais muda na função.

`postLedgerEntry` (do m29a) passa a recusar movimento que deixe `quantity < reserved`: saída, perda, ajuste negativo e inventário com contagem abaixo do reservado → erro no campo `quantity`: `A loja tem {reservado} reservado; o saldo não pode ficar abaixo disso.`

### 4.2 Reservas (`src/server/inventory/reservations.ts`, para uso interno dentro de transação)
```ts
export type ReservationSource = "transfer" | "sale";
/** Locks the balance (creating it at zero), checks available >= quantity, inserts an active reservation and raises reserved. */
export async function reserveStock(tx: Tx, organizationId: string, input: { storeId: string; variantId: string; quantityMilli: bigint; source: ReservationSource; sourceId: string; actorUserId: string }): Promise<{ id: string }>;
/** active -> released; lowers reserved. Releasing a reservation that is not active is a no-op that returns false. */
export async function releaseReservation(tx: Tx, organizationId: string, reservationId: string): Promise<boolean>;
/** active -> consumed; lowers reserved (the caller posts the matching ledger exit in the same transaction). */
export async function consumeReservation(tx: Tx, organizationId: string, reservationId: string): Promise<{ storeId: string; variantId: string; quantityMilli: bigint }>;
```
Sem permissão própria: quem chama já autorizou a operação. Saldo insuficiente → `invalid("Saldo disponível insuficiente.", { quantity: [...] })` com o disponível na mensagem. Trava das linhas de saldo sempre em ordem crescente de `(store_id, variant_id)` quando houver mais de uma na mesma transação.

### 4.3 Transferências (`src/server/inventory/transfers.ts`)
```ts
export const TRANSFER_STATUSES = ["requested", "approved", "in_transit", "received", "cancelled"] as const;   // em transfer-schemas.ts
export const TRANSFER_STATUS_LABELS;  // Solicitada, Aprovada, Em trânsito, Recebida, Cancelada

export async function requestTransfer(context, input: unknown): Promise<{ id: string; number: number }>;
// { originStoreId, destinationStoreId (≠ origem), notes? ≤ 500, items: [{ variantId, quantity > 0 }] 1..200 sem repetição }
// inventory.transfer.request; DESTINO no escopo; origem ativa da empresa (pode estar fora do escopo do solicitante)
export async function approveTransfer(context, id): Promise<void>;
// inventory.transfer.approve; ORIGEM no escopo; requested -> approved; reserva cada item na origem (falta de saldo = erro no item)
export async function dispatchTransfer(context, id, input: unknown): Promise<void>;
// inventory.transfer.execute; ORIGEM no escopo; approved -> in_transit
// input: { items: [{ itemId, quantitySent }] } com 0 ≤ sent ≤ requested; consome a reserva, posta `exit` do enviado na origem
// (motivo "Transferência nº {n} para {loja destino}"), libera a sobra, soma o enviado em in_transit do destino
export async function receiveTransfer(context, id, input: unknown): Promise<void>;
// inventory.transfer.execute; DESTINO no escopo; in_transit -> received
// input: { items: [{ itemId, quantityReceived }], divergenceReason? } com 0 ≤ recebido ≤ enviado;
// tira o enviado de in_transit, posta `entry` do recebido no destino (motivo "Transferência nº {n} de {loja origem}");
// recebido < enviado exige divergenceReason (3..240) e fica registrado no item e na auditoria (não vira movimento de loja)
export async function cancelTransfer(context, id, reason: unknown): Promise<void>;
// requested (inventory.transfer.request com destino no escopo, ou approve com origem no escopo) ou approved (approve com origem no escopo) -> cancelled; libera reservas
export async function listTransfers(context, filters): Promise<Page<...>>;        // inventory.read; origem OU destino no escopo; filtros status, loja, número, página
export async function getTransfer(context, id): Promise<null | TransferDetail>;  // idem; fora do escopo = null
```
- Toda transição trava a transferência com `FOR UPDATE` e confere o estado; estado diferente do esperado → `invalid("Esta transferência não está {estado esperado}.")`. Repetir a mesma transição não duplica nada (segunda chamada vê o estado novo e falha com essa mensagem).
- Número por `nextDocumentNumber(tx, orgId, "stock_transfer")`.
- Plano: `assertFeature(tx, orgId, "inventory")` em todas as escritas.
- Unidade `un` aceita só inteiros (validação por item, com a unidade do produto).

### 4.4 Permissões novas (grupo `inventory`)
| Chave | Rótulo |
|-------|--------|
| `inventory.transfer.request` | `Solicitar transferências de estoque para lojas do escopo` |
| `inventory.transfer.approve` | `Aprovar e cancelar transferências que saem de lojas do escopo` |
| `inventory.transfer.execute` | `Despachar e receber transferências nas lojas do escopo` |

Perfis: Dono/Administrador (todas); Coordenador: request, approve; Gerente de loja: as três; demais: nenhuma.

### 4.5 Auditoria
Ações: `stock_transfer.requested` "Transferência de estoque solicitada", `.approved` "Transferência aprovada", `.dispatched` "Transferência despachada", `.received` "Transferência recebida", `.cancelled` "Transferência cancelada". Entidade `stock_transfer` "Transferência de estoque". `storeId` = origem (solicitação, aprovação, despacho, cancelamento) ou destino (recebimento). `changes` com número, itens e quantidades, divergências e motivos. Os movimentos de livro continuam com a auditoria própria do `postLedgerEntry`.

## 5. Dados e esquemas (`src/db/schema/transfers.ts`)
```
enum stock_transfer_status (requested, approved, in_transit, received, cancelled)
enum reservation_source (transfer, sale)
enum reservation_status (active, released, consumed)

stock_transfers
  id, organization_id, number integer, origin_store_id, destination_store_id, status, notes varchar(500),
  requested_by/at, approved_by/at, dispatched_by/at, received_by/at, cancelled_by/at, cancel_reason varchar(240), timestamps
  UNIQUE (organization_id, id); UNIQUE (organization_id, number)
  FKs compostas para stores (origem e destino); CHECK origin_store_id <> destination_store_id
  INDEX (organization_id, origin_store_id, status), (organization_id, destination_store_id, status)
  tenantIsolationPolicy()

stock_transfer_items
  id, organization_id, transfer_id, variant_id, quantity_requested numeric(14,3) > 0,
  quantity_sent numeric(14,3) NULL (>= 0, <= requested), quantity_received numeric(14,3) NULL (>= 0, <= sent),
  divergence_reason varchar(240) NULL, reservation_id uuid NULL, exit_movement_id uuid NULL, entry_movement_id uuid NULL
  UNIQUE (organization_id, id); UNIQUE (transfer_id, variant_id)
  FKs compostas para stock_transfers (cascata), product_variants, inventory_reservations, inventory_movements
  tenantIsolationPolicy()

inventory_reservations
  id, organization_id, store_id, variant_id, quantity numeric(14,3) > 0, source reservation_source, source_id uuid,
  status reservation_status DEFAULT 'active', created_by, created_at DEFAULT clock_timestamp(), released_at, consumed_at
  UNIQUE (organization_id, id); INDEX (organization_id, store_id, variant_id) WHERE status = 'active'; INDEX (organization_id, source, source_id)
  CHECK coerência de status com released_at/consumed_at
  FKs compostas para stores e product_variants
  tenantIsolationPolicy()
```
Migração gerada + custom com `FORCE ROW LEVEL SECURITY` nas três tabelas novas. As colunas novas em `inventory_balances` têm `DEFAULT 0`: linhas existentes ficam válidas.

## 6. Invariantes
- Para cada loja e variação: `reserved` = soma das reservas `active`; `in_transit` = soma de `quantity_sent` das transferências `in_transit` com destino na loja (verificado em teste).
- Saldo físico só muda por `postLedgerEntry`; reserva e trânsito só pelo serviço de estoque.
- Duas lojas na mesma transação: travas em ordem fixa (sem deadlock).
- `withScope` + `organization_id` explícito + escopo de loja em todas as consultas.

## 7. Erros e casos de borda
| Situação | Comportamento esperado |
|----------|------------------------|
| Origem = destino; loja inativa; loja de outra empresa | Erro no campo / "Loja não encontrada." |
| Aprovar sem saldo disponível na origem | Erro no item; nada reservado (transação toda desfeita) |
| Saída manual que invade o reservado | Erro no campo `quantity` |
| Despachar mais que o solicitado; receber mais que o enviado | Erro no item |
| Receber menos sem motivo | Erro no campo `divergenceReason` |
| Despacho com tudo zero | `invalid("Informe ao menos um item enviado; para não enviar nada, cancele a transferência.")` |
| Cancelar em trânsito ou recebida | `invalid` |
| Membro só do destino tenta aprovar ou despachar | "Transferência não encontrada." se a origem não está no escopo e o destino também não; com o destino no escopo, `forbidden` na ação da origem |
| Chamadas concorrentes de despacho | Uma vence; a outra recebe "não está aprovada" |

## 8. Segurança
Permissões e escopo por lado (origem/destino) no serviço; RLS forçado; nenhum saldo editado fora do livro; travas em ordem fixa; auditoria de toda transição.

## 9. Critérios de aceite
### 9.1 Unitários (`transfer-schemas.test.ts`)
- [ ] Solicitação: origem = destino recusada; item repetido recusado em `items.1.variantId`; quantidade `0` e `-1` recusadas; `"2,5"` vira 2500 milésimos.
- [ ] Despacho: `quantitySent` negativo recusado. Recebimento: `divergenceReason` com 2 caracteres recusado.

### 9.2 Integração (`transfers.test.ts`, `reservations.test.ts`)
- [ ] Ciclo completo: loja A com 10 un; Gerente do destino B solicita 4; Gerente de A aprova (A: reserved 4, available 6); despacha 4 (A: quantity 6, reserved 0; B: in_transit 4; livro de A com `exit` e motivo com o número); Gerente de B recebe 4 (B: in_transit 0, quantity 4; livro de B com `entry`); status e datas corretos; auditoria de cada passo.
- [ ] Despacho parcial (3 de 4): sobra da reserva liberada; trânsito 3. Recebimento com divergência (2 de 3) exige motivo; B recebe 2; trânsito zera; divergência registrada no item e na auditoria.
- [ ] Aprovação sem saldo: erro e nenhuma reserva criada. Saída manual em A que invade o reservado: erro em `quantity`; dentro do disponível: aceita.
- [ ] Cancelar aprovada libera a reserva; cancelar em trânsito é recusado.
- [ ] Concorrência: dois `approveTransfer` de transferências diferentes que juntas passam do disponível → uma aprova, a outra falha; `reserved` final = só a aprovada. Dois `dispatchTransfer` simultâneos da mesma transferência → um sucesso, um `invalid`, um só movimento.
- [ ] Escopo: membro só da loja B não vê transferência entre A e C; Gerente de B não aprova nem despacha transferência que sai de A (origem fora do escopo).
- [ ] Isolamento entre empresas (serviço e `withScope` direto) nas três tabelas.
- [ ] Reservas: `reserveStock`/`releaseReservation`/`consumeReservation` mantêm `reserved` = soma das ativas; liberar duas vezes devolve `false` na segunda; `reserveStock` acima do disponível falha.
- [ ] `listBalances` devolve `reserved`, `inTransit` e `available` corretos; `inventory.test.ts` e `purchasing.test.ts` continuam verdes.

### 9.3 Gerais
- [ ] `lint`, `typecheck`, `lint:rules`, `test`, `build`; integração verde no gate; `db:generate` sem pendências.
- [ ] Gate `PASS+REVIEW`; revisão do Maestro (corrida, travas, atomicidade).
- [ ] `docs/data-model.md` e `docs/security.md` atualizados; ADR-015 confere com o implementado.

## 10. Política de dúvida
Dúvidas ao Maestro, em lote, com proposta. PLANO antes de editar e `DEC-xxx` antes de começar. Sem `git add`, sem commit, sem branch.

## 11. Dependências
Nenhuma nova; nenhuma alteração em `package.json` nem em lockfile.

## 12. Comandos de verificação
```
lint/typecheck/rules/test/build: corepack pnpm lint | typecheck | lint:rules | test | build
schema:      corepack pnpm db:generate   (de novo depois: "No schema changes")
integração:  pwsh -NoProfile -File tools/gate/with-test-db.ps1 corepack pnpm test:integration
gate:        pwsh -NoProfile -Command "& tools/gate/gate.ps1 -Module m30a-transferencias-reservas -Allowed @('src/db/schema/transfers.ts','src/db/schema/inventory.ts','src/db/schema/index.ts','drizzle/**','src/server/inventory/ledger.ts','src/server/inventory/service.ts','src/server/inventory/reservations.ts','src/server/inventory/transfers.ts','src/server/inventory/transfer-schemas.ts','src/server/inventory/transfer-schemas.test.ts','src/server/authz/permissions.ts','src/server/authz/system-roles.ts','src/server/authz/system-roles.test.ts','src/server/audit/labels.ts','src/server/audit/service.ts','tests/integration/transfers.test.ts','tests/integration/reservations.test.ts','tests/integration/roles.test.ts','docs/data-model.md','docs/security.md')"
```
