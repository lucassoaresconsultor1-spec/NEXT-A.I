# Contrato do módulo `m05a-caixa` — v1

> Escrito pelo Arquiteto (Opus) em 22/10/2026. O agente implementa o que está aqui e nada além.
> Se algo estiver ambíguo, o agente PERGUNTA (ver seção 10); não presume.
> Risco: **SENSÍVEL** (dinheiro, tabelas com RLS, migração, permissões novas). Nível: **A** (Opus).
> **Ordem de migração: 5ª da fila A** (ADR-010), depois da do m30a integrada.

## 1. Objetivo
Caixas por loja e **sessões de caixa** (abertura com troco inicial, suprimento, sangria, fechamento com contagem e divergência, reabertura autorizada), com um livro de movimentos em dinheiro somente de inserção que o PDV (m06a) e as devoluções (m08) alimentam.

## 2. Fora de escopo
- Telas (m05b). Vendas, pagamentos e meios de pagamento além de dinheiro (m06a/m07); o resumo por meio de pagamento no fechamento entra no m06a.
- Conciliação e fechamento diário financeiro (m37a). Impressão de relatório de caixa.
- `nav.ts`/`shell.ts` (ADR-009).

## 3. Allowlist de arquivos
```
src/db/schema/cash.ts
src/db/schema/index.ts
drizzle/**                                  (só os arquivos desta migração + custom de FORCE RLS + meta)
src/server/cash/schemas.ts
src/server/cash/schemas.test.ts
src/server/cash/registers.ts
src/server/cash/sessions.ts
src/server/cash/ledger.ts
src/server/plans/entitlements.ts            (só acrescentar "pos" ao tipo PlanFeature e sua mensagem)
src/server/authz/permissions.ts
src/server/authz/system-roles.ts
src/server/authz/system-roles.test.ts
src/server/audit/labels.ts
src/server/audit/service.ts
tests/integration/cash.test.ts
tests/integration/roles.test.ts             (só se a lista esperada de algum perfil mudar)
tests/integration/fixtures.ts               (só acrescentar createCashRegisterFixture)
docs/data-model.md
docs/security.md
```
Veredito esperado: `PASS+REVIEW` com a integração verde.

## 4. Interface pública
### 4.1 Permissões novas (grupo `cash`, rótulo "Caixa")
| Chave | Rótulo |
|-------|--------|
| `cash.read` | `Ver caixas e sessões das lojas do escopo` |
| `cash.operate` | `Abrir, movimentar e fechar o próprio caixa` |
| `cash.manage` | `Cadastrar caixas, fechar sessões de outros operadores e reabrir sessões` |

Perfis: Dono/Administrador (todas); Financeiro: `cash.read`; Coordenador: `cash.read`; Gerente de loja: as três; Supervisor: `cash.read`; Operador de caixa: `cash.operate`; Vendedor: nenhuma. (O teste de `system-roles.test.ts` que limita `.manage` nos perfis de linha de frente continua valendo: o operador não recebe `cash.manage`.)

Plano: `entitlements.ts` passa a aceitar `PlanFeature = "inventory" | "pos"` com a mensagem `O plano atual não inclui o PDV e o caixa. Fale com o suporte para alterar o plano.`; todas as escritas do caixa chamam `assertFeature(tx, orgId, "pos")`.

### 4.2 Validação (`src/server/cash/schemas.ts`, puro)
```ts
export const CASH_MOVEMENT_TYPES = ["opening", "supply", "withdrawal", "sale", "refund"] as const;
export const CASH_MOVEMENT_LABELS;  // Abertura, Suprimento, Sangria, Venda em dinheiro, Devolução em dinheiro
export const registerInputSchema;   // { storeId: uuid, name: requiredText("o nome do caixa", 60, 2) }
export const openSessionSchema;     // { registerId: uuid, openingAmountCents: int 0..MAX_CENTS, idempotencyKey: uuid }
export const manualMovementSchema;  // { type: "supply" | "withdrawal", amountCents: int 1..MAX_CENTS, reason: requiredText("o motivo", 240, 3), idempotencyKey: uuid }
export const closeSessionSchema;    // { countedAmountCents: int 0..MAX_CENTS, note?: ≤ 500 }
export const reopenSchema;          // { reason: requiredText("o motivo", 240, 3) }
```
Valores sempre em centavos inteiros (o formulário converte com `parseBrlToCents` no m05b; o serviço aceita números ou strings de inteiros).

### 4.3 Caixas (`registers.ts`)
```ts
export async function listRegisters(context, filters: { storeId?: string; status?: "active" | "inactive" }): Promise<{ id; storeId; storeName; name; isActive; openSession: { id; openedByName; openedAt } | null }[]>; // cash.read ou cash.operate; lojas do escopo
export async function createRegister(context, input: unknown): Promise<{ id: string }>;   // cash.manage; loja ativa no escopo; nome único na loja (sem diferenciar maiúsculas)
export async function updateRegister(context, id, input: unknown): Promise<void>;          // cash.manage; só o nome
export async function setRegisterActive(context, id, isActive: boolean): Promise<void>;    // cash.manage; desativar com sessão aberta é recusado
```

### 4.4 Sessões (`sessions.ts`)
```ts
export async function openSession(context, input: unknown): Promise<{ sessionId: string; replayed: boolean }>;
// cash.operate; caixa ativo de loja ativa no escopo; um caixa tem no máximo uma sessão aberta e um operador também;
// grava a sessão e o movimento "opening" (valor do troco inicial); mesma idempotencyKey -> mesma sessão (replayed)
export async function recordManualMovement(context, sessionId, input: unknown): Promise<{ movementId: string; replayed: boolean }>;
// dono da sessão com cash.operate, ou cash.manage com a loja no escopo; sessão aberta;
// sangria não pode passar do dinheiro esperado no caixa ("Valor acima do dinheiro disponível no caixa ({esperado}).")
export async function getSessionSummary(context, sessionId): Promise<null | {
  id; registerId; registerName; storeId; storeName; status: "open" | "closed";
  openedBy: { id; name }; openedAt: Date; closedBy: { id; name } | null; closedAt: Date | null;
  totals: { openingCents; suppliesCents; withdrawalsCents; salesCents; refundsCents; expectedCents };
  countedCents: number | null; differenceCents: number | null; closingNote: string | null;
  movements: { id; type; amountCents; reason: string | null; createdAt: Date; createdByName: string | null }[];
  events: { type: "opened" | "closed" | "reopened"; actorName: string | null; reason: string | null; at: Date }[];
}>; // cash.read, ou o próprio operador com cash.operate
export async function closeSession(context, sessionId, input: unknown): Promise<{ expectedCents: number; differenceCents: number }>;
// dono com cash.operate ou cash.manage na loja; sessão aberta; esperado = abertura + suprimentos − sangrias + vendas − devoluções (calculado no servidor);
// diferença = contado − esperado; diferença ≠ 0 exige note (3..500): "Explique a diferença de {valor}."
export async function reopenSession(context, sessionId, input: unknown): Promise<void>;
// cash.manage; só a sessão fechada mais recente do caixa, e só se o caixa e o operador não têm outra sessão aberta; status volta a open; evento "reopened" com motivo
export async function listSessions(context, filters): Promise<Page<...>>;
// cash.read: lojas do escopo; só cash.operate: apenas as próprias; filtros loja, caixa, situação, de/até (dias no fuso da empresa), página
export async function findOpenSessionForOperator(context, storeId): Promise<{ sessionId; registerId; registerName } | null>; // para o PDV
```

### 4.5 Livro de dinheiro (`ledger.ts`, interno, dentro de transação)
```ts
/** For m06a/m08: locks the session (must be open and belong to the store), inserts a sale or refund cash movement. No permission check. */
export async function postCashMovementInTx(tx: Tx, organizationId: string, input: { sessionId: string; storeId: string; type: "sale" | "refund"; amountCents: number; actorUserId: string; reference: { kind: "sale" | "refund"; id: string } }): Promise<{ movementId: string }>;
/** Expected cash of a session from its movements (same formula as closeSession). */
export async function expectedCashCents(tx: Tx, organizationId: string, sessionId: string): Promise<number>;
```
Devolução em dinheiro acima do esperado é recusada como a sangria.

### 4.6 Auditoria
Ações: `cash_register.created` "Caixa cadastrado", `cash_register.updated` "Caixa alterado", `cash_register.status_changed` "Situação de caixa alterada", `cash_session.opened` "Caixa aberto", `cash_session.movement_recorded` "Suprimento ou sangria registrado", `cash_session.closed` "Caixa fechado", `cash_session.reopened` "Caixa reaberto". Entidades `cash_register` "Caixa" e `cash_session` "Sessão de caixa". `storeId` sempre preenchido. `changes` com valores em centavos, tipo, motivo, esperado, contado e diferença (são dados de negócio, não pessoais). Movimentos de venda/devolução (do m06a/m08) não geram auditoria própria aqui: a venda já audita.

## 5. Dados e esquemas (`src/db/schema/cash.ts`)
```
enum cash_session_status (open, closed)
enum cash_movement_type (opening, supply, withdrawal, sale, refund)
enum cash_session_event_type (opened, closed, reopened)

cash_registers
  id, organization_id, store_id, name varchar(60), is_active, timestamps
  UNIQUE (organization_id, id); UNIQUE INDEX (organization_id, store_id, lower(name)); FK composta stores
  tenantIsolationPolicy()

cash_sessions
  id, organization_id, register_id, store_id, status, opened_by uuid NOT NULL, opened_at timestamptz DEFAULT clock_timestamp(),
  opening_amount_cents bigint >= 0, closed_by, closed_at, counted_amount_cents bigint NULL >= 0,
  expected_amount_cents bigint NULL, difference_cents bigint NULL, closing_note varchar(500) NULL, open_idempotency_key uuid NOT NULL, timestamps
  UNIQUE (organization_id, id); UNIQUE (organization_id, open_idempotency_key)
  UNIQUE INDEX (organization_id, register_id) WHERE status = 'open'
  UNIQUE INDEX (organization_id, opened_by) WHERE status = 'open'
  FKs compostas para cash_registers e stores; CHECK coerência (open ⇒ closed_* nulos; closed ⇒ closed_at, counted, expected e difference preenchidos)
  tenantIsolationPolicy()   (UPDATE necessário para fechar/reabrir)

cash_movements             (somente inserção e leitura: appendOnlyTenantPolicies())
  id, organization_id, session_id, store_id, type, amount_cents bigint > 0 (opening aceita >= 0), reason varchar(240) NULL,
  reference_kind varchar(16) NULL, reference_id uuid NULL, idempotency_key uuid NULL, created_by, created_at DEFAULT clock_timestamp()
  UNIQUE (organization_id, id); UNIQUE (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL
  CHECK reason obrigatório em supply/withdrawal; reference obrigatória em sale/refund
  FK composta para cash_sessions

cash_session_events        (appendOnlyTenantPolicies())
  id, organization_id, session_id, type, actor_user_id, reason varchar(240) NULL,
  counted_cents, expected_cents, difference_cents bigint NULL (preenchidos no fechamento), created_at DEFAULT clock_timestamp()
  (colunas tipadas, sem JSON genérico)
  FK composta para cash_sessions
```
Custom: `FORCE ROW LEVEL SECURITY` nas quatro tabelas.

## 6. Invariantes
- Esperado e diferença sempre calculados no servidor a partir do livro (nunca vindos do cliente).
- Sessão fechada não recebe movimento; reabrir registra evento com motivo e responsável; o fechamento anterior fica no histórico de eventos (os campos de fechamento da sessão são limpos ao reabrir e gravados de novo no próximo fechamento).
- Um caixa e um operador com no máximo uma sessão aberta (índices únicos parciais; corrida vira conflito amigável `Este caixa já está aberto.` / `Você já tem um caixa aberto.`).
- Dinheiro em centavos inteiros (`bigint`, `mapWith(Number)` na leitura; valores até `MAX_CENTS`).
- `withScope` + `organization_id` explícito + escopo de loja; operador sem `cash.read` só enxerga as próprias sessões.

## 7. Erros e casos de borda
| Situação | Comportamento esperado |
|----------|------------------------|
| Abrir caixa inativo, de loja inativa ou fora do escopo | `invalid` / "Caixa não encontrado." |
| Abrir caixa já aberto, ou operador com outro caixa aberto | Conflito amigável |
| Mesma chave de abertura ou de movimento reenviada | `replayed: true`, nada duplicado |
| Sangria acima do esperado | Erro no campo `amountCents` |
| Fechar com diferença sem justificativa | Erro no campo `note` |
| Outro operador (sem `cash.manage`) fecha ou movimenta a sessão | "Sessão de caixa não encontrada." |
| Reabrir sessão que não é a mais recente do caixa, ou com outra aberta | `invalid` |
| Desativar caixa com sessão aberta | `invalid("Feche a sessão aberta antes de desativar o caixa.")` |
| Plano sem `pos` | `limitReached` |

## 8. Segurança
Permissões e escopo no serviço; dinheiro calculado só no servidor; livro de movimentos imutável; idempotência por chave; sem retry automático; auditoria de toda operação manual; RLS forçado.

## 9. Critérios de aceite
### 9.1 Unitários (`schemas.test.ts`)
- [ ] `openSessionSchema`: valor negativo, não inteiro e acima de `MAX_CENTS` recusados; chave não-uuid recusada.
- [ ] `manualMovementSchema`: `amountCents` 0 recusado; tipo `sale` recusado (só suprimento/sangria são manuais); motivo curto recusado.
- [ ] `closeSessionSchema`: contado negativo recusado; nota com 501 caracteres recusada.

### 9.2 Integração (`tests/integration/cash.test.ts`)
- [ ] Gerente cadastra caixa; nome repetido na loja (outra caixa de letras) → conflito; outro nome ok.
- [ ] Operador abre com R$ 100,00; suprimento R$ 50,00; sangria R$ 30,00; `postCashMovementInTx` de venda R$ 20,00; esperado = 14 000 centavos; fecha contando 14 000 → diferença 0 sem nota; auditoria de abertura, movimentos e fechamento.
- [ ] Fechamento com contado 13 900 sem nota → erro; com nota → diferença −100 gravada no evento e na sessão.
- [ ] Sangria acima do esperado → erro; devolução em dinheiro acima do esperado → erro.
- [ ] Idempotência: abrir duas vezes com a mesma chave → mesma sessão; suprimento repetido com a mesma chave → um só movimento.
- [ ] Corrida: dois operadores abrem o mesmo caixa ao mesmo tempo → uma sessão; o mesmo operador abre dois caixas ao mesmo tempo → uma sessão.
- [ ] Outro operador não vê nem fecha a sessão alheia; Gerente (`cash.manage`) fecha sessão de operador da sua loja; Gerente de outra loja não vê.
- [ ] Reabertura: Gerente reabre a última sessão com motivo; evento registrado; nova sangria aceita; reabrir sessão antiga (já existe outra depois) → erro; Operador sem `cash.manage` → `forbidden`.
- [ ] Movimento em sessão fechada (manual ou pelo `postCashMovementInTx`) → erro.
- [ ] Plano sem `pos` recusa abertura; isolamento entre empresas por serviço e por `withScope` direto nas quatro tabelas; `cash_movements` e `cash_session_events` recusam UPDATE e DELETE (política só de inserção).

### 9.3 Gerais
- [ ] `lint`, `typecheck`, `lint:rules`, `test`, `build`; integração verde no gate; `db:generate` sem pendências.
- [ ] Gate `PASS+REVIEW`; revisão do Maestro (dinheiro, corrida, idempotência).
- [ ] `docs/data-model.md` e `docs/security.md` atualizados.

## 10. Política de dúvida
Dúvidas ao Maestro, em lote, com proposta. PLANO antes de editar e `DEC-xxx` antes de começar. Sem `git add`, sem commit, sem branch.

## 11. Dependências
Nenhuma nova; nenhuma alteração em `package.json` nem em lockfile.

## 12. Comandos de verificação
```
lint/typecheck/rules/test/build: corepack pnpm lint | typecheck | lint:rules | test | build
schema:      corepack pnpm db:generate   (de novo depois: "No schema changes")
integração:  pwsh -NoProfile -File tools/gate/with-test-db.ps1 corepack pnpm test:integration
gate:        pwsh -NoProfile -Command "& tools/gate/gate.ps1 -Module m05a-caixa -Allowed @('src/db/schema/cash.ts','src/db/schema/index.ts','drizzle/**','src/server/cash/**','src/server/plans/entitlements.ts','src/server/authz/permissions.ts','src/server/authz/system-roles.ts','src/server/authz/system-roles.test.ts','src/server/audit/labels.ts','src/server/audit/service.ts','tests/integration/cash.test.ts','tests/integration/roles.test.ts','tests/integration/fixtures.ts','docs/data-model.md','docs/security.md')"
```
