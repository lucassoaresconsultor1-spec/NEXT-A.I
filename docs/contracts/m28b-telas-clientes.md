# Contrato do módulo `m28b-telas-clientes` — v1

> Escrito pelo Arquiteto (Opus) em 22/10/2026. O agente implementa o que está aqui e nada além.
> Se algo estiver ambíguo, o agente PERGUNTA (ver seção 10); não presume.
> Risco: **SENSÍVEL** (dados pessoais). Nível: **I** (Codex), pelo ADR-008: máscara do CPF, permissões, auditoria e isolamento estão no serviço testado do m28a (`src/server/customers/`). O Maestro revisa à mão `actions.ts` e `customer-dialogs.tsx` mesmo com o gate em `PASS`.

## 1. Objetivo
Tela de **clientes**: listar com busca (nome, CPF, e-mail ou telefone), situação e paginação; cadastrar, editar e ativar/desativar, respeitando a máscara do CPF para quem não pode vê-lo completo.

## 2. Fora de escopo
- Histórico de compras do cliente (vem com o m06c), importação (m19), exclusão ou anonimização (pendência de produto, ADR-017).
- Qualquer alteração em `src/server/**`, `src/db/**`, `drizzle/**`, `src/components/ui/**`, `src/lib/**`.
- `nav.ts`/`shell.ts`: o Maestro aplica o menu (seção 4.6, ADR-009).

## 3. Allowlist de arquivos
```
src/app/(app)/clientes/page.tsx
src/app/(app)/clientes/actions.ts
src/app/(app)/clientes/customer-dialogs.tsx
```
Veredito esperado: `PASS`. Pré-condições: **m28a e m26 integrados**; árvore limpa; `corepack pnpm build` funcionando.

## 4. Interface pública
### 4.1 Página `/clientes` (`page.tsx`, servidor)
- `requireTenantContext()`; sem `customers.read` → `<AccessDenied />`; `metadata.title = "Clientes"`; `searchParams` é `Promise`; parâmetros só aceitos se `string`.
- `canManage = can(context, "customers.manage")` (clientes são da empresa; o serviço não exige acesso a todas as lojas).
- Dados: `listCustomers(context, customerFiltersSchema.parse({ q, status: parseStatusParam(raw.situacao), page }))` (`customerFiltersSchema` de `@/server/customers/schemas`; `parseStatusParam`/`statusToParam` de `@/components/catalog/status-param`).
- Filtro: `StatusFilter` de `@/components/catalog/status-filter` com `basePath="/clientes"`, `label="Filtrar clientes"`, `options={{ all: "Todos", active: "Ativos", inactive: "Inativos" }}`, `query={filters.q ?? ""}` e `key` com situação e busca (como no m02b). O rótulo do campo de busca é o do componente ("Buscar por nome"); acima da tabela, texto `Também é possível buscar pelo CPF, e-mail ou telefone completos.` em `text-xs text-ink-muted`.
- Cabeçalho: `PageHeader` "Clientes", descrição `Clientes da empresa, compartilhados por todas as lojas. Use o mínimo de dados necessário.`; botão de criação só com `canManage`.
- Tabela (`caption` "Clientes cadastrados"): Nome, CPF (`documentMasked` → o valor como veio; senão `formatCpf(document)`; nulo → `—`), E-mail (`—`), Telefone (`formatPhone` ou `—`), Contato autorizado (`Badge` `brand` "Sim" ou texto "Não"), Situação (`Badge` `Ativo`/`Inativo`), e Ações só com `canManage`.
- `Pagination` com `params={{ q: filters.q, situacao: statusToParam(filters.status) || undefined }}`.
- Vazios: sem clientes e sem filtro → `Nenhum cliente cadastrado` / com `canManage` `Cadastre clientes para identificá-los nas vendas.` + botão; sem `canManage` `Os clientes aparecerão aqui quando forem cadastrados.`; com filtro → `Nenhum cliente encontrado` / `Altere a busca ou o filtro de situação.` + `Ver todos`.

### 4.2 Diálogos (`customer-dialogs.tsx`, `"use client"`)
```tsx
import { useFormAction } from "@/components/ui/use-form-action";
type FormAction = Parameters<typeof useFormAction>[0];            // sem export

export interface CustomerDialogRow {
  id: string; name: string; document: string | null; documentMasked: boolean;
  email: string | null; phone: string | null; marketingConsent: boolean; isActive: boolean;
}
export function CustomerFormDialog(props: { saveAction: FormAction; row?: CustomerDialogRow }): React.JSX.Element;
export function CustomerStatusDialog(props: { statusAction: FormAction; row: CustomerDialogRow }): React.JSX.Element;
```
Estrutura igual à de `department-dialogs.tsx` (formulário dentro do conteúdo, `useFormAction`, `Notice`, `SubmitButton` "Salvar", campo oculto `id` ao editar). Campos (nomes = os do `pick` da ação):

| `name` | Rótulo | Controle | Valor inicial | Dica |
|--------|--------|----------|---------------|------|
| `name` | Nome | `Input`, `required`, `maxLength={120}`, `autoComplete="off"` | `row?.name` | `Entre 2 e 120 caracteres.` |
| `document` | CPF | `Input`, `inputMode="numeric"`, `maxLength={14}`, `autoComplete="off"` | `row?.documentMasked ? row.document : (row?.document ? formatCpf(row.document) : "")` | sem máscara: `Opcional. Não pode repetir outro cliente.`; com máscara: `O CPF está oculto para o seu perfil. Deixe como está para mantê-lo ou digite o CPF completo para trocá-lo.` |
| `email` | E-mail | `Input type="email"`, `maxLength={254}`, `autoComplete="off"` | `row?.email ?? ""` | `Opcional.` |
| `phone` | Telefone | `Input type="tel"`, `maxLength={20}`, `autoComplete="off"` | `row?.phone ? formatPhone(row.phone) : ""` | `Opcional. Use DDD + número.` |
| `marketingConsent` | — | `Checkbox` com o texto `O cliente autorizou receber contatos e ofertas.` | `row?.marketingConsent` | — |

- Títulos: `Novo cliente` / `Editar cliente`; botão de linha `Editar` com `aria-label="Editar cliente {nome}"`.
- Situação: título `Ativar o cliente {nome}?` / `Desativar o cliente {nome}?`; descrição ao desativar `O cadastro é mantido e pode ser reativado. Clientes inativos não são oferecidos no PDV.`, ao ativar `O cliente volta a ser oferecido no PDV.`; botões `Ativar cliente` (`primary`) / `Desativar cliente` (`danger`), espera `Ativando…`/`Desativando…`; `aria-label="Ativar cliente {nome}"` / `"Desativar cliente {nome}"`.
- O CPF completo nunca chega ao cliente sem `customers.documents.read`: o diálogo usa só o que a página recebeu do serviço.

### 4.3 Server Actions (`actions.ts`)
`"use server"`; exporta só funções async; `_state` primeiro; `requireTenantContext()` na primeira linha.
```ts
export async function saveCustomerAction(_state: ActionState, formData: FormData): Promise<ActionState>;
export async function setCustomerActiveAction(_state: ActionState, formData: FormData): Promise<ActionState>;
```
- `saveCustomerAction`: `id` opcional (`""` ou uuid, senão `{ status: "error", message: "Cliente inválido." }`); `pick(formData, ["name", "document", "email", "phone", "marketingConsent"])` repassado **cru** a `createCustomer`/`updateCustomer` (o serviço valida e devolve erros por campo; `marketingConsent` ausente = desmarcado). Mensagens `Cliente cadastrado.` / `Cliente atualizado.`; nome estável `saveCustomer`.
- `setCustomerActiveAction`: `id` uuid e `active` `"true"`/`"false"` (senão `Cliente inválido.`); `setCustomerActive`; `Cliente ativado.` / `Cliente desativado.`; nome estável `setCustomerActive`.
- `revalidatePath("/clientes")` após sucesso.

### 4.4 Textos e estados
Textos exatamente os desta seção; carregando (skeleton do grupo, m26), erro (limite do m26), vazio, sem permissão; celular sem rolagem horizontal da página (tabela com `overflow-x-auto` dentro do `Card`).

### 4.5 Segurança na tela
Nada de CPF, e-mail ou telefone em `aria-label`, `title`, URL ou log; a busca vai na URL (`?q=`) só quando o usuário a digita — é a mesma regra do resto do produto, registrada como risco aceito.

### 4.6 Menu (aplicado pelo Maestro, ADR-009)
- `nav.ts`: nova seção **"Vendas"** logo depois de "Estoque", com `{ href: "/clientes", label: "Clientes", icon: Contact }` (`lucide-react`). (O PDV e o histórico de vendas entram nesta seção depois.)
- `shell.ts` `NAV_PERMISSIONS`: `"/clientes": "customers.read"`.

## 5. Dados e esquemas
Nenhuma tabela. Consumidos (não alterar): `listCustomers`, `createCustomer`, `updateCustomer`, `setCustomerActive` (`@/server/customers/service`); `customerFiltersSchema` (`@/server/customers/schemas`); `formatCpf`, `formatPhone` (`@/lib/documents`); `StatusFilter`, `parseStatusParam`, `statusToParam` (`@/components/catalog/*`).

## 6. Invariantes
- A tela não decide máscara nem permissão além de `canManage` para os botões; o serviço é a fonte.
- Mensagens do serviço exibidas como estão; erro inesperado pela mensagem genérica de `runAction`.
- Comentários em inglês; arquivos ≤ 350 linhas; sem `any`, sem `console`, sem `dangerouslySetInnerHTML`, sem import de `@/db`.

## 7. Erros e casos de borda
| Situação | Comportamento esperado |
|----------|------------------------|
| Sem `customers.read` | `<AccessDenied />` |
| Sem `customers.manage` | Lista sem botões; ação forjada recusada pelo serviço |
| CPF inválido ou repetido, e-mail/telefone inválido | Erro no campo, diálogo aberto |
| Perfil sem documento apaga o CPF | Erro no campo vindo do serviço |
| `?q=` repetido, `?page=` inválido | Ignorado / normalizado |

## 8. Segurança
`requireTenantContext()` na página e nas ações; `pick` com lista fixa; dados pessoais fora de log e de atributos de acessibilidade.

## 9. Critérios de aceite
### 9.1 Automáticos
- [ ] `corepack pnpm lint`, `typecheck`, `lint:rules`, `test`, `build` verdes; gate `PASS`.
- [ ] `Select-String -Path "src/app/(app)/clientes/*.ts*" -Pattern "@/db|drizzle-orm|dangerouslySetInnerHTML|console\."` vazio; `requireTenantContext` em `page.tsx` e `actions.ts`.
- [ ] `tests/integration/customers.test.ts` continua verde (nenhum serviço muda) — verificado pelo Maestro.

### 9.2 Manual (Maestro, banco descartável)
- [ ] Gerente de loja: cria cliente com CPF, edita, desativa e reativa; CPF repetido e inválido mostram erro no campo.
- [ ] Vendedor: vê o CPF mascarado na lista e no diálogo; edita o nome mantendo a máscara e o CPF continua o mesmo; apagar o CPF mostra o erro do serviço; o código-fonte da página não contém o CPF completo.
- [ ] Supervisor: lista sem botões. Perfil sem `customers.read`: acesso negado e sem item de menu.
- [ ] Busca por nome, por CPF completo (com e sem pontuação), por e-mail e por telefone; paginação preserva busca e situação.
- [ ] Celular sem rolagem horizontal; leitor de tela anuncia rótulos, dicas e erros.

## 10. Política de dúvida
Dúvidas ao Maestro, em lote, com proposta. PLANO antes de editar e `DEC-xxx` antes de começar. Sem `git add`, sem commit, sem branch.

## 11. Dependências
Nenhuma nova; nenhuma alteração em `package.json` nem em lockfile.

## 12. Comandos de verificação
```
lint/typecheck/rules/test/build: corepack pnpm lint | typecheck | lint:rules | test | build
gate: pwsh -NoProfile -Command "& tools/gate/gate.ps1 -Module m28b-telas-clientes -Allowed @('src/app/(app)/clientes/**')"
```
