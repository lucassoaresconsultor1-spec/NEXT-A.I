# Preparação local

## Pré-requisitos

- Node.js ≥ 22.12 (validado com 22.22) e pnpm 10.28 (`corepack enable` usa a versão de `packageManager`).
- PostgreSQL ≥ 15 local ou gerenciado (validado com 16.15). RLS e `gen_random_uuid()` são nativos.
- Para E2E: um Chromium compatível com o Playwright 1.64 (`pnpm exec playwright install chromium`) ou um binário existente informado em `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

## Primeira execução

```bash
pnpm install
cp .env.example .env.local   # preencha os valores (arquivo ignorado pelo Git)
```

Variáveis (`.env.example` lista todas):

| Variável | Uso |
|---|---|
| `DATABASE_URL` | Conexão da aplicação com um papel **sem** `SUPERUSER`/`BYPASSRLS` |
| `DATABASE_MIGRATION_URL` | Dono do schema, usado só por `pnpm db:migrate` |
| `DATABASE_URL_UNPOOLED` | Conexão direta, se o provedor exigir para migrations |
| `AUTH_SECRET` | ≥ 32 caracteres aleatórios (`openssl rand -base64 48`); chave dos HMAC de autenticação |
| `ALLOW_SIGNUP` | `true`/`false` para o cadastro self-service de empresas |
| `LOG_LEVEL` | Nível do Pino (`info` por padrão) |

## Banco

Exemplo com PostgreSQL local (superusuário `postgres`): cria os papéis `varejo_owner` (dono/migrations) e `varejo_app` (aplicação, sem BYPASSRLS) e o banco.

```bash
psql -U postgres -v db=varejo -v owner_password='troque' -v app_password='troque' -f scripts/sql/local-database.sql
```

`.env.local` correspondente:

```
DATABASE_URL=postgresql://varejo_app:troque@localhost:5432/varejo
DATABASE_MIGRATION_URL=postgresql://varejo_owner:troque@localhost:5432/varejo
```

Aplicar as migrations (inclui o catálogo de planos):

```bash
pnpm db:migrate
```

Ao mudar o schema: edite `src/db/schema/`, rode `pnpm db:generate`, revise o SQL em `drizzle/` e aplique. Detalhes em [data-model.md](data-model.md). Nunca use o banco de produção para testes.

Em hospedagem gerenciada, crie um papel de aplicação equivalente (sem `BYPASSRLS`) e conceda `USAGE` no schema e `SELECT, INSERT, UPDATE, DELETE` nas tabelas (os `ALTER DEFAULT PRIVILEGES` do script local mostram o necessário).

## Desenvolver

```bash
pnpm dev            # http://localhost:3000
```

Crie a primeira empresa em `/criar-conta`. Para um administrador da plataforma:

```bash
PLATFORM_ADMIN_PASSWORD='senha-provisoria-forte' pnpm platform:admin admin@exemplo.com.br
```

Se o e-mail já existir, o usuário apenas recebe a permissão; caso contrário é criado com troca de senha obrigatória no primeiro acesso.

## Verificar

```bash
pnpm check   # lint + tipos + regras locais + testes unitários + build (sem banco)
```

Com um PostgreSQL descartável (o banco é **apagado e recriado** a cada execução):

```bash
export TEST_DATABASE_URL=postgresql://varejo_app:troque@localhost:5432/varejo_test
export TEST_DATABASE_MIGRATION_URL=postgresql://varejo_owner:troque@localhost:5432/varejo_test
pnpm test:integration
pnpm test:e2e        # build + servidor na porta 3200 + Playwright
```

O que cada comando prova está em [quality.md](quality.md).

## Agentes

Leia [AGENTS.md](../AGENTS.md). [CLAUDE.md](../CLAUDE.md) importa as mesmas instruções. Consulte [setup.md](setup.md) para skills locais, plugins de projeto (`.claude/settings.json`), integrações e escopos configurados. `.mcp.json` declara o Context7; o cliente pede confirmação antes de usar servidores MCP do projeto.

## Dificuldades conhecidas

- **Testes de integração recusam rodar:** o papel de `TEST_DATABASE_URL` é superusuário ou tem `BYPASSRLS`, o que tornaria os testes de RLS inválidos. Use o papel da aplicação.
- **Playwright não encontra o navegador:** a revisão de Chromium esperada pelo Playwright não está instalada; rode `pnpm exec playwright install chromium` ou aponte `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` para um Chromium existente (no ambiente de bootstrap: `/opt/pw-browsers/chromium`).
