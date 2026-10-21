# Contrato das telas de vendedores — m10b v1

> Escopo de interface para a implementação das telas. O serviço m10a já está integrado; este contrato não autoriza alterações nele.

## 1. Objetivo
Permitir que gestores autorizados cadastrem vendedores vinculados a membros e lojas, mantenham seu estado ativo e configurem dias de folga por loja e mês.

## 2. Fora de escopo
- Criar ou editar membros/equipe, perfis de acesso ou lojas.
- Alterar `src/server/salespeople/**`, `src/server/members/**`, banco ou migrations.
- Gerenciar vendas, metas ou disponibilidade em outros módulos.

## 3. Allowlist de arquivos
Somente arquivos novos em:
```
src/app/(app)/vendedores/**
```
Não editar menu, `src/server/**`, `src/db/**`, `drizzle/**`, `src/lib/**` ou componentes compartilhados.

## 4. Interface pública existente
Usar as funções de tela exportadas em `src/server/salespeople/service.ts` e `src/server/salespeople/schedules.ts`:
```ts
listSalespeople(context: TenantContext, filters: SalespeopleFilters)
saveSalesperson(context: TenantContext, rawInput: unknown, salespersonId?: string): Promise<{ id: string }>
setSalespersonActive(context: TenantContext, salespersonId: string, isActive: boolean): Promise<void>
setSchedule(context: TenantContext, rawInput: unknown): Promise<void>
```
Schemas/tipos em `src/server/salespeople/schemas.ts`: `salespersonSchema`, `SalespersonInput`, `scheduleSchema`, `salespeopleFiltersSchema`, `SalespeopleFilters`. `scheduleSchema` valida e transforma o input de escala; não há tipo `ScheduleInput` exportado. A listagem é paginada e cada linha inclui `id`, `code`, `nickname`, `isActive`, `membershipId`, `userId`, `name` e `storeIds` visíveis ao leitor.

Dependências de opções: `listMembers(context, filters: MemberFilters)` em `src/server/members/service.ts` fornece candidatos da equipe e exige `members.read`; `listStores(context, filters: StoreFilters)` em `src/server/stores/service.ts` fornece lojas visíveis e exige `stores.read`. `getMemberFormOptions(context)` também existe e exige `members.manage`, mas retorna opções de formulário de membros, não uma lista de candidatos. O serviço de vendedores não exporta operação de leitura de escalas; a tela não deve inventar uma. Se for necessário mostrar folgas já salvas, solicitar essa capacidade ao Maestro antes da implementação.

## 5. Dados e esquemas
- `SalespersonInput`: `membershipId` UUID, `code` alfanumérico maiúsculo com até 10 caracteres, `nickname` de 2 a 40 caracteres, `storeIds` com 1 a 200 UUIDs.
- `SalespeopleFilters`: filtros opcionais `storeId`, `status` (`active`/`inactive`) e `page`.
- Input validado por `scheduleSchema`: `salespersonId`, `storeId`, mês `AAAA-MM`, `daysOff` (datas do mesmo mês, distintas, até 31).
- No formulário de criação, selecionar membro ativo e lojas acessíveis ao operador e ao membro. A seleção exige as permissões adicionais dos serviços auxiliares (`members.read`, `stores.read`); `salespeople.manage` não as substitui.

## 6. Invariantes e regras de negócio
- Cadastro e alteração exigem `salespeople.manage`; o serviço limita gestão a membros de nível inferior e às lojas dentro do escopo do ator.
- Um vendedor referencia um único membro; não é permitido substituir o membro associado em edição. O membro precisa estar ativo e ter acesso às lojas escolhidas.
- Atualização substitui apenas os vínculos de loja visíveis ao ator; vínculos fora do escopo são preservados pelo serviço.
- Um código não pode repetir-se na empresa e um membro não pode ser cadastrado duas vezes como vendedor.
- Escala configura folgas no mês para uma loja à qual o vendedor está vinculado. O serviço impõe escopo, vínculo e auditoria.
- `listSalespeople` exige `members.read` (não `salespeople.manage`). A tela de lista precisa exigir ambas as permissões para consultar e operar; não contornar essa diferença chamando funções internas. Exibir `AccessDenied` se faltar uma delas.

## 7. Estados e textos da interface
- Título: **Vendedores**. Colunas: **Código**, **Vendedor**, **Lojas**, **Situação**. Situações: **Ativo**, **Inativo**.
- Filtros: **Buscar por código ou nome**, **Loja**, **Situação**. Ações: **Novo vendedor**, **Editar**, **Ativar**, **Desativar**, **Escala**, **Salvar**, **Cancelar**.
- Campos: **Membro**, **Código**, **Nome de exibição**, **Lojas vinculadas**, **Mês**, **Dias de folga**.
- Estado vazio: **Nenhum vendedor cadastrado.**; filtro sem resultados: **Nenhum vendedor encontrado.**
- Escala sem dias de folga: **Nenhum dia de folga informado neste mês.**
- Carregamento: **Carregando vendedores…**; erro: **Não foi possível carregar os vendedores. Tente novamente.**
- Sem permissão de leitura ou gestão: `AccessDenied`, sem consultar dados.
- Sucesso: **Vendedor salvo.**, **Situação atualizada.**, **Escala salva.** Erro genérico: **Não foi possível salvar as alterações. Tente novamente.**
- Mensagens seguras do serviço devem ser apresentadas junto dos campos/ações relevantes. Diálogos de ativação e desativação pedem confirmação explícita.
- Ações, filtros, paginação e seleção de dias devem ser operáveis por teclado e leitor de código não é necessário nesta tela; foco e erros devem ser anunciados.

## 8. Segurança
- Toda `page.tsx` e Server Action começa por `requireTenantContext()` antes de qualquer leitura ou mutação.
- A página de lista requer `members.read` e `salespeople.manage`, pois a própria listagem exige a primeira permissão e a gestão a segunda. Formulário de criação exige também `members.read` para `listMembers` e `stores.read` para `listStores`; não presumir que `salespeople.manage` concede essas permissões. `getMemberFormOptions` exige `members.manage`, mas não substitui `listMembers` para obter candidatos.
- Actions usam `pick()` com allowlist fixa, validam IDs/entradas por Zod e delegam às funções públicas. Não aceitar `userId`, nome ou vínculos fora do input validado como autoridade.
- Serviço revalida hierarquia, tenant e escopo de loja e audita mutações. Respostas fora do alcance não devem revelar existência de membro/vendedor.
- Sem `@/db`, Drizzle, SQL ou imports de implementação interna nas telas. Sem `dangerouslySetInnerHTML`; usar mensagens seguras e `AccessDenied`.

## 9. Critérios de aceite
- [ ] Listagem paginada e filtros respeitam permissões e escopo.
- [ ] Cadastro/edição preservam vínculo imutável com o membro e lojas fora do escopo.
- [ ] Ativar/desativar exige confirmação e atualiza o estado exibido.
- [ ] Escala grava folgas válidas do mês e loja escolhidos; não promete visualizar dados de escala sem função pública de leitura.
- [ ] Estados vazio, carregamento, erro e sem permissão, responsividade e acessibilidade por teclado estão cobertos.

## 10. Política de dúvida
Se a tela precisar listar membros disponíveis ou escalas existentes sem cumprir as permissões adicionais ou sem uma função de leitura pública, levar a dependência ao Maestro; não contornar com acesso ao banco ou helper interno.

## 11. Dependências e menu
- Reutilizar dependências existentes; nenhuma dependência nova.
- Solicitação ao Maestro para `nav.ts`/`shell.ts`: item **Vendedores**, ícone Lucide `ContactRound`, seção Pessoas e acesso, permissão de menu `salespeople.manage`. A lista também exige `members.read`; opções de criação requerem `members.read` e `stores.read`.

## 12. Comandos de verificação
Executar os checks canônicos do projeto após implementar as telas: `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm lint:rules`, `corepack pnpm test` e `corepack pnpm build`.
