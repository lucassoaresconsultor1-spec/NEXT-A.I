# Código e arquitetura

## Ponto de partida

O repositório continha apenas `index-2.2.html` (landing page estática de um restaurante, ~4,4 MB com imagens embutidas), sem stack, dependências ou relação com o produto. Foi preservado intacto; a aplicação foi criada do zero ao lado dele seguindo o Vibe Coding Toolkit ([setup.md](setup.md)).

## Stack efetiva

| Camada | Escolha | Versão observada | Motivo |
|---|---|---|---|
| Web | Next.js App Router + Turbopack | 16.4.2 | Default do toolkit; Server Components e Server Actions mantêm dados e regras no servidor |
| UI | React, Tailwind CSS, Radix (`radix-ui`), `lucide-react` | 19.3.0 / 4.3.3 / 1.8.1 / 1.57.0 | Primitivas acessíveis sem catálogo inteiro |
| Linguagem | TypeScript strict | 5.9.3 | Default do create-next-app 16.4 (TypeScript 7 não avaliado) |
| Dados | PostgreSQL + Drizzle ORM + `pg` | PG 16.15 (testes), drizzle-orm 0.45.4, drizzle-kit 0.31.11, pg 8.23.1 | Default do toolkit; RLS nativo e migrations SQL revisáveis |
| Validação | Zod | 4.6.7 | Ambiente, formulários e entradas |
| Logs | Pino | 10.4.0 | Estruturado com redação |
| Testes | Vitest, Playwright | 5.0.5 / 1.64.1 | Unitários, integração com banco real, E2E |
| Runtime | Node.js, pnpm | 22.22 / 10.28 | `engines.node >= 22.12` (exigência do Vitest 5) |

Monólito modular: um app Next.js com módulos por domínio em `src/server/`. Sem microsserviços até haver justificativa (escala independente, equipe ou isolamento de falhas). Filas e tarefas agendadas entram com a necessidade (relatórios pesados, alertas — Fases 4 e 6).

## Mapa do código

```
src/
├── proxy.ts                      # checagem otimista de cookie e renovação (não é autorização)
├── app/
│   ├── layout.tsx, globals.css   # fontes Plus Jakarta Sans e Urbanist, tokens da marca NEXT A.I
│   ├── page.tsx                  # redireciona para /painel ou /entrar
│   ├── error.tsx, not-found.tsx  # erros genéricos, 404
│   ├── session-actions.ts        # sair, trocar empresa, selecionar loja
│   ├── api/health/route.ts       # liveness + ida ao banco
│   ├── (auth)/                   # entrar, criar-conta, alterar-senha, selecionar-empresa
│   ├── (app)/                    # área da empresa (shell + requireTenantContext em cada página)
│   │   ├── painel/               # visão geral com dados estruturais reais
│   │   ├── lojas/, regioes/, departamentos/
│   │   ├── equipe/, perfis/
│   │   ├── auditoria/, configuracoes/
│   │   └── busca/                # busca global no escopo
│   └── plataforma/               # administração da plataforma (somente is_platform_admin): empresas, nova-empresa, planos
├── components/
│   ├── ui/                       # botões, campos, tabelas, diálogos, avisos
│   └── shell/                    # sidebar, cabeçalho, navegação móvel, breadcrumbs
├── db/
│   ├── index.ts                  # pool único, lazy e limitado
│   ├── tenant.ts                 # withScope(): transação + settings de RLS
│   └── schema/                   # tabelas, enums e políticas
├── lib/                          # env, logger, formatos pt-BR, documentos, datas, fusos
└── server/                       # serviços (server-only)
    ├── auth/                     # senha, sessão, tokens, rate limit, cadastro/login
    ├── authz/                    # catálogo de permissões, perfis do sistema, contexto, guardas
    ├── organizations/, plans/    # provisionamento, perfil da empresa, limites e recursos
    ├── regions/, stores/, departments/, members/, roles/
    ├── catalog/, inventory/      # produtos, variações, preço/custo versionados; livro e saldo de estoque
    ├── audit/, dashboard/, search/, platform/
    └── actions.ts, forms.ts, errors.ts, pagination.ts, http.ts, shell.ts
demo/                             # demonstração estática com dados fictícios (fora do app; ver demo/README.md)
drizzle/                          # SQL versionado (0000 schema, 0001 FORCE RLS, 0002 planos, 0003 dono da conta, 0004 perfis, 0005/0006 catálogo e estoque)
tests/integration/                # PostgreSQL real; fixtures por inserção direta
tests/e2e/                        # Playwright sobre build de produção
scripts/                          # verify-quality-rules, platform-admin, SQL local
eslint-rules/                     # regras do toolkit (350 linhas, logger, fronteira de dados)
```

## Fronteiras e fluxo

```
Página (Server Component) ─ requireTenantContext() ─┐
Server Action ("use server") ─ Zod(pick) ───────────┤
                                                    ▼
                 Serviço src/server/<módulo> (assertCan, escopo, regras, auditoria)
                                                    ▼
                 withScope(dbScope(ctx)) → transação com app.organization_id/app.user_id
                                                    ▼
                 PostgreSQL (RLS forçado, FKs compostas, unicidades)
```

- **Contexto do tenant** (`src/server/authz/context.ts`): sessão → empresa ativa → vínculo ativo + perfil + permissões + escopo de lojas efetivo + loja selecionada. Calculado por requisição (`React.cache`), então suspensões valem imediatamente. Faltando etapa, redireciona (login, troca de senha, seleção de empresa).
- **Apresentação** nunca importa `@/db`/`withScope` (regra `quality/no-direct-data-access`). Client Components recebem DTOs mínimos.
- **Ações** retornam `ActionState` (`src/lib/action-state.ts`); `runAction` converte erros de domínio em mensagens seguras e registra o resto no logger.
- **Shell** (`src/server/shell.ts`) decide o menu pelas permissões; cada página reverifica.

## Experiências sobre serviços compartilhados

Um app Next.js e os serviços de `src/server/<módulo>` atendem todas as experiências do [PRODUCT.md](../PRODUCT.md#experiências-e-regras-de-acesso). Cada experiência é um grupo de rotas com layout próprio e sem regra de negócio: `(app)/` gestão e `plataforma/` (existentes), `pdv/` (Fase 2), `vendedor/` e `fila/` (Fase 3). Dashboards, app do vendedor, PDV, IA e escritório virtual leem as mesmas funções de métricas (Fase 4), o que mantém o mesmo número em todos os canais e evita cadastro duplicado. A instalação como PWA usa a convenção `app/manifest.ts` do Next.js e entra com a primeira experiência móvel.

## Dados e migrations

Schema em `src/db/schema/`, explicado em [data-model.md](data-model.md). `getDb()` cria um pool `pg` (máx. 5, timeout 5 s) sob demanda e o reaproveita no HMR; nada conecta no build. Transações: toda operação de tenant é uma transação (`withScope`), o que também garante atomicidade entre a mudança e sua auditoria; limites de plano travam a organização com `FOR UPDATE`. Migrations são geradas por `drizzle-kit generate`, revisadas e aplicadas por `db:migrate` com o dono do schema; `FORCE ROW LEVEL SECURITY` e o catálogo de planos ficam em migrations custom.

## Métricas de vendas

`src/server/metrics/` é a fonte única dos números de vendas (ADR-012): metas, app do vendedor, painéis, relatórios e IA leem daqui, nunca somam vendas por conta própria. Tudo é agregado em SQL (centavos inteiros, quantidades em milésimos), dentro de `withScope`, com a visibilidade do m06a (`sales.read` no escopo de lojas; sem ela, só as próprias vendas). Datas são do calendário do fuso da loja (ou da empresa), com as duas pontas incluídas e até 366 dias.

| Métrica | Fórmula |
|---|---|
| `grossRevenueCents` | Σ subtotal + acréscimo das vendas finalizadas no período (inclui as canceladas depois) |
| `discountCents` | Σ desconto das mesmas vendas |
| `cancelledCents` | Σ total das vendas cujo cancelamento ocorreu no período |
| `returnedCents` | Σ valor das devoluções registradas no período |
| `netRevenueCents` | bruto − desconto − cancelado − devolvido |
| `saleCount` | vendas finalizadas no período que continuam finalizadas |
| `averageTicketCents` | líquido ÷ quantidade, arredondado para baixo; 0 sem vendas |
| `itemsPerSale` | Σ quantidade das vendas contadas ÷ quantidade, 2 casas, arredondado para baixo |

O detalhamento (`salesDrillDown`) usa as mesmas parcelas por venda; a soma das contribuições é igual à métrica.

Métricas completas (m16b, `fullSalesSummary`), das mesmas fontes:

| Métrica | Fórmula |
|---|---|
| `grossMarginCents` | receita dos itens com custo (rateio do total líquido da venda) − custo do snapshot × quantidade; estornos pelos itens devolvidos; itens sem custo contados à parte |
| `netProfitCents` | margem − despesas não canceladas do período (só com despesas lançadas) |
| `conversion` | atendimentos encerrados com venda ÷ atendimentos encerrados (fila) |
| `commissionsCents` | Σ das apurações não canceladas dos meses do período |

Cada bloco só aparece para quem tem a permissão correspondente (custos, despesas, comissões).

## Decisões

| Decisão | Motivo | Alternativa considerada | Revisar quando |
|---|---|---|---|
| RLS forçado + filtro explícito + FKs compostas | Isolamento mesmo com bug de código; o prompt pede política no banco | Só filtros na aplicação | Nunca remover; avaliar RLS em `users` (Fase 7) |
| Contexto via `set_config(..., true)` por transação | Seguro com pool; falha fechada | Papel por tenant / schemas por tenant | Milhares de tenants com requisitos de isolamento físico |
| Autenticação própria (scrypt, sessões no banco) | Sem dependência nativa; controle do vínculo sessão→empresa→escopo; revogação imediata | Auth.js, Better Auth | Exigência de SSO, 2FA ou login social |
| Permissões de perfis do sistema no código | Novas versões atualizam todos os tenants sem migração de dados | Semear `role_permissions` por empresa | Clientes precisarem editar perfis do sistema |
| Hierarquia por `rank` | Bloqueia escalada de forma simples e testável | Grafo de perfis gerenciáveis | Estruturas organizacionais mais complexas |
| Planos em tabela + `entitlements.ts` único | Limites alteráveis sem espalhar regra comercial | Plano fixo no código | Cobrança/planos personalizados por cliente |
| Lojas sem exclusão física | Histórico de vendas e auditoria | Exclusão em cascata | — |
| Componentes próprios sobre Radix | Registro do shadcn bloqueado no ambiente; só o necessário | shadcn/ui CLI | Registro disponível e necessidade de mais componentes |
| Plus Jakarta Sans e Urbanist via `next/font/google` (identidade NEXT A.I) | Baixadas no build e servida pelo próprio app (sem requisição ao Google no navegador) | Fonte do sistema | Build sem acesso ao Google Fonts |
| Demonstração separada em `demo/` (página estática, React 18 + htm por CDN, dados fictícios gerados no navegador) | Mostrar a visão completa sem simular módulos dentro do produto nem misturar dados fictícios com reais | Rota `/demo` no app com seed no banco | Fases 2–7 implementadas no produto |
| Escritório virtual em Canvas 2D próprio (sem Phaser/PixiJS) | Cena pequena, poucos sprites, zero dependência, ciclo de vida explícito | Engine 2D | Animações ou mapas que o Canvas simples não sustente |
| Perfil Financeiro no nível 80, acima do coordenador | Só dono e administrador concedem acesso financeiro | Nível abaixo do coordenador | Financeiro regional ou por loja |
| Empresa cadastrada pela plataforma sempre com conta nova do dono | Mesmo motivo do pré-sequestro: sem prova de posse do e-mail, vincular conta existente é inseguro | Vincular conta existente | Convite com confirmação por e-mail disponível |
| Conta só readicionada pela empresa que a criou | Sem prova de posse do e-mail, vincular contas entre empresas permite pré-sequestro | Vincular qualquer conta existente | Convite com confirmação por e-mail disponível |

Fontes consultadas (16/10/2026): documentação empacotada do Next.js 16.4 (`node_modules/next/dist/docs/`: autenticação, proxy, cookies, data security, `forbidden` experimental), tipos do Drizzle 0.45 (`pg-core/policies`), registry npm (canais `latest`). Context7 indisponível no ambiente (bloqueio de rede).

## Manutenção

Atualize este mapa ao alterar diretórios, dependências relevantes, contratos ou fronteiras. Registre comportamento comprovado; remova decisões que deixaram de valer.
