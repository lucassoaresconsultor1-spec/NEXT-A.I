# Contrato do módulo `m03-telas-produtos` — v1

> Escrito pelo Arquiteto (Opus) em 21/10/2026. O agente implementa o que está aqui e nada além.
> Se algo estiver ambíguo, o agente PERGUNTA (ver seção 10); não presume.
> Risco: **SENSÍVEL** (preço e custo). Nível: **I** (Codex), pelo ADR-008: as regras de dinheiro, custo e permissão já estão no serviço testado (`src/server/catalog/`); a tela só as chama. O Maestro revisa à mão `actions.ts` e `src/server/catalog/options.ts` mesmo com o gate em `PASS`.

## 1. Objetivo
Telas de **produtos**: listar com busca e filtros, cadastrar produto com variações (preço e, para quem pode, custo), ver o detalhe, editar produto e variações, ativar/desativar, alterar preço e custo e consultar o histórico de preço/custo de cada variação.

## 2. Fora de escopo
- Estoque (m04), importação (m19), fotos/imagens, etiquetas, preço por loja (o preço é único na empresa, ver `docs/data-model.md`).
- Exclusão de produto ou variação (o serviço só desativa).
- Qualquer alteração em `src/server/catalog/{service,variants,pricing,references,queries,schemas}.ts`, `src/db/**`, `drizzle/**`, permissões, auditoria e `src/components/ui/**`.
- `src/components/shell/nav.ts` e `src/server/shell.ts`: o Maestro aplica as linhas de menu na integração (seção 4.8, ADR-009).

## 3. Allowlist de arquivos
```
src/lib/money.ts
src/lib/money.test.ts
src/server/catalog/options.ts
tests/integration/catalog-options.test.ts
src/app/(app)/produtos/page.tsx
src/app/(app)/produtos/product-filters.tsx
src/app/(app)/produtos/actions.ts
src/app/(app)/produtos/variant-form-data.ts
src/app/(app)/produtos/variant-form-data.test.ts
src/app/(app)/produtos/novo/page.tsx
src/app/(app)/produtos/novo/new-product-form.tsx
src/app/(app)/produtos/[productId]/page.tsx
src/app/(app)/produtos/[productId]/product-dialogs.tsx
src/app/(app)/produtos/[productId]/variant-dialogs.tsx
src/app/(app)/produtos/[productId]/historico/page.tsx
```
Veredito esperado do gate: `PASS` (nenhum caminho sensível). O gate não roda a integração nesse caso: o agente roda `tests/integration/catalog-options.test.ts` à mão (seção 12) e relata.

### Pré-condições
1. **m02b integrado** (componentes de `src/components/catalog/` disponíveis) e **m26 integrado** (use `PageSkeleton` se criar `loading.tsx`; não é obrigatório criar).
2. Árvore limpa; `corepack pnpm build` funcionando; `with-test-db.ps1` disponível.

## 4. Interface pública
### 4.1 Dinheiro no formulário (`src/lib/money.ts`, puro)
```ts
/** "12,90" | "12.90" | "1.234,56" | "R$ 1.234,56" | "0" -> integer cents; null when invalid, negative, > 3 decimals... (see rules). */
export function parseBrlToCents(value: string): number | null;
/** 1290 -> "12,90"; 123456 -> "1.234,56"; 0 -> "0,00" (no "R$", for input defaults). */
export function formatCentsInput(cents: number): string;
```
Regras de `parseBrlToCents`: aceita prefixo opcional `R$` e espaços; vírgula é o separador decimal; pontos só como milhar em grupos de 3 (`1.234,56`); sem vírgula, um único ponto seguido de 1–2 dígitos é decimal (`12.9` → 1290); no máximo 2 casas; resultado inteiro ≤ `99_999_999_999` (`MAX_CENTS`); `""`, negativo, letras, `1,234` (3 casas), `1.23.4` → `null`. Sem `parseFloat` sobre o valor final: montar os centavos com inteiros.

### 4.2 Opções de seleção (`src/server/catalog/options.ts`, `import "server-only"`)
```ts
export interface CatalogOption { id: string; name: string; isActive: boolean }
/**
 * Active categories, brands and suppliers for product forms (up to 1000 each, by name),
 * plus the ids in `keep` even if inactive (the product's current values on edit).
 * Needs catalog.read. Ids in `keep` from another organization are ignored.
 */
export async function listCatalogOptions(context: TenantContext, keep?: { categoryId?: string | null; brandId?: string | null; supplierId?: string | null }): Promise<{ categories: CatalogOption[]; brands: CatalogOption[]; suppliers: CatalogOption[] }>;
```
Uma transação `withScope(dbScope(context), …)`; cada consulta filtra `organization_id` explicitamente; ordenação `lower(name)`; `keep` com id malformado é ignorado (sem erro).

### 4.3 Variações vindas do formulário (`src/app/(app)/produtos/variant-form-data.ts`, puro)
O formulário de criação envia as variações como campos indexados: `variants.0.name`, `variants.0.sku`, `variants.0.barcode`, `variants.0.price`, `variants.0.cost`, `variants.1.name`…
```ts
export interface VariantFormRow { name: string; sku: string; barcode: string; priceCents?: number; costCents?: number }
/** Reads indexes 0..MAX_VARIANTS_PER_PRODUCT-1 in order, skipping fully empty rows. Money via parseBrlToCents. */
export function readVariantRows(formData: FormData, options: { withCost: boolean }): { rows: VariantFormRow[]; fieldErrors: Record<string, string[]> };
```
- Linha "totalmente vazia" (nome, SKU, código, preço e custo vazios) é ignorada; índices ≥ 50 são ignorados.
- Preço/custo inválido → `fieldErrors["variants.{i}.price"|"variants.{i}.cost"] = ["Informe um valor em reais, como 12,90."]`; vazio → `undefined`.
- Com `withCost: false`, `variants.{i}.cost` é **ignorado** mesmo se enviado (não chega ao serviço).
- Os demais erros (nome, SKU, código repetido) vêm do serviço com o caminho `variants.{i}.campo` e são exibidos no campo certo.

### 4.4 Rotas
| Rota | Arquivo | Leitura | Ação |
|------|---------|---------|------|
| `/produtos` | `produtos/page.tsx` | `catalog.read` | botão "Novo produto" só com `canManage` |
| `/produtos/novo` | `produtos/novo/page.tsx` | `catalog.read` e `canManage`, senão `<AccessDenied />` | cria |
| `/produtos/[productId]` | `produtos/[productId]/page.tsx` | `catalog.read`; produto inexistente/de outra empresa/id inválido → `notFound()` | edita |
| `/produtos/[productId]/historico` | `…/historico/page.tsx` | `catalog.read`; custo exige `catalog.costs.read` | consulta |

Em todas: `requireTenantContext()` antes de tudo; `params` e `searchParams` são `Promise` (Next 16); `canManage = can(context, "catalog.manage") && context.storeScope.all`; `canSeeCosts = can(context, "catalog.costs.read")`; `canManageCosts = canManage && canSeeCosts`.

### 4.5 Lista `/produtos`
- Filtros (formulário GET `next/form` em `product-filters.tsx`, componente de servidor): busca `q` ("Buscar por nome, SKU ou código de barras", `maxLength={80}`), Situação (`situacao=ativo|inativo`, com `parseStatusParam`/`statusToParam` de `@/components/catalog/status-param`), Categoria, Marca, Fornecedor (`categoria`, `marca`, `fornecedor` = ids; opções de `listCatalogOptions`). URL em pt-BR. Botões "Filtrar" e "Limpar filtros" (este só com algum filtro ativo).
- Dados: `listProducts(context, productFiltersSchema.parse({ q, status, categoryId, brandId, supplierId, page }))` com cada parâmetro bruto aceito só se for `string` (nunca `string[]`).
- Tabela (`caption` "Produtos cadastrados"): Nome (link para o detalhe), Categoria, Marca, Unidade (rótulo da 4.9), Variações (`formatInteger`), Situação (`Badge` `Ativo`/`Inativo`). `Pagination` com `params` montados dos filtros já validados.
- Vazios: sem produtos e com `canManage` → `Nenhum produto cadastrado` / `Cadastre o primeiro produto com suas variações, preço e código de barras.` + botão; sem `canManage` → `Os produtos aparecerão aqui quando alguém com permissão cadastrá-los.`; com filtro → `Nenhum produto encontrado` / `Altere a busca ou os filtros para ver os demais produtos.` + `Ver todos`.

### 4.6 Cadastro `/produtos/novo` (`new-product-form.tsx`, `"use client"`)
- Seção "Produto": Nome (`maxLength={120}`, obrigatório), Descrição (`Textarea`, `maxLength={1000}`), Unidade (`Select` com a 4.9, padrão `un`, dica `Não pode ser alterada depois do cadastro.`), Categoria, Marca, Fornecedor (`Select` com "Nenhuma"/"Nenhum" = `""`).
- Seção "Variações": começa com 1 linha; botão `Adicionar variação` (até 50; desabilita no limite com o texto `Limite de 50 variações por produto.`) e `Remover` por linha (não remove a última). Campos por linha: Nome (dica `Ex.: Único, 39, Azul P`), SKU (`maxLength={40}`, dica `Letras sem acento, números, ponto, hífen ou sublinhado.`), Código de barras (opcional, `inputMode="numeric"`), Preço de venda (`inputMode="decimal"`, prefixo visual `R$`), Custo (só se `canManageCosts`; mesmo formato).
- Envio: `createProductAction`; sucesso redireciona para `/produtos/{id}?criado=1` (padrão de `src/app/(app)/lojas/actions.ts`); erros por campo exibidos no `Field` certo, inclusive `variants.{i}.*`; erro geral em `Notice`.
- O estado das linhas é do cliente; os nomes dos campos seguem a 4.3. Teclado: foco vai para o Nome da nova linha ao adicionar.

### 4.7 Detalhe `/produtos/[productId]`
- Cabeçalho: nome, `Badge` de situação, `DetailList` (Descrição, Unidade, Categoria, Marca, Fornecedor, Cadastrado em, Atualizado em — datas com `formatDateTime(valor, context.organization.timezone)`). `?criado=1` mostra `Notice` de sucesso `Produto cadastrado.`.
- Ações do produto (só `canManage`, em `product-dialogs.tsx`): `Editar produto` (mesmos campos da 4.6 sem Unidade; Categoria/Marca/Fornecedor com as opções de `listCatalogOptions(context, keep)`, onde inativo atual aparece como "{nome} (inativa/inativo)"), `Ativar/Desativar produto` (diálogo de confirmação; desativar avisa `O produto deixa de aparecer para venda; o histórico é mantido.`).
- Tabela de variações (`caption` "Variações do produto"): Nome, SKU, Código de barras (`—`), Preço (`formatCurrencyCents` ou `Sem preço`), Custo (coluna só com `canSeeCosts`; `Sem custo`), Situação, Ações. Ações por linha em `variant-dialogs.tsx`: `Editar` (nome, SKU, código), `Alterar preço`, `Alterar custo` (só `canManageCosts`), `Ativar/Desativar`, e link `Histórico` (sempre visível com `catalog.read`) para `/produtos/{id}/historico?variante={variantId}&tipo=preco`. Botão `Adicionar variação` (`canManage`; desabilitado com 50 variações), com preço e, se `canManageCosts`, custo.
- `aria-label` com o nome: `Editar variação {nome}`, `Alterar preço da variação {nome}`, `Alterar custo da variação {nome}`, `Desativar variação {nome}`, `Ver histórico da variação {nome}`.

### 4.8 Histórico `/produtos/[productId]/historico`
- `?variante=` (uuid de variação **deste** produto; senão `notFound()`), `?tipo=preco|custo` (padrão `preco`; `custo` sem `catalog.costs.read` → `<AccessDenied detail="Seu perfil não tem acesso aos custos dos produtos." />`), `?page=`.
- Abas (links) "Preço" e "Custo" (a segunda só com `canSeeCosts`). Tabela (`caption` "Histórico de preços" / "Histórico de custos"): Valor, Vigente desde (`formatDateTime` no fuso da empresa), Alterado por. `Pagination`. Breadcrumbs: Painel > Produtos > {produto} > Histórico.
- Dados: `listVariantHistory(context, variantId, "price" | "cost", page)`.

### 4.9 Textos fixos
Unidades: `un` = `Unidade (un)`, `kg` = `Quilograma (kg)`, `l` = `Litro (l)`, `m` = `Metro (m)`. Mensagens de sucesso: `Produto cadastrado.` (via redirect), `Produto atualizado.`, `Produto ativado.`, `Produto desativado.`, `Variação adicionada.`, `Variação atualizada.`, `Variação ativada.`, `Variação desativada.`, `Preço atualizado.`, `Custo atualizado.`, e, quando o serviço devolve `{ changed: false }`, `O valor informado já era o vigente.` (status `success`).

### 4.10 Server Actions (`src/app/(app)/produtos/actions.ts`)
`"use server"`; exporta **só** funções async; `_state` como primeiro parâmetro; `requireTenantContext()` na primeira linha; `pick()` com lista de campos; ids validados com `z.uuid()` antes do serviço (`{ status: "error", message: "Produto inválido." }` / `"Variação inválida."`); `runAction(work, mensagem, nomeEstável)`; `revalidatePath("/produtos")` e `revalidatePath(`/produtos/${productId}`)`.
```ts
export async function createProductAction(_state: ActionState, formData: FormData): Promise<ActionState>;     // createProduct; custo só se canManageCosts (senão ignorado)
export async function updateProductAction(_state: ActionState, formData: FormData): Promise<ActionState>;     // updateProduct (sem unit)
export async function setProductActiveAction(_state: ActionState, formData: FormData): Promise<ActionState>;  // setProductActive
export async function addVariantAction(_state: ActionState, formData: FormData): Promise<ActionState>;        // addVariant (productId, name, sku, barcode, price, cost)
export async function updateVariantAction(_state: ActionState, formData: FormData): Promise<ActionState>;     // updateVariant (variantId, productId, name, sku, barcode)
export async function setVariantActiveAction(_state: ActionState, formData: FormData): Promise<ActionState>;  // setVariantActive
export async function setVariantPriceAction(_state: ActionState, formData: FormData): Promise<ActionState>;   // setVariantPrice (variantId, productId, price)
export async function setVariantCostAction(_state: ActionState, formData: FormData): Promise<ActionState>;    // setVariantCost (variantId, productId, cost)
```
Nomes estáveis de `runAction`: `createProduct`, `updateProduct`, `setProductActive`, `addVariant`, `updateVariant`, `setVariantActive`, `setVariantPrice`, `setVariantCost`. Preço/custo vazio em "Alterar preço/custo" → erro no campo `Informe um valor em reais, como 12,90.` (sem chamar o serviço).

### 4.11 Menu (aplicado pelo Maestro na integração, ADR-009)
- `src/components/shell/nav.ts`: na seção "Catálogo", **primeiro** item `{ href: "/produtos", label: "Produtos", icon: Package }` (`Package` de `lucide-react`).
- `src/server/shell.ts`: `"/produtos": "catalog.read"` em `NAV_PERMISSIONS`.

## 5. Dados e esquemas
Nenhuma tabela nova. Funções consumidas (não alterar): `listProducts`, `getProduct`, `createProduct`, `updateProduct`, `setProductActive` (`service.ts`); `addVariant`, `updateVariant`, `setVariantActive` (`variants.ts`); `setVariantPrice`, `setVariantCost`, `listVariantHistory` (`pricing.ts`); `productFiltersSchema`, `PRODUCT_UNITS`, `MAX_VARIANTS_PER_PRODUCT` (`schemas.ts`). `getProduct` já omite `costCents` sem `catalog.costs.read`: a tela **não** tenta obter custo por outro caminho.

## 6. Invariantes e regras de negócio
- Custo nunca aparece, nem em atributo oculto, `title`, HTML ou payload do cliente, para quem não tem `catalog.costs.read`; campos de custo só são renderizados com `canManageCosts`; a ação ignora custo quando o ator não pode gerenciá-lo (o serviço também recusa).
- Dinheiro em centavos inteiros do formulário ao serviço; exibição com `formatCurrencyCents`.
- Unidade só no cadastro; a edição não envia `unit`.
- Filtros e ids da URL validados antes do serviço; `string[]` descartado.
- Mensagens do serviço (`DomainError`) exibidas como estão; erros inesperados pela mensagem genérica do `runAction`.
- Estados: carregando (PageSkeleton do grupo), vazio, sem permissão, erro (limite do m26), sucesso (`Notice`).
- Acessibilidade: `caption` em tabelas, `aria-label` nas ações de linha, rótulos em todos os campos, foco gerenciado ao adicionar variação, navegação por teclado.
- Textos exatamente os deste contrato; comentários em inglês; arquivos ≤ 350 linhas (dividir componentes se preciso, dentro da allowlist); sem `any`, sem `console`.

## 7. Erros e casos de borda
| Situação | Comportamento esperado |
|----------|------------------------|
| Sem `catalog.read` | `<AccessDenied />` em todas as rotas |
| `catalog.manage` com escopo parcial | Sem botões; ação forjada recusada pelo serviço |
| `catalog.manage` sem `catalog.costs.read` | Sem campos e coluna de custo; cadastro com custo forjado → custo ignorado na ação |
| `/produtos/{id}` de outra empresa, inexistente ou malformado | `notFound()` |
| Histórico com variação de outro produto | `notFound()` |
| SKU/código repetido, 51 variações, categoria inativa | Erro no campo vindo do serviço |
| Preço `12,999`, `-5`, `abc` | Erro no campo, serviço não chamado |
| `?page=` inválido, `?categoria=` malformado | Normalizado pelo schema (página 1, filtro ignorado) |
| Erro inesperado | Mensagem genérica, sem detalhe |

## 8. Segurança
- `requireTenantContext()` em cada página e ação; autorização e isolamento no serviço; `listCatalogOptions` confere `catalog.read` e filtra a empresa.
- Sem `dangerouslySetInnerHTML`, sem SQL na tela, sem import de `@/db` em `src/app/**`.
- Nenhum log de dados de formulário.

## 9. Critérios de aceite
### 9.1 Unitários
`src/lib/money.test.ts`:
- [ ] `parseBrlToCents`: `"12,90"`→1290, `"12.90"`→1290, `"12.9"`→1290, `"1.234,56"`→123456, `"R$ 1.234,56"`→123456, `"0"`→0, `"0,5"`→50, `" 7 "`→700, `"999.999.999,99"`→99999999999; `null` para `""`, `"-1"`, `"abc"`, `"1,234"`, `"1.23.4"`, `"12,999"`, `"1.000.000.000,00"` (acima do máximo), `"1e3"`.
- [ ] `formatCentsInput`: 1290→"12,90", 123456→"1.234,56", 0→"0,00", 5→"0,05".
- [ ] Ida e volta: `parseBrlToCents(formatCentsInput(x)) === x` para 0, 5, 1290, 123456, 99999999999.

`src/app/(app)/produtos/variant-form-data.test.ts` (FormData do Node):
- [ ] Duas linhas válidas viram dois `VariantFormRow` na ordem dos índices, com centavos.
- [ ] Linha totalmente vazia no meio é ignorada; índice 50 é ignorado.
- [ ] Preço `"abc"` gera `fieldErrors["variants.0.price"]`.
- [ ] Com `withCost: false`, `variants.0.cost="10,00"` não aparece no resultado.

### 9.2 Integração (`tests/integration/catalog-options.test.ts`, banco real)
- [ ] Devolve só categorias, marcas e fornecedores ativos da empresa, ordenados por nome.
- [ ] `keep` com id de categoria inativa da empresa inclui a categoria com `isActive: false`.
- [ ] `keep` com id de outra empresa não inclui nada; id malformado não lança.
- [ ] Membro sem `catalog.read` (perfil personalizado sem a permissão) recebe `forbidden`.
- [ ] Dados da empresa B nunca aparecem para a empresa A.

### 9.3 Gerais
- [ ] `corepack pnpm lint`, `typecheck`, `lint:rules`, `test` e `build` verdes; integração do 9.2 verde (relatar a saída).
- [ ] Gate `PASS`; revisão manual do Maestro em `actions.ts` e `options.ts` (REVIEW-CHECKLIST: entrada, autorização, custo).
- [ ] `Select-String -Path "src/app/(app)/produtos/**/*.ts*" -Pattern "@/db|drizzle-orm|dangerouslySetInnerHTML|console\."` não encontra nada; cada `page.tsx` e o `actions.ts` contêm `requireTenantContext`.

### 9.4 Manual (Maestro, banco descartável)
- [ ] Dono: cadastra produto com 3 variações (preço e custo), edita, desativa/reativa variação e produto, altera preço e custo, vê os dois históricos.
- [ ] Vendedor (só `catalog.read`): lista e detalhe sem botões e sem coluna de custo; `/produtos/{id}/historico?tipo=custo` → acesso negado; nenhum custo no HTML (ver código-fonte da página).
- [ ] Coordenador (`catalog.costs.read` sem `catalog.manage`): vê custo, sem botões.
- [ ] Filtros combinados preservados na paginação; celular sem rolagem horizontal; leitor de tela anuncia rótulos e erros.

## 10. Política de dúvida
Dúvidas ao Maestro, em lote, com proposta. PLANO antes de editar e `DEC-xxx` antes de começar. Sem `git add`, sem commit, sem branch.

## 11. Dependências
- Permitidas: nenhuma nova (`next`, `react`, `lucide-react`, `zod`, `@/components/ui/*`, `@/components/catalog/*`, `@/lib/*`).
- Proibidas: qualquer outra; nenhuma alteração em `package.json` nem em lockfile.

## 12. Comandos de verificação
```
lint/typecheck/rules/test/build: corepack pnpm lint | typecheck | lint:rules | test | build
unit:        corepack pnpm exec vitest run src/lib/money.test.ts "src/app/(app)/produtos/variant-form-data.test.ts"
integração:  pwsh -NoProfile -File tools/gate/with-test-db.ps1 corepack pnpm test:integration tests/integration/catalog-options.test.ts
gate:        pwsh -NoProfile -Command "& tools/gate/gate.ps1 -Module m03-telas-produtos -Allowed @('src/lib/money.ts','src/lib/money.test.ts','src/server/catalog/options.ts','tests/integration/catalog-options.test.ts','src/app/(app)/produtos/**')"
```
