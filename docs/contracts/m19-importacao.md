# Contrato do módulo `m19-importacao` — v1

> Escrito pelo Arquiteto (Opus) em 22/10/2026. Risco: **SENSÍVEL** (arquivo não confiável, volume, dados pessoais). Nível: **A** (Opus).
> **Ordem de migração: 11ª da fila A**, depois da do m31.
> Se algo estiver ambíguo, o agente PERGUNTA; não presume.

## 1. Objetivo
**Importação CSV** (sem dependência nova, ADR-019) de **produtos com variações e preço**, **clientes** e **saldo inicial de estoque**: envio do arquivo, mapeamento de colunas, **prévia** validada linha a linha sem gravar nada, confirmação que grava em lotes pelos serviços existentes, e histórico com o resultado por linha.

## 2. Fora de escopo
XLSX (só com dependência aprovada depois), importação de vendas históricas, atualização em massa de preços existentes (vira m19 v2 se pedido), arquivos de outros sistemas com layout próprio.

## 3. Allowlist
```
src/db/schema/imports.ts
src/db/schema/index.ts
drizzle/**
src/lib/csv.ts                               (leitor CSV puro: separador ; ou , detectado, aspas, UTF-8 com ou sem BOM)
src/lib/csv.test.ts
src/server/imports/schemas.ts
src/server/imports/schemas.test.ts
src/server/imports/service.ts                (criar, mapear, prévia, confirmar, listar, detalhe)
src/server/imports/apply.ts                  (aplicar uma linha por tipo, reaproveitando os serviços do catálogo, clientes e estoque)
src/server/authz/permissions.ts
src/server/authz/system-roles.ts
src/server/audit/labels.ts
src/server/audit/service.ts
tests/integration/imports.test.ts
src/app/(app)/importacoes/**                 (etapa 2: tela)
docs/data-model.md
docs/security.md
```
Menu (Maestro): seção "Administração", `{ href: "/importacoes", label: "Importações", icon: FileUp }`, `NAV_PERMISSIONS "/importacoes": "imports.manage"`.

## 4. Regras
- Limites: arquivo ≤ 2 MB, ≤ 5 000 linhas, ≤ 40 colunas, célula ≤ 1 000 caracteres; recusa binário (bytes nulos) e codificação inválida.
- O conteúdo do arquivo nunca é executado nem interpretado como fórmula; nada é enviado para fora.
- Arquivo guardado só como linhas normalizadas na tabela da importação (sem o arquivo bruto), apagadas 30 dias depois da confirmação (rotina registrada como pendência da infraestrutura de tarefas).
- Prévia: para cada linha, `ok` / `erro` (mensagens do mesmo Zod dos serviços) / `ignorar` (duplicada no arquivo); a confirmação grava só as `ok`, em lotes de 200 linhas por transação, idempotente por importação (linha já aplicada não reaplica).
- Produtos: chave SKU (existente = erro "SKU já cadastrado", sem atualizar); clientes: CPF repetido = erro; saldo inicial: só para variação **sem** movimentos na loja (lança `entry` "Saldo inicial importado").
- Permissão nova `imports.manage` (Dono, Administrador); saldo inicial exige também `inventory.manage` e a loja no escopo; clientes exigem `customers.manage`.
- Auditoria: `import.created`, `import.confirmed` (contagens); as linhas aplicadas geram a auditoria normal dos serviços.

## 5. Dados
`imports` (tipo, situação `draft`/`previewed`/`applying`/`done`/`failed`, mapeamento como colunas tipadas por tipo de importação, totais) e `import_rows` (número da linha, valores normalizados em colunas tipadas por tipo, situação, mensagens, id criado). FORCE RLS.

## 6. Critérios de aceite
- [ ] Unitários `csv.test.ts`: `;` e `,`, aspas com separador e quebra de linha dentro, BOM, linha vazia, limites; schemas de cada tipo.
- [ ] Integração: prévia não grava nada; confirmação grava só as válidas e é idempotente (confirmar duas vezes não duplica); SKU e CPF existentes viram erro; saldo inicial recusado para variação com movimento; limites de tamanho e de linhas; permissões; escopo; isolamento; dados pessoais fora de log.
- [ ] `lint`, `typecheck`, `lint:rules`, `test`, `build`; integração verde no gate; etapa 2 com verificação manual.

## 7. Dependências
Nenhuma nova (leitor CSV próprio).

## 8. v2 (22/10/2026, Arquiteto, antes da implementação)
Decisões que a v1 deixava em aberto, registradas também em `docs/DECISIONS.md`:

1. **Lotes com ponto de salvamento por unidade.** A confirmação grava em lotes de até ~200 linhas por transação (um grupo de produto nunca é dividido) e aplica cada unidade (um produto com suas variações, um cliente, um saldo) num *savepoint*: um erro de domínio marca só aquela unidade como `failed`, sem desfazer o lote. Para isso os serviços ganham variantes dentro da transação, sem mudar o comportamento das funções públicas: `createProductInTx(tx, context, input)` em `src/server/catalog/service.ts` e `createCustomerInTx(tx, context, input)` em `src/server/customers/service.ts`. O saldo inicial usa `postLedgerEntry` (já em transação).
2. **Sem estado `draft`.** O navegador lê só o cabeçalho do arquivo (com o mesmo `src/lib/csv.ts`) para propor o mapeamento; arquivo e mapeamento vão juntos ao servidor, que relê tudo e grava a prévia (`previewed`). Estados: `previewed` → `applying` → `done`, ou `discarded` (prévia descartada: as linhas são apagadas).
3. **Mapeamento em tabela** `import_mappings` (campo → coluna do arquivo), sem JSON.
4. **Produtos:** linhas com o mesmo nome de produto (sem diferenciar maiúsculas) formam um produto e cada linha é uma variação (nome padrão "Única"); unidade, descrição, categoria e marca têm de coincidir no grupo; categoria e marca são buscadas pelo nome entre as ativas da empresa (não são criadas); preço opcional; **custo não é importado** (exige `catalog.costs.read` e fica para a tela).
5. **Clientes:** o consentimento de marketing **não é importado** (fica `false`): precisa ser coletado do cliente, não de uma planilha.
6. **Saldo inicial:** loja escolhida na importação; o SKU tem de existir.
7. **Linhas com erro** guardam só o número da linha e as mensagens; as válidas guardam os valores já normalizados pelo Zod dos serviços. Na tela, o CPF aparece mascarado para quem não tem `customers.documents.read`.
8. **Tamanho do envio (etapa 2):** Server Actions aceitam 1 MB por padrão; para arquivos de até 2 MB o Maestro configura `experimental.serverActions.bodySizeLimit: "3mb"` em `next.config.ts` (arquivo do Maestro).

Allowlist acrescida: `src/server/catalog/service.ts`, `src/server/customers/service.ts`, `src/server/imports/preview.ts` (validação linha a linha da prévia), `src/server/imports/queries.ts` (lista e detalhe).
