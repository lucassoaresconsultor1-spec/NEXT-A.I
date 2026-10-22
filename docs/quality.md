# Qualidade

## Comandos

| Comando | O que prova | Precisa de banco |
|---|---|---|
| `pnpm lint` | ESLint com presets Next/TypeScript, teto de 350 linhas, proibição de `console` (usar logger), fronteira de dados (apresentação não importa `@/db`/`withScope`), `update/delete` Drizzle sempre com `where` (`db` e `tx`) | Não |
| `pnpm typecheck` | `next typegen` (tipos de rotas) + `tsc --noEmit` strict | Não |
| `pnpm lint:rules` | Self-check das regras locais com o RuleTester do ESLint | Não |
| `pnpm test` | Vitest em Node: ambiente, logger (redação), pool, documentos (CNPJ alfanumérico, CPF, telefone, CEP), formatos pt-BR, fusos, hash de senha, catálogo de perfis, regras puras de módulos | Não |
| `pnpm build` | Build de produção (Turbopack) e checagem de tipos do Next | Não |
| `pnpm check` | Todos os anteriores em sequência; não conecta nem migra | Não |
| `pnpm test:integration` | Serviços contra PostgreSQL real com RLS: isolamento entre empresas, escopo de lojas, permissões no serviço, hierarquia, limites de plano, auditoria, autenticação | Sim (descartável) |
| `pnpm test:e2e` | Build + servidor + Playwright (desktop e celular): cadastro, login, cadastros, equipe, permissões e isolamento pela interface | Sim (descartável) |

Rode o teste escopado durante o desenvolvimento (`pnpm exec vitest run caminho` ou `pnpm test:integration tests/integration/arquivo.test.ts`) e a suíte completa antes de entregar. `test:integration` e `test:e2e` **apagam e recriam** o banco de `TEST_DATABASE_URL`/`TEST_DATABASE_MIGRATION_URL`; o papel da aplicação não pode ter `BYPASSRLS` (a suíte recusa).

## Regras de base

- TypeScript strict e presets oficiais do framework.
- Teto de 350 linhas e organização proporcional ao comportamento.
- Logger estruturado no servidor; dados não acessados diretamente pela apresentação.
- Com Drizzle, guarda contra update/delete sem where e revisão das queries/migrations.
- Validação de entradas e ambiente, erros sem segredos e testes de fronteiras relevantes.
- Multiempresa: todo módulo novo traz testes de integração de isolamento por id, permissão negada no serviço e escopo de lojas.

## Estratégia de testes

- **Unitários** para funções puras (validação de documentos, formatos, fusos, regras de gestão de membros, catálogo de perfis, hash).
- **Integração** é a principal rede: os serviços rodam contra PostgreSQL real com o papel da aplicação, migrations aplicadas do zero, RLS ativo. Fixtures inserem dados diretamente (`tests/integration/fixtures.ts`) para não depender do serviço testado; cada teste cria empresas novas (o banco é compartilhado na execução).
- **E2E** cobre os fluxos do aceite pela interface real, em desktop e celular.
- Não há mocks de banco nos testes de integração; o único mock é o marcador `server-only` (alias para módulo vazio fora do bundler).
- Sem medição de cobertura configurada; não declaramos percentual.

## Revisão após implementação ou correção

Ao concluir um ciclo de implementação ou correção, sugira de 3 a 8 ciclos posteriores de code review, com quantidade proporcional ao risco, focos complementares e prompt de continuação preenchido. Essa faixa é convenção do projeto; revisões adicionais dependem de pedido do usuário.

Cada ciclo verifica o estado atual e o código conectado, registra achados com severidade, local e evidência e reavalia correções autorizadas com os checks afetados. Correções da mesma rodada não reiniciam a contagem. Termine com verificação integrada e riscos residuais, sem criar ciclos artificiais ou afirmar que uma quantidade de revisões prova ausência de bugs.

## Testes de carga (m42)

Fluxos críticos sob concorrência no banco descartável, com o mesmo pool da aplicação (5 conexões): `pwsh -NoProfile -File tools/gate/with-test-db.ps1 corepack pnpm exec vitest run --config vitest.load.config.mts`. Primeiro a correção (exatamente 100 vendas para 100 unidades, números de venda sem buracos, saldo zero; nenhum cliente ou vendedor repetido na fila), depois as medidas, impressas em linhas `LOAD`.

Medição local de 22/10/2026 (Windows, PostgreSQL 17 local; referência, não meta):

| Fluxo | Operações | p50 | p95 | Por segundo |
|---|---|---|---|---|
| PDV `completeSale` (8 caixas, 120 tentativas, 100 unidades) | 120 | 521 ms | 843 ms | 138 |
| Métricas `salesSummary` (dia com 100 vendas) | 20 | 9 ms | 16 ms | 111 |
| Fila `registerArrival` | 60 | 77 ms | 125 ms | 458 |
| Fila `callNext` (10 vendedores) | 15 | 27 ms | 37 ms | 397 |

Carga HTTP de ponta a ponta (com sessão, proxy e Server Actions) fica para o ambiente de homologação do dono.

## Gate modular

Portão sem LLM para módulos entregues por workers ([PROTOCOLO-MODULAR-V2.md](PROTOCOLO-MODULAR-V2.md)). Rode na raiz do repositório, com PowerShell 7:

```powershell
pwsh tools/gate/gate.ps1 -Module <id> -Allowed 'src/server/<modulo>/**','tests/integration/<modulo>.test.ts'
```

| Saída | Significado |
|---|---|
| `PASS` (exit 0) | Escopo, arquivos proibidos, dependências, testes e segredos ok; `lint`, `typecheck`, `lint:rules` e `test` passaram |
| `PASS+REVIEW` (exit 2) | Como PASS, mas tocou superfície sensível ou removeu asserts; o Maestro revisa só esses diffs com [REVIEW-CHECKLIST.md](REVIEW-CHECKLIST.md) |
| `FAIL` (exit 1) | Arquivo fora da allowlist, `.env`/chave, `package.json`/lockfile, teste apagado ou com `skip`/`only`, possível segredo, ou comando reprovado |

- Configuração em `tools/gate/gate.config.json`. Sensíveis incluem `auth`, `authz`, `roles`, `src/db/**`, `drizzle/**`, auditoria, planos, membros, plataforma, estoque e o próprio `tools/gate/**` (nunca entra em allowlist de worker).
- Segredos: chave AWS, chave privada, JWT e `api/secret/private key` literal reprovam em qualquer arquivo; senha literal (`password`/`senha`) reprova fora de testes.
- O gate compara com `HEAD` e soma arquivos não rastreados: com trabalho sem commit na árvore, todo módulo reprova por escopo. Use um commit base (decisão do usuário) ou `-InitBaseline` antes do worker começar. Workers rodam em sequência na mesma árvore.
- Não roda `build` nem integração. `tools/gate/gate.integration.config.json` (via `-Config`) acrescenta `pnpm test:integration` quando há arquivo sensível; as variáveis `TEST_DATABASE_URL`/`TEST_DATABASE_MIGRATION_URL` vêm do shell, nunca de arquivo.
- `.env*` e `*.pem` estão no `.gitignore`, então o gate não os enxerga; a regra de proibidos só pega arquivos rastreados à força.

## Dependências e entrega

Confira auditorias completas e de produção (`pnpm audit --prod` e `pnpm audit`). Investigue advisories e registre risco conhecido e correção disponível em [setup.md](setup.md). Lint/build aprovados não significam auditoria zerada.

Checks são comandos explícitos. Hooks Git, bloqueios de push e exigências de branch não fazem parte do padrão. Atualize este documento junto dos scripts e regras que mudarem.

## Banco de testes local e gate de integração

A suíte de integração **apaga e recria** o schema do banco de teste. Para rodá-la com o gate:

1. Crie o banco descartável `varejo_test` com os papéis `varejo_owner` (dono do schema) e `varejo_app` (sem `SUPERUSER` e sem `BYPASSRLS`), como em [onboarding.md](onboarding.md).
2. Crie `.env.test-db.local` na raiz (ignorado pelo Git) com `TEST_DATABASE_URL` (papel `varejo_app`) e `TEST_DATABASE_MIGRATION_URL` (papel `varejo_owner`), ambos apontando para `varejo_test` em localhost.
3. `pwsh -NoProfile -File tools/gate/with-test-db.ps1 corepack pnpm test:integration` roda a suíte; o script recusa qualquer banco que não seja `varejo_test` em localhost e nunca imprime as credenciais. Uma trava exclusiva (arquivo `varejo_test.lock` na pasta temporária) serializa as execuções: se outra suíte estiver rodando, o script espera até 20 minutos em vez de recriar o schema por cima dela. O gate usa esse mesmo script em `sensitiveCommands.integration` quando um arquivo sensível muda.
