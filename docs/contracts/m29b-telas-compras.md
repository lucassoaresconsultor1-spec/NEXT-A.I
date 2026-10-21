# Contrato do módulo `m29b-telas-compras` — v1

> Escrito pelo Arquiteto (Opus) em 22/10/2026. O agente implementa o que está aqui e nada além.
> Se algo estiver ambíguo, o agente PERGUNTA (ver seção 10); não presume.
> Risco: **SENSÍVEL** (estoque e custo). Nível: **I** (Codex), pelo ADR-008: atomicidade, idempotência, custo, permissões e escopo estão no serviço do m29a. O Maestro revisa à mão `actions.ts` e o formulário de recebimento mesmo com o gate em `PASS`.

## 1. Objetivo
Telas de **compras**: listar pedidos, criar e editar rascunho com busca de produtos, aprovar, cancelar, encerrar com pendências e **registrar recebimento** contra o pedido.

## 2. Fora de escopo
- Qualquer alteração em `src/server/**`, `src/db/**`, `drizzle/**`, `src/components/ui/**`, `src/lib/**` (usa `money.ts` e `quantity-format.ts` já existentes).
- Recebimento sem pedido (é a entrada manual do m04); impressão do pedido; envio ao fornecedor.
- `nav.ts`/`shell.ts` (seção 4.7).

## 3. Allowlist de arquivos
```
src/app/(app)/compras/page.tsx
src/app/(app)/compras/purchase-filters.tsx
src/app/(app)/compras/actions.ts
src/app/(app)/compras/order-items-form-data.ts
src/app/(app)/compras/order-items-form-data.test.ts
src/app/(app)/compras/order-form.tsx
src/app/(app)/compras/variant-picker.tsx
src/app/(app)/compras/novo/page.tsx
src/app/(app)/compras/[orderId]/page.tsx
src/app/(app)/compras/[orderId]/order-dialogs.tsx
src/app/(app)/compras/[orderId]/editar/page.tsx
src/app/(app)/compras/[orderId]/receber/page.tsx
src/app/(app)/compras/[orderId]/receber/receipt-form.tsx
```
Veredito esperado: `PASS`. Pré-condições: **m29a, m03, m04 e m26 integrados**; árvore limpa; build funcionando.

## 4. Interface pública
### 4.1 Permissões na tela
`requireTenantContext()` em toda página e ação; `searchParams`/`params` são `Promise`. Leitura: `purchases.read` (senão `<AccessDenied />`). Botões só aparecem com a permissão correspondente: criar/editar `purchases.manage` **e** `catalog.costs.read`; aprovar/cancelar/encerrar `purchases.approve`; receber `purchases.receive`. O serviço confere de novo, inclusive o escopo de loja.

### 4.2 Lista `/compras`
- Filtros GET (`purchase-filters.tsx`): Situação (`situacao` com as chaves de `PURCHASE_ORDER_STATUSES` e os rótulos de `PURCHASE_ORDER_STATUS_LABELS`), Loja (`loja`, de `listStoreOptions(context)`), Fornecedor (`fornecedor`, de `listCatalogOptions(context).suppliers`), Número (`numero`). Dados: `listPurchaseOrders(context, purchaseOrderFiltersSchema.parse({ status, storeId, supplierId, number, page }))`.
- Tabela (`caption` "Pedidos de compra"): Nº (link para o detalhe), Loja, Fornecedor, Previsão (`formatDate` no fuso da empresa ou `—`), Itens, Total (só se o serviço devolver `totalCents`; senão a coluna não existe), Situação (`Badge`: rascunho `neutral`, aprovado `brand`, recebido em parte `attention`, recebido `positive`, cancelado `critical`), Criado em.
- Vazios: `Nenhum pedido de compra` / com `purchases.manage`: `Crie um pedido para registrar o recebimento das mercadorias com o custo de reposição.` + `Novo pedido`; com filtro: `Nenhum pedido encontrado` + `Ver todos`.

### 4.3 Busca de produtos (`variant-picker.tsx`, `"use client"`)
Campo `Buscar produto` (nome, SKU ou código de barras; busca a partir de 2 caracteres, com espera de 300 ms entre teclas) que chama a Server Action `searchVariantsAction(q)` e lista até 20 resultados (`{produto} · {variação}`, SKU, unidade; inativos não aparecem: `activeOnly: true`). Escolher adiciona a variação ao pedido; variação já incluída aparece desabilitada com `Já está no pedido`. Teclado: setas navegam, Enter escolhe, Esc fecha; `role="listbox"`/`option` com `aria-activedescendant`.

### 4.4 Formulário do pedido (`order-form.tsx`, `"use client"`, usado em `/compras/novo` e `/compras/[orderId]/editar`)
- Cabeçalho: Loja de destino (`storeId`, lojas ativas do escopo), Fornecedor (`supplierId`, ativos), Previsão de entrega (`expectedDate`, `type="date"`, opcional), Observações (`notes`, `maxLength={500}`).
- Itens (tabela editável, até 200): Produto (texto), Quantidade (`items.{i}.quantity`, `inputMode="decimal"`; produtos `un` com dica `Somente números inteiros.`), Custo unitário (`items.{i}.unitCost`, em reais, convertido por `parseBrlToCents`), Subtotal calculado só para exibição (centavos inteiros × quantidade em milésimos ÷ 1000, arredondado para baixo, exibido com `formatCurrencyCents` e o rótulo `Estimado`), `Remover`. Campo oculto `items.{i}.variantId`.
- `order-items-form-data.ts` (puro): `readOrderItems(formData)` lê os índices em ordem, ignora linhas sem `variantId`, converte custo com `parseBrlToCents` (inválido → `fieldErrors["items.{i}.unitCostCents"] = ["Informe um valor em reais, como 12,90."]`) e devolve `{ items: { variantId, quantity, unitCostCents }[]; fieldErrors }`; a quantidade segue como texto (o serviço valida).
- Na edição, o formulário só abre para pedido `draft`; senão a página mostra `Notice` `Só pedidos em rascunho podem ser alterados.` e link para o detalhe.
- Sucesso: redireciona para `/compras/{id}?salvo=1`.

### 4.5 Detalhe `/compras/[orderId]`
- Pedido inexistente, de outra empresa ou fora do escopo → `notFound()`.
- Cabeçalho: `Pedido de compra nº {número}`, situação, `DetailList` (Loja, Fornecedor, Previsão, Observações, Criado por, Aprovado em/por, Cancelado ou Encerrado com motivo).
- Itens (`caption` "Itens do pedido"): Produto, SKU, Pedido, Recebido, Pendente (`formatQuantity` com a unidade), Custo unitário (só se veio do serviço).
- Recebimentos (`caption` "Recebimentos registrados"): data/hora (fuso da empresa), responsável, observações e quantidades por item.
- Ações (`order-dialogs.tsx`), conforme estado e permissão: `Editar` (link, rascunho), `Aprovar pedido` (rascunho; confirmação `Depois de aprovado, o pedido não pode mais ser alterado.`), `Cancelar pedido` (rascunho ou aprovado sem recebimento; motivo obrigatório 3..240), `Encerrar pendências` (recebido em parte; motivo obrigatório; aviso `As quantidades pendentes deixam de ser esperadas.`), `Registrar recebimento` (link; aprovado ou recebido em parte).

### 4.6 Recebimento `/compras/[orderId]/receber`
- Só para pedido aprovado ou recebido em parte; senão `Notice` `Este pedido não aceita recebimento.`.
- A página gera **no servidor** uma chave `randomUUID()` (de `node:crypto`) e a coloca em `<input type="hidden" name="idempotencyKey">`; reenvios do mesmo formulário usam a mesma chave (o serviço devolve `replayed: true` sem lançar de novo). Recarregar a página gera chave nova.
- `receipt-form.tsx`: para cada item com pendência, campo `items.{i}.quantity` (padrão vazio; botão `Receber tudo` preenche com o pendente) e oculto `items.{i}.orderItemId`; Observações (`notes`, ≤ 500). Itens sem quantidade são ignorados; nenhum item → erro `Informe a quantidade recebida de ao menos um item.` sem chamar o serviço.
- Sucesso (novo ou repetido): redireciona para `/compras/{id}?recebido=1` com `Notice` `Recebimento registrado. As entradas foram lançadas no estoque.`.

### 4.7 Server Actions (`actions.ts`)
`"use server"`; só funções async; `_state` primeiro; `requireTenantContext()` na primeira linha; ids com `z.uuid()` (senão `{ status: "error", message: "Pedido inválido." }`).
```ts
export async function searchVariantsAction(q: string): Promise<{ variantId: string; label: string; sku: string; unit: string }[]>; // searchVariants(context, q, { activeOnly: true }); q não-string ou < 2 → []
export async function savePurchaseOrderAction(_state: ActionState, formData: FormData): Promise<ActionState>;   // create/update; redirect
export async function approvePurchaseOrderAction(_state: ActionState, formData: FormData): Promise<ActionState>;
export async function cancelPurchaseOrderAction(_state: ActionState, formData: FormData): Promise<ActionState>;
export async function closePurchaseOrderAction(_state: ActionState, formData: FormData): Promise<ActionState>;
export async function receiveGoodsAction(_state: ActionState, formData: FormData): Promise<ActionState>;        // redirect
```
Mensagens: `Pedido aprovado.`, `Pedido cancelado.`, `Pendências encerradas.`; nomes estáveis `savePurchaseOrder`, `approvePurchaseOrder`, `cancelPurchaseOrder`, `closePurchaseOrder`, `receiveGoods`. `searchVariantsAction` não devolve custo. `revalidatePath("/compras")` e do detalhe; `receiveGoodsAction` também `revalidatePath("/estoque")`.

### 4.8 Menu (aplicado pelo Maestro, ADR-009)
- `nav.ts`: na seção "Estoque", depois de "Movimentações": `{ href: "/compras", label: "Compras", icon: ClipboardList }`.
- `shell.ts`: `"/compras": "purchases.read"`.

## 5. Dados e esquemas
Nenhuma tabela. Consumidos (não alterar): serviço e schemas do m29a (`@/server/purchasing/*`), `searchVariants` (`@/server/catalog/variant-search`), `listCatalogOptions` (m03), `listStoreOptions`, `parseBrlToCents`/`formatCentsInput` (`@/lib/money`), `formatQuantity` (`@/lib/quantity-format`), `formatCurrencyCents`/`formatDate`/`formatDateTime` (`@/lib/format`).

## 6. Invariantes
- A tela não calcula pendência, saldo nem custo de reposição: só exibe o que o serviço devolve (o subtotal do formulário é estimativa visível, nunca gravada).
- Custo nunca chega a quem não tem `catalog.costs.read` (o serviço omite; a tela não pede o campo).
- Idempotência do recebimento pela chave gerada no servidor por renderização.
- Estados: carregando, vazio, erro, sem permissão, sucesso; acessibilidade (`caption`, rótulos, `aria-label` com número do pedido nas ações, teclado no seletor); celular sem rolagem horizontal da página.
- Comentários em inglês; arquivos ≤ 350 linhas; sem `any`, `console`, `dangerouslySetInnerHTML`, `@/db`.

## 7. Erros e casos de borda
| Situação | Comportamento esperado |
|----------|------------------------|
| Pedido de outra loja fora do escopo | `notFound()` |
| Erros por item vindos do serviço (`items.{i}.*`) | Exibidos na linha certa |
| Receber acima do pendente | Erro na linha, vindo do serviço |
| Duplo clique / reenvio do recebimento | Mesma chave → um só lançamento; tela de sucesso |
| Fornecedor desativado depois do rascunho | Erro em `supplierId` ao salvar |
| Busca com 1 caractere | Sem chamada ao servidor |

## 8. Segurança
`requireTenantContext()` em páginas e ações; `pick`/leitura indexada com limites; a chave de idempotência é gerada no servidor (o cliente não escolhe); nada de custo em log ou em atributos de acessibilidade.

## 9. Critérios de aceite
### 9.1 Unitários (`order-items-form-data.test.ts`)
- [ ] Dois itens viram duas entradas na ordem dos índices com `unitCostCents` em centavos; linha sem `variantId` ignorada; custo `"abc"` gera erro em `items.{i}.unitCostCents`; índices acima de 199 ignorados.

### 9.2 Gerais
- [ ] `lint`, `typecheck`, `lint:rules`, `test`, `build` verdes; gate `PASS`.
- [ ] `Select-String` sem `@/db|drizzle-orm|dangerouslySetInnerHTML|console\.` em `src/app/(app)/compras/**`; `requireTenantContext` em todas as `page.tsx` e no `actions.ts`.

### 9.3 Manual (Maestro, banco descartável)
- [ ] Coordenador cria pedido com 3 itens pela busca (código de barras, SKU e nome), edita, aprova; Gerente da loja recebe em duas etapas; saldos e livro conferem; custo de reposição aparece no produto (m03) para quem pode ver custo.
- [ ] Duplo clique em "Registrar recebimento" não duplica entradas.
- [ ] Gerente não vê custos nem a coluna Total; Financeiro vê e não tem botões; perfil sem `purchases.read` recebe acesso negado.
- [ ] Encerrar pendências e cancelar com motivo; celular sem rolagem horizontal; seletor de produtos utilizável só com teclado.

## 10. Política de dúvida
Dúvidas ao Maestro, em lote, com proposta. PLANO antes de editar e `DEC-xxx` antes de começar. Sem `git add`, sem commit, sem branch.

## 11. Dependências
Nenhuma nova; nenhuma alteração em `package.json` nem em lockfile.

## 12. Comandos de verificação
```
lint/typecheck/rules/test/build: corepack pnpm lint | typecheck | lint:rules | test | build
unit: corepack pnpm exec vitest run "src/app/(app)/compras/order-items-form-data.test.ts"
gate: pwsh -NoProfile -Command "& tools/gate/gate.ps1 -Module m29b-telas-compras -Allowed @('src/app/(app)/compras/**')"
```
