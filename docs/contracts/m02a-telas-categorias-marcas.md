# Contrato do módulo `m02a-telas-categorias-marcas` — v1

> Escrito pelo Maestro a pedido do usuário (21/10/2026), a partir da revisão do Arquiteto (Opus) do contrato m02 original, que foi dividido em m02a (este) e [m02b](m02b-telas-fornecedores.md). O Arquiteto deve reconfirmar antes de qualquer delegação. O worker implementa o que está aqui e nada além.
> Se algo estiver ambíguo, o worker PERGUNTA (ver seção 10); não presume.
> Risco: **BAIXO**, condicionado à pré-condição da seção 3 (suíte de integração do catálogo verde). Telas sobre serviços; sem tabela, sem migração, sem dinheiro, sem estoque, sem regra de autorização nova. A autorização é do serviço (ADR-007); as telas só a espelham.

## 1. Objetivo
Telas de **categorias** e **marcas** (listar, criar, editar, ativar/desativar) sobre `src/server/catalog/references.ts`, para quem tem `catalog.read` ver e quem tem `catalog.manage` com acesso a todas as lojas gerenciar. Padrão visual e de código: `/departamentos` (`src/app/(app)/departamentos/`). Cria também a seção "Catálogo" do menu e os componentes que o m02b reaproveita.

## 2. Fora de escopo
- Fornecedores (m02b), produtos, variações, preços e custos (m03), estoque (m04), busca global e importação.
- **Exclusão** de categoria ou marca: o serviço só desativa; não há botão nem ação de excluir.
- Qualquer alteração em `src/server/catalog/**`, `src/db/**`, `drizzle/**`, permissões, perfis, auditoria, `proxy.ts`, `src/lib/**` e `src/components/ui/**`.
- Teste de ponta a ponta (Playwright) e teste de componente: o projeto não tem `testing-library` nem `jsdom`, e o Playwright exige Chromium e banco. A verificação de tela é manual (seção 9.3).
- Alterar `docs/` (o Maestro atualiza `roadmap.md` e `architecture.md` depois da aceitação).
- Código para o m02b (por exemplo o campo de busca do filtro): isso é do m02b.

## 3. Allowlist de arquivos
Somente estes caminhos podem ser criados ou alterados (usados pelo gate):
```
src/app/(app)/categorias/page.tsx
src/app/(app)/categorias/actions.ts
src/app/(app)/marcas/page.tsx
src/app/(app)/marcas/actions.ts
src/components/catalog/status-param.ts
src/components/catalog/status-param.test.ts
src/components/catalog/status-filter.tsx
src/components/catalog/reference-view.tsx
src/components/catalog/reference-dialogs.tsx
src/components/shell/nav.ts
src/server/shell.ts
```
Qualquer outro caminho = falha automática do gate. `src/server/shell.ts` só recebe 2 linhas no mapa `NAV_PERMISSIONS`; ele **não** está na lista de sensíveis do gate, então o veredito esperado é `PASS`. Mesmo assim o Maestro revisa à mão o diff dos dois `actions.ts` e de `src/server/shell.ts` antes de integrar.

### Pré-condições
1. **Árvore limpa** (tudo commitado) e `corepack pnpm build` funcionando. Se o build falhar por variável de ambiente ausente, o worker NÃO cria `.env` e NÃO mexe em `src/lib/env*`: avisa o Maestro.
2. **Integração do catálogo verde (condição do risco BAIXO):** antes de o Maestro **integrar** este módulo, `corepack pnpm test:integration` precisa passar contra o `varejo_test` no commit base. Evidência atual: 115/115 em 20/10/2026 (Codex, DEC-002, com a correção do preço corrente). O Maestro repete a execução antes de aceitar; sem ela o m02a não é integrado.

## 4. Interface pública
Nomes e comportamentos exatos. Rotas em pt-BR; textos exibidos em pt-BR.

### 4.1 Rotas e menu
| Rota | Arquivo | Permissão de leitura |
|------|---------|----------------------|
| `/categorias` | `src/app/(app)/categorias/page.tsx` | `catalog.read` |
| `/marcas` | `src/app/(app)/marcas/page.tsx` | `catalog.read` |

`src/server/shell.ts`: acrescentar em `NAV_PERMISSIONS` as duas rotas com `"catalog.read"`.
`src/components/shell/nav.ts`: nova seção entre "Estrutura" e "Pessoas e acesso", com os ícones importados de `lucide-react`:
```ts
{
  label: "Catálogo",
  items: [
    { href: "/categorias", label: "Categorias", icon: Tags },
    { href: "/marcas", label: "Marcas", icon: Award },
  ],
},
```
(O m02b acrescenta "Fornecedores"; não antecipar.)

### 4.2 Parâmetros de URL e helper de situação
Nas duas listas: `?situacao=ativo|inativo` (qualquer outro valor = todos). Valores sempre em pt-BR na URL.

```ts
// src/components/catalog/status-param.ts — puro, sem React
export type CatalogStatus = "active" | "inactive";

/** "ativo" -> "active", "inativo" -> "inactive"; anything else (including arrays and undefined) -> undefined. */
export function parseStatusParam(value: unknown): CatalogStatus | undefined;

/** "active" -> "ativo", "inactive" -> "inativo", undefined -> "". */
export function statusToParam(status: CatalogStatus | undefined): "ativo" | "inativo" | "";
```

```tsx
// src/components/catalog/status-filter.tsx — componente de servidor (sem "use client")
// Formulário GET com next/form, como o StatusFilter de /departamentos: funciona sem JavaScript.
export function StatusFilter(props: {
  basePath: string;
  value: "ativo" | "inativo" | "";
  label: string;                                          // aria-label do formulário
  options: { all: string; active: string; inactive: string }; // rótulos do <select>
}): React.JSX.Element;
```
Campo `<Select name="situacao">` com rótulo "Situação", botões "Filtrar" e "Limpar filtro" (este só com situação ativa), `Link` de volta para `basePath`.

### 4.3 Texto fixo (nada de texto inventado)
```ts
// src/components/catalog/reference-dialogs.tsx (exporta o tipo; o objeto de cada rota fica no próprio page.tsx)
export interface ReferenceCopy {
  title: string;                   // título da página e do breadcrumb
  description: string;             // subtítulo do PageHeader
  singular: string;
  plural: string;
  newButton: string;
  nameHint: string;
  filterLabel: string;
  filterOptions: { all: string; active: string; inactive: string };
  activeBadge: string;
  inactiveBadge: string;
  caption: string;                 // caption da tabela
  emptyTitle: string;
  emptyDescriptionManage: string;
  emptyDescriptionReadOnly: string;
  emptyFilteredActive: string;
  emptyFilteredInactive: string;
}
```
Valores exatos:

| Campo | Categorias | Marcas |
|-------|------------|--------|
| `title` | `Categorias` | `Marcas` |
| `description` | `Agrupe os produtos da empresa por categoria. O cadastro é compartilhado por todas as lojas.` | `Marcas dos produtos vendidos pela empresa, compartilhadas por todas as lojas.` |
| `singular` / `plural` | `categoria` / `categorias` | `marca` / `marcas` |
| `newButton` | `Nova categoria` | `Nova marca` |
| `nameHint` | `Entre 2 e 80 caracteres. Não pode repetir outra categoria.` | `Entre 2 e 80 caracteres. Não pode repetir outra marca.` |
| `filterLabel` | `Filtrar categorias` | `Filtrar marcas` |
| `filterOptions` | `Todas` / `Ativas` / `Inativas` | `Todas` / `Ativas` / `Inativas` |
| `activeBadge` / `inactiveBadge` | `Ativa` / `Inativa` | `Ativa` / `Inativa` |
| `caption` | `Categorias cadastradas` | `Marcas cadastradas` |
| `emptyTitle` | `Nenhuma categoria cadastrada` | `Nenhuma marca cadastrada` |
| `emptyDescriptionManage` | `Cadastre categorias para organizar os produtos da empresa.` | `Cadastre as marcas dos produtos da empresa.` |
| `emptyDescriptionReadOnly` | `As categorias aparecerão aqui quando um administrador da empresa cadastrá-las.` | `As marcas aparecerão aqui quando um administrador da empresa cadastrá-las.` |
| `emptyFilteredActive` / `emptyFilteredInactive` | `Nenhuma categoria ativa` / `Nenhuma categoria inativa` | `Nenhuma marca ativa` / `Nenhuma marca inativa` |

Textos derivados (as duas entidades são femininas; usar "a", "esta", "Ver todas"):
- Diálogo de edição: título `Editar {singular}`; criação: título = `newButton`; botão da linha: `Editar` com `aria-label="Editar {singular} {nome}"`.
- Diálogo de situação: título `Ativar a {singular} {nome}?` / `Desativar a {singular} {nome}?`; descrição ao ativar `A {singular} volta a constar como ativa.`; descrição ao desativar `O cadastro é mantido como inativo e pode ser reativado a qualquer momento. Os produtos que já usam esta {singular} continuam com ela, mas ela deixa de ser oferecida para novos produtos.`; botão de ação `Ativar {singular}` / `Desativar {singular}` (`variant="primary"` / `"danger"`), espera `Ativando…` / `Desativando…`; `aria-label="Ativar {singular} {nome}"` / `"Desativar {singular} {nome}"`.
- Vazio por filtro: título `emptyFilteredActive`/`Inactive`, descrição `Altere o filtro de situação para ver as demais {plural}.`, botão `Ver todas` (link para `basePath`).
- Rodapé: `{N} {singular|plural}` e, quando `N >= limit`, ` · exibindo as primeiras {limit} em ordem alfabética` (números com `formatInteger`; **"as primeiras"**, feminino).

### 4.4 Diálogos compartilhados por categorias e marcas
```tsx
// src/components/catalog/reference-dialogs.tsx — "use client"
import { useFormAction } from "@/components/ui/use-form-action";

/** The hook's own action type (it is not exported); do not redeclare it. */
export type FormAction = Parameters<typeof useFormAction>[0];

export interface ReferenceRow { id: string; name: string; isActive: boolean }

export function ReferenceFormDialog(props: { copy: ReferenceCopy; saveAction: FormAction; row?: ReferenceRow }): React.JSX.Element;
export function ReferenceStatusDialog(props: { copy: ReferenceCopy; statusAction: FormAction; row: ReferenceRow }): React.JSX.Element;
```
Estrutura igual à de `department-dialogs.tsx`: o `<form>` fica dentro do conteúdo do `Dialog` (reinicia a cada abertura), `useFormAction(action, onDone)`, `Notice` de erro, `Field` com `error={state.fieldErrors?.name}` e `hint={copy.nameHint}`, campo oculto `id` ao editar, `SubmitButton` "Salvar". Campo `name`: `maxLength={80}`, `required`, `autoComplete="off"`, rótulo "Nome". Sem diálogo de exclusão. Não redeclarar o tipo `FormAction`: ele vem do hook.

### 4.5 Visão de lista
```tsx
// src/components/catalog/reference-view.tsx — componente de servidor
import type { LucideIcon } from "lucide-react";

export function ReferenceView(props: {
  basePath: "/categorias" | "/marcas";
  icon: LucideIcon;               // ícone do EmptyState
  copy: ReferenceCopy;
  rows: ReferenceRow[];
  status: CatalogStatus | undefined;
  canManage: boolean;
  limit: number;                  // REFERENCE_LIST_LIMIT
  saveAction: FormAction;
  statusAction: FormAction;
}): React.JSX.Element;
```
Renderiza `Breadcrumbs` (Painel > `copy.title`), `PageHeader` (título e descrição de `copy`; botão de criação só com `canManage`), `Card` com `StatusFilter` (`key={statusToParam(status)}`, quando há linhas ou filtro ativo; `options={copy.filterOptions}`, `label={copy.filterLabel}`), os três `EmptyState` (filtro sem resultado, vazio com `canManage`, vazio sem `canManage`), `Table` com `caption`, colunas Nome, Situação (`Badge` positivo/neutro com `activeBadge`/`inactiveBadge`) e, só com `canManage`, Ações (editar e ativar/desativar), e o rodapé da seção 4.3.

### 4.6 Páginas (`page.tsx`)
Cada `page.tsx` é um componente `async` de servidor com `export const metadata: Metadata = { title: "Categorias" }` (ou "Marcas") e define o objeto `copy` com os valores da seção 4.3 como constante **não exportada** do arquivo. Fluxo:
```tsx
const context = await requireTenantContext();                 // sempre, antes de qualquer leitura
if (!can(context, "catalog.read")) return <AccessDenied />;
const params = await searchParams;                            // searchParams é uma Promise
const status = parseStatusParam(params.situacao);             // aceita string | string[] | undefined
const rows = await listReferences(context, "category" /* ou "brand" */, { status });
const canManage = can(context, "catalog.manage") && context.storeScope.all; // espelha assertCanManageCatalog
```
Depois renderiza `<ReferenceView … />` passando `limit={REFERENCE_LIST_LIMIT}`. A página nunca importa de `@/db` nem de `drizzle-orm`.

### 4.7 Server Actions
Mesmo contrato de `src/app/(app)/departamentos/actions.ts`: `"use server"`, `requireTenantContext()` na primeira linha, entrada lida com `pick()`, validada com Zod, `runAction()`, `revalidatePath`.

**Regras de arquivo `"use server"` (o build quebra se violadas):** o arquivo exporta **somente** funções assíncronas. Constantes (como o estado de erro `INVALID`), schemas Zod e tipos ficam **sem `export`**. O primeiro parâmetro das ações se chama `_state` (não usado).

```ts
// categorias/actions.ts
export async function saveCategoryAction(_state: ActionState, formData: FormData): Promise<ActionState>;
export async function setCategoryActiveAction(_state: ActionState, formData: FormData): Promise<ActionState>;
// marcas/actions.ts
export async function saveBrandAction(_state: ActionState, formData: FormData): Promise<ActionState>;
export async function setBrandActiveAction(_state: ActionState, formData: FormData): Promise<ActionState>;
```
| Ação | Campos lidos (`pick`) | Serviço chamado | Mensagens de sucesso |
|------|-----------------------|-----------------|----------------------|
| `save*Action` | `id` (opcional: `""` ou uuid), `name` | `createReference` / `updateReference` com `referenceInputSchema` de `@/server/catalog/schemas` | `Categoria cadastrada.` / `Categoria atualizada.`; `Marca cadastrada.` / `Marca atualizada.` |
| `set*ActiveAction` | `id` (uuid), `active` (`"true"` / `"false"`) | `setReferenceActive` | `Categoria ativada.` / `Categoria desativada.`; `Marca ativada.` / `Marca desativada.` |

`id` ou `active` malformados: `{ status: "error", message: "Categoria inválida." }` (ou `"Marca inválida."`); campos do formulário inválidos: `invalidState(parsed.error)`. Depois do sucesso: `revalidatePath("/categorias")` (ou `"/marcas"`). O terceiro argumento de `runAction` é um nome estável: `"saveCategory"`, `"setCategoryActive"`, `"saveBrand"`, `"setBrandActive"`.

## 5. Dados e esquemas
Nenhum. Sem tabelas, sem migrações. As telas só consomem estas funções existentes (não alterar):
```ts
// @/server/catalog/references
listReferences(context, kind: "category" | "brand", filters?: { status?: "active" | "inactive" }): Promise<{ id: string; name: string; isActive: boolean }[]>;
createReference(context, kind, input: { name: string }): Promise<{ id: string }>;
updateReference(context, kind, id: string, input: { name: string }): Promise<void>;
setReferenceActive(context, kind, id: string, isActive: boolean): Promise<void>;
REFERENCE_LIST_LIMIT: number; // 500
```

## 6. Invariantes e regras de negócio
- Toda página chama `requireTenantContext()` e confere `catalog.read`; toda Server Action chama `requireTenantContext()` (layout não protege página nem ação).
- `canManage = can(context, "catalog.manage") && context.storeScope.all`. Quem não tem `canManage` vê a lista sem botões de ação (o serviço recusa de qualquer forma).
- As telas não decidem permissão além disso, não duplicam regra do serviço e não escondem erro: a mensagem do serviço (`DomainError`) aparece ao usuário como está.
- Nome repetido volta do serviço com erro no campo `name`; a tela o exibe em `Field error`.
- Sem exclusão; desativar mantém o registro. Itens inativos continuam na lista (o filtro de situação os separa).
- URL em pt-BR (`?situacao=ativo`), nunca `active`.
- Acessibilidade: `aria-label` em cada botão de linha, `Table` com `caption`, `Field` com `label` e `hint`; foco e fechamento por teclado vêm do `Dialog` existente.
- Textos 100% em pt-BR, exatamente os da seção 4.3, sem dados de exemplo.
- Arquivos com no máximo 350 linhas; comentários em inglês como no restante do projeto; sem `console`, sem `any`.

## 7. Erros e casos de borda
| Situação | Comportamento esperado |
|----------|------------------------|
| Usuário sem `catalog.read` abre a rota | `<AccessDenied />` (sem consulta ao banco) |
| `catalog.read` sem `catalog.manage`, ou com escopo de lojas parcial | Lista sem botões; ação forjada é recusada pelo serviço e a mensagem aparece no diálogo |
| `?situacao=` inválido ou repetido (`?situacao=a&situacao=b`) | Trata como "todos" (`parseStatusParam` devolve `undefined` para array) |
| Lista vazia sem filtro | `EmptyState` com texto para quem pode e para quem não pode cadastrar |
| Filtro sem resultado | `EmptyState` com título por situação e botão `Ver todas` |
| Nome já usado | Erro no campo; o diálogo continua aberto |
| `id` inexistente, de outra empresa ou malformado | Mensagem do serviço ("não encontrada") ou `"… inválida."`; nunca stack trace |
| Erro inesperado | `runAction` devolve a mensagem genérica e registra no log |

## 8. Segurança (obrigatório mesmo em módulo BAIXO)
- Toda entrada externa (formulário e URL) validada por Zod antes de ir ao serviço; nunca repassar o `FormData` inteiro (`pick` com lista de campos).
- Autorização e isolamento por empresa ficam no serviço; a tela confere de novo a leitura e não confia em `id` do cliente.
- Sem segredos no código; sem log de dados do formulário; sem `dangerouslySetInnerHTML`; nada de SQL nem de import de `@/db`.
- `revalidatePath` só das rotas do módulo.

## 9. Critérios de aceite (escritos/aprovados pelo Arquiteto)
### 9.1 Testes automatizados que o worker escreve
Em `src/components/catalog/status-param.test.ts`:
- [ ] `parseStatusParam("ativo")` → `"active"`; `("inativo")` → `"inactive"`.
- [ ] `parseStatusParam` com `""`, `"active"`, `"ATIVO"`, `undefined`, `null`, um número, `["ativo"]` e `["ativo","inativo"]` → `undefined`.
- [ ] `statusToParam("active")` → `"ativo"`; `("inactive")` → `"inativo"`; `(undefined)` → `""`.
- [ ] Ida e volta: `statusToParam(parseStatusParam(x))` devolve `x` para `"ativo"` e `"inativo"`.
- [ ] O arquivo não usa `any`, `skip` nem `only`.

### 9.2 Verificações automáticas
- [ ] `corepack pnpm lint`, `typecheck`, `lint:rules`, `test` e **`build`** passam (o build compila as duas rotas e prova os tipos das páginas e das Server Actions, inclusive a regra de que arquivos `"use server"` só exportam funções assíncronas).
- [ ] Gate `PASS`.
- [ ] A verificação de `requireTenantContext` e a de "sem acesso direto ao banco" da seção 12 não encontram falhas.
- [ ] Pré-condição 2 da seção 3 cumprida pelo Maestro (`test:integration` verde) antes de integrar.

### 9.3 Verificação manual do Maestro (não é tarefa do worker)
Com `pnpm dev` apontando para um banco descartável com uma empresa de teste:
- [ ] Dono: as duas rotas listam, criam, editam, desativam e reativam; nome repetido mostra erro no campo; o diálogo reabre limpo.
- [ ] Perfil só com `catalog.read` (ex.: Vendedor): vê as listas e a seção "Catálogo" do menu, sem botões de ação.
- [ ] Perfil sem `catalog.read`: menu sem "Catálogo" e a rota mostra "acesso negado".
- [ ] Usuário com `catalog.manage` e escopo de lojas parcial: sem botões.
- [ ] Filtro de situação guarda `?situacao=` na URL; `?situacao=x` mostra todos.
- [ ] Layout no celular (largura estreita) sem rolagem horizontal da página.
- [ ] Mensagens, rótulos e `aria-label` em pt-BR, conforme a seção 4.3.

## 10. Política de dúvida
O worker pergunta ao Maestro (não ao Arquiteto) quando: contrato ambíguo, interface insuficiente, dependência nova necessária, ou quando o padrão de `/departamentos` não bastar para um caso. Perguntas em lote, com a proposta de resposta já escrita. Antes de editar, envia o PLANO ao Maestro e espera o `DEC-xxx`. Não usa `git add` (nem `-N`), não commita, não cria branch, não lê o terminal do Maestro.

## 11. Dependências
- Permitidas: nenhuma nova. Somente `next`, `react`, `lucide-react` (`Tags`, `Award` e os ícones que `/departamentos` já usa), `zod` e os componentes de `@/components/ui/*` existentes.
- Proibidas: qualquer outra (pedir aprovação antes de instalar); nenhuma alteração em `package.json` nem em lockfile.
- Convenções: TypeScript strict sem `any`; alias `@/*`; `"use client"` só em `reference-dialogs.tsx`; textos em pt-BR.

## 12. Comandos de verificação
```
lint:      corepack pnpm lint
typecheck: corepack pnpm typecheck
rules:     corepack pnpm lint:rules
test:      corepack pnpm exec vitest run src/components/catalog/status-param.test.ts
test (todos): corepack pnpm test
build:     corepack pnpm build
gate:      pwsh -NoProfile -Command "& tools/gate/gate.ps1 -Module m02a-telas-categorias-marcas -Allowed @('src/app/(app)/categorias/page.tsx','src/app/(app)/categorias/actions.ts','src/app/(app)/marcas/page.tsx','src/app/(app)/marcas/actions.ts','src/components/catalog/status-param.ts','src/components/catalog/status-param.test.ts','src/components/catalog/status-filter.tsx','src/components/catalog/reference-view.tsx','src/components/catalog/reference-dialogs.tsx','src/components/shell/nav.ts','src/server/shell.ts')"
sem acesso direto ao banco nas telas (não deve encontrar nada):
           Select-String -Path "src/app/(app)/categorias/*.ts*","src/app/(app)/marcas/*.ts*","src/components/catalog/*.ts*" -Pattern "@/db|drizzle-orm|dangerouslySetInnerHTML|console\."
requireTenantContext em cada página e ação (não deve imprimir "FALTA"):
           foreach ($f in "src/app/(app)/categorias/page.tsx","src/app/(app)/categorias/actions.ts","src/app/(app)/marcas/page.tsx","src/app/(app)/marcas/actions.ts") { if (-not (Select-String -Path $f -Pattern "requireTenantContext" -Quiet)) { "FALTA: $f" } }
```
Resultado esperado do gate: `PASS`. O `build` fica de fora do gate: o worker o executa e relata. (O `rg` não existe nesta máquina; usar `Select-String`.)
