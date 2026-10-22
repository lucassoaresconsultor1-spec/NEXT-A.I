# Contrato do módulo `m25-observabilidade` — v1

> Arquiteto (Opus), 22/10/2026. Risco **SENSÍVEL**. Nível **A**. Migração **27ª** (`0058`/`0059`).

## 1. Objetivo
Erros, latência (transações lentas) e custo de IA **por organização**, sem serviço externo: logs Pino estruturados, eventos operacionais em `ops_events` e relatório da plataforma. APM/rastreamento de erros externo depende de credencial do dono (pendente).

## 3. Allowlist
`src/db/schema/ops.ts`, `src/db/schema/index.ts`, `src/db/ops.ts`, `src/db/tenant.ts` (medição em `withScope`), `src/server/actions.ts` (erro inesperado), `src/server/platform/service.ts` (exporta os auxiliares de autorização), `src/server/platform/observability.ts`, `drizzle/**`, `tests/integration/observability.test.ts`, `docs/data-model.md`, `docs/security.md`, `docs/contracts/m25-observabilidade.md`.

## 6. Regras
Transação de `withScope` com 1 s ou mais vira log `warn` e evento `slow_transaction` com a empresa e a duração; erro inesperado de Server Action vira evento `error` com o nome da ação e a empresa da sessão. `ops_events` não guarda dado de negócio, aceita inserção de qualquer conexão e só é lido no contexto da plataforma (FORCE RLS). Registro sem bloquear a operação (falha só vira log). `observabilitySummary(actorId, { from, to })` (administração da plataforma): por empresa, erros, transações lentas, maior duração e uso/custo de IA do período (até 200 empresas mais recentes).

## 9. Critérios de aceite
Transação lenta e erro registrados; empresa não lê eventos (nem os próprios); só a plataforma vê o relatório; IA por empresa somada do período.
