# Contrato do módulo `m02b-telas-fornecedores` — v1

> Escrito pelo Maestro a pedido do usuário (21/10/2026), a partir da revisão do Arquiteto (Opus) do contrato m02 original, dividido em [m02a](m02a-telas-categorias-marcas.md) e m02b (este). O Arquiteto deve reconfirmar antes de qualquer delegação. O worker implementa o que está aqui e nada além.
> Se algo estiver ambíguo, o worker PERGUNTA (ver seção 10); não presume.
> Risco: **BAIXO**, condicionado às pré-condições da seção 3. Telas sobre serviços; sem tabela, sem migração, sem dinheiro, sem estoque, sem regra de autorização nova. A autorização é do serviço (ADR-007).

## 1. Objetivo
Tela de **fornecedores** (listar com busca por nome, situação e paginação; criar, editar, ativar/desativar) sobre `src/server/catalog/references.ts`, no mesmo padrão do m02a. Reaproveita `parseStatusParam`, `statusToParam` e `StatusFilter` do m02a e acrescenta "Fornecedores" ao menu "Catálogo".

## 2. Fora de escopo
- Categorias e marcas (m02a), produtos, variações, preços e custos (m03), estoque (m04), importação.
- **Exclusão** de fornecedor: o serviço só desativa; não há botão nem ação de excluir.
- Qualquer alteração em `src/server/catalog/**`, `src/db/**`, `drizzle/**`, permissões, perfis, auditoria, `proxy.ts`, `src/lib/**`, `src/components/ui/**` e nos demais arquivos de `src/components/catalog/` (só `status-filter.tsx` pode mudar, e só como descrito na seção 4.2).
- Teste de componente e ponta a ponta (ver m02a, seção 2). Alterar `docs/`.

## 3. Allowlist de arquivos
Somente estes caminhos podem ser criados ou alterados (usados pelo gate):
```
src/app/(app)/fornecedores/page.tsx
src/app/(app)/fornecedores/actions.ts
src/app/(app)/fornecedores/supplier-dialogs.tsx
src/components/catalog/status-filter.tsx
src/components/shell/nav.ts
src/server/shell.ts
```
Qualquer outro caminho = falha automática do gate. `src/server/shell.ts` recebe 1 linha no mapa `NAV_PERMISSIONS` e **não** está na lista de sensíveis do gate: veredito esperado `PASS`. O Maestro revisa à mão o diff de `actions.ts` e de `shell.ts`.

### Pré-condições
1. **m02a integrado e commitado** (o m02b usa os componentes dele); árvore limpa; `corepack pnpm build` funcionando.
2. **Integração do catálogo verde (condição do risco BAIXO):** antes de o Maestro integrar, `corepack pnpm test:integration` precisa passar contra o `varejo_test` no commit base (115/115 em 20/10/2026, Codex, DEC-002). O Maestro repete a execução; sem ela o m02b não é integrado.
3. Execução **sequencial** ao m02a (nunca em paralelo: ambos tocam `nav.ts` e `shell.ts`).

## 4. Interface pública
### 4.1 Rota e menu
| Rota | Arquivo | Permissão de leitura |
|------|---------|----------------------|
| `/fornecedores` | `src/app/(app)/fornecedores/page.tsx` | `catalog.read` |

`src/server/shell.ts`: acrescentar `"/fornecedores": "catalog.read"` em `NAV_PERMISSIONS`.
`src/components/shell/nav.ts`: acrescentar ao final da seção "Catálogo" (já criada pelo m02a) o item `{ href: "/fornecedores", label: "Fornecedores", icon: Truck }` (ícone de `lucide-react`).

### 4.2 Mudança no `StatusFilter` (única alteração permitida fora de `fornecedores/`)
Em `src/components/catalog/status-filter.tsx`, acrescentar uma prop **opcional** e compatível com o m02a:
```tsx
export function StatusFilter(props: {
  basePath: string;
  value: "ativo" | "inativo" | "";
  label: string;
  options: { all: string; active: string; inactive: string };
  /** When defined (even ""), also shows a name search field named `q` with this default value. */
  query?: string;
}): React.JSX.Element;
```
Quando `query !== undefined`: campo `<Input type="search" name="q" id="filtro-busca" maxLength={80} autoComplete="off">` com rótulo "Buscar por nome" e `defaultValue={query}`, dentro do mesmo formulário GET, antes do `<Select>` de situação. O botão "Limpar filtro" aparece se houver situação **ou** busca ativa. Sem `query`, o componente se comporta exatamente como no m02a (categorias e marcas não podem mudar).

### 4.3 Texto fixo (nada de texto inventado)
| Item | Texto |
|------|-------|
| Título da página, breadcrumb e `metadata.title` | `Fornecedores` |
| Descrição | `Fornecedores dos produtos da empresa, compartilhados por todas as lojas.` |
| Botão de criação | `Novo fornecedor` |
| `filterLabel` do `StatusFilter` | `Filtrar fornecedores` |
| `options` do `StatusFilter` | `Todos` / `Ativos` / `Inativos` |
| Badges de situação | `Ativo` / `Inativo` |
| `caption` da tabela | `Fornecedores cadastrados` |
| Colunas | `Nome`, `CNPJ`, `E-mail`, `Telefone`, `Situação`, e (só com `canManage`) `Ações` |
| Célula vazia (CNPJ, e-mail, telefone) | `—` |
| Vazio sem filtro, com `canManage` | título `Nenhum fornecedor cadastrado`; descrição `Cadastre os fornecedores para associá-los aos produtos.` (+ botão de criação) |
| Vazio sem filtro, sem `canManage` | título `Nenhum fornecedor cadastrado`; descrição `Os fornecedores aparecerão aqui quando um administrador da empresa os cadastrar.` |
| Vazio com busca ou situação | título `Nenhum fornecedor encontrado`; descrição `Altere a busca ou o filtro de situação para ver os demais fornecedores.`; botão `Ver todos` (link para `/fornecedores`) |
| Diálogo de criação / edição | título `Novo fornecedor` / `Editar fornecedor`; botão da linha `Editar` com `aria-label="Editar fornecedor {nome}"` |
| Diálogo de situação | título `Ativar o fornecedor {nome}?` / `Desativar o fornecedor {nome}?`; descrição ao ativar `O fornecedor volta a constar como ativo.`; ao desativar `O cadastro é mantido como inativo e pode ser reativado a qualquer momento. Os produtos que já usam este fornecedor continuam com ele, mas ele deixa de ser oferecido para novos produtos.`; botão `Ativar fornecedor` / `Desativar fornecedor` (`primary` / `danger`), espera `Ativando…` / `Desativando…`; `aria-label="Ativar fornecedor {nome}"` / `"Desativar fornecedor {nome}"` |

A paginação mostra o texto do próprio componente `Pagination` (não há rodapé de limite).

### 4.4 Diálogos de fornecedor
```tsx
// src/app/(app)/fornecedores/supplier-dialogs.tsx — "use client"
import { useFormAction } from "@/components/ui/use-form-action";

type FormAction = Parameters<typeof useFormAction>[0];   // sem export: o hook não exporta o tipo

export interface SupplierRow {
  id: string;
  name: string;
  document: string | null;
  email: string | null;
  phone: string | null;
  isActive: boolean;
}

export function SupplierFormDialog(props: { saveAction: FormAction; row?: SupplierRow }): React.JSX.Element;
export function SupplierStatusDialog(props: { statusAction: FormAction; row: SupplierRow }): React.JSX.Element;
```
Estrutura igual à de `department-dialogs.tsx` (formulário dentro do conteúdo do `Dialog`, `useFormAction`, `Notice` de erro, campo oculto `id` ao editar, `SubmitButton` "Salvar"). Campos, com os **mesmos nomes lidos pelo `pick`** na ação:

| `name` | Rótulo | Controle | Regras do controle | Dica (`hint`) | Valor inicial |
|--------|--------|----------|--------------------|---------------|---------------|
| `name` | `Nome` | `Input` | `required`, `maxLength={120}`, `autoComplete="off"` | `Entre 2 e 120 caracteres.` | `row?.name` |
| `document` | `CNPJ` | `Input` | `maxLength={18}`, `autoComplete="off"`, `inputMode="text"` | `Opcional. Pode digitar com pontuação. Não pode repetir outro fornecedor.` | `row?.document ? formatCnpj(row.document) : ""` |
| `email` | `E-mail` | `Input type="email"` | `maxLength={254}`, `autoComplete="off"` | `Opcional.` | `row?.email ?? ""` |
| `phone` | `Telefone` | `Input type="tel"` | `maxLength={20}`, `autoComplete="off"` | `Opcional. Use DDD + número.` | `row?.phone ? formatPhone(row.phone) : ""` |

Cada `Field` mostra `state.fieldErrors?.<campo>`. `formatCnpj` e `formatPhone` vêm de `@/lib/documents` (puros, servem no cliente). Sem diálogo de exclusão.

### 4.5 Página (`page.tsx`)
Componente `async` de servidor com `export const metadata: Metadata = { title: "Fornecedores" }`:
```tsx
const context = await requireTenantContext();                     // sempre, antes de qualquer leitura
if (!can(context, "catalog.read")) return <AccessDenied />;
const raw = await searchParams;                                   // Promise
const status = parseStatusParam(raw.situacao);                    // string | string[] | undefined
const q = typeof raw.q === "string" ? raw.q : undefined;          // nunca repassar string[]
const filters = supplierFiltersSchema.parse({ q, status, page: typeof raw.page === "string" ? raw.page : undefined });
const result = await listSuppliers(context, filters);
const canManage = can(context, "catalog.manage") && context.storeScope.all;
```
`supplierFiltersSchema` vem de `@/server/catalog/schemas`. Renderização:
- `Breadcrumbs` (Painel > Fornecedores), `PageHeader` com o botão de criação só com `canManage`.
- `StatusFilter` com `basePath="/fornecedores"`, `value={statusToParam(filters.status)}`, `query={filters.q ?? ""}`, `key={`${statusToParam(filters.status)}|${filters.q ?? ""}`}` (reinicia o formulário quando a URL muda, como em `/departamentos`), exibido quando há linhas ou filtro ativo.
- `Table` com `caption`; CNPJ com `formatCnpj` e telefone com `formatPhone` (de `@/lib/documents`), `—` quando vazio; `Badge` de situação.
- `Pagination` (`@/components/ui/table`) com `page={result.page}`, `pageCount={result.pageCount}`, `total={result.total}`, `basePath="/fornecedores"` e **`params={{ q: filters.q, situacao: statusToParam(filters.status) || undefined }}`** — nunca o `searchParams` bruto (pode conter `string[]`).
- A página nunca importa de `@/db` nem de `drizzle-orm`.

### 4.6 Server Actions
Mesmo contrato de `src/app/(app)/departamentos/actions.ts`: `"use server"`, `requireTenantContext()` na primeira linha, `pick()`, Zod, `runAction()`, `revalidatePath("/fornecedores")`.

**Regras de arquivo `"use server"` (o build quebra se violadas):** o arquivo exporta **somente** funções assíncronas; constantes (o estado de erro), schemas e tipos ficam sem `export`; o primeiro parâmetro se chama `_state`.
```ts
export async function saveSupplierAction(_state: ActionState, formData: FormData): Promise<ActionState>;
export async function setSupplierActiveAction(_state: ActionState, formData: FormData): Promise<ActionState>;
```
| Ação | Campos lidos (`pick`) | Serviço | Mensagens de sucesso |
|------|-----------------------|---------|----------------------|
| `saveSupplierAction` | `id` (opcional: `""` ou uuid), `name`, `document`, `email`, `phone` | `createSupplier` / `updateSupplier` com `supplierInputSchema` de `@/server/catalog/schemas` | `Fornecedor cadastrado.` / `Fornecedor atualizado.` |
| `setSupplierActiveAction` | `id` (uuid), `active` (`"true"`/`"false"`) | `setSupplierActive` | `Fornecedor ativado.` / `Fornecedor desativado.` |

`id` ou `active` malformados: `{ status: "error", message: "Fornecedor inválido." }`; campos do formulário inválidos: `invalidState(parsed.error)`. Nome estável de `runAction`: `"saveSupplier"` e `"setSupplierActive"`.

## 5. Dados e esquemas
Nenhum. Funções existentes consumidas (não alterar):
```ts
// @/server/catalog/references
listSuppliers(context, filters: { q?: string; status?: "active" | "inactive"; page: number }): Promise<{
  rows: { id: string; name: string; document: string | null; email: string | null; phone: string | null; isActive: boolean }[];
  total: number; page: number; pageCount: number;
}>;
createSupplier(context, input): Promise<{ id: string }>;
updateSupplier(context, id: string, input): Promise<void>;
setSupplierActive(context, id: string, isActive: boolean): Promise<void>;
```
`document` chega normalizado (14 caracteres, maiúsculas); `phone` chega só com dígitos.

## 6. Invariantes e regras de negócio
- Mesmas regras do m02a, seção 6 (leitura exige `catalog.read`; `canManage = can(context, "catalog.manage") && context.storeScope.all`; sem exclusão; URL em pt-BR; mensagens do serviço mostradas como estão; textos exatamente os da seção 4.3).
- CNPJ repetido ou inválido volta do serviço com erro em `document`; e-mail e telefone inválidos, em `email` e `phone`.
- A busca `q` é por nome (o serviço aplica `ilike` com escape); a tela só a repassa depois de `supplierFiltersSchema`.
- Arquivos com no máximo 350 linhas; comentários em inglês; sem `console`, sem `any`.

## 7. Erros e casos de borda
| Situação | Comportamento esperado |
|----------|------------------------|
| Usuário sem `catalog.read` | `<AccessDenied />` |
| `catalog.read` sem `catalog.manage`, ou escopo parcial | Lista sem botões; ação forjada é recusada pelo serviço |
| `?situacao=` inválido ou repetido; `?q=` repetido (`?q=a&q=b`) | Situação = todos; `q` = ignorado (só aceita string única) |
| `?page=` inválido ou fora do intervalo | O serviço normaliza; a tela mostra a página retornada |
| Busca com `%` ou `_` | Tratados como texto (o serviço escapa) |
| Lista vazia, filtro sem resultado | Os `EmptyState` da seção 4.3 |
| CNPJ, e-mail ou telefone inválido; CNPJ repetido | Erro no campo, diálogo aberto |
| `id` inexistente, de outra empresa ou malformado | Mensagem do serviço ("não encontrado") ou `"Fornecedor inválido."` |
| Erro inesperado | Mensagem genérica de `runAction`, sem detalhe |

## 8. Segurança (obrigatório mesmo em módulo BAIXO)
Igual ao m02a, seção 8: entrada validada por Zod, `pick` com lista de campos, autorização e isolamento no serviço, sem `dangerouslySetInnerHTML`, sem SQL, sem import de `@/db`, `revalidatePath` só de `/fornecedores`. Dados de contato (e-mail, telefone, CNPJ) não vão para log.

## 9. Critérios de aceite (escritos/aprovados pelo Arquiteto)
### 9.1 Testes automatizados
Este módulo não adiciona teste automatizado novo: não há `testing-library`/`jsdom` e as únicas peças puras (`parseStatusParam`, `statusToParam`) já são cobertas pelo m02a. A suíte existente (`corepack pnpm test`) continua verde e o `status-filter.tsx` não pode quebrar o m02a.

### 9.2 Verificações automáticas
- [ ] `corepack pnpm lint`, `typecheck`, `lint:rules`, `test` e **`build`** passam (o build compila a rota nova e prova os tipos).
- [ ] Gate `PASS`.
- [ ] As verificações de `requireTenantContext` e de "sem acesso direto ao banco" da seção 12 não encontram falhas.
- [ ] Pré-condição 2 da seção 3 cumprida pelo Maestro antes de integrar.

### 9.3 Verificação manual do Maestro (não é tarefa do worker)
Com `pnpm dev` e banco descartável:
- [ ] Dono: cria, edita, desativa e reativa fornecedor; CNPJ inválido, CNPJ repetido, e-mail inválido e telefone inválido mostram erro no campo certo; o diálogo reabre limpo.
- [ ] Edição de fornecedor com CNPJ e telefone existentes mostra os valores formatados.
- [ ] Busca por nome (parcial, maiúsculas e minúsculas) e filtro de situação funcionam juntos; a URL guarda `?q=` e `?situacao=`; a paginação preserva os dois; "Limpar filtro" volta ao início.
- [ ] Mais de 25 fornecedores: paginação com "Próxima página" e "Página anterior" corretas.
- [ ] Perfil só com `catalog.read`: vê a lista e o item do menu, sem botões; perfil sem `catalog.read`: sem o item e com "acesso negado" na rota; escopo parcial de lojas: sem botões.
- [ ] As telas de categorias e marcas (m02a) continuam iguais depois da mudança no `StatusFilter`.
- [ ] Layout no celular sem rolagem horizontal da página; textos conforme a seção 4.3.

## 10. Política de dúvida
Igual ao m02a: dúvidas ao Maestro, em lote, com a proposta de resposta; PLANO antes de editar e `DEC-xxx` antes de começar; sem `git add` (nem `-N`), sem commit, sem branch, sem ler o terminal do Maestro.

## 11. Dependências
- Permitidas: nenhuma nova (`next`, `react`, `lucide-react` com `Truck` e os ícones já usados em `/departamentos`, `zod`, `@/components/ui/*`, `@/lib/documents`).
- Proibidas: qualquer outra; nenhuma alteração em `package.json` nem em lockfile.
- Convenções: TypeScript strict sem `any`; alias `@/*`; `"use client"` só em `supplier-dialogs.tsx`; textos em pt-BR.

## 12. Comandos de verificação
```
lint:      corepack pnpm lint
typecheck: corepack pnpm typecheck
rules:     corepack pnpm lint:rules
test:      corepack pnpm test
build:     corepack pnpm build
gate:      pwsh -NoProfile -Command "& tools/gate/gate.ps1 -Module m02b-telas-fornecedores -Allowed @('src/app/(app)/fornecedores/page.tsx','src/app/(app)/fornecedores/actions.ts','src/app/(app)/fornecedores/supplier-dialogs.tsx','src/components/catalog/status-filter.tsx','src/components/shell/nav.ts','src/server/shell.ts')"
sem acesso direto ao banco nas telas (não deve encontrar nada):
           Select-String -Path "src/app/(app)/fornecedores/*.ts*","src/components/catalog/*.ts*" -Pattern "@/db|drizzle-orm|dangerouslySetInnerHTML|console\."
requireTenantContext em cada página e ação (não deve imprimir "FALTA"):
           foreach ($f in "src/app/(app)/fornecedores/page.tsx","src/app/(app)/fornecedores/actions.ts") { if (-not (Select-String -Path $f -Pattern "requireTenantContext" -Quiet)) { "FALTA: $f" } }
```
Resultado esperado do gate: `PASS`. O `build` fica de fora do gate: o worker o executa e relata. (Sem `rg` nesta máquina: usar `Select-String`.)
