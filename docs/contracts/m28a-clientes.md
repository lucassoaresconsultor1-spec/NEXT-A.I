# Contrato do módulo `m28a-clientes` — v2

> Escrito pelo Arquiteto (Opus) em 21/10/2026. O agente implementa o que está aqui e nada além.
> Se algo estiver ambíguo, o agente PERGUNTA (ver seção 10); não presume.
> Risco: **SENSÍVEL** (dados pessoais/LGPD, tabela com RLS, migração, permissões novas). Nível: **A** (Opus).
> **Ordem de migração: 2ª da fila A** (ADR-010), depois da do m27 integrada. Número atribuído pelo `pnpm db:generate` sobre o HEAD integrado (esperado `0009` gerada + `0010` custom de FORCE RLS).

## 1. Objetivo
Cadastro de **clientes** da empresa com dados mínimos (ADR-017), compartilhado por todas as lojas, para o PDV identificar o comprador (m06a) e para importação (m19). Só back-end: schema, migração, permissões, serviço, auditoria e testes. As telas são do m28b.

## 2. Fora de escopo
- Telas (m28b), uso no PDV (m06a), importação (m19), histórico de compras do cliente (vem com as vendas).
- Endereço, data de nascimento, CNPJ de cliente pessoa jurídica, segmentação, fidelidade.
- Anonimização/exclusão a pedido do titular e política de retenção: **pendência de produto** registrada em `docs/security.md` por este módulo (não implementar agora).
- `nav.ts`/`shell.ts` (ADR-009).

## 3. Allowlist de arquivos
```
src/db/schema/customers.ts
src/db/schema/index.ts
drizzle/**                                  (só os arquivos desta migração + custom de FORCE RLS + meta)
src/server/customers/schemas.ts
src/server/customers/schemas.test.ts
src/server/customers/service.ts
src/server/authz/permissions.ts
src/server/authz/system-roles.ts
src/server/authz/system-roles.test.ts       (só se o teste existente precisar refletir as permissões novas)
src/server/audit/labels.ts
src/server/audit/service.ts
tests/integration/customers.test.ts
tests/integration/fixtures.ts               (só acrescentar createCustomerFixture)
tests/integration/roles.test.ts             (v2: só a lista esperada de permissões do Vendedor, ~linha 227, que passa a incluir customers.read e customers.manage)
docs/data-model.md
docs/security.md
```
Veredito esperado do gate: `PASS+REVIEW`, com a integração verde pelo gate.

## 4. Interface pública
### 4.1 Validação e máscara (`src/server/customers/schemas.ts`, puro)
```ts
export const customerInputSchema: z.ZodType<{
  name: string;                      // requiredText("o nome do cliente", 120, 2)
  document: string | null;           // CPF: "" -> null; só dígitos; isValidCpf; mensagem "CPF inválido."
  email: string | null;              // optionalEmail -> null quando vazio
  phone: string | null;              // optionalPhone -> null quando vazio
  marketingConsent: boolean;         // "on"/"true"/true -> true; ausente/"false" -> false
}>;
export const customerFiltersSchema: z.ZodType<{ q?: string; status?: "active" | "inactive"; page: number }>; // mesmo padrão de supplierFiltersSchema

/** "12345678909" -> "***.456.789-**". Anything that is not 11 digits -> "***". */
export function maskCpf(document: string): string;
/** Contact masks for audit: "ana.souza@exemplo.com" -> "a***@exemplo.com"; "21987654321" -> "(21) *****-4321". */
export function maskEmail(email: string): string;
export function maskPhone(phone: string): string;
```

### 4.2 Permissões novas (`permissions.ts`, grupo novo `customers`, rótulo "Clientes")
| Chave | Rótulo |
|-------|--------|
| `customers.read` | `Ver clientes (CPF mascarado)` |
| `customers.manage` | `Cadastrar e editar clientes` |
| `customers.documents.read` | `Ver o CPF completo dos clientes` |

Perfis do sistema (`system-roles.ts`): Dono e Administrador já têm tudo. Financeiro: `customers.read`, `customers.documents.read`. Coordenador: `customers.read`. Gerente de loja: as três. Supervisor: `customers.read`. Vendedor e Operador de caixa: `customers.read`, `customers.manage` (cadastram o comprador na venda).

### 4.3 Serviço (`src/server/customers/service.ts`, `import "server-only"`)
```ts
export interface CustomerRow {
  id: string; name: string;
  document: string | null;          // completo só com customers.documents.read; senão maskCpf(...)
  documentMasked: boolean;          // true quando `document` veio mascarado
  email: string | null; phone: string | null;
  marketingConsent: boolean; consentAt: Date | null;
  isActive: boolean; createdAt: Date; updatedAt: Date;
}
/** Needs customers.read. q: e-mail, valid CPF, phone or name, in the order of section 4.3. Paginated (PAGE_SIZE). */
export async function listCustomers(context: TenantContext, filters: CustomerFilters): Promise<{ rows: CustomerRow[]; total: number; page: number; pageCount: number }>;
/** Needs customers.read. Null when missing / other company / malformed id. */
export async function getCustomer(context: TenantContext, id: string): Promise<CustomerRow | null>;
/** Needs customers.manage. Raw input validated inside. */
export async function createCustomer(context: TenantContext, input: unknown): Promise<{ id: string }>;
export async function updateCustomer(context: TenantContext, id: string, input: unknown): Promise<void>;
export async function setCustomerActive(context: TenantContext, id: string, isActive: boolean): Promise<void>;
/** For other services in their own transaction (m06a): active customer of the organization or null. No permission check. */
export async function loadActiveCustomer(tx: Tx, organizationId: string, id: string): Promise<{ id: string; name: string } | null>;
```
- Clientes são da **empresa** (sem escopo de loja), como o catálogo: qualquer membro com `customers.read` vê todos.
- Edição por quem **não** tem `customers.documents.read`: o formulário não conhece o CPF completo, então o serviço **mantém** o CPF atual quando `document` chega igual à máscara atual ou vazio-com-flag. Regra exata: `updateCustomer` recebe `document`; se o ator não tem `customers.documents.read` e o valor recebido for igual a `maskCpf(atual)`, mantém o atual; qualquer outro valor é validado normalmente (pode corrigir digitando o CPF inteiro). Apagar o CPF (`""`) sem a permissão é recusado no campo: `Seu perfil não pode remover o CPF do cliente.`
- `marketingConsent` passando de `false` para `true` grava `consent_at = now()`; de `true` para `false` grava `consent_at = null`.
- CPF repetido na empresa → `conflict("Já existe um cliente com este CPF.", { document: ["CPF já cadastrado nesta empresa."] })`; a mensagem não revela o nome do outro cliente.
- Busca, nesta ordem: (1) `q` contém `@` → e-mail exato (minúsculo); (2) `onlyDigits(q)` tem 11 dígitos **e** `isValidCpf` → CPF exato; (3) `q` só tem dígitos, espaços, parênteses e hífen e `onlyDigits(q)` tem 10 ou 11 dígitos → telefone exato; (4) senão nome `ilike` com `likePattern` (≥ 2 caracteres; 1 caractere = sem filtro). Ordenação `lower(name), id`. Também declarado em `listCustomers`.

### 4.4 Auditoria
- Ações: `customer.created` "Cliente cadastrado", `customer.updated` "Cliente alterado", `customer.status_changed` "Situação de cliente alterada". Entidade `customer: "Cliente"` em `labels.ts` e no `z.enum` de `audit/service.ts`.
- `changes`: `name`, `isActive`, `marketingConsent` com valores reais; `document`, `email`, `phone` **sempre mascarados** (`maskCpf`/`maskEmail`/`maskPhone`) no `from`/`to`. Nunca o valor completo de CPF, e-mail ou telefone na auditoria nem em log.

## 5. Dados e esquemas (`src/db/schema/customers.ts`)
```
customers
  id uuid PK default gen_random_uuid()
  organization_id uuid NOT NULL FK organizations(id) ON DELETE CASCADE
  name varchar(120) NOT NULL
  document varchar(11) NULL            -- CPF, só dígitos
  email varchar(254) NULL              -- minúsculo
  phone varchar(11) NULL               -- só dígitos
  marketing_consent boolean NOT NULL DEFAULT false
  consent_at timestamptz NULL
  is_active boolean NOT NULL DEFAULT true
  created_by uuid NULL FK users(id) ON DELETE SET NULL
  timestamps()
  UNIQUE (organization_id, id)                                   -- alvo das FKs compostas (vendas, fila)
  UNIQUE INDEX customers_org_document_idx (organization_id, document) WHERE document IS NOT NULL
  INDEX customers_org_name_idx (organization_id, lower(name))
  INDEX customers_org_email_idx (organization_id, email) WHERE email IS NOT NULL
  INDEX customers_org_phone_idx (organization_id, phone) WHERE phone IS NOT NULL
  CHECK (document IS NULL OR document ~ '^[0-9]{11}$')
  CHECK (phone IS NULL OR phone ~ '^[0-9]{10,11}$')
  CHECK ((marketing_consent AND consent_at IS NOT NULL) OR (NOT marketing_consent AND consent_at IS NULL))
  policy: tenantIsolationPolicy()
```
Migration custom com `FORCE ROW LEVEL SECURITY`. Sem exclusão física (desativação). Revisar o SQL gerado.

## 6. Invariantes e regras de negócio
- `withScope(dbScope(context), …)` e filtro explícito de `organization_id` em toda consulta; `isUuid` antes de consultar por id.
- CPF completo só sai do serviço para quem tem `customers.documents.read`; em qualquer outro caso, `maskCpf`.
- Nenhum dado pessoal em log (Pino) nem em mensagem de erro.
- Desativado não é oferecido ao PDV (`loadActiveCustomer` devolve null), mas continua listável.
- Textos pt-BR; comentários em inglês; arquivos ≤ 350 linhas; sem `any`.

## 7. Erros e casos de borda
| Situação | Comportamento esperado |
|----------|------------------------|
| Sem `customers.read` / `customers.manage` | `forbidden` |
| Id malformado, inexistente ou de outra empresa | `getCustomer` null; mutações "Cliente não encontrado." |
| CPF inválido / repetido | Erro no campo `document` |
| CPF em branco por quem não pode ver o completo, cliente com CPF | Erro no campo (não remove) |
| Máscara reenviada sem permissão | CPF atual mantido, sem auditoria de `document` |
| Nome com 1 caractere ou 121 | Erro no campo `name` |
| Busca `q` = "a" | Sem filtro de nome (lista normal) |
| Corrida criando o mesmo CPF | Um vence; o outro recebe o conflito amigável (violação de unicidade traduzida) |

## 8. Segurança
- RLS forçado; permissões no serviço; máscara aplicada no servidor (a tela nunca recebe o CPF completo sem permissão).
- Auditoria com contatos mascarados; consentimento com data.
- Registrar em `docs/security.md`: permissões novas, mascaramento, pendência de retenção/anonimização.

## 9. Critérios de aceite
### 9.1 Unitários (`src/server/customers/schemas.test.ts`)
- [ ] `customerInputSchema`: CPF com pontuação válido vira 11 dígitos; `"111.111.111-11"` e `"123"` recusados; `""` vira `null`; e-mail com maiúsculas vira minúsculo; telefone `(21) 98765-4321` vira `21987654321`; `marketingConsent` `"on"` → true, ausente → false.
- [ ] `maskCpf("12345678909")` = `"***.456.789-**"`; `maskCpf("123")` = `"***"`.
- [ ] `maskEmail("ana.souza@exemplo.com")` = `"a***@exemplo.com"`; `maskPhone("21987654321")` = `"(21) *****-4321"`; `maskPhone("2134567890")` = `"(21) ****-7890"`.

### 9.2 Integração (`tests/integration/customers.test.ts`)
- [ ] Dono cria, edita, desativa e reativa; auditoria registra cada passo com CPF/e-mail/telefone mascarados (verificar que o CPF completo **não** aparece em `audit_logs.changes`).
- [ ] Vendedor (`customers.read`/`manage`, sem `documents.read`) lista e recebe `document` mascarado e `documentMasked: true`; Gerente recebe completo.
- [ ] Vendedor edita o nome reenviando a máscara: CPF continua o mesmo no banco; tentar apagar o CPF → erro no campo.
- [ ] CPF repetido na mesma empresa → conflito no campo; o mesmo CPF em outra empresa → permitido.
- [ ] Busca: por parte do nome (sem diferenciar maiúsculas), por CPF exato (com e sem pontuação), por e-mail exato, por telefone exato; filtro de situação; paginação (26 clientes → 2 páginas).
- [ ] Consentimento: marcar grava `consent_at`; desmarcar zera.
- [ ] Supervisor (só `customers.read`) recebe `forbidden` ao criar.
- [ ] Isolamento: dono da empresa B não lê (`getCustomer` null) nem altera ("Cliente não encontrado.") cliente da A; consulta direta com `withScope({ organizationId: B })` não vê linhas da A.
- [ ] `loadActiveCustomer` devolve null para desativado e para outra empresa.
- [ ] Permissões dos perfis do sistema conferem com a tabela da 4.2 (via `findSystemRole`).

### 9.3 Gerais
- [ ] `corepack pnpm lint`, `typecheck`, `lint:rules`, `test`, `build`; integração verde pelo gate; `db:generate` sem mudanças pendentes após gerar.
- [ ] Gate `PASS+REVIEW`; revisão do Maestro com `docs/REVIEW-CHECKLIST.md` (dados pessoais fora de log e auditoria).
- [ ] `docs/data-model.md` e `docs/security.md` atualizados.

## 10. Política de dúvida
Dúvidas ao Maestro, em lote, com proposta. PLANO antes de editar e `DEC-xxx` antes de começar. Sem `git add`, sem commit, sem branch.

## 11. Dependências
- Permitidas: nenhuma nova. Reaproveitar `isValidCpf`, `onlyDigits` (`@/lib/documents`), `optionalEmail`, `optionalPhone`, `requiredText` (`@/server/forms`), `likePattern`, `pageWindow`, `pageResult`, `parsePage` (`@/server/pagination`).
- Proibidas: qualquer outra; nenhuma alteração em `package.json` nem em lockfile.

## 12. Comandos de verificação
```
lint/typecheck/rules/test/build: corepack pnpm lint | typecheck | lint:rules | test | build
schema:      corepack pnpm db:generate   (rodar de novo depois: "No schema changes")
integração:  pwsh -NoProfile -File tools/gate/with-test-db.ps1 corepack pnpm test:integration
gate:        pwsh -NoProfile -Command "& tools/gate/gate.ps1 -Module m28a-clientes -Allowed @('src/db/schema/customers.ts','src/db/schema/index.ts','drizzle/**','src/server/customers/**','src/server/authz/permissions.ts','src/server/authz/system-roles.ts','src/server/authz/system-roles.test.ts','src/server/audit/labels.ts','src/server/audit/service.ts','tests/integration/customers.test.ts','tests/integration/fixtures.ts','docs/data-model.md','docs/security.md')"
```
