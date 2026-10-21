# Contrato das telas de calendário — m32b v1

> Escopo de interface para a implementação das telas. O serviço m32a já está integrado; este contrato não autoriza alterações nele.

## 1. Objetivo
Permitir que pessoas autorizadas consultem e mantenham feriados da empresa/loja e os dias de trabalho de cada loja, usados pelo calendário operacional.

## 2. Fora de escopo
- Alterar regras ou persistência de `src/server/calendar/**`, `src/lib/business-days.ts`, banco ou migrations.
- Cadastrar automaticamente feriados nacionais, estaduais ou municipais; são dados configurados pela empresa.
- Gerenciar escalas de vendedores ou metas.

## 3. Allowlist de arquivos
Somente arquivos novos em:
```
src/app/(app)/calendario/**
```
Não editar menu, `src/server/**`, `src/db/**`, `drizzle/**`, `src/lib/**` ou componentes compartilhados.

## 4. Interface pública existente
Usar exclusivamente estas operações de tela exportadas em `src/server/calendar/service.ts`:
```ts
listHolidays(context: TenantContext, filters: HolidayFilters)
saveHoliday(context: TenantContext, rawInput: unknown, holidayId?: string): Promise<{ id: string }>
deleteHoliday(context: TenantContext, holidayId: string): Promise<void>
getStoreWorkWeek(context: TenantContext, storeId: string): Promise<number[] | null>
setStoreWorkWeek(context: TenantContext, storeId: string, rawInput: unknown): Promise<void>
```
Tipos e schemas reais em `src/server/calendar/schemas.ts`: `HolidayFilters`, `HolidayInput`, `holidayFiltersSchema`, `holidaySchema`, `workWeekSchema`, `HOLIDAY_KINDS` e `HOLIDAY_KIND_LABELS`. A listagem retorna registros `{ id, day, name, kind, closed, storeId }`. `getStoreWorkWeek` retorna dias numéricos de 0 (domingo) a 6 (sábado), ou `null` quando não há configuração explícita.

`loadCalendarOptions(tx, organizationId, storeId, from, to)` é auxiliar interno de outros serviços; não chamar pela tela.

## 5. Dados e esquemas
- Consulta de feriados por ano (`HolidayFilters.year`) e, opcionalmente, loja (`storeId`). Ao escolher loja, a listagem inclui feriados da empresa e daquela loja.
- `HolidayInput`: `storeId` opcional, data `day`, `name`, `kind` (`holiday` ou `optional`) e `closed`.
- Dia classificado como `holiday` sempre fecha a operação; `optional` pode deixar a loja aberta ou fechada.
- A semana de trabalho deve conter de um a sete dias distintos entre 0 e 6.

## 6. Invariantes e regras de negócio
- Datas da empresa valem para todas as lojas; datas de loja valem só para a loja selecionada.
- Feriados e pontos facultativos não são inferidos nem importados pelo sistema.
- O calendário configura somente os dias da semana da loja. Quando não há configuração, permanece o padrão operacional de segunda a sexta.
- Edições e exclusões respeitam o escopo de lojas do ator; datas da empresa exigem alcance organizacional completo.
- Use datas locais no formato ISO `AAAA-MM-DD` para entrada e apresentação coerente com o calendário; não deslocar o dia por conversão de fuso.

## 7. Estados e textos da interface
- Título: **Calendário**. Abas/seções: **Feriados e pontos facultativos**, **Dias de trabalho**.
- Filtros: **Ano**, **Loja**, opção **Todas as lojas**. Tipos: **Feriado**, **Ponto facultativo**. Campos: **Data**, **Nome**, **A loja fecha neste dia**, **Dias de trabalho**.
- Ações: **Adicionar data**, **Salvar**, **Editar**, **Excluir**, **Cancelar**. Confirmação de exclusão: **Excluir esta data do calendário?**
- Estado vazio: **Nenhuma data cadastrada para este período.**
- Semana não configurada: **A loja usa os dias padrão: segunda a sexta-feira.**
- Carregamento: **Carregando calendário…**; erro de leitura: **Não foi possível carregar o calendário. Tente novamente.**
- Sem acesso de leitura: renderizar `AccessDenied`, sem consultar dados.
- Sucesso: **Calendário salvo.**; exclusão: **Data excluída.** Erros inesperados: **Não foi possível salvar o calendário. Tente novamente.**
- Validação do servidor deve aparecer junto do campo correspondente; não substituir mensagens seguras do serviço.
- Formulários e filtros devem funcionar por teclado, com rótulos visíveis, foco identificado e anúncio acessível de erros e sucesso.

## 8. Segurança
- Toda `page.tsx` e Server Action começa por `requireTenantContext()` antes de qualquer leitura ou mutação; a página exige `organization.settings.read` e Actions de gravação exigem `settings.operations.manage`. Sem a permissão correspondente, retornar `AccessDenied`.
- Chamadas de serviço repetem a autorização: `listHolidays` e `getStoreWorkWeek` usam `organization.settings.read`; gravações usam `settings.operations.manage`.
- Validar entradas com os schemas exportados e `pick()` de campos fixos nas Actions. Validar UUIDs de loja e feriado; delegar escopo, permissão e auditoria ao serviço.
- Não importar `@/db`, Drizzle ou `src/server` internals; usar apenas as funções públicas acima. Sem SQL, conteúdo bruto perigoso ou `dangerouslySetInnerHTML`.
- Exibir mensagens de domínio seguras; não revelar existência de registros fora do escopo.

## 9. Critérios de aceite
- [ ] Consulta anual distingue feriados da empresa e da loja selecionada; estado vazio e filtro por loja são utilizáveis.
- [ ] Criação, edição e exclusão permitem feriado e ponto facultativo, respeitando as regras de fechamento.
- [ ] Dias de trabalho podem ser consultados e salvos por loja; `null` é apresentado como padrão segunda a sexta.
- [ ] Sem permissão de leitura ou gestão, a operação correspondente é negada sem expor dados.
- [ ] Formulários acessíveis por teclado, responsivos e com feedback de validação/erro.

## 10. Política de dúvida
Não inventar operação para dados ausentes da interface pública. Levar ao Maestro qualquer requisito de calendário que demande alteração do serviço.

## 11. Dependências e menu
- Reutilizar componentes e dependências já existentes no projeto; não adicionar dependências.
- Solicitação ao Maestro para `nav.ts`/`shell.ts`: item **Calendário**, ícone Lucide `CalendarDays`, seção Administração, permissão de navegação `organization.settings.read`. A edição continua protegida separadamente por `settings.operations.manage`.

## 12. Comandos de verificação
Executar os checks canônicos do projeto após implementar as telas: `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm lint:rules`, `corepack pnpm test` e `corepack pnpm build`.
