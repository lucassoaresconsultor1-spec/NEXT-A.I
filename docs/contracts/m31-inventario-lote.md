# Contrato do módulo `m31-inventario-lote` — v1

> Escrito pelo Arquiteto (Opus) em 22/10/2026. Risco: **SENSÍVEL** (estoque, tabelas com RLS). Nível: **A** (Opus), back-end e tela no mesmo contrato, em duas etapas (serviço com testes; depois tela).
> **Ordem de migração: 10ª da fila A**, depois da do m08.
> Se algo estiver ambíguo, o agente PERGUNTA; não presume.

## 1. Objetivo
**Inventário por lote** numa loja: abrir uma contagem (todos os itens com saldo, ou filtrados por categoria/marca), registrar as quantidades contadas sem mostrar o saldo do sistema (contagem cega), revisar as diferenças e **aprovar**, o que lança no livro um movimento `count` por item divergente, numa transação.

## 2. Fora de escopo
Coletor de dados/app offline, contagem por localização interna (prateleira), recontagem automática, inventário rotativo agendado.

## 3. Allowlist
```
src/db/schema/counts.ts
src/db/schema/index.ts
drizzle/**
src/server/inventory/counts.ts
src/server/inventory/count-schemas.ts
src/server/inventory/count-schemas.test.ts
src/server/authz/permissions.ts
src/server/authz/system-roles.ts
src/server/audit/labels.ts
src/server/audit/service.ts
tests/integration/inventory-counts.test.ts
src/app/(app)/estoque/inventarios/**          (etapa 2: lista, nova, contagem, revisão)
docs/data-model.md
docs/security.md
```
Menu (Maestro): seção "Estoque", `{ href: "/estoque/inventarios", label: "Inventários", icon: ClipboardCheck }`, `NAV_PERMISSIONS "/estoque/inventarios": "inventory.read"`.

## 4. Interface
```ts
export async function openCount(context, input: unknown): Promise<{ id; number }>;               // inventory.count.manage; { storeId, categoryId?, brandId?, note? }; cria itens com snapshot do saldo (oculto na contagem)
export async function recordCountedQuantities(context, countId, input: unknown): Promise<void>; // inventory.count.record; { items: [{ itemId, countedQuantity }] }; contagem aberta; pode repetir (vale a última)
export async function getCount(context, countId, options?: { blind?: boolean });                // blind = sem saldo do sistema (padrão para quem só tem count.record)
export async function approveCount(context, countId, input: unknown): Promise<{ adjusted: number }>; // inventory.count.approve; { reason }; para cada item contado: count no livro com o contado; itens não contados ficam como estão (registrados como "não contados")
export async function cancelCount(context, countId, reason): Promise<void>;
export async function listCounts(context, filters);
```
- Na aprovação, a diferença é calculada contra o **saldo atual** (não o snapshot), sob trava das linhas de saldo em ordem; movimentos depois da abertura entram no relatório de revisão como "movimentado durante a contagem".
- Uma contagem aberta por loja (índice único parcial).
- Permissões: `inventory.count.record` (Gerente, Supervisor), `inventory.count.manage` e `inventory.count.approve` (Gerente); Dono/Admin todas. A contagem respeita `reserved` (inventário abaixo do reservado é recusado pelo ledger).

## 5. Dados
`inventory_counts` (número por empresa via contador `inventory_count`, loja, situação `open`/`approved`/`cancelled`, filtros, abertura/aprovação/cancelamento com responsável e motivo) e `inventory_count_items` (variação, saldo na abertura, contado NULL, contado por/em, movimento gerado). FKs compostas; FORCE RLS.

## 6. Critérios de aceite
- [ ] Integração: abrir com filtro de categoria; contagem cega não expõe o saldo; aprovar lança `count` só nos divergentes e deixa o livro igual ao contado; movimento durante a contagem é sinalizado e a aprovação usa o saldo atual; segunda contagem aberta na mesma loja recusada; reservado protegido; permissões e escopo de loja; isolamento.
- [ ] Unitários dos schemas; `lint`, `typecheck`, `lint:rules`, `test`, `build`; integração verde no gate; etapa 2 com verificação manual (contagem no celular, teclado).

## 7. Dependências
Nenhuma nova.
