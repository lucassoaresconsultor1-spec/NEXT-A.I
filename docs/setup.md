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
| Drizzle 0.45.4 + `pg` 8.23.1 + PostgreSQL | Núcleo de persistência do toolkit | Projeto | Validado: 4 migrations (`0000`–`0003`) aplicadas em banco limpo; suíte de integração |
| Zod, Pino, `server-only`, `clsx`/`tailwind-merge`, Vitest | Núcleo do toolkit (templates `templates/next/` copiados, `.env.example` mantido) | Projeto | Validado: testes de ambiente, logger e pool do template passando |
| ESLint do toolkit (`next-app.config.mjs`, `eslint-rules/`, self-check) | Perfil completo com Drizzle | Projeto | Validado: `pnpm lint` e `pnpm lint:rules` |
| Skills Vercel: `vercel-react-best-practices`, `vercel-composition-patterns`, `web-design-guidelines`, `writing-guidelines`, `vercel-react-view-transitions`, `vercel-optimize`, `deploy-to-vercel`, `vercel-cli-with-tokens` + `find-skills` | Catálogo upstream conferido com `--list` (mesmas 8 web + RN); RN omitida (sem plataforma mobile nativa) | Projeto (`--agent claude-code`, cópias em `.claude/skills/`, `skills-lock.json`) | Instalado e versionado; descoberta pelo cliente confirmada na sessão retomada (skills listadas) |
| Superpowers 7.0.0 (`claude-plugins-official`), Ponytail 5.2.0, Caveman 4.0.1 | Ausentes; instalados com `claude plugin install --scope project` | Projeto (`.claude/settings.json`) | Instalado; hooks revisados (sem chamadas de rede); carregados na sessão retomada (modos `full`/Caveman ativos) |
| Context7 | Sem conexão ativa; `.mcp.json` do template | Projeto | Configurado sem execução: host bloqueado pela rede do ambiente |
| RTK | Ausente; binário global | Usuário | Pendente: não instalado (o bootstrap não instala binários globais) |
| Graphify (`graphifyy` 0.9.91) | Ausente; executado via `uvx` sem instalação global; `.graphifyignore` do template + exclusões do projeto | Projeto (`graphify-out/` ignorado) | Validado: `GRAPHIFY_NO_AUTO_REFRESH=1 uvx --from graphifyy graphify update . --no-cluster` → 1218 nós, 4833 arestas, 198 arquivos. A versão não tem `extract`; `update` é o modo sem LLM. SQL não extraído (falta `graphifyy[sql]`). Skill do Graphify não instalada (`graphify install` é global) |
| Plugins da conta `engineering` e `design` (sincronizados pelo claude.ai) | Adicionados pelo usuário durante a sessão; usados quando pertinentes. Plugins só do computador local não chegam ao container | Conta | Validado: skill `engineering:code-review` usada na revisão final do diff. Servidores MCP desses plugins (Figma, Asana, Atlassian, GitHub, Linear, Notion, PagerDuty, Slack, Intercom) recusados pelo proxy (403); Datadog exige autorização. Sem efeito na Fase 1 |
| Playwright Chromium | Revisão esperada (1248) ausente; usado o Chromium pré-instalado do ambiente (1194) via `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` | Ambiente | Validado: E2E desktop e celular |

## Documentação criada

`PRODUCT.md`, `README.md`, `AGENTS.md` (bloco gerado pelo Next preservado no topo), `CLAUDE.md` (`@AGENTS.md`), `docs/architecture.md`, `docs/design.md`, `docs/onboarding.md`, `docs/quality.md`, `docs/setup.md`. Documentos adicionais com responsabilidade própria pedidos pelo produto: `docs/data-model.md`, `docs/security.md`, `docs/ai.md`, `docs/roadmap.md`. Não havia `product.md` anterior para consolidar.

## Verificações

| Item | Estado | Evidência |
|---|---|---|
| `pnpm lint` | Validado | Sem erros ou avisos |
| `pnpm typecheck` | Validado | `next typegen` + `tsc --noEmit` sem erros |
| `pnpm lint:rules` | Validado | `quality/max-lines`, `no-direct-console`, `no-direct-data-access`: ok |
| `pnpm test` | Validado | 12 arquivos, 77 testes |
| `pnpm build` | Validado | 24 rotas, sem variáveis de banco no ambiente do shell |
| `pnpm db:generate` | Validado | SQL gerado sem conexão (`0000_foundation.sql`, `0003_account_ownership_and_region_restrict.sql`) e revisado; `0001`/`0002` custom |
| Migrations em banco real | Validado | Aplicadas do zero a cada execução das suítes (PostgreSQL 16.15, papel dono) |
| RLS com papel da aplicação | Validado | Papel `varejo_app` sem SUPERUSER/BYPASSRLS; testes de isolamento |
| `pnpm test:integration` | Validado | 9 arquivos, 95 testes (PostgreSQL real, papel sem BYPASSRLS) |
| `pnpm test:e2e` | Validado | 6 cenários (5 desktop, 1 celular) sobre build de produção |
| HTTP | Validado | `GET /api/health` → `{"status":"ok","database":"ok"}` em porta livre; páginas inspecionadas por captura de tela |
| `pnpm audit --prod` | Validado | Nenhuma vulnerabilidade conhecida |
| `pnpm audit` (dev) | Risco conhecido | `braces` (alta, via `eslint-config-next` → `fast-glob` → `micromatch`; sem versão corrigida publicada) e `esbuild <=0.24.2` (moderada, via `drizzle-kit` → `@esbuild-kit/core-utils`; afeta o servidor de desenvolvimento do esbuild, não usado). Ambos só em ferramentas de desenvolvimento; sem downgrade/override forçado |
| Context7 (consulta real) | Pendente | Bloqueio de rede do ambiente |

Recursos temporários criados e encerrados: cluster PostgreSQL local do container (iniciado para testes), bancos `varejo`, `varejo_test` e `varejo_it_*` (descartáveis, locais), servidores `next start` nas portas 3100/3200/3300 (encerrados). Nenhum serviço externo, publicação ou cobrança.

## Demonstração com dados fictícios (16/10/2026)

Pedido do usuário: demo funcional da visão completa (PRD com Escritório Virtual 2D), com dados fictícios. Entregue em `demo/`, separada do app ([demo/README.md](../demo/README.md)).

| Item | Estado | Evidência |
|---|---|---|
| Motor (dados, métricas, PDV, estoque, fila, agentes, alertas) | Validado | `node demo/selfcheck.mjs`: ledger sem saldo negativo; totais por loja, por vendedor e gráfico diário iguais ao resumo; idempotência; desconto, PIX e NSU recusados; ferramenta bloqueada por perfil; roteamento das 8 perguntas sugeridas; alertas sem duplicar; aprovação gera transferência |
| Interface no Chromium (1440 px, 390 px e movimento reduzido) | Validado | 11 roteiros Playwright passaram, sem erros de console: venda com comprovante, PIX desabilitado, resposta do assistente com aprovação, delegação visível no mapa, seleção por chip e por clique no canvas, queda de conexão com estado desatualizado, visão em lista, vendedora sem acesso a caixa, ferramenta de comparação bloqueada, celular sem rolagem horizontal. Bibliotecas servidas das mesmas versões do npm (CDNs bloqueados no container) |
| `pnpm lint` | Validado | `demo/js` incluído, sem erros ou avisos; arquivos ≤ 350 linhas |
| Publicação | Configurado sem execução no visualizador | Artefato privado https://claude.ai/artifact/SqQ3ETNacUbsf9W85oNtnL; carrega React 18.3.1 (cdnjs) e htm 3.1.1 (jsDelivr). A renderização dentro do visualizador do claude.ai não foi aberta por esta sessão |
| Skills usadas | — | `dataviz` (gráficos), guia de design de artefatos, `engineering:code-review` (rodada anterior) |

Semente 276 escolhida por busca para a história se manter estável nos dias seguintes: lojas no ritmo da meta, uma em atenção e uma em risco, rupturas, caixa pendente e divergência.

## Pendências e próxima entrega

- **Externas:** provedor de e-mail, pagamentos (PIX/cartão), emissão fiscal, provedor de IA, hospedagem e PostgreSQL gerenciado, validação comercial dos planos, enquadramento LGPD ([PRODUCT.md](../PRODUCT.md#hipóteses-e-pendências)).
- **Ferramentas:** RTK e skill do Graphify (globais), consulta real ao Context7.
- **Próxima tarefa do MVP:** Fase 2, catálogo + estoque por livro de movimentações ([roadmap.md](roadmap.md)).
- **Revisão sugerida:** ver a seção seguinte.

## Revisões realizadas

1. **Adversarial por dimensão** (isolamento, escalada de privilégio, autenticação, integridade, UX/documentação), com verificação cética de cada achado. Corrigidos 1 crítico (pré-sequestro de conta), 2 altos e 7 médios, cada um com teste de regressão; detalhes e riscos aceitos em [security.md](security.md#revisão-adversarial-16102026). Migration `0003` (dono da conta e FK de região restritiva).
2. **Diff final com a skill `engineering:code-review`**: 1 alto (limite por conta somava tentativas já bloqueadas no par conta+IP; um único endereço bloqueava o titular), corrigido com teste; 2 baixos (helper de FK duplicado, mensagem sem contagem), corrigidos.

## Próximos ciclos de code review sugeridos

Seis ciclos, pelo risco de autenticação e isolamento multiempresa. Sugestão, não autorização: cada rodada depende de pedido.

| Ciclo | Foco | Motivo |
|---|---|---|
| 1 | Isolamento multiempresa: políticas RLS, `withScope`, FKs compostas, migrations `0000`–`0003` | Falha aqui vaza dados entre empresas |
| 2 | Escalada de privilégio: membros, perfis, hierarquia, escopo de lojas, invariante de proprietário | Regras com muitas combinações |
| 3 | Autenticação e sessão: limites de tentativa, cookies, troca e redefinição de senha, `next` | Superfície pública |
| 4 | Integridade e concorrência: transações, limites de plano, corridas, auditoria de toda mutação | Corridas aparecem só sob carga |
| 5 | Interface: acessibilidade (`design:accessibility-review`, `web-design-guidelines`), textos pt-BR (`design:ux-copy`), estados e celular | Telas novas sem revisão dedicada |
| 6 | Testes e documentação (`engineering:testing-strategy`, `writing-guidelines`): lacunas de cobertura, docs coerentes com o código | Base para a Fase 2 |

Prompt para continuar:

```text
Faça 6 ciclos de code review da Fase 1 do Varejo Inteligente, nesta ordem:
1) isolamento multiempresa (RLS, withScope, FKs compostas, migrations);
2) escalada de privilégio (membros, perfis, hierarquia, escopo de lojas);
3) autenticação e sessão (limites, cookies, senhas, redirecionamento);
4) integridade e concorrência (transações, limites de plano, auditoria);
5) interface (acessibilidade, textos pt-BR, estados, celular);
6) testes e documentação.
Em cada ciclo, revise o estado atual, registre achados com severidade, arquivo:linha e evidência,
corrija os confirmados com teste de regressão e rode os checks afetados. No fim, rode lint, typecheck,
testes unitários, de integração e E2E, atualize docs/setup.md e docs/security.md, faça commit e push na branch atual.
```
