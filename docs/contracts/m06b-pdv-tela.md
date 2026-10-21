# Contrato do módulo `m06b-pdv-tela` — v1

> Escrito pelo Arquiteto (Opus) em 22/10/2026. Risco: **SENSÍVEL** (dinheiro, idempotência no cliente). Nível: **A** (Opus), pelo ADR-008.
> Se algo estiver ambíguo, o agente PERGUNTA; não presume.

## 1. Objetivo
**PDV de desktop** sobre o serviço do m06a: leitura de código de barras e busca por teclado, carrinho, cliente e vendedor, descontos/acréscimo autorizados, pagamento misto (dinheiro com troco, cartão com NSU), finalização idempotente com pendência visível, suspensão/retomada e comprovante não fiscal imprimível.

## 2. Fora de escopo
Pagamento por provedor (m07), fiscal (m09), cancelamento (m08), operação offline, alterações em `src/server/**`, `src/db/**`, `src/components/ui/**`, `src/lib/**`; `nav.ts`/`shell.ts` (seção 6).

## 3. Allowlist
```
src/app/(pdv)/layout.tsx
src/app/(pdv)/pdv/page.tsx
src/app/(pdv)/pdv/actions.ts
src/app/(pdv)/pdv/pos-screen.tsx
src/app/(pdv)/pdv/cart.ts
src/app/(pdv)/pdv/cart.test.ts
src/app/(pdv)/pdv/payment-dialog.tsx
src/app/(pdv)/pdv/suspended-dialog.tsx
src/app/(pdv)/pdv/comprovante/[saleId]/page.tsx
```
Pré-condições: **m06a, m05b, m28b e m26 integrados**. Gate esperado `PASS` (o Maestro revisa `actions.ts` e `pos-screen.tsx`).

## 4. Interface
- **Layout próprio** `(pdv)`: tela cheia, sem a barra lateral; `layout.tsx` e cada página chamam `requireTenantContext()`; cabeçalho com loja, operador, caixa aberto e link "Sair do PDV" (`/painel`). Sem `sales.create` → `<AccessDenied />`; sem sessão aberta (`findOpenSessionForOperator`) → `EmptyState` `Abra o caixa para vender.` com link para `/caixa`.
- **Teclado**: campo de código sempre focado; Enter busca por código/SKU exato (`searchVariantsAction` → 1 resultado adiciona com quantidade 1; vários abrem a lista); `F2` busca por nome; `F4` cliente; `F6` desconto; `F8` pagamento; `F9` suspender; `F10` vendas suspensas; `Esc` fecha diálogos; `Delete` remove o item selecionado; setas navegam no carrinho. Atalhos visíveis no rodapé.
- **Carrinho** (`cart.ts`, puro, com testes): linhas `{ variantId, label, sku, unit, quantity (string), unitPriceCents, discountCents }`; somar quantidade quando o mesmo item entra de novo; totais exibidos com as mesmas regras de `src/server/sales/pricing.ts` (importar as funções; a tela só **mostra**, o servidor recalcula); persistência em `sessionStorage` por loja e caixa (`pdv:{storeId}:{sessionId}`), com `try/catch`.
- **Chave de finalização (ADR-013)**: gerada com `crypto.randomUUID()` ao abrir o diálogo de pagamento e guardada junto do carrinho; reenviada em toda tentativa; trocada só depois de uma venda concluída ou de o operador alterar o carrinho. Se a resposta não chegar (erro de rede), a tela mostra `Venda pendente de confirmação` com o botão `Verificar`, que chama `findSaleByCompletionKeyAction(key)`: venda encontrada → sucesso; não encontrada → permite tentar de novo com a **mesma** chave. Sem retentativa automática.
- **Pagamento** (`payment-dialog.tsx`): linhas de pagamento (Dinheiro: valor e recebido → troco; Cartão (maquininha): valor, NSU, bandeira); botão Finalizar só quando a soma = total; `conflict` de preço atualiza os preços do carrinho e avisa `Preços atualizados. Confira a venda.`; erros por item/pagamento nos campos.
- **Suspensas** (`suspended-dialog.tsx`): suspender com observação; listar as da loja; retomar carrega o carrinho com `suspendedSaleId`; descartar com motivo.
- **Comprovante** `/pdv/comprovante/[saleId]`: `getReceipt`; layout de impressão 80 mm (`@media print`), botão `Imprimir` (`window.print()`), texto `Documento sem valor fiscal`; reimpressão a qualquer momento.
- **Actions** (`actions.ts`, `"use server"`, só funções async, `requireTenantContext()` primeiro): `searchVariantsAction(q)`, `searchCustomersAction(q)` (via `listCustomers`, até 10, CPF mascarado), `completeSaleAction(input)`, `findSaleByCompletionKeyAction(key)`, `suspendSaleAction(input)`, `listSuspendedAction(storeId)`, `resumeSaleAction(saleId)`, `discardSaleAction(saleId, reason)`; devolvem `ActionState` com os dados necessários; nenhum custo vai ao cliente.

## 5. Critérios de aceite
- [ ] `cart.test.ts`: somar item repetido, remover, quantidade fracionada em kg, totais iguais aos de `pricing.ts` para 3 carrinhos conhecidos, persistência tolerante a `sessionStorage` indisponível.
- [ ] `lint`, `typecheck`, `lint:rules`, `test`, `build` verdes; gate `PASS`; `requireTenantContext` em layout, páginas e actions; sem `@/db`, `console`, `dangerouslySetInnerHTML`.
- [ ] Manual (Maestro): venda só com teclado e leitor (código + Enter); pagamento misto com troco; queda de rede simulada (DevTools offline) na finalização mostra a pendência e `Verificar` não duplica; suspender, retomar em outro operador, descartar; preço alterado durante a venda; desconto acima do teto recusado para o caixa; comprovante impresso em 80 mm.

## 6. Menu (aplicado pelo Maestro, ADR-009)
`nav.ts`: seção "Vendas", primeiro item `{ href: "/pdv", label: "PDV", icon: ScanBarcode }`; `shell.ts`: `"/pdv": "sales.create"`.

## 7. Dependências
Nenhuma nova. Comandos: os do m06c, com `-Module m06b-pdv-tela -Allowed @('src/app/(pdv)/**')`.
