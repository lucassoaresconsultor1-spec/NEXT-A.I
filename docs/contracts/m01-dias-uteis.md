# Contrato do módulo `m01-dias-uteis` — v2

> Escrito pelo Maestro a pedido do usuário (20/10/2026), seguindo o [SPEC](../SPEC.md#1-mapa-de-módulos); o Arquiteto pode revisar. O worker implementa o que está aqui e nada além.
> Se algo estiver ambíguo, o worker PERGUNTA (ver seção 10); não presume.
> Risco: **BAIXO** (função pura, sem banco, sem I/O, sem dinheiro, sem estoque, sem RLS, sem autenticação).

## 1. Objetivo
Biblioteca pura de calendário que diz se um dia é útil e conta ou lista os dias úteis de um período, para as escalas e as metas por período da Fase 3 ([roadmap](../roadmap.md#fase-3--pessoas-e-atendimento)).

## 2. Fora de escopo
- Banco, tabelas, migrations, serviços de `src/server/`, telas, Server Actions ou rotas.
- Fuso horário: a biblioteca trabalha com **dias de calendário** (`YYYY-MM-DD`), nunca com instantes; não chama `zonedDayStart` nem `Intl`.
- Feriados estaduais, municipais e pontos facultativos (Carnaval, Corpus Christi, Sexta-feira Santa): o chamador os informa em `extraHolidays`.
- Buscar feriados em serviço externo ou arquivo; cache; internacionalização.
- Alterar qualquer arquivo existente do projeto.

## 3. Allowlist de arquivos
Somente estes caminhos podem ser criados (usados pelo gate):
```
src/lib/business-days.ts
src/lib/business-days.test.ts
```
Qualquer outro caminho = falha automática do gate.

Pré-condição para delegar: `docs/SPEC.md` e este contrato precisam estar **commitados** (ou o Maestro roda `pwsh tools/gate/gate.ps1 -Module m01-dias-uteis -InitBaseline` antes do worker começar); senão o gate os vê como alterações fora da allowlist.

## 4. Interface pública
Exatamente estes nomes, tipos e comportamentos. Todos são exports nomeados de `src/lib/business-days.ts`; não há `default`.

```ts
/** A day on the calendar, "YYYY-MM-DD" (no time of day, no time zone). */
export type CalendarDay = string;

/** Years accepted by every function (inclusive). */
export const MIN_YEAR = 1900;
export const MAX_YEAR = 2199;

/** Largest period (both ends counted) accepted by countBusinessDays/listBusinessDays. */
export const MAX_SPAN_DAYS = 3660;

/** Largest `extraHolidays` array accepted (before removing duplicates). */
export const MAX_EXTRA_HOLIDAYS = 1000;

export interface NationalHoliday {
  /** "MM-DD". */
  readonly monthDay: string;
  /** Display name, pt-BR. */
  readonly name: string;
  /** First year in which the day is a national holiday; absent = always. */
  readonly fromYear?: number;
}

/** Fixed-date national holidays. Order: calendar order. */
export const NATIONAL_FIXED_HOLIDAYS: readonly NationalHoliday[] = [
  { monthDay: "01-01", name: "Confraternização Universal" },
  { monthDay: "04-21", name: "Tiradentes" },
  { monthDay: "05-01", name: "Dia do Trabalho" },
  { monthDay: "09-07", name: "Independência do Brasil" },
  { monthDay: "10-12", name: "Nossa Senhora Aparecida" },
  { monthDay: "11-02", name: "Finados" },
  { monthDay: "11-15", name: "Proclamação da República" },
  { monthDay: "11-20", name: "Dia da Consciência Negra", fromYear: 2024 },
  { monthDay: "12-25", name: "Natal" },
];

export interface CalendarOptions {
  /**
   * Additional non-working days (state, municipal, optional). Must be an array of valid CalendarDay with at
   * most MAX_EXTRA_HOLIDAYS entries; duplicates allowed; weekends have no extra effect. Internally held in a Set.
   */
  readonly extraHolidays?: readonly CalendarDay[];
  /** Working weekdays, 0 = Sunday … 6 = Saturday. Default [1, 2, 3, 4, 5]. Must be a non-empty array of integers 0..6. */
  readonly workingWeekdays?: readonly number[];
  /** Whether NATIONAL_FIXED_HOLIDAYS apply. Default true. Must be a boolean when given. */
  readonly includeNationalHolidays?: boolean;
}

/**
 * True when `value` is a string holding a real calendar day "YYYY-MM-DD" with MIN_YEAR <= year <= MAX_YEAR.
 * Accepts any input and never throws: undefined, numbers, objects and other non-strings return false.
 */
export function isValidCalendarDay(value: unknown): value is CalendarDay;

/**
 * Gregorian Easter Sunday of `year` (integer in MIN_YEAR..MAX_YEAR). Throws RangeError otherwise (including NaN and Infinity).
 * Purpose: callers derive Good Friday (Easter - 2 days), Carnival (Easter - 48 and - 47 days) and Corpus Christi (Easter + 60 days)
 * and pass them in `extraHolidays`; no function of this module calls it.
 */
export function easterSunday(year: number): CalendarDay;

/** True when the day is a working weekday and not a holiday. Throws RangeError on invalid input or options. */
export function isBusinessDay(day: CalendarDay, options?: CalendarOptions): boolean;

/** Business days between `from` and `to`, both ends counted. Throws RangeError if from > to, the span exceeds MAX_SPAN_DAYS, or any input or option is invalid. */
export function countBusinessDays(from: CalendarDay, to: CalendarDay, options?: CalendarOptions): number;

/** Same rules as countBusinessDays, returning the business days in ascending order. */
export function listBusinessDays(from: CalendarDay, to: CalendarDay, options?: CalendarOptions): CalendarDay[];
```

Algoritmo da Páscoa: Meeus/Jones/Butcher (calendário gregoriano). Feriado nacional fixo com `fromYear` só vale a partir desse ano. A origem legal da lista (Lei 662/1949 e posteriores, Lei 14.759/2023 para 20/11) é **a confirmar pelo Arquiteto com validação profissional antes de a lista alimentar folha, metas ou comissões**; o módulo não afirma nada além dessa lista.

## 5. Dados e esquemas
Nenhum. Sem tabelas, sem migrations, sem arquivos de dados.

## 6. Invariantes e regras de negócio
- Funções puras e determinísticas: o resultado depende só dos argumentos. Proibido `Date.now()`, `new Date()` sem argumentos, `Math.random()`, variáveis de ambiente e qualquer leitura do fuso local.
- A aritmética de datas usa só UTC (`Date.UTC`, `getUTCDay`, `getUTCDate`…); nunca `new Date("YYYY-MM-DD")` interpretado em fuso local nem os getters locais (`getDay`, `getDate`, `getMonth`, `getFullYear`).
- Um dia é útil quando: (a) seu dia da semana está em `workingWeekdays`; (b) não é feriado nacional aplicável (`includeNationalHolidays` verdadeiro, `monthDay` igual e `fromYear` ausente ou ≤ ano); (c) não consta em `extraHolidays`.
- `isValidCalendarDay` exige o formato `^\d{4}-\d{2}-\d{2}$`, mês 1–12, dia existente no mês (ano bissexto gregoriano) e ano entre `MIN_YEAR` e `MAX_YEAR`.
- Validação de `options`, em toda função que a recebe: `undefined` usa os padrões; qualquer outro valor precisa ser um objeto comum (não `null`, não array, não função). Cada campo, quando presente (diferente de `undefined`), precisa ter o tipo exato da interface (`extraHolidays` e `workingWeekdays` são arrays; `includeNationalHolidays` é booleano). Valores inteiros são verificados com `Number.isInteger` (rejeita `NaN`, `Infinity` e frações).
- `extraHolidays` é convertido num `Set` de strings validadas; nunca num objeto usado como mapa.
- Os argumentos de entrada nunca são alterados; os arrays retornados são novos.
- `listBusinessDays(a, b, o).length === countBusinessDays(a, b, o)` sempre.

## 7. Erros e casos de borda
| Situação | Comportamento esperado |
|----------|------------------------|
| Dia fora do formato, inexistente (`2026-02-30`), `2026-2-3`, vazio, ou fora de 1900–2199 | `RangeError` (em `isValidCalendarDay`: `false`) |
| Argumento que não é string (`undefined`, número, objeto) em qualquer função de dia | `RangeError` (não `TypeError`); em `isValidCalendarDay`: `false` |
| `options` igual a `null`, array, função ou valor que não é objeto | `RangeError` |
| `extraHolidays` que não é array (por exemplo uma string ou um objeto) | `RangeError` |
| `extraHolidays` com mais de `MAX_EXTRA_HOLIDAYS` entradas | `RangeError` |
| `extraHolidays` com valor inválido (inclusive `"__proto__"`) | `RangeError`, mesmo que a data não caia no período consultado |
| `workingWeekdays` que não é array, vazio, com valor não inteiro (`1.5`, `NaN`, `Infinity`) ou fora de 0–6 | `RangeError` |
| `includeNationalHolidays` que não é booleano (quando informado) | `RangeError` |
| `from` depois de `to` | `RangeError` (não retornar 0 em silêncio) |
| Período com mais de `MAX_SPAN_DAYS` dias, contando as duas pontas | `RangeError` |
| `from` igual a `to` | Conta 1 se for dia útil, senão 0 |
| Feriado que cai em fim de semana não útil | Sem efeito adicional |
| `easterSunday` com ano não inteiro (`2026.5`, `NaN`, `Infinity`) ou fora de 1900–2199 | `RangeError` |
| `includeNationalHolidays: false` | Só `extraHolidays` valem como feriado |

A mensagem dos `RangeError` é livre (quem chama a traduz para o usuário); não faz parte do contrato.

## 8. Segurança (obrigatório mesmo em módulo BAIXO)
- Toda entrada validada antes do uso (formato, tipo, intervalo); nada de `eval`, `Function` ou construção de regex a partir de entrada.
- Sem I/O: nada de rede, sistema de arquivos, banco, `process.env` ou logs.
- Os limites `MAX_SPAN_DAYS` (período) e `MAX_EXTRA_HOLIDAYS` (feriados extras) impedem laço longo e consumo excessivo por entrada hostil. Cada chamada valida as opções e monta o `Set` uma única vez (O(n) em `extraHolidays`, n ≤ 1000); `countBusinessDays` e `listBusinessDays` não revalidam as opções a cada dia do período.
- Opções são sempre validadas por tipo antes do uso; `extraHolidays` jamais é iterado se não for um array (uma string seria percorrida caractere a caractere).
- Sem segredos no código; nenhum dado pessoal envolvido.
- Não é preciso tenant, sessão ou permissão: a biblioteca não acessa recurso algum.

## 9. Critérios de aceite (escritos/aprovados pelo Arquiteto)
Testes que DEVEM existir em `src/lib/business-days.test.ts` e passar. O worker implementa até o gate passar; não enfraquece, pula (`skip`/`only`) nem apaga testes.
- [ ] `isValidCalendarDay`: aceita `2026-10-20`, `2024-02-29`, `2000-02-29`; recusa (retorna `false`, sem lançar) `2026-02-29`, `2100-02-29`, `2026-02-30`, `2026-13-01`, `2026-2-3`, `""`, `1899-12-31`, `2200-01-01`, `undefined`, `null`, `20261020`, um objeto e um array.
- [ ] `easterSunday`: 2000 → `2000-04-23`; 2024 → `2024-03-31`; 2025 → `2025-04-20`; 2026 → `2026-04-05`; 2027 → `2027-03-28`; 2038 → `2038-04-25`; `RangeError` para 1899, 2200, 2026.5, `NaN` e `Infinity`.
- [ ] `isBusinessDay` padrão: `2026-10-20` (terça) verdadeiro; `2026-01-03` (sábado) e `2026-01-04` (domingo) falsos; `2026-10-12` (segunda, Nossa Senhora Aparecida) falso; `2026-01-01` falso.
- [ ] Vigência: `2023-11-20` (segunda) verdadeiro e `2024-11-20` (quarta) falso.
- [ ] `extraHolidays`: com `["2026-02-17"]`, `isBusinessDay("2026-02-17")` falso; um feriado extra num sábado não altera nada.
- [ ] `includeNationalHolidays: false`: `isBusinessDay("2026-10-12")` verdadeiro.
- [ ] `workingWeekdays: [1,2,3,4,5,6]`: `isBusinessDay("2026-01-03")` verdadeiro e `2026-01-04` falso.
- [ ] `countBusinessDays` com números conhecidos (padrão, sem extras): janeiro/2026 → 21; fevereiro/2026 → 20; abril/2026 → 21; novembro/2026 → 19; dezembro/2026 → 22; novembro/2023 → 20.
- [ ] `countBusinessDays` com opções: fevereiro/2026 com `extraHolidays ["2026-02-16","2026-02-17"]` → 18; abril/2026 com `extraHolidays ["2026-04-03"]` → 20; fevereiro/2026 com `workingWeekdays [1,2,3,4,5,6]` → 24.
- [ ] `countBusinessDays("2026-10-20","2026-10-20")` → 1 e `("2026-10-17","2026-10-17")` (sábado) → 0.
- [ ] `listBusinessDays("2026-04-01","2026-04-10")` sem extras → `["2026-04-01","2026-04-02","2026-04-03","2026-04-06","2026-04-07","2026-04-08","2026-04-09","2026-04-10"]` (8 dias; a Sexta-feira Santa não é feriado embutido) e, com `extraHolidays ["2026-04-03"]`, a mesma lista sem `2026-04-03` (7 dias).
- [ ] Consistência: `listBusinessDays(a, b, o).length === countBusinessDays(a, b, o)` em pelo menos três períodos e opções diferentes.
- [ ] Borda do limite de período: `countBusinessDays("2020-01-01","2030-01-07")` (3660 dias, as duas pontas contadas) não lança; `("2020-01-01","2030-01-08")` (3661 dias) lança `RangeError`; `listBusinessDays` tem o mesmo comportamento; `("2020-01-01","2030-12-31")` (4018 dias) lança `RangeError`.
- [ ] Erros de dia e período: `from > to`, argumento `undefined` e número no lugar do dia → `RangeError`.
- [ ] Opções hostis, todas `RangeError` em `isBusinessDay`, `countBusinessDays` e `listBusinessDays`: `options: null`; `options` como array e como string; `extraHolidays: "2026-02-17"` (string no lugar de array); `extraHolidays` como objeto; `extraHolidays: ["2026-02-30"]`; `extraHolidays: ["__proto__"]`; `extraHolidays` com `MAX_EXTRA_HOLIDAYS + 1` entradas válidas (e com exatamente `MAX_EXTRA_HOLIDAYS` entradas não lança); `workingWeekdays: []`, `[7]`, `[-1]`, `[1.5]`, `[NaN]`, `[Infinity]` e `"12345"`; `includeNationalHolidays: "false"` e `0`.
- [ ] Imutabilidade: os arrays de entrada (`extraHolidays`, `workingWeekdays`) continuam iguais depois da chamada e `listBusinessDays` devolve um array novo a cada chamada.
- [ ] Determinismo de fuso: o arquivo de teste não depende do fuso da máquina e passa com `TZ=UTC` e com `TZ=America/Sao_Paulo` (comandos na seção 12).

## 10. Política de dúvida
O worker pergunta ao Maestro (não ao Arquiteto) quando: contrato ambíguo, interface insuficiente, dependência nova necessária. Perguntas em lote, com a proposta de resposta já escrita. O Maestro só escala ao Arquiteto o que for decisão de arquitetura. Antes de editar, o worker envia o PLANO ao Maestro e espera o `DEC-xxx`.

## 11. Dependências
- Permitidas: nenhuma. Somente a biblioteca padrão do TypeScript/Node e o Vitest já instalado (`import { describe, expect, it } from "vitest"`).
- Proibidas: qualquer outra (pedir aprovação antes de instalar); nenhuma alteração em `package.json` nem em lockfile.
- Convenções do projeto: TypeScript strict sem `any`, comentários em inglês como no restante de `src/lib/`, textos exibíveis em pt-BR, arquivo com no máximo 350 linhas (`quality/max-lines`), sem `console`.

## 12. Comandos de verificação
```
lint:      corepack pnpm lint
typecheck: corepack pnpm typecheck
rules:     corepack pnpm lint:rules
test:      corepack pnpm exec vitest run src/lib/business-days.test.ts
test (todos): corepack pnpm test
fuso UTC:  $env:TZ = 'UTC'; corepack pnpm exec vitest run src/lib/business-days.test.ts
fuso BR:   $env:TZ = 'America/Sao_Paulo'; corepack pnpm exec vitest run src/lib/business-days.test.ts
gate:      pwsh tools/gate/gate.ps1 -Module m01-dias-uteis -Allowed 'src/lib/business-days.ts','src/lib/business-days.test.ts'
sem fuso local (deve não imprimir nada):
           rg -n "getDay\(|getDate\(|getMonth\(|getFullYear\(|getHours\(|getTimezoneOffset|Date\.now|new Date\(\)|Math\.random|process\.env|Intl|toLocale" src/lib/business-days.ts
```
Os dois comandos de fuso são em PowerShell (`$env:TZ`); em Bash, `TZ=UTC corepack pnpm exec vitest run …`. Os dois precisam passar, e o resultado deve ser idêntico.
Resultado esperado do gate: `PASS` (nenhum caminho do módulo é sensível). `PASS+REVIEW` ou `FAIL` devolve ao worker com a saída do gate.
