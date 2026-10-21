# Contrato das telas de metas — m11b v1

> Escopo de interface para a implementação das telas. O serviço m11a já está integrado; este contrato não autoriza alterações nele.

## 1. Objetivo
Permitir que pessoas autorizadas consultem metas de venda e progresso por empresa, região, loja ou vendedor, e definam novas versões de metas com justificativa.

## 2. Fora de escopo
- Alterar cálculo de métricas, projeções, calendário, serviço de metas, banco ou migrations.
- Exibir dados de vendas fora do escopo do serviço ou criar relatórios/exportações.
- Permitir que vendedores consultem metas de outras pessoas.

## 3. Allowlist de arquivos
Somente arquivos novos em:
```
src/app/(app)/metas/**
```
Não editar menu, `src/server/**`, `src/db/**`, `drizzle/**`, `src/lib/**` ou componentes compartilhados.

## 4. Interface pública existente
Usar estas funções exportadas:
```ts
// src/server/targets/service.ts
listTargets(context: TenantContext, filters: TargetFilters)
setTarget(context: TenantContext, rawInput: unknown): Promise<{ id: string; version: number }>
targetHistory(context: TenantContext, targetId: string)

// src/server/targets/progress.ts
targetProgress(context: TenantContext, filters: TargetFilters)
```
Tipos e schemas em `src/server/targets/schemas.ts`: `TargetScope`, `TargetInput`, `ParsedTarget`, `TargetFilters`, `TARGET_SCOPES`, `TARGET_SCOPE_LABELS`, `targetInputSchema` e `targetFiltersSchema`. Escopos e rótulos: `organization` / **Empresa**, `region` / **Região**, `store` / **Loja**, `salesperson` / **Vendedor**.

`listTargets` devolve a versão atual de cada meta visível com `id`, escopo/IDs, `month`, `amountCents`, `version`, `reason` e `createdAt`. `targetHistory` devolve versões em ordem crescente com esses campos. `targetProgress` devolve os campos da meta mais `targetCents`, `achievedCents`, `percent` (string com uma casa decimal), `workingDaysTotal`, `workingDaysElapsed` e `projectionCents`.

## 5. Dados e esquemas
- Filtros: mês obrigatório no formato `AAAA-MM`, `scope` opcional e `storeId` opcional.
- Entrada de meta: `scope`, IDs correspondentes ao escopo, `month`, `amountCents` inteiro positivo e `reason` opcional de até 240 caracteres. O schema remove os IDs não aplicáveis.
- Para alteração de meta já existente no mesmo escopo/alvo/mês, `reason` torna-se obrigatório com no mínimo 3 caracteres. Cada gravação cria nova versão.
- Valores são sempre centavos inteiros internamente; entrada visual em reais via helpers existentes de `src/lib/money.ts`, exibição com `formatCurrencyCents`.

## 6. Invariantes e regras de negócio
- Leituras, histórico e progresso exigem `targets.read`; gravação exige `targets.manage`.
- Ator sem `sales.read` só pode ver suas próprias metas de vendedor, regra aplicada no serviço.
- Metas de empresa exigem alcance organizacional completo; metas de região exigem acesso a todas as lojas daquela região; loja e vendedor respeitam escopo. Vendedor precisa estar vinculado à loja selecionada.
- Não é possível criar ou alterar meta de mês encerrado. Mudança cria versão append-only com motivo; a versão mais alta é a vigente.
- Progresso e projeção vêm exclusivamente de `targetProgress`; não recalcular no cliente. Percentual é retornado como string arredondada para baixo a uma casa decimal. Projeção é linear pelos dias úteis decorridos e totais; antes do primeiro dia útil é zero.
- Progresso depende do recurso `pos`; serviço pode negar quando o recurso não está disponível. Não inventar dados substitutos.

## 7. Estados e textos da interface
- Título: **Metas de venda**. Filtros: **Mês**, **Escopo**, **Loja**. Ações: **Nova meta**, **Ver histórico**, **Salvar**, **Cancelar**.
- Campos: **Valor da meta (R$)**, **Motivo da alteração**, e seletor contextual **Região**, **Loja** ou **Vendedor**.
- Colunas/cartões: **Meta**, **Realizado**, **Atingimento**, **Projeção para o mês**, **Versão**. Valores monetários formatados a partir de centavos.
- Estado vazio: **Nenhuma meta cadastrada para este mês.**; filtro sem resultados: **Nenhuma meta encontrada para este período.**
- Histórico vazio: **Ainda não há versões anteriores desta meta.** Carregamento: **Carregando metas…**; erro: **Não foi possível carregar as metas. Tente novamente.**
- Sem permissão de leitura ou gestão: `AccessDenied`, sem consultar dados. Se o plano não incluir PDV: **O progresso das metas depende do recurso de vendas estar disponível no plano.**
- Sucesso: **Meta salva.** Erro genérico: **Não foi possível salvar a meta. Tente novamente.** Apresentar mensagens seguras de validação, incluindo **Informe o motivo da mudança da meta.** quando aplicável.
- Progresso nulo/zero continua sendo apresentado conforme valor retornado pelo serviço; nenhum valor é estimado pela interface.
- Histórico, filtros e formulários devem ser operáveis por teclado; usar rótulos, foco visível, contraste AA e anúncios acessíveis para atualização/erro.

## 8. Segurança
- Toda `page.tsx` e Server Action começa por `requireTenantContext()` antes de qualquer leitura ou mutação.
- Leitura e progresso exigem `targets.read`; mutações exigem `targets.manage`. Não conceder leitura inferida a quem só tem gestão: o serviço não autoriza `listTargets`/`targetProgress` com `targets.manage` isoladamente.
- Actions usam `pick()` com campos fixos, schemas Zod e validação de UUID/mês/valor; delegam escopo, versionamento, permissões e auditoria ao serviço.
- Nunca confiar em valores monetários, progresso ou percentual enviados pelo cliente. Não expor metas fora do escopo; tratar fora de alcance como não encontrado/negado conforme erro seguro do serviço.
- Sem `@/db`, Drizzle, SQL, helpers internos do serviço ou `dangerouslySetInnerHTML` nas telas.

## 9. Critérios de aceite
- [ ] Listagem e progresso exibem apenas o resultado de `listTargets`/`targetProgress`, inclusive a regra de vendedor ver somente suas metas.
- [ ] Gravação usa entrada monetária em reais convertida a centavos, pede motivo para nova versão e não permite mês encerrado.
- [ ] Histórico apresenta versões e motivos em ordem fornecida pelo serviço.
- [ ] Sem permissão ou recurso de plano, a tela mostra estado seguro sem dados simulados.
- [ ] Estados vazio, carregamento, erro, sem permissão, responsividade e WCAG AA/teclado cobertos.

## 10. Política de dúvida
Não calcular progresso no cliente nem contornar permissões. Requisitos de leitura/gestão que divergem do serviço devem ser levados ao Maestro antes de implementação.

## 11. Dependências e menu
- Reutilizar componentes e dependências existentes; nenhuma dependência nova.
- Solicitação ao Maestro para `nav.ts`/`shell.ts`: item **Metas**, ícone Lucide `Target`, seção Vendas, permissão de menu `targets.read`. `targets.manage` é permissão distinta de alteração; membros que gerenciam também precisam de `targets.read` para abrir e consultar a tela.

## 12. Comandos de verificação
Executar os checks canônicos do projeto após implementar as telas: `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm lint:rules`, `corepack pnpm test` e `corepack pnpm build`.
