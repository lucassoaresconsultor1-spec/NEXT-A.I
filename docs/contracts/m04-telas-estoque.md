# Contrato do módulo `m04-telas-estoque` — v1

> Escrito pelo Arquiteto (Opus) em 21/10/2026. O agente implementa o que está aqui e nada além.
> Se algo estiver ambíguo, o agente PERGUNTA (ver seção 10); não presume.
> Risco: **SENSÍVEL** (estoque). Nível: **I** (Codex), pelo ADR-008: saldo, livro, escopo de loja, plano e auditoria já estão no serviço testado (`src/server/inventory/`); a tela só o chama. O Maestro revisa à mão `actions.ts` mesmo com o gate em `PASS`.

## 1. Objetivo
Telas de **estoque**: saldos por loja do escopo, livro de movimentações com filtros e lançamento manual (entrada, saída, ajuste, perda e inventário de um item).

## 2. Fora de escopo
- Transferências, reservas e trânsito (m30), compras e recebimento (m29), inventário por lote (m31), estoque mínimo (m23).
- Qualquer alteração em `src/server/inventory/**`, `src/server/catalog/**`, `src/db/**`, `drizzle/**`, permissões, auditoria, `src/components/ui/**`.
- `nav.ts` e `shell.ts`: o Maestro aplica as linhas de menu (seção 4.7, ADR-009).

## 3. Allowlist de arquivos
```
src/lib/quantity-format.ts
src/lib/quantity-format.test.ts
src/app/(app)/estoque/page.tsx
src/app/(app)/estoque/stock-filters.tsx
src/app/(app)/estoque/actions.ts
src/app/(app)/estoque/feature-guard.tsx
src/app/(app)/estoque/movimentacoes/page.tsx
src/app/(app)/estoque/movimentacoes/movement-filters.tsx
src/app/(app)/estoque/lancar/page.tsx
src/app/(app)/estoque/lancar/movement-form.tsx
```
Veredito esperado do gate: `PASS`.

### Pré-condições
1. **m03 integrado** (o link "Ver produto" leva a `/produtos/{id}`) e **m26 integrado**.
2. Árvore limpa; `corepack pnpm build` funcionando.

## 4. Interface pública
### 4.1 Formatação de quantidade (`src/lib/quantity-format.ts`, puro)
```ts
export type QuantityUnit = "un" | "kg" | "l" | "m";
/** "12.500" -> "12,5"; "1234.000" -> "1.234"; "-3.250" -> "-3,25"; "0.000" -> "0". With unit: "12,5 kg". */
export function formatQuantity(dbValue: string, unit?: QuantityUnit): string;
```
Sem `Number`/`parseFloat` no valor: trabalhar com a string (sinal, parte inteira com separador de milhar ".", decimais sem zeros à direita, vírgula decimal). Valor fora do padrão `^-?\d+(\.\d{1,3})?$` → devolve o valor recebido sem mudança. Unidade como sufixo após um espaço.

### 4.2 Rotas e permissões
| Rota | Leitura | Observação |
|------|---------|-----------|
| `/estoque` | `inventory.read` | Saldos |
| `/estoque/movimentacoes` | `inventory.read` | Livro |
| `/estoque/lancar` | `inventory.manage` (senão `<AccessDenied />`) | Lançamento |

Em todas: `requireTenantContext()` antes de tudo; `searchParams` é `Promise`; parâmetros brutos só aceitos se `string`.
**Plano sem estoque:** os serviços lançam `DomainError` com `code === "limit"`. `feature-guard.tsx` exporta `InventoryUnavailable({ message }: { message: string })` (componente de servidor) que renderiza `Card` + `EmptyState` (ícone `PackageX`) com título `Controle de estoque indisponível no plano` e a `message` do erro. Cada página faz a chamada ao serviço dentro de `try`; `isDomainError(error) && error.code === "limit"` → `<InventoryUnavailable message={error.message} />`; qualquer outro erro é relançado (vai para o `error.tsx` do m26).

### 4.3 Saldos `/estoque`
- Filtros (`stock-filters.tsx`, GET com `next/form`): Loja (`loja`, `Select` com "Todas as lojas do meu acesso" e as lojas de `listStoreOptions(context)`), Busca (`q`, "Buscar por produto, SKU ou código de barras", `maxLength={80}`). "Filtrar" / "Limpar filtros".
- Dados: `listBalances(context, balanceFiltersSchema.parse({ storeId: loja, q, page }))`.
- Tabela (`caption` "Saldos de estoque"): Produto (nome do produto, e embaixo `{variação} · {SKU}` em `text-ink-muted`), Loja (`{código} · {nome}`), Quantidade (`formatQuantity(quantity, unit)`, alinhada à direita, `tabular-nums`; zero em `text-ink-muted`), Atualizado em (`formatDateTime(updatedAt, context.organization.timezone)`), e link `Ver produto` (`/produtos/{productId}`, `aria-label="Ver produto {nome}"`).
- Cabeçalho: `PageHeader` "Estoque", descrição `Saldos das lojas do seu acesso, calculados pelo livro de movimentações.`; ações: `LinkButton` `Movimentações` (`/estoque/movimentacoes`) e, com `inventory.manage`, `Lançar movimentação` (`/estoque/lancar`, `primary`).
- Vazios: sem saldos e sem filtro → `Nenhum saldo registrado` / `Os saldos aparecem depois da primeira entrada de estoque.` (+ `Lançar movimentação` com `inventory.manage`); com filtro → `Nenhum item encontrado` / `Altere a loja ou a busca.` + `Ver todos`.
- `Pagination` com `params` dos filtros validados (`loja`, `q`).

### 4.4 Livro `/estoque/movimentacoes`
- Filtros (`movement-filters.tsx`, GET): Loja (`loja`), Tipo (`tipo`, opções "Todos" + `MOVEMENT_TYPE_LABELS`; a URL usa a chave em inglês do enum, ex. `tipo=entry`, por ser o valor do serviço), De (`de`, `Input type="date"`), Até (`ate`, `type="date"`). Dica abaixo das datas: `Datas no fuso da empresa.`
- Dados: `listMovements(context, movementFiltersSchema.parse({ storeId: loja, type: tipo, from: de, to: ate, page }))`.
- Tabela (`caption` "Movimentações de estoque"): Data e hora (`formatDateTime` no fuso da empresa), Loja, Produto (`{produto} · {variação}` e SKU), Tipo (`Badge`: entrada `positive`, saída `neutral`, ajuste `brand`, perda `critical`, inventário `attention`, com o rótulo de `MOVEMENT_TYPE_LABELS`), Quantidade (`formatQuantity(quantity)` com sinal, `tabular-nums`), Saldo após (`formatQuantity(balanceAfter)`), Contado (`formatQuantity(countedQuantity)` ou `—`), Motivo, Responsável (`actorName ?? "—"`).
- Em telas estreitas a tabela pode rolar horizontalmente **dentro** do `Card` (`overflow-x-auto`), nunca a página.
- Vazios: `Nenhuma movimentação registrada` / com filtro `Nenhuma movimentação encontrada` + `Ver todas`.

### 4.5 Lançamento `/estoque/lancar`
Fluxo em dois passos, sem serviço novo:
1. **Escolher o produto** (`?q=`): formulário GET "Buscar produto" (nome, SKU ou código de barras). Resultado: `listProducts(context, productFiltersSchema.parse({ q, status: "active", page: 1 }))` — lista de até 25 produtos com botão `Escolher` (link para `?produto={id}`, mantendo `q`). Sem `q`: só o campo de busca e o texto `Busque o produto pelo nome, SKU ou código de barras.`
2. **Lançar** (`?produto={id}`): `getProduct(context, id)`; null → `notFound()`; produto inativo → `Notice` `warning` `Produto inativo: só saídas, ajustes, perdas e inventários são aceitos.` Formulário (`movement-form.tsx`, `"use client"`):
   - Loja (`storeId`): `Select` com `listStoreOptions(context)` (ativas do escopo); pré-seleciona `context.activeStoreId` quando está na lista; sem lojas → `Notice` `Nenhuma loja ativa no seu acesso.` e sem formulário.
   - Variação (`variantId`): `Select` com as variações ativas (`{nome} · {SKU}`); com uma só, já selecionada.
   - Tipo (`type`): `Select` com `MOVEMENT_TYPE_LABELS`.
   - Quantidade (`quantity`, `inputMode="decimal"`, `maxLength={16}`). Rótulo e dica mudam com o tipo (estado do cliente): entrada/saída/perda → rótulo `Quantidade`, dica `Quantidade movimentada, maior que zero.`; ajuste → `Ajuste`, dica `Use número negativo para reduzir (ex.: -2).`; inventário → `Quantidade contada`, dica `Total contado na loja; o sistema calcula a diferença.` Produto em `un`: acrescentar `Somente números inteiros.`
   - Motivo (`reason`, `Textarea`, `maxLength={240}`, obrigatório, dica `Entre 3 e 240 caracteres. Fica no histórico.`).
   - Botão `Lançar movimentação` (espera `Lançando…`).
   - Sucesso: `Notice` `success` `Movimentação lançada. Saldo atual: {formatQuantity(balanceAfter, unit)}.`; o formulário limpa Quantidade e Motivo e mantém loja, variação e tipo; link `Ver no livro` para `/estoque/movimentacoes?loja={storeId}`.

### 4.6 Server Action (`src/app/(app)/estoque/actions.ts`)
`"use server"`; exporta só funções async; `_state` primeiro.
```ts
export async function recordMovementAction(_state: ActionState, formData: FormData): Promise<ActionState & { balanceAfter?: string }>;
```
`requireTenantContext()` na primeira linha; `pick(formData, ["storeId", "variantId", "type", "quantity", "reason"])` repassado a `recordMovement(context, input)` (o serviço valida com `movementInputSchema` e devolve erros por campo); `runAction` não devolve dados, então a ação chama o serviço dentro de `try` próprio **apenas** para capturar `balanceAfter` e reaproveita o tratamento de `runAction` para erros (padrão: `let result; const state = await runAction(async () => { result = await recordMovement(...); revalidatePath("/estoque"); revalidatePath("/estoque/movimentacoes"); }, "Movimentação lançada.", "recordMovement"); return result ? { ...state, balanceAfter: result.balanceAfter } : state;`). Nenhum outro dado do resultado vai ao cliente.

### 4.7 Menu (aplicado pelo Maestro, ADR-009)
- `nav.ts`: nova seção **"Estoque"** logo depois de "Catálogo": `{ href: "/estoque", label: "Saldos", icon: Boxes }`, `{ href: "/estoque/movimentacoes", label: "Movimentações", icon: ArrowLeftRight }` (`lucide-react`).
- `shell.ts` `NAV_PERMISSIONS`: `"/estoque": "inventory.read"`, `"/estoque/movimentacoes": "inventory.read"`.

## 5. Dados e esquemas
Nenhuma tabela. Consumidos (não alterar): `recordMovement`, `listBalances`, `listMovements` (`@/server/inventory/service`); `balanceFiltersSchema`, `movementFiltersSchema`, `MOVEMENT_TYPES`, `MOVEMENT_TYPE_LABELS` (`@/server/inventory/schemas`); `listProducts`, `getProduct`, `productFiltersSchema` (catálogo); `listStoreOptions` (`@/server/stores/options`); `isDomainError` (`@/server/errors`).

## 6. Invariantes e regras de negócio
- Saldo nunca é digitado nem calculado na tela: vem do serviço (`balanceAfter`, `quantity`).
- Quantidades exibidas só com `formatQuantity` (sem ponto flutuante).
- Escopo de loja é do serviço; a tela só oferece as lojas de `listStoreOptions`.
- Datas exibidas no fuso da empresa; filtros de data são dias de calendário (o serviço converte).
- Textos exatamente os deste contrato; acessibilidade (`caption`, rótulos, `aria-label`, foco no primeiro erro); comentários em inglês; arquivos ≤ 350 linhas; sem `any`, sem `console`.

## 7. Erros e casos de borda
| Situação | Comportamento esperado |
|----------|------------------------|
| Sem `inventory.read` | `<AccessDenied />` nas listas |
| Sem `inventory.manage` | `/estoque/lancar` com `<AccessDenied />`; sem botão de lançar |
| Plano sem `inventory` | `InventoryUnavailable` com a mensagem do serviço |
| Loja fora do escopo forjada no formulário | Mensagem do serviço ("não encontrada") no `Notice` |
| Saída maior que o saldo | Erro no campo `quantity` vindo do serviço (`Saldo insuficiente…`) |
| `0,5` em produto `un` | Erro no campo vindo do serviço |
| `?produto=` de outra empresa ou malformado | `notFound()` |
| `?de=2026-13-01`, `?tipo=x`, `?loja=x` | Filtro ignorado (schema) |

## 8. Segurança
- `requireTenantContext()` em todas as páginas e na ação; sem `@/db` em `src/app/**`; `pick` com lista fixa.
- Motivo do lançamento é dado de negócio (vai para o livro e a auditoria pelo serviço); não logar.

## 9. Critérios de aceite
### 9.1 Unitários (`src/lib/quantity-format.test.ts`)
- [ ] `"12.500"`→`"12,5"`, `"1234.000"`→`"1.234"`, `"1234567.125"`→`"1.234.567,125"`, `"-3.250"`→`"-3,25"`, `"0.000"`→`"0"`, `"5"`→`"5"`, `"0.001"`→`"0,001"`.
- [ ] Com unidade: `("12.500","kg")`→`"12,5 kg"`, `("3.000","un")`→`"3 un"`.
- [ ] Valor inválido (`"abc"`, `"1.2345"`) volta sem mudança.

### 9.2 Gerais
- [ ] `corepack pnpm lint`, `typecheck`, `lint:rules`, `test`, `build` verdes; gate `PASS`.
- [ ] `Select-String` sem `@/db|drizzle-orm|dangerouslySetInnerHTML|console\.` em `src/app/(app)/estoque/**`; `requireTenantContext` presente nas três `page.tsx` e no `actions.ts`.
- [ ] Integração existente (`tests/integration/inventory.test.ts`) continua verde no gate de integração do Maestro (nenhum serviço muda).

### 9.3 Manual (Maestro, banco descartável)
- [ ] Gerente de loja lança entrada, saída, ajuste negativo, perda e inventário; o saldo e o livro batem; saída acima do saldo mostra o erro no campo.
- [ ] Membro com escopo de uma loja só vê e lança nessa loja.
- [ ] Vendedor (só `inventory.read`) vê saldos e livro, sem botão e com acesso negado em `/estoque/lancar`.
- [ ] Empresa em plano sem `inventory` (alterar o plano no banco de teste) vê `Controle de estoque indisponível no plano`.
- [ ] Filtros de data no fuso da empresa; celular sem rolagem horizontal da página.

## 10. Política de dúvida
Dúvidas ao Maestro, em lote, com proposta. PLANO antes de editar e `DEC-xxx` antes de começar. Sem `git add`, sem commit, sem branch.

## 11. Dependências
- Permitidas: nenhuma nova.
- Proibidas: qualquer outra; nenhuma alteração em `package.json` nem em lockfile.

## 12. Comandos de verificação
```
lint/typecheck/rules/test/build: corepack pnpm lint | typecheck | lint:rules | test | build
unit:  corepack pnpm exec vitest run src/lib/quantity-format.test.ts
gate:  pwsh -NoProfile -Command "& tools/gate/gate.ps1 -Module m04-telas-estoque -Allowed @('src/lib/quantity-format.ts','src/lib/quantity-format.test.ts','src/app/(app)/estoque/**')"
```
