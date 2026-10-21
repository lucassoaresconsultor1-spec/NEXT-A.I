# Contrato do módulo `m32a-calendario-empresa` — v1

> Escrito pelo Arquiteto (Opus) em 22/10/2026. Risco: **SENSÍVEL** (tabela com RLS, migração). Nível: **A** (Opus).
> **Ordem de migração: 12ª da fila A**, depois da do m19 (ou antes, se o Maestro reordenar: não depende de m31/m19).
> Se algo estiver ambíguo, o agente PERGUNTA; não presume.

## 1. Objetivo
Feriados e dias de trabalho **por empresa e por loja**, que alimentam o m01 (`extraHolidays`, `workingWeekdays`) para escalas (m10a) e metas (m11a). Os feriados estaduais e municipais (ex.: Araruama/RJ, SPEC seção 1) entram aqui como dado da empresa, não do código.

## 2. Allowlist
```
src/db/schema/calendar.ts
src/db/schema/index.ts
drizzle/**
src/server/calendar/schemas.ts
src/server/calendar/schemas.test.ts
src/server/calendar/service.ts
src/server/authz/permissions.ts
src/server/audit/labels.ts
src/server/audit/service.ts
tests/integration/calendar.test.ts
docs/data-model.md
docs/security.md
```

## 3. Dados
- `calendar_holidays`: empresa, loja (NULL = vale para todas as lojas), data (`date`), nome (2..80), tipo (`holiday` = sem expediente; `optional` = ponto facultativo, **não** é dia útil só se a empresa marcar `closed = true`), `closed boolean`, `UNIQUE (organization_id, store_id, day)` tratando NULL com índice parcial; FORCE RLS.
- `store_work_weeks`: empresa, loja, `weekdays smallint[]` (0..6, 1 a 7 elementos, sem repetição), PK `(organization_id, store_id)`; ausente = segunda a sexta (padrão do m01).

## 4. Interface
```ts
export async function listHolidays(context, filters: { year: number; storeId?: string }): Promise<{ id; day; name; kind; closed; storeId: string | null }[]>; // organization.settings.read
export async function saveHoliday(context, input: unknown): Promise<{ id: string }>;          // settings.operations.manage; loja no escopo ou NULL (exige acesso a todas as lojas)
export async function deleteHoliday(context, id): Promise<void>;                               // exclusão física permitida (dado de configuração), auditada
export async function setStoreWorkWeek(context, storeId, input: unknown): Promise<void>;
/** For other services: the m01 options of a store for a period (holidays of the store + organization-wide ones that are closed). */
export async function loadCalendarOptions(tx: Tx, organizationId: string, storeId: string, from: CalendarDay, to: CalendarDay): Promise<CalendarOptions>;
```
- Validação de datas com `isValidCalendarDay` do m01; `loadCalendarOptions` respeita `MAX_EXTRA_HOLIDAYS`.
- Auditoria: `calendar.holiday_saved`, `calendar.holiday_deleted`, `calendar.work_week_set`; entidade `calendar`.

## 5. Critérios de aceite
- [ ] Unitários: schemas (data inválida, nome curto, dias da semana repetidos/fora de 0..6).
- [ ] Integração: feriado da empresa vale para todas as lojas; feriado da loja só para ela; ponto facultativo só conta quando `closed`; `loadCalendarOptions` + `countBusinessDays` (m01) dão o número esperado para um mês de Araruama com 20/01 e 06/02 cadastrados; semana de trabalho de segunda a sábado; permissões, escopo e isolamento.
- [ ] `lint`, `typecheck`, `lint:rules`, `test`, `build`; integração verde no gate.

## 6. Dependências
Nenhuma nova (usa o m01).
