# Contrato do módulo `m30b-telas-transferencias` — v1

> Escrito pelo Arquiteto (Opus) em 22/10/2026. O agente implementa o que está aqui e nada além.
> Se algo estiver ambíguo, o agente PERGUNTA (ver seção 10); não presume.
> Risco: **SENSÍVEL** (estoque). Nível: **I** (Codex), pelo ADR-008: reservas, trânsito, travas, lados da transferência e escopo estão no serviço do m30a. O Maestro revisa à mão `actions.ts` mesmo com o gate em `PASS`.

## 1. Objetivo
Telas de **transferências de estoque**: listar, solicitar, aprovar, despachar, receber (com divergência) e cancelar; e mostrar **reservado, em trânsito e disponível** na tela de saldos do m04.

## 2. Fora de escopo
- Qualquer alteração em `src/server/**`, `src/db/**`, `drizzle/**`, `src/components/ui/**`, `src/lib/**`, `src/app/(app)/compras/**`.
- `nav.ts`/`shell.ts` (seção 4.7).

## 3. Allowlist de arquivos
```
src/app/(app)/estoque/page.tsx                         (só as colunas novas da seção 4.6)
src/app/(app)/estoque/transferencias/page.tsx
src/app/(app)/estoque/transferencias/transfer-filters.tsx
src/app/(app)/estoque/transferencias/actions.ts
src/app/(app)/estoque/transferencias/nova/page.tsx
src/app/(app)/estoque/transferencias/nova/transfer-form.tsx
src/app/(app)/estoque/transferencias/[transferId]/page.tsx
src/app/(app)/estoque/transferencias/[transferId]/transfer-dialogs.tsx
```
Veredito esperado: `PASS`. Pré-condições: **m30a, m29b, m04 e m26 integrados**; árvore limpa; build funcionando.

## 4. Interface pública
### 4.1 Regras gerais
`requireTenantContext()` em toda página e ação; `params`/`searchParams` são `Promise`; parâmetros só aceitos como `string`. Leitura: `inventory.read` (senão `<AccessDenied />`). Botões aparecem só com a permissão e o lado certo: solicitar `inventory.transfer.request`; aprovar e cancelar aprovada `inventory.transfer.approve` com a **origem** no escopo; cancelar solicitada também por quem solicita com o **destino** no escopo; despachar `inventory.transfer.execute` com a origem no escopo; receber `inventory.transfer.execute` com o **destino** no escopo. Use `isStoreInScope(context.storeScope, storeId)` de `@/server/authz/context` só para decidir os botões; o serviço decide de novo.

### 4.2 Lista `/estoque/transferencias`
- Filtros GET (`transfer-filters.tsx`): Situação (`situacao`, chaves de `TRANSFER_STATUSES` com `TRANSFER_STATUS_LABELS`), Loja (`loja`, origem ou destino, de `listStoreOptions`), Número (`numero`). Dados: `listTransfers(context, transferFiltersSchema.parse({ status, storeId, number, page }))`.
- Tabela (`caption` "Transferências de estoque"): Nº (link), Origem, Destino, Itens, Situação (`Badge`: solicitada `neutral`, aprovada `brand`, em trânsito `attention`, recebida `positive`, cancelada `critical`), Solicitada em (fuso da empresa). `Pagination`.
- Vazios: `Nenhuma transferência` / com `inventory.transfer.request`: `Solicite mercadorias de outra loja da empresa.` + `Nova transferência`; com filtro: `Nenhuma transferência encontrada` + `Ver todas`.

### 4.3 Nova `/estoque/transferencias/nova` (`transfer-form.tsx`, `"use client"`)
- Sem `inventory.transfer.request` → `<AccessDenied />`.
- Campos: Loja de origem (`originStoreId`, todas as lojas **ativas da empresa** — a página lê `listStoreOptions(context)` para o destino e, para a origem, as lojas ativas da empresa só quando o membro tem acesso a todas; com escopo parcial, a origem vem da mesma lista do escopo e o texto de ajuda diz `Para pedir de uma loja fora do seu acesso, fale com o coordenador.`), Loja de destino (`destinationStoreId`, lojas do escopo), Observações (`notes`, ≤ 500), Itens com o seletor de produtos do m29b (`import { VariantPicker } from "@/app/(app)/compras/variant-picker"`, sem alterá-lo) e Quantidade por item (`items.{i}.quantity`; `un` com dica `Somente números inteiros.`).
- Sucesso: redireciona para `/estoque/transferencias/{id}?criada=1`.

### 4.4 Detalhe `/estoque/transferencias/[transferId]`
- `getTransfer` null → `notFound()`.
- Cabeçalho `Transferência nº {número}`, situação, `DetailList` (Origem, Destino, Solicitada por, datas de cada etapa no fuso da empresa, Observações, Motivo do cancelamento).
- Itens (`caption` "Itens da transferência"): Produto, SKU, Solicitado, Enviado, Recebido (`formatQuantity` com unidade; `—` quando ainda não houve), Divergência (motivo ou `—`).
- Ações (`transfer-dialogs.tsx`) conforme situação, permissão e lado:
  - `Aprovar` (solicitada): confirmação `As quantidades ficam reservadas na loja de origem até o despacho.`
  - `Despachar` (aprovada): diálogo com Enviado por item (padrão = solicitado; 0 permitido) e aviso `O que não for enviado volta a ficar disponível na origem.`
  - `Registrar recebimento` (em trânsito): Recebido por item (padrão = enviado) e `Motivo da diferença` (obrigatório se algum recebido < enviado; a tela mostra o campo assim que detecta a diferença).
  - `Cancelar` (solicitada ou aprovada): motivo obrigatório 3..240.
  - Campos por item: `items.{i}.itemId` oculto e `items.{i}.quantitySent` / `items.{i}.quantityReceived`.
- `aria-label` com o número nas ações (`Aprovar transferência nº {n}` etc.).

### 4.5 Server Actions (`actions.ts`)
`"use server"`; só funções async; `_state` primeiro; `requireTenantContext()` na primeira linha; id com `z.uuid()` (senão `Transferência inválida.`).
```ts
export async function requestTransferAction(_state: ActionState, formData: FormData): Promise<ActionState>;   // redirect
export async function approveTransferAction(_state: ActionState, formData: FormData): Promise<ActionState>;
export async function dispatchTransferAction(_state: ActionState, formData: FormData): Promise<ActionState>;
export async function receiveTransferAction(_state: ActionState, formData: FormData): Promise<ActionState>;
export async function cancelTransferAction(_state: ActionState, formData: FormData): Promise<ActionState>;
```
Leitura indexada dos itens (até 200) montando o objeto que o serviço espera (`items: [{ variantId, quantity }]`, `[{ itemId, quantitySent }]`, `[{ itemId, quantityReceived }]`); o serviço valida. Mensagens: `Transferência aprovada.`, `Transferência despachada.`, `Recebimento registrado.`, `Transferência cancelada.`; nomes estáveis `requestTransfer`, `approveTransfer`, `dispatchTransfer`, `receiveTransfer`, `cancelTransfer`. `revalidatePath` da lista, do detalhe e de `/estoque`.

### 4.6 Saldos (`estoque/page.tsx`)
Acrescentar à tabela do m04, depois de Quantidade: `Reservado` e `Em trânsito` (`formatQuantity` com unidade; zero em `text-ink-muted`) e `Disponível` (destaque `font-medium`). Nada mais muda nessa página.

### 4.7 Menu (aplicado pelo Maestro, ADR-009)
- `nav.ts`: seção "Estoque", depois de "Movimentações": `{ href: "/estoque/transferencias", label: "Transferências", icon: Repeat }`.
- `shell.ts`: `"/estoque/transferencias": "inventory.read"`.

## 5. Dados e esquemas
Nenhuma tabela. Consumidos (não alterar): `requestTransfer`, `approveTransfer`, `dispatchTransfer`, `receiveTransfer`, `cancelTransfer` (`@/server/inventory/transfers`), `listTransfers`, `getTransfer` (`@/server/inventory/transfer-queries`), `transferFiltersSchema`, `TRANSFER_STATUSES`, `TRANSFER_STATUS_LABELS` (`@/server/inventory/transfer-schemas`), `listBalances` (campos `reserved`, `inTransit`, `available`), `listStoreOptions`, `formatQuantity`.

## 6. Invariantes
- A tela não calcula reserva, trânsito nem disponível: exibe o que o serviço devolve.
- Estados de interface completos (carregando, vazio, erro, sem permissão, sucesso); acessibilidade (`caption`, rótulos, `aria-label`, foco no primeiro erro); celular sem rolagem horizontal da página.
- Comentários em inglês; arquivos ≤ 350 linhas; sem `any`, `console`, `dangerouslySetInnerHTML`, `@/db`.

## 7. Erros e casos de borda
| Situação | Comportamento esperado |
|----------|------------------------|
| Etapa do outro lado forjada | Mensagem `forbidden` do serviço no diálogo |
| Aprovação sem saldo | Erro na linha do item, vindo do serviço |
| Recebido maior que o enviado; diferença sem motivo | Erro no campo certo |
| Despacho com tudo zero | Mensagem do serviço sugerindo cancelar |
| Transferência de lojas fora do escopo | `notFound()` |

## 8. Segurança
`requireTenantContext()` em páginas e ações; leitura indexada com limite; decisão de botões só como conveniência (o serviço confere lado e permissão).

## 9. Critérios de aceite
### 9.1 Automáticos
- [ ] `lint`, `typecheck`, `lint:rules`, `test`, `build` verdes; gate `PASS`.
- [ ] `Select-String` sem `@/db|drizzle-orm|dangerouslySetInnerHTML|console\.` em `src/app/(app)/estoque/transferencias/**`; `requireTenantContext` em todas as `page.tsx` e no `actions.ts`.

### 9.2 Manual (Maestro, banco descartável)
- [ ] Gerente da loja B solicita da loja A; gerente de A aprova (saldos mostram reservado e disponível), despacha parte; gerente de B recebe com divergência e motivo; saldos e livro conferem.
- [ ] Gerente de B não vê botões de aprovar/despachar; gerente de C não vê a transferência.
- [ ] Cancelamentos com motivo; celular sem rolagem horizontal; diálogos utilizáveis só com teclado.

## 10. Política de dúvida
Dúvidas ao Maestro, em lote, com proposta. PLANO antes de editar e `DEC-xxx` antes de começar. Sem `git add`, sem commit, sem branch.

## 11. Dependências
Nenhuma nova; nenhuma alteração em `package.json` nem em lockfile.

## 12. Comandos de verificação
```
lint/typecheck/rules/test/build: corepack pnpm lint | typecheck | lint:rules | test | build
gate: pwsh -NoProfile -Command "& tools/gate/gate.ps1 -Module m30b-telas-transferencias -Allowed @('src/app/(app)/estoque/page.tsx','src/app/(app)/estoque/transferencias/**')"
```
