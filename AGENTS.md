<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# NEXT A.I

## Produto e stack

- Produto e escopo: `PRODUCT.md`; plano por fases: `docs/roadmap.md`.
- Stack: Next.js 16.4 (App Router, Turbopack), React 19.3, TypeScript 5.9 strict, Tailwind 4.3, Drizzle ORM 0.45 + PostgreSQL (`pg`), Zod 4.6, Pino 10, Vitest 5, Playwright 1.64, Node.js ≥ 22.12, pnpm 10.28.
- Setup e validações: `docs/setup.md`.

## Comandos canônicos

- Instalar: `pnpm install`
- Desenvolver: `pnpm dev` (requer `.env.local`, ver `docs/onboarding.md`)
- Lint: `pnpm lint`
- Tipos: `pnpm typecheck`
- Regras locais de lint: `pnpm lint:rules`
- Testes unitários: `pnpm test`
- Testes de integração (PostgreSQL real, banco descartável): `pnpm test:integration` com `TEST_DATABASE_URL` e `TEST_DATABASE_MIGRATION_URL`
- E2E: `pnpm test:e2e` (mesmas variáveis; faz build e sobe o app)
- Build: `pnpm build`
- Verificar base (sem banco): `pnpm check`
- Banco: `pnpm db:generate` (gera SQL, sem conexão) e `pnpm db:migrate` (aplica com `DATABASE_MIGRATION_URL`)

## Acordos de trabalho

- Leia código e instruções pertinentes antes de editar. Declare hipóteses que alterem comportamento ou escopo.
- Complete o pedido com a menor mudança suficiente. Reutilize padrões, componentes e dependências existentes.
- Preserve alterações locais, validação, tratamento de erros, segurança, acessibilidade e requisitos explícitos.
- Não crie abstrações, arquitetura, opções, dependências ou funcionalidades para necessidades não solicitadas.
- Execute checks adequados. Teste lógica relevante e regressões; mudanças triviais não precisam de testes que apenas reproduzem a implementação.
- Não transforme hipóteses em fatos ou integrações pendentes em resultados simulados. Dados de demonstração, se um dia existirem, ficam identificados e separados.
- Continue trabalho já autorizado. Pergunte somente por informação indispensável ou por ação fora da autorização.
- Publicação, mensagens a terceiros, custos e ações destrutivas dependem de autorização pertinente. Instalar ferramentas não concede essa autorização.

## Continuidade de execução

- Durante trabalho autorizado, responda a perguntas de status e retome as ações restantes. Pare se o usuário pedir pausa, cancelar ou mudar o objetivo. Sem execução em andamento, um pedido apenas informativo termina com a resposta.
- Um bloqueio impede só tarefas dependentes. Conclua as independentes que ainda forem seguras e autorizadas; antes de encerrar, confira se resta ação executável no escopo.
- Se um agente falhar ou ficar com estado incerto, confirme que parou antes de assumir seus arquivos. Inspecione alterações parciais e retome do ponto verificado, sem escritores concorrentes.
- Não repita tentativa idêntica sem evidência nova. Respeite limites de custo, tempo e tentativas, gates explícitos e negativas; decisões anteriores não ampliam autorização.
- Ao retomar por handoff, confira arquivos, Git, checks e processos reais. Só afirme execução em segundo plano quando houver processo, agente ou automação ativo e verificável.
- Sem alternativa segura, informe o bloqueio, o trabalho concluído e o que falta para retomar; não apresente pendência como resultado nem prometa continuação automática.

## Regras do domínio (obrigatórias)

- **Multiempresa:** toda consulta a tabela de tenant roda dentro de `withScope(dbScope(context), tx => …)` (`src/db/tenant.ts`) **e** filtra `organization_id` explicitamente. Tabela nova com `organization_id` recebe `tenantIsolationPolicy()`, `UNIQUE (organization_id, id)`, FKs compostas para pais do tenant e `FORCE ROW LEVEL SECURITY` numa migration custom.
- **Autorização no servidor:** serviços em `src/server/<módulo>/` recebem `TenantContext`, chamam `assertCan` e respeitam o escopo de lojas (`storeScopeCondition`, `assertStoreInScope`). Toda página chama `requireTenantContext()` (layout não protege página); toda Server Action também. Fora do escopo ou de outra empresa = "não encontrado".
- **Hierarquia:** só níveis inferiores são gerenciáveis (exceto proprietário), permissões concedidas ⊆ permissões do ator, ninguém altera o próprio acesso, sempre um proprietário ativo.
- **Auditoria:** toda mutação chama `recordAudit` na mesma transação, com chave listada em `src/server/audit/labels.ts` e somente campos de negócio.
- **Plano:** limites e recursos só via `src/server/plans/entitlements.ts`.
- **Dinheiro** em centavos inteiros; datas exibidas no fuso da empresa/loja; textos em pt-BR.
- **Sem números inventados:** painéis e IA mostram apenas dados calculados por serviços; integrações pendentes ficam identificadas como pendentes.

## Padrões e documentação

- Persistência nova: Drizzle ORM + PostgreSQL com driver compatível com o runtime. Preserve a stack existente; registre exceções em `PRODUCT.md` e `docs/architecture.md`.
- Conexão servidor única (`src/db/index.ts`), pool limitado e inicialização sob demanda. Gere e revise SQL antes de aplicar migrations em destino autorizado; não migre no build ou por request.
- Valide entradas e ambiente com Zod (`src/server/forms.ts`, `src/lib/env.ts`). Use Pino no servidor, sem segredos ou corpos completos. Apresentação (`src/app`, `src/components`) chama serviços, nunca o cliente de banco.
- Prefira tipos inferidos, consultas parametrizadas, projeções explícitas, listagens limitadas/paginadas e DTOs seguros. Transações seguem a atomicidade exigida.
- Consulte fontes oficiais atuais e o canal estável antes de alterar stack/APIs. Registre fonte, motivo e resultado em `docs/setup.md`. Não migre versões principais ou serviços automaticamente.
- `PRODUCT.md` guarda escopo; `docs/architecture.md`, estrutura e decisões; `docs/data-model.md`, schema; `docs/security.md`, controles; `docs/ai.md`, plano de IA; `docs/virtual-office.md`, escritório virtual; `docs/roadmap.md`, fases; `docs/design.md`, interface; `docs/onboarding.md`, preparação; `docs/quality.md`, checks. Atualize o documento responsável junto da mudança.

## Ferramentas e estilo

- **Ponytail:** plugin de projeto em intensidade `full` para programação. `stop ponytail` desativa o modo.
- **Caveman:** conversa concisa no idioma do usuário, preservando clareza e explicações completas quando solicitadas. Código, documentação e commits têm redação normal. `stop caveman` desativa o estilo.
- **Superpowers:** use skills pertinentes e proporcione o fluxo ao escopo. Instruções explícitas e execução já autorizada prevalecem sobre aprovações repetidas.
- **Context7:** configurado em `.mcp.json`; consulte documentação atual para APIs, um conceito por vez, sem segredos ou código privado. Se indisponível (como no ambiente de bootstrap), use `node_modules/next/dist/docs/` e fontes oficiais e registre a limitação.
- **RTK:** não instalado neste ambiente; quando houver hook nativo ativo, evite wrapper duplicado.
- **Graphify:** use `graphify-out/` (não versionado) quando ajudar em perguntas de estrutura; regenere com o comando de `docs/setup.md`. Registre evidência desatualizada; não invente relações.
- **LLMs:** preserve cliente nativo, modelo principal e autenticação autorizados. Sem política de seleção autorizada, subagentes usam o modelo da sessão. Não troque provedor nem ative API paga ou proxy silenciosamente.

Confira instalação e descoberta antes de depender de uma ferramenta. Ausência precisa de registro ou alternativa oficialmente suportada.

## Skills para Next.js

Instaladas em `.claude/skills/` (lock em `skills-lock.json`):

- `vercel-react-best-practices`: ao escrever/revisar React/Next, dados e desempenho.
- `vercel-composition-patterns`: em decisões concretas de composição e API de componentes.
- `web-design-guidelines`: revisão de interface e acessibilidade.
- `writing-guidelines`: revisão de documentação e prosa.
- `vercel-react-view-transitions`: transições solicitadas e compatíveis com as versões.
- `vercel-optimize`: otimização com tarefa pertinente e métricas Vercel disponíveis.
- `deploy-to-vercel`: publicação/preview autorizados.
- `vercel-cli-with-tokens`: operações Vercel com esse método de autenticação escolhido.
- `find-skills`: descoberta quando faltar uma capacidade concreta.

Instalar skills não executa suas ações. Não force animações, cache, deploy ou mudanças de arquitetura só porque uma skill está disponível.

## Git e colaboração

- Não adicione bloqueios de push em `main`, exigência de branch/worktree ou hooks `pre-commit`/`pre-push` por padrão.
- Lint, tipos, testes e build são checks explícitos; configurações Git adicionais entram quando solicitadas.
- Delegue quando solicitado ou pelo fluxo pertinente e suportado. Tarefas paralelas precisam de arquivos distintos e independência na mesma onda.
- Use ferramentas reais do host; nomes ilustrativos de agentes não são capacidades instaladas.

## Delegação e revisão

- Delegue somente quando isolamento de contexto, especialização ou paralelismo independente compensarem a coordenação; prefira execução direta para tarefas simples.
- Cada tarefa recebe objetivo, contexto mínimo, arquivos permitidos, dependências, aceite e checks. Um escritor por arquivo; o coordenador cuida de lockfile, configuração compartilhada e integração. Revisores paralelos trabalham somente em leitura. Testes de integração paralelos usam bancos distintos.
- Verifique diff e checks antes de aceitar o resultado de um trabalhador.
- Após cada ciclo de implementação ou correção, sugira ao usuário de **3 a 8 ciclos posteriores de code review**, com quantidade e focos conforme risco e escopo, motivo e prompt copiável. A sugestão não autoriza executar novas rodadas automaticamente.
- Em uma rodada solicitada, cada ciclo revisa o estado atual, registra achados com severidade/local/evidência e verifica correções autorizadas. Termine com verificação integrada e riscos residuais.

## Aprovações entre agentes

- **Aprovar sem perguntar:** leituras (`ls`, `cat`, `grep`, `git status|diff|log`), `pnpm -s lint`, `pnpm -s typecheck`, `pnpm -s lint:rules`, `pnpm -s test` e ferramentas MCP de leitura. A lista está em `.claude/settings.json`; novos itens só se forem somente leitura e sem execução de código arbitrário.
- **Sempre com o usuário:** `git push`, PR, merge, deploy, instalar software, apagar ou reescrever arquivos fora do escopo, migrations em qualquer banco que não seja o de teste e qualquer ação com custo ou mensagem a terceiros.
- **Testes com banco:** `pnpm test:integration` e `pnpm test:e2e` apagam e recriam o banco. Só com `TEST_DATABASE_URL` e `TEST_DATABASE_MIGRATION_URL` apontando para o PostgreSQL local de teste (`localhost`); nunca para o Neon ou outro destino remoto.
- **Segredos:** senhas, `DATABASE_URL` e `AUTH_SECRET` não vão para chat, relatório, print ou commit. Quem precisa de uma senha pede ao usuário que a digite no próprio terminal.
- **Economia de tokens:** um agente por tarefa; relatório com resultado, arquivos alterados e checks (sem colar logs inteiros); sessão nova a cada tarefa grande; imagens só quando o texto não bastar.
- Um agente não aprova pedidos de outro em nome do usuário: pedido fora da lista acima volta para o usuário.

## Convenções e contexto

- Imports com alias `@/*` → `src/*`. Server-only: `src/db`, `src/server`, `src/lib/env.ts`, `src/lib/logger.ts`.
- Módulos: `src/server/<módulo>/service.ts` (regras e consultas), `src/app/(app)/<rota-pt-br>/{page.tsx,actions.ts,*.tsx}` (apresentação e Server Actions). Rotas em português (`/lojas`, `/equipe`, `/perfis`…).
- Formulários: Zod + `pick()` em `actions.ts`, `runAction()` para mapear erros, `useFormAction()` no cliente; diálogos com o formulário dentro do conteúdo para reiniciar o estado.
- Erros de domínio em `src/server/errors.ts` com mensagens pt-BR seguras; inesperados viram mensagem genérica e log.
- Arquivos com no máximo 350 linhas (regra `quality/max-lines`).
