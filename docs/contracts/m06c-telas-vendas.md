# Contrato do módulo `m06c-telas-vendas` — v1

> Escrito pelo Arquiteto (Opus) em 22/10/2026. O agente implementa o que está aqui e nada além.
> Se algo estiver ambíguo, o agente PERGUNTA (ver seção 10); não presume.
> Risco: **SENSÍVEL** (dinheiro, dados de cliente). Nível: **I** (Codex), pelo ADR-008: só leitura sobre o serviço do m06a; nenhuma mutação.

## 1. Objetivo
**Histórico de vendas**: lista com filtros, detalhe da venda (itens, pagamentos, totais, cliente, operador, vendedor) e link para reimprimir o comprovante não fiscal.

## 2. Fora de escopo
- Cancelamento e devolução (m08), PDV (m06b), exportação (m18).
- Qualquer alteração em `src/server/**`, `src/db/**`, `src/components/ui/**`, `src/lib/**`.
- `nav.ts`/`shell.ts` (seção 4.5).

## 3. Allowlist de arquivos
```
src/app/(app)/vendas/page.tsx
src/app/(app)/vendas/sale-filters.tsx
src/app/(app)/vendas/[saleId]/page.tsx
```
Veredito esperado: `PASS`. Pré-condições: **m06a, m04 (quantity-format) e m26 integrados**. Pode rodar em paralelo com o m06b (arquivos disjuntos).

## 4. Interface pública
### 4.1 Lista `/vendas`
- `requireTenantContext()`; sem `sales.read` nem `sales.create` → `<AccessDenied />`. Quem só tem `sales.create` vê as próprias vendas (o serviço filtra); cabeçalho com a frase `Suas vendas` nesse caso, senão `Vendas das lojas do seu acesso`.
- Filtros GET (`sale-filters.tsx`): Loja (`loja`), Situação (`situacao`: `finalizada`→`completed`, `cancelada`→`cancelled`, `suspensa`→`suspended`, `descartada`→`discarded`; padrão = todas), Número (`numero`), De/Até (`de`, `ate`, dias no fuso da empresa). Dados: `listSales(context, { storeId, status, number, from, to, page })`.
- Tabela (`caption` "Vendas"): Nº (link; `—` para suspensa/descartada), Data e hora (`completedAt` no fuso), Loja, Operador, Cliente (`—`), Itens, Pagamento (rótulos de `PAYMENT_METHOD_LABELS` separados por " + "), Total (`formatCurrencyCents`, `tabular-nums`), Situação (`Badge` com `SALE_STATUS_LABELS`: finalizada `positive`, cancelada `critical`, suspensa `attention`, descartada `neutral`). `Pagination`.
- Vazios: `Nenhuma venda registrada` / com filtro `Nenhuma venda encontrada` + `Ver todas`.

### 4.2 Detalhe `/vendas/[saleId]`
- `getSale` null → `notFound()`.
- Cabeçalho `Venda nº {número}` (ou `Venda suspensa`), situação, `DetailList`: Loja, Data e hora, Operador, Vendedor (`—`), Cliente (nome e CPF como o serviço devolve, ou `Sem cliente identificado`), Observação.
- Itens (`caption` "Itens da venda"): Linha, Produto (`{produto} · {variação}` e SKU), Quantidade (`formatQuantity` com unidade), Preço unitário, Desconto, Total; coluna Custo só se o serviço devolveu `unitCostCents`.
- Totais: Subtotal, Desconto, Acréscimo (só se > 0), **Total**, Troco (só se > 0).
- Pagamentos (`caption` "Pagamentos"): Forma (`PAYMENT_METHOD_LABELS`), Valor, Recebido e Troco (dinheiro), NSU (como veio, mascarado) e bandeira (cartão), Situação.
- Ação: `Reimprimir comprovante` (link para `/pdv/comprovante/{saleId}`, abre em nova aba com `target="_blank" rel="noopener"`), só para venda finalizada ou cancelada.

### 4.3 Textos e estados
Textos em pt-BR como acima; carregando, vazio, erro, sem permissão; celular sem rolagem horizontal da página (tabelas com `overflow-x-auto` dentro do `Card`).

### 4.4 Segurança na tela
Sem ações de escrita; nenhum dado além do que o serviço devolve (CPF e NSU já mascarados, custo só quando vier).

### 4.5 Menu (aplicado pelo Maestro, ADR-009)
- `nav.ts`: seção "Vendas", depois de "PDV": `{ href: "/vendas", label: "Histórico de vendas", icon: ScrollText }`.
- `shell.ts`: `"/vendas": "sales.create"`. (Quem tem só `sales.read` também precisa do item: o Maestro pode trocar a chave por `sales.read` e dar `sales.read` aos operadores se quiser; decisão registrada como pendência do menu de permissão única.)

## 5. Dados e esquemas
Nenhuma tabela. Consumidos (não alterar): `listSales`, `getSale` (`@/server/sales/queries`), `PAYMENT_METHOD_LABELS`, `SALE_STATUS_LABELS`, `SALE_STATUSES` (`@/server/sales/schemas`), `listStoreOptions`, `formatQuantity`, `formatCurrencyCents`, `formatDateTime`.

## 6. Invariantes
Sem cálculo de valores na tela; comentários em inglês; arquivos ≤ 350 linhas; sem `any`, `console`, `dangerouslySetInnerHTML`, `@/db`.

## 7. Erros e casos de borda
| Situação | Comportamento esperado |
|----------|------------------------|
| Venda de outra loja/empresa/operador sem `sales.read` | `notFound()` |
| Filtros inválidos na URL | Ignorados pelo schema |
| Plano sem `pos` | Mensagem do serviço num `Card` |

## 8. Segurança
`requireTenantContext()` nas duas páginas; leitura só pelo serviço.

## 9. Critérios de aceite
- [ ] `lint`, `typecheck`, `lint:rules`, `test`, `build` verdes; gate `PASS`.
- [ ] `Select-String` sem `@/db|drizzle-orm|dangerouslySetInnerHTML|console\.` em `src/app/(app)/vendas/**`; `requireTenantContext` nas duas `page.tsx`.
- [ ] Manual: gerente vê as vendas da loja com filtros; operador só as suas; detalhe com CPF mascarado para o operador; coluna de custo só para quem tem `catalog.costs.read`; reimpressão abre o comprovante.

## 10. Política de dúvida
Dúvidas ao Maestro, em lote, com proposta. PLANO antes de editar e `DEC-xxx` antes de começar. Sem `git add`, sem commit, sem branch.

## 11. Dependências
Nenhuma nova.

## 12. Comandos de verificação
```
lint/typecheck/rules/test/build: corepack pnpm lint | typecheck | lint:rules | test | build
gate: pwsh -NoProfile -Command "& tools/gate/gate.ps1 -Module m06c-telas-vendas -Allowed @('src/app/(app)/vendas/**')"
```
