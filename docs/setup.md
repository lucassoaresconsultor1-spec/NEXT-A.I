# Setup e evidências

## Origem e contexto

- **Data:** 16/10/2026.
- **Toolkit:** [vibe-coding-toolkit](https://github.com/soumatheusgomes/vibe-coding-toolkit), revisão única `f13bb354363dafef8ce8d8f605856cc9e1cc52cc` (15/10/2026), clonada fora da aplicação. Receita seguida: `docs/prompts/11-next-project-bootstrap.md`, `docs/04-project-bootstrap.md`, `docs/06-project-defaults.md`, `docs/tools/16-vercel-skills.md`, `templates/README.md` e `templates/project-docs/manifest.json`, todos da mesma revisão.
- **Produto:** "Prompt mestre — plataforma SaaS inteligente de gestão para varejo" ([PRODUCT.md](../PRODUCT.md)).
- **Cliente e ambiente:** Claude Code 2.1.301 em sessão na nuvem (container Linux), Node.js 22.22.0, pnpm 10.28.0, PostgreSQL 16.15 local do container. Modelo e autenticação da sessão preservados; subagentes usaram o modelo da sessão (sem política de seleção de modelos autorizada).
- **Destino:** raiz do repositório, que só tinha `index-2.2.html` (preservado sem alteração). Scaffold gerado em pasta temporária e incorporado sem sobrescrever arquivos.

## Decisões e fontes

| Decisão | Motivo e fonte |
|---|---|
| `create-next-app@16.4.2` (canal `latest`) com `--typescript --tailwind --eslint --app --src-dir --import-alias '@/*' --use-pnpm --disable-git --no-react-compiler --no-cache-components --no-agent-feedback --agents-md` | Flags conferidas em `--help`; canais `beta`/`rc` ignorados |
| TypeScript 5.9.3 (do template), não 7.0.2 | Versão escolhida pelo create-next-app 16.4; troca de major fora do escopo |
| `@types/node@22` | Runtime real Node 22 e peer do Vitest 5 (`^22.0.0 \|\| >=24`); `engines.node >= 22.12` |
| ESLint 9.39.5 (template), não 10 | Versão do create-next-app; `eslint-config-next@16.4.2` aceita `>=9` |
| Drizzle ORM 0.45.4 / drizzle-kit 0.31.11 (`latest`) | Canais `1.0.0-beta.*` ignorados |
| Zod 4.6.7, Pino 10.4.0, Vitest 5.0.5, Playwright 1.64.1, tsx 4.23.15 | Canal `latest` do registry em 16/10/2026 |
| Componentes próprios sobre `radix-ui` 1.8.1 + `lucide-react` 1.57.0 | Registro do shadcn/ui bloqueado (403 no proxy); só primitivas necessárias |
| Autenticação própria (scrypt + sessões no banco) | Toolkit: "autenticação depende do produto"; justificativa em [architecture.md](architecture.md#decisões) |
| RLS forçado, FKs compostas, papel da app sem BYPASSRLS | Requisito explícito de isolamento no banco; [security.md](security.md) |
| `DATABASE_MIGRATION_URL` acrescentado ao `drizzle.config.ts` do template | Migrations como dono do schema e app com papel restrito |
| Regras ESLint do template ajustadas: `@/db/tenant`/`withScope` na fronteira de dados; guardas Drizzle também para `tx` | Layout efetivo usa transações nomeadas `tx` |
| `next typegen` antes de `tsc` no script `typecheck` | Tipos de rotas (`PageProps`, `LayoutProps`) gerados pelo Next 16 |
| `pnpm test:integration` e `pnpm test:e2e` | Toolkit: testes DOM/E2E entram com os fluxos; banco real para provar RLS |

Fontes consultadas: documentação empacotada do Next.js 16.4.2 (`node_modules/next/dist/docs/`: autenticação, proxy, cookies, data security, forms, `forbidden` experimental, `notFound` com streaming), tipos do Drizzle 0.45 e do drizzle-kit (`generate --custom`), registry npm (dist-tags), catálogo atual das skills pela CLI `skills@1.7.2 --list`. **Context7 indisponível:** `mcp.context7.com` e `context7.com` recusados pelo proxy do ambiente (403); configurado, não validado.

## Componentes

| Componente | Ação e motivo | Escopo | Estado e evidência |
|---|---|---|---|
| Next.js 16.4.2, React 19.3.0, Tailwind 4.3.3 | Scaffold oficial | Projeto | Validado: build de produção com 24 rotas |
| Drizzle 0.45.4 + `pg` 8.23.1 + PostgreSQL | Núcleo de persistência do toolkit | Projeto | Validado: 3 migrations aplicadas em banco limpo; suíte de integração |
| Zod, Pino, `server-only`, `clsx`/`tailwind-merge`, Vitest | Núcleo do toolkit (templates `templates/next/` copiados, `.env.example` mantido) | Projeto | Validado: testes de ambiente, logger e pool do template passando |
| ESLint do toolkit (`next-app.config.mjs`, `eslint-rules/`, self-check) | Perfil completo com Drizzle | Projeto | Validado: `pnpm lint` e `pnpm lint:rules` |
| Skills Vercel: `vercel-react-best-practices`, `vercel-composition-patterns`, `web-design-guidelines`, `writing-guidelines`, `vercel-react-view-transitions`, `vercel-optimize`, `deploy-to-vercel`, `vercel-cli-with-tokens` + `find-skills` | Catálogo upstream conferido com `--list` (mesmas 8 web + RN); RN omitida (sem plataforma mobile nativa) | Projeto (`--agent claude-code`, cópias em `.claude/skills/`, `skills-lock.json`) | Instalado e versionado; descoberta pelo cliente confirmada na sessão retomada (skills listadas) |
| Superpowers 7.0.0 (`claude-plugins-official`), Ponytail 5.2.0, Caveman 4.0.1 | Ausentes; instalados com `claude plugin install --scope project` | Projeto (`.claude/settings.json`) | Instalado; hooks revisados (sem chamadas de rede); carregados na sessão retomada (modos `full`/Caveman ativos) |
| Context7 | Sem conexão ativa; `.mcp.json` do template | Projeto | Configurado sem execução: host bloqueado pela rede do ambiente |
| RTK | Ausente; binário global | Usuário | Pendente: não instalado (o bootstrap não instala binários globais) |
| Graphify (`graphifyy` 0.9.91) | Ausente; executado via `uvx` sem instalação global; `.graphifyignore` do template + exclusões do projeto | Projeto (`graphify-out/` ignorado) | Validado: `GRAPHIFY_NO_AUTO_REFRESH=1 uvx --from graphifyy graphify update . --no-cluster` → 1218 nós, 4833 arestas, 198 arquivos. A versão não tem `extract`; `update` é o modo sem LLM. SQL não extraído (falta `graphifyy[sql]`). Skill do Graphify não instalada (`graphify install` é global) |
| Playwright Chromium | Revisão esperada (1248) ausente; usado o Chromium pré-instalado do ambiente (1194) via `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` | Ambiente | Validado: E2E desktop e celular |

## Documentação criada

`PRODUCT.md`, `README.md`, `AGENTS.md` (bloco gerado pelo Next preservado no topo), `CLAUDE.md` (`@AGENTS.md`), `docs/architecture.md`, `docs/design.md`, `docs/onboarding.md`, `docs/quality.md`, `docs/setup.md`. Documentos adicionais com responsabilidade própria pedidos pelo produto: `docs/data-model.md`, `docs/security.md`, `docs/ai.md`, `docs/roadmap.md`. Não havia `product.md` anterior para consolidar.

## Verificações

| Item | Estado | Evidência |
|---|---|---|
| `pnpm lint` | Validado | Sem erros ou avisos |
| `pnpm typecheck` | Validado | `next typegen` + `tsc --noEmit` sem erros |
| `pnpm lint:rules` | Validado | `quality/max-lines`, `no-direct-console`, `no-direct-data-access`: ok |
| `pnpm test` | Validado | Ver contagem final abaixo |
| `pnpm build` | Validado | 24 rotas, sem variáveis de banco no ambiente do shell |
| `pnpm db:generate` | Validado | SQL gerado sem conexão (`0000_foundation.sql`) e revisado; `0001`/`0002` custom |
| Migrations em banco real | Validado | Aplicadas do zero a cada execução das suítes (PostgreSQL 16.15, papel dono) |
| RLS com papel da aplicação | Validado | Papel `varejo_app` sem SUPERUSER/BYPASSRLS; testes de isolamento |
| `pnpm test:integration` | Validado | Ver contagem final abaixo |
| `pnpm test:e2e` | Validado | Ver contagem final abaixo |
| HTTP | Validado | `GET /api/health` → `{"status":"ok","database":"ok"}` em porta livre; páginas inspecionadas por captura de tela |
| `pnpm audit --prod` | Validado | Nenhuma vulnerabilidade conhecida |
| `pnpm audit` (dev) | Risco conhecido | `braces` (alta, via `eslint-config-next` → `fast-glob` → `micromatch`; sem versão corrigida publicada) e `esbuild <=0.24.2` (moderada, via `drizzle-kit` → `@esbuild-kit/core-utils`; afeta o servidor de desenvolvimento do esbuild, não usado). Ambos só em ferramentas de desenvolvimento; sem downgrade/override forçado |
| Context7 (consulta real) | Pendente | Bloqueio de rede do ambiente |

Recursos temporários criados e encerrados: cluster PostgreSQL local do container (iniciado para testes), bancos `varejo`, `varejo_test` e `varejo_it_*` (descartáveis, locais), servidores `next start` nas portas 3100/3200/3300 (encerrados). Nenhum serviço externo, publicação ou cobrança.

## Pendências e próxima entrega

- **Externas:** provedor de e-mail, pagamentos (PIX/cartão), emissão fiscal, provedor de IA, hospedagem e PostgreSQL gerenciado, validação comercial dos planos, enquadramento LGPD ([PRODUCT.md](../PRODUCT.md#hipóteses-e-pendências)).
- **Ferramentas:** RTK e skill do Graphify (globais), consulta real ao Context7.
- **Próxima tarefa do MVP:** Fase 2, catálogo + estoque por livro de movimentações ([roadmap.md](roadmap.md)).
- **Revisão sugerida:** ver o fim deste documento após a rodada adversarial.
