# Contrato do módulo `m13a-fila` — v1

> Arquiteto (Opus), 22/10/2026. Risco **SENSÍVEL**, nível **A**. Migração **16ª** (`0037`/`0038`). Substitui o m33 (cortado): o tablet da entrada usa a sessão normal de um membro com o perfil **Recepção**.

## 1. Objetivo
Fila de atendimento da loja: chegada do cliente, presença dos vendedores, distribuição por **rodízio** (quem está disponível há mais tempo) ou **manual com motivo**, encerramento **com venda vinculada** ou **sem venda com motivo**, desistência, e a **conversão** com denominador documentado.

## 2. Fora de escopo
Telas (m13b), pareamento do aparelho e PIN (m33, cortado), distribuição por especialidade/setor (adiada), dados pessoais do cliente na fila (só uma nota curta opcional).

## 3. Allowlist
`src/db/schema/queue.ts`, `src/db/schema/index.ts`, `drizzle/**`, `src/server/queue/schemas.ts`, `src/server/queue/service.ts`, `src/server/authz/permissions.ts`, `src/server/authz/system-roles.ts`, `src/server/audit/labels.ts`, `src/server/audit/service.ts`, `tests/integration/queue.test.ts`, `tests/integration/roles.test.ts` (listas fixas de perfis), `docs/data-model.md`, `docs/security.md`, `docs/contracts/m13a-fila.md`.

## 4. Interface (`src/server/queue/service.ts`)
```ts
registerArrival(context, { storeId, requestKey, note? }): Promise<{ id; ticket; replayed }>  // queue.operate
setPresence(context, { storeId, salespersonId, status: "available" | "away" })            // o próprio vendedor ou queue.operate
callNext(context, { storeId }): Promise<{ entryId; salespersonId } | null>                // queue.operate: mais antigo aguardando + rodízio
assignManual(context, entryId, { salespersonId, reason })                                 // queue.assign_manual
finishAttendance(context, entryId, { outcome: "sale", saleId } | { outcome: "no_sale", reason }) // o vendedor do atendimento ou queue.operate
abandonEntry(context, entryId, { reason })                                                // queue.operate (só aguardando)
getQueue(context, storeId)        // queue.read: aguardando, em atendimento e presença na ordem do rodízio
queueStats(context, { storeId?, from, to }): { finished; withSale; noSale; abandoned; conversion: string }
```

## 5. Dados
`queue_presence` (vendedor × loja: `available`/`busy`/`away`, desde quando; FK para o vínculo do m10a). `queue_entries` (loja, senha por loja e dia local, situação `waiting` → `in_service` → `finished`, ou `abandoned`; vendedor, modo `rotation`/`manual` e motivo; horários; resultado `sale`/`no_sale`, venda (única por empresa) ou motivo; nota até 80 caracteres; chave da chegada única por empresa). FORCE RLS. A `0038` também cria o perfil Recepção nas empresas existentes (como a `0004`).

## 6. Regras
- Rodízio: entre os vendedores `available` da loja (ativos e vinculados), vai o de `since` mais antigo; ao chamar fica `busy`; ao encerrar volta a `available` com `since = agora` (fim da fila). Travas: entrada mais antiga `FOR UPDATE SKIP LOCKED` e presenças da loja `FOR UPDATE`.
- Venda vinculada: da mesma loja, finalizada, com o vendedor do atendimento, concluída depois da chegada e ainda não vinculada a outro atendimento.
- **Conversão** = atendimentos encerrados com venda ÷ atendimentos encerrados (`finished`) no período (dia local da chegada); desistências ficam fora do denominador e aparecem à parte; sem atendimentos = "0.0".
- Permissões: `queue.read` (Recepção, Vendedor, Supervisor, Gerente, Coordenador), `queue.operate` (Recepção, Supervisor, Gerente), `queue.assign_manual` (Supervisor, Gerente); Dono/Admin todas. Escopo de lojas; fora dele = não encontrado. Auditoria em toda mutação (`queue.*`).

## 9. Critérios de aceite
Integração: rodízio na ordem e volta ao fim; chamadas simultâneas não repetem cliente nem vendedor; manual exige motivo e permissão; venda vinculada validada (outro vendedor, outra loja, já vinculada = erro); chegada repetida pela chave = mesma senha; conversão com desistência fora do denominador; vendedor só encerra o próprio; Recepção existe em empresa nova; escopo e isolamento.
