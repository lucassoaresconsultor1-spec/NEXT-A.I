# Contrato do módulo `m18-relatorios` (serviço) — v1

> Arquiteto (Opus), 22/10/2026. Risco **SENSÍVEL** (dados financeiros exportados). Nível **A**. Migração **20ª** (`0045`/`0046`). Telas na parte I do m18 (Codex).

## 1. Objetivo
Central de relatórios: catálogo de relatórios sobre os serviços existentes, **exportação CSV** (sem dependência nova, ADR-019), **histórico** das gerações e **agendamento** (diário, semanal, mensal) executado em nome de quem agendou, com as permissões atuais dessa pessoa.

## 2. Fora de escopo
XLSX/PDF (dependência não aprovada); envio por e-mail (sem provedor configurado: o agendamento grava no histórico e o envio fica `pendente`); o disparador periódico em produção (a rota/cron que chama `runDueSchedules` depende da infraestrutura de deploy do dono; pendência documentada).

## 3. Allowlist
`src/db/schema/reports.ts`, `src/db/schema/index.ts`, `drizzle/**`, `src/lib/csv.ts` (+ `toCsv`), `src/lib/csv.test.ts`, `src/server/reports/catalog.ts`, `src/server/reports/service.ts`, `src/server/reports/schedules.ts`, `src/server/authz/permissions.ts`, `src/server/authz/system-roles.ts`, `src/server/audit/labels.ts`, `src/server/audit/service.ts`, `tests/integration/reports.test.ts`, `docs/data-model.md`, `docs/security.md`, `docs/contracts/m18-relatorios.md`.

## 4. Interface
```ts
REPORT_KINDS = ["sales_by_period", "sales_by_store", "sales_by_salesperson", "expenses", "daily_closings"]
runReport(context, { kind, from, to, storeId?, groupBy? }): Promise<{ id; rowCount }>   // reports.read + a permissão do serviço de origem
listRuns(context, { page }); getRunCsv(context, runId): Promise<{ fileName; content } | null>
saveSchedule(context, { kind, period, frequency, hour, storeId?, groupBy? }, id?); setScheduleActive(context, id, active); listSchedules(context)   // reports.schedule
runDueSchedules(now = new Date()): Promise<{ ran; failed }>   // sem contexto: para o disparador periódico
```

## 5. Dados
`report_runs` (tipo, parâmetros em colunas, situação `done`/`failed`, linhas, CSV, motivo da falha, agendamento de origem, quem pediu; somente inserção). `report_schedules` (tipo, período relativo `yesterday`/`last_7_days`/`month_to_date`/`last_month`, frequência `daily`/`weekly`/`monthly`, hora local, loja/agrupamento, dono = membro, ativo, próxima e última execução, `delivery = pending`). FORCE RLS.

## 6. Regras
- O conteúdo vem só dos serviços (mesmas permissões e escopo de quem gera); até 10.000 linhas; CSV UTF-8 com BOM, `;`, decimais com vírgula, centavos em reais; células de texto que começam com `= + - @` recebem `'` (sem fórmula).
- Agendamento roda como o dono (contexto montado na hora); sem permissão ou membro inativo = execução `failed` registrada, sem dados. Próxima execução no fuso da empresa.
- Permissões novas: `reports.read` (Financeiro, Coordenador, Gerente de loja), `reports.schedule` (Financeiro, Coordenador); Dono/Admin todas. Auditoria: `report.generated`, `report_schedule.saved|status_changed`.

## 9. Critérios de aceite
Unitário do `toCsv` (injeção de fórmula, aspas, decimais). Integração: CSV de vendas por loja com valores conhecidos; permissão do serviço de origem respeitada; histórico; agendamento vencido gera execução e avança a próxima; dono sem permissão = `failed`; isolamento.
