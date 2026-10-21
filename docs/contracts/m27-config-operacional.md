# Contrato do módulo `m27-config-operacional` — v1

> Escrito pelo Arquiteto (Opus) em 21/10/2026. O agente implementa o que está aqui e nada além.
> Se algo estiver ambíguo, o agente PERGUNTA (ver seção 10); não presume.
> Risco: **SENSÍVEL** (tabelas com RLS, migração, permissão nova, regra que o PDV vai obedecer). Nível: **A** (Opus).
> **Ordem de migração: 1ª da fila A** (ADR-010). O número sai do `pnpm db:generate` sobre o HEAD integrado (esperado `0007` gerada + `0008` custom de FORCE RLS); nenhuma outra migração pode estar aberta.

## 1. Objetivo
Guardar, por empresa e com exceção por loja, as regras operacionais que o caixa e o PDV vão obedecer: exigência de cliente na venda, teto de desconto sem autorização e o texto do comprovante não fiscal. Inclui o serviço com leitura "efetiva" (empresa + exceção da loja) e a tela de configuração.

## 2. Fora de escopo
- Aplicar as regras (isso é do m06a/m05a): aqui só se guarda, valida, audita e lê.
- Permissões de desconto (`sales.discount*`): entram no m06a.
- Feriados e calendário (m32a); dados cadastrais da empresa (já existem em `/configuracoes`).
- Cache, configurações genéricas em JSON (proibido pelo data-model: colunas tipadas).

## 3. Allowlist de arquivos
```
src/db/schema/settings.ts
src/db/schema/index.ts
drizzle/**                                  (só os arquivos gerados por esta migração + a custom de FORCE RLS + meta)
src/server/settings/schemas.ts
src/server/settings/schemas.test.ts
src/server/settings/service.ts
src/server/authz/permissions.ts
src/server/audit/labels.ts
src/server/audit/service.ts
tests/integration/settings.test.ts
src/app/(app)/configuracoes/page.tsx        (só o link para a nova tela)
src/app/(app)/configuracoes/operacao/page.tsx
src/app/(app)/configuracoes/operacao/actions.ts
src/app/(app)/configuracoes/operacao/operation-forms.tsx
docs/data-model.md
docs/security.md
```
Veredito esperado do gate: `PASS+REVIEW` (schema, drizzle, authz, audit); a suíte de integração roda pelo gate (`sensitiveCommands.integration`) e precisa passar. **Não** editar `nav.ts` nem `shell.ts` (ADR-009): a tela é aberta pelo link em `/configuracoes`; nenhuma linha de menu nova.

## 4. Interface pública
### 4.1 Tipos e validação (`src/server/settings/schemas.ts`, puro, sem `server-only`)
```ts
export const CUSTOMER_REQUIREMENTS = ["none", "optional", "required"] as const;
export type CustomerRequirement = (typeof CUSTOMER_REQUIREMENTS)[number];
export const CUSTOMER_REQUIREMENT_LABELS: Record<CustomerRequirement, string>;
// none: "Não pedir cliente"; optional: "Cliente opcional"; required: "Cliente obrigatório"

export const MAX_DISCOUNT_BPS = 10_000;          // 100,00 %
export const RECEIPT_TEXT_MAX = 240;             // caracteres
export const RECEIPT_TEXT_MAX_LINES = 4;

/** "10", "10,5", "10.25", "0" -> basis points (1050 = 10,50 %); null when invalid, negative, > 100 or more than 2 decimals. */
export function parsePercentToBps(value: string): number | null;
/** 1050 -> "10,5"; 1000 -> "10"; 1 -> "0,01" (pt-BR, no "%"). */
export function formatBpsInput(bps: number): string;

/** Organization defaults: every field required. */
export const organizationOperationsSchema: z.ZodType<{
  customerRequirement: CustomerRequirement;
  maxDiscountBps: number;          // aceita a string do formulário em % e converte
  receiptHeader: string | null;    // trim; "" -> null; ≤ 240 caracteres e ≤ 4 linhas; sem caracteres de controle além de \n
  receiptFooter: string | null;    // mesmas regras
}>;

/** Store override: each field null = "usar o padrão da empresa". The form sends "" for inherit. */
export const storeOperationsSchema: z.ZodType<{
  customerRequirement: CustomerRequirement | null;
  maxDiscountBps: number | null;
  receiptHeader: string | null;
}>;
```
Mensagens de erro em pt-BR, no campo: `Informe um percentual entre 0 e 100, com até duas casas decimais.`, `Use no máximo 240 caracteres e 4 linhas.`, `Selecione uma opção válida.`

### 4.2 Serviço (`src/server/settings/service.ts`, `import "server-only"`)
```ts
export interface OperationalSettings {
  customerRequirement: CustomerRequirement;
  maxDiscountBps: number;
  receiptHeader: string | null;
  receiptFooter: string | null;
}
export const DEFAULT_OPERATIONAL_SETTINGS: OperationalSettings; // { "optional", 0, null, null }

/** Effective settings of a store, for other services inside their own transaction (no permission check: the caller already authorized its operation). */
export async function loadEffectiveSettings(tx: Tx, organizationId: string, storeId: string): Promise<OperationalSettings & { source: Record<keyof Omit<OperationalSettings, "receiptFooter">, "organization" | "store" | "default"> }>;

/** Screen data. Needs organization.settings.read. Stores = only those in the member's scope. */
export async function getOperationalSettings(context: TenantContext): Promise<{
  organization: OperationalSettings;
  stores: { storeId: string; code: string; name: string; override: { customerRequirement: CustomerRequirement | null; maxDiscountBps: number | null; receiptHeader: string | null } ; effective: OperationalSettings }[];
}>;

/** Needs settings.operations.manage and organization-wide scope. Upsert; audits only changed fields. */
export async function updateOrganizationOperations(context: TenantContext, input: unknown): Promise<void>;

/** Needs settings.operations.manage and the store in scope (out of scope or other company = "Loja não encontrada."). */
export async function updateStoreOperations(context: TenantContext, storeId: string, input: unknown): Promise<void>;
```
- Entrada crua (`unknown`) validada dentro do serviço com `parseOrThrow`/`invalid(...)` e `fieldErrorsOf` (mesmo padrão de `src/server/catalog/queries.ts`).
- Linhas ausentes = padrão (`DEFAULT_OPERATIONAL_SETTINGS`); nada é semeado na migração.
- `updateStoreOperations` com os três campos `null` **apaga** a exceção da loja (volta a herdar) e audita.

### 4.3 Permissão nova (`src/server/authz/permissions.ts`)
No grupo `organization`: `{ key: "settings.operations.manage", label: "Alterar regras de operação do caixa e do PDV (cliente, teto de desconto, comprovante)" }`. Só Dono e Administrador a recebem (já recebem `ALL_PERMISSIONS`); **não** alterar `system-roles.ts`.

### 4.4 Auditoria
- Ações (em `labels.ts`): `"settings.operations_updated": "Regras de operação da empresa alteradas"`, `"settings.store_operations_updated": "Regras de operação da loja alteradas"`, `"settings.store_operations_cleared": "Loja voltou a seguir as regras da empresa"`.
- Entidade nova em `labels.ts` e no `z.enum` de `audit/service.ts`: `operational_settings: "Regras de operação"`.
- `changes` = `diffFields` dos campos de negócio (`customerRequirement`, `maxDiscountBps`, `receiptHeader`, `receiptFooter`); `storeId` preenchido nas ações de loja; `entityId` = id da loja nas ações de loja e `null` na da empresa.

### 4.5 Tela `/configuracoes/operacao`
- `page.tsx`: `requireTenantContext()`; sem `organization.settings.read` → `<AccessDenied />`; `canManage = can(context, "settings.operations.manage") && context.storeScope.all` para o cartão da empresa; para as lojas, `can(context, "settings.operations.manage")` (o serviço confere o escopo). `metadata.title = "Regras de operação"`. Breadcrumbs: Painel > Configurações (`/configuracoes`) > Regras de operação.
- Cartão "Padrão da empresa" (formulário quando `canManage`, senão `DetailList`): Cliente na venda (`Select` com os rótulos de `CUSTOMER_REQUIREMENT_LABELS`), Teto de desconto sem autorização (`Input inputMode="decimal"` com sufixo "%", dica `Acima deste percentual, o desconto exige um perfil com autorização para descontos maiores.`), Cabeçalho do comprovante e Rodapé do comprovante (`Textarea rows={4} maxLength={240}`, dica `Até 4 linhas. Aparece no comprovante não fiscal do PDV.`).
- Tabela "Exceções por loja" (`caption` "Regras por loja"): Loja (código e nome), Cliente, Teto de desconto, Cabeçalho (cada célula mostra o valor efetivo e o selo `Padrão da empresa` quando herdado). Com permissão: botão `Personalizar` por linha (`aria-label="Personalizar regras da loja {nome}"`) abrindo diálogo com os três campos, cada um com a opção "Usar o padrão da empresa" (valor `""`), e botão `Voltar ao padrão` que envia os três vazios.
- `actions.ts` (`"use server"`, só exporta funções async; `_state` como primeiro parâmetro): `saveOrganizationOperationsAction`, `saveStoreOperationsAction` (lê `storeId` uuid por `pick`); `runAction(..., "Regras da empresa salvas." | "Regras da loja salvas.", "saveOrganizationOperations" | "saveStoreOperations")`; `revalidatePath("/configuracoes/operacao")`.
- `src/app/(app)/configuracoes/page.tsx`: acrescentar abaixo do grid um `Card` com `CardHeader` "Regras de operação", descrição `Cliente na venda, teto de desconto e textos do comprovante do PDV.` e `LinkButton` `Abrir` para `/configuracoes/operacao`. Nada mais muda nessa página.
- Valores na tela: percentual com `formatBpsInput` + " %"; textos com quebras de linha preservadas (`whitespace-pre-line`), nunca HTML.

## 5. Dados e esquemas (`src/db/schema/settings.ts`)
```
enum customer_requirement ('none','optional','required')

organization_settings
  organization_id uuid PK, FK organizations(id) ON DELETE CASCADE
  customer_requirement customer_requirement NOT NULL DEFAULT 'optional'
  max_discount_bps integer NOT NULL DEFAULT 0  CHECK 0..10000
  receipt_header varchar(240) NULL, receipt_footer varchar(240) NULL
  updated_by uuid NULL FK users(id) ON DELETE SET NULL
  created_at, updated_at (timestamps())
  UNIQUE (organization_id)  -- já é PK; FKs compostas não precisam dela
  policy: tenantIsolationPolicy()

store_settings
  organization_id uuid NOT NULL FK organizations(id) ON DELETE CASCADE
  store_id uuid NOT NULL
  PK (organization_id, store_id)
  FK (organization_id, store_id) -> stores(organization_id, id) ON DELETE CASCADE
  customer_requirement customer_requirement NULL
  max_discount_bps integer NULL CHECK (max_discount_bps IS NULL OR max_discount_bps BETWEEN 0 AND 10000)
  receipt_header varchar(240) NULL
  updated_by uuid NULL FK users(id) ON DELETE SET NULL
  timestamps()
  policy: tenantIsolationPolicy()
```
Migration custom (`pnpm db:generate --custom`): `ALTER TABLE ... FORCE ROW LEVEL SECURITY` para as duas tabelas. Revisar o SQL gerado antes de entregar. **Nenhuma** migração é aplicada em banco que não seja o `varejo_test` (a suíte de integração aplica do zero).

## 6. Invariantes e regras de negócio
- Toda consulta dentro de `withScope(dbScope(context), …)` **e** com filtro explícito de `organization_id`.
- Leitura efetiva: cada campo da loja não nulo vence; nulo herda da empresa; empresa sem linha = padrão. `receiptFooter` só existe na empresa.
- Teto de desconto em pontos-base inteiros (0 a 10 000); nada de ponto flutuante gravado.
- Alteração sem mudança efetiva não grava nem audita.
- Concorrência: upsert com `ON CONFLICT DO UPDATE` dentro da transação; a auditoria lê o valor anterior com `FOR UPDATE`.
- Textos pt-BR; comentários em inglês; arquivos ≤ 350 linhas; sem `any`, sem `console`.

## 7. Erros e casos de borda
| Situação | Comportamento esperado |
|----------|------------------------|
| Sem `organization.settings.read` | Página `<AccessDenied />`; serviço `forbidden` |
| `settings.operations.manage` com escopo parcial, alterando a empresa | `forbidden` ("Esta ação exige acesso a todas as lojas da empresa.") |
| Loja fora do escopo, de outra empresa ou id malformado | "Loja não encontrada." (`notFound`) |
| Percentual `-1`, `100,01`, `10,555`, `abc`, vazio na empresa | Erro no campo `maxDiscountBps` |
| Texto com 5 linhas, 241 caracteres ou caractere de controle (ex.: `\u0007`) | Erro no campo |
| Loja inativa | Pode ter exceção (não aparece no PDV, mas a regra fica guardada) |
| Exceção com os três campos vazios | Linha da loja apagada; ação `settings.store_operations_cleared` |

## 8. Segurança
- Permissão nova só para Dono/Administrador; escopo de loja verificado no serviço; página e ação chamam `requireTenantContext()`.
- Textos do comprovante são exibidos como texto (sem HTML) e não vão para log.
- RLS forçado nas duas tabelas; FKs compostas impedem loja de outra empresa.

## 9. Critérios de aceite
### 9.1 Unitários (`src/server/settings/schemas.test.ts`)
- [ ] `parsePercentToBps`: `"0"`→0, `"10"`→1000, `"10,5"`→1050, `"10.25"`→1025, `"100"`→10000, `" 7 "`→700; `null` para `"-1"`, `"100,01"`, `"10,555"`, `"1e2"`, `"abc"`, `""`, `"10,"`.
- [ ] `formatBpsInput`: 0→"0", 1000→"10", 1050→"10,5", 1025→"10,25", 1→"0,01", 10000→"100".
- [ ] `organizationOperationsSchema`: aceita o caso válido; recusa 5 linhas, 241 caracteres, `\u0007`, `customerRequirement` fora da lista; `""` em cabeçalho vira `null`.
- [ ] `storeOperationsSchema`: `""` em cada campo vira `null`.

### 9.2 Integração (`tests/integration/settings.test.ts`, banco real)
- [ ] Empresa sem linha devolve `DEFAULT_OPERATIONAL_SETTINGS` em `loadEffectiveSettings` e em `getOperationalSettings`.
- [ ] Dono altera a empresa → leitura efetiva da loja reflete; exceção da loja sobrepõe só o campo informado; `source` indica `"store"`/`"organization"`/`"default"`.
- [ ] Limpar a exceção (três nulos) apaga a linha e a loja volta a herdar.
- [ ] Auditoria: uma entrada por alteração com `changes` `{ from, to }` só dos campos mudados; nenhuma entrada quando nada muda.
- [ ] Gerente de loja (sem a permissão) recebe `forbidden` em `updateOrganizationOperations` e `updateStoreOperations`.
- [ ] Administrador com escopo de lojas parcial: `forbidden` na empresa; loja do escopo ok; loja fora do escopo = "Loja não encontrada."
- [ ] Isolamento: dono da empresa B não lê nem altera a configuração da empresa A (loja de A = "não encontrada"); consulta direta com `withScope({ organizationId: B })` não vê as linhas de A.
- [ ] `getOperationalSettings` de um membro com escopo de lojas lista só as lojas do escopo.
- [ ] Validação no serviço: `maxDiscountBps` 10001 recusado com erro no campo, mesmo chamando o serviço sem o formulário.

### 9.3 Gerais
- [ ] `corepack pnpm lint`, `typecheck`, `lint:rules`, `test`, `build` e `test:integration` (pelo gate) verdes.
- [ ] Gate `PASS+REVIEW` com a integração verde; revisão do Maestro com `docs/REVIEW-CHECKLIST.md`.
- [ ] `docs/data-model.md` (tabelas, migração) e `docs/security.md` (permissão nova) atualizados.

### 9.4 Manual (Maestro)
- [ ] Dono altera os padrões e uma exceção de loja; selos "Padrão da empresa" corretos; "Voltar ao padrão" funciona.
- [ ] Financeiro (com `organization.settings.read`) vê sem formulários; Gerente de loja sem `organization.settings.read` recebe "acesso negado".
- [ ] Celular sem rolagem horizontal; textos em pt-BR.

## 10. Política de dúvida
Dúvidas ao Maestro, em lote, com proposta. PLANO antes de editar e `DEC-xxx` antes de começar. Sem `git add`, sem commit, sem branch.

## 11. Dependências
- Permitidas: nenhuma nova.
- Proibidas: qualquer outra; nenhuma alteração em `package.json` nem em lockfile.

## 12. Comandos de verificação
```
lint/typecheck/rules/test/build: corepack pnpm lint | typecheck | lint:rules | test | build
schema:      corepack pnpm db:generate     (depois de gerar, rodar de novo: deve dizer "No schema changes")
integração:  pwsh -NoProfile -File tools/gate/with-test-db.ps1 corepack pnpm test:integration
gate:        pwsh -NoProfile -Command "& tools/gate/gate.ps1 -Module m27-config-operacional -Allowed @('src/db/schema/settings.ts','src/db/schema/index.ts','drizzle/**','src/server/settings/**','src/server/authz/permissions.ts','src/server/audit/labels.ts','src/server/audit/service.ts','tests/integration/settings.test.ts','src/app/(app)/configuracoes/page.tsx','src/app/(app)/configuracoes/operacao/**','docs/data-model.md','docs/security.md')"
```
