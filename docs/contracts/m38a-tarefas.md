# Contrato do módulo `m38a-tarefas` — v1

> Arquiteto (Opus), 22/10/2026. Risco **SENSÍVEL**. Nível **A**. Migração **24ª** (`0053`/`0054`).

## 1. Objetivo
Tarefas da gestão com linha do tempo de eventos e procedimentos da empresa. **Recomendação não é ação:** tarefa nasce só por ação de uma pessoa (manual, a partir de um alerta ou de uma conversa do assistente); a IA não tem ferramenta de criação.

## 2. Fora de escopo
Telas (m38b), notificação por e-mail/push, ferramenta de busca de procedimentos no assistente (entra no m39).

## 3. Allowlist
`src/db/schema/tasks.ts`, `src/db/schema/index.ts`, `drizzle/**`, `src/server/tasks/service.ts`, `src/server/tasks/procedures.ts`, `src/server/authz/permissions.ts`, `src/server/authz/system-roles.ts`, `src/server/audit/labels.ts`, `src/server/audit/service.ts`, `tests/integration/tasks.test.ts`, `tests/integration/roles.test.ts`, `docs/data-model.md`, `docs/security.md`, `docs/contracts/m38a-tarefas.md`.

## 4. Interface
```ts
createTask(context, { title, description?, storeId?, priority, dueDate?, assigneeMembershipId?, alertId?, conversationId? })   // tasks.manage
updateTaskStatus(context, id, { status, note? })     // tasks.manage ou o responsável
assignTask(context, id, membershipId); commentTask(context, id, { text })
listTasks(context, { status?, storeId?, mine?, page }); getTask(context, id)   // com eventos
saveProcedure(context, { title, body }, id?); setProcedureActive(context, id, active); listProcedures(context, { q? }); getProcedure(context, id)
```

## 5. Dados
`tasks` (loja opcional, título, descrição, prioridade `low`/`normal`/`high`, prazo, responsável, origem `manual`/`alert`/`assistant` com o id de origem, situação `open` → `in_progress` → `done` ou `cancelled`, quem/quando concluiu). `task_events` (somente inserção: criado, situação, atribuição, comentário, com autor). `procedures` (título único, texto até 20.000, ativo, quem atualizou). FORCE RLS.

## 6. Regras
- Responsável ativo e com acesso à loja da tarefa; tarefa sem loja só para membro com acesso a toda a empresa.
- Visível no escopo de lojas (`tasks.read`); tarefa sem loja só para acesso total; o responsável sempre vê e move a própria.
- Concluir ou cancelar exige nota no cancelamento; tarefa concluída/cancelada não muda mais.
- Permissões: `tasks.read` (Coordenador, Gerente de loja, Supervisor, Financeiro, Vendedor, Operador de caixa, Recepção), `tasks.manage` (Coordenador, Gerente de loja, Supervisor), `procedures.read` (os mesmos de `tasks.read`), `procedures.manage` (Coordenador); Dono/Admin todas. Auditoria em tudo.

## 9. Critérios de aceite
Integração: criar a partir de alerta e de conversa (do próprio usuário); responsável sem a loja recusado; responsável move a própria sem `tasks.manage`; eventos na ordem; finalizada imutável; escopo; procedimentos com busca e só ativos para quem não gerencia; isolamento.
