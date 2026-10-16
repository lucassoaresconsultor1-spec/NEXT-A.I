# Varejo Inteligente

Plataforma SaaS multiempresa para gestão de varejo: lojas, equipes, PDV, estoque, atendimento, metas, indicadores e um agente de IA que trabalha somente sobre dados calculados pelo sistema. Escopo e público em [PRODUCT.md](PRODUCT.md).

**Estado atual: Fase 1 (fundação) concluída** — autenticação, isolamento entre empresas no banco (RLS), perfis e permissões com escopo de lojas, layout corporativo, cadastros de lojas, regiões, departamentos e equipe, perfis personalizados, auditoria, planos com limites e administração da plataforma. Vendas, estoque, fila, BI e IA seguem o [plano por fases](docs/roadmap.md).

## Demonstração

Uma página interativa com **dados fictícios** mostra a visão completa (painéis por perfil, PDV, estoque, fila, metas, relatórios, agentes de IA e o Escritório Virtual 2D) sem banco nem login: [link privado](https://claude.ai/artifact/SqQ3ETNacUbsf9W85oNtnL) · código e limites em [demo/README.md](demo/README.md). Ela é separada da aplicação e não representa módulos já implementados no produto.

## Executar

Requer Node.js ≥ 22.12, pnpm 10 e PostgreSQL ≥ 15.

```bash
pnpm install
cp .env.example .env.local      # DATABASE_URL, DATABASE_MIGRATION_URL, AUTH_SECRET…
pnpm db:migrate
pnpm dev                        # http://localhost:3000 → /criar-conta
```

A aplicação deve conectar com um papel de banco **sem** `SUPERUSER`/`BYPASSRLS`; o passo a passo (inclusive o script de papéis locais) está em [docs/onboarding.md](docs/onboarding.md).

Verificação: `pnpm check` (lint, tipos, regras, unitários e build, sem banco); `pnpm test:integration` e `pnpm test:e2e` com um PostgreSQL descartável.

## Documentação

- [Produto e escopo](PRODUCT.md) e [plano por fases e riscos](docs/roadmap.md).
- [Preparação local](docs/onboarding.md).
- [Estrutura e decisões técnicas](docs/architecture.md) e [modelo de dados](docs/data-model.md).
- [Segurança, isolamento e LGPD](docs/security.md).
- [Plano de IA e agentes](docs/ai.md) e [Escritório Virtual 2D](docs/virtual-office.md).
- [Design e acessibilidade](docs/design.md).
- [Checks de qualidade](docs/quality.md).
- [Instruções para agentes](AGENTS.md).
- [Setup e evidências](docs/setup.md).

`index-2.2.html` é um arquivo anterior do repositório (página de restaurante), sem relação com a aplicação; foi preservado sem alterações.

## Próxima entrega

Fase 2, primeiro incremento: catálogo de produtos e categorias com estoque por livro de movimentações — cadastrar produto com SKU/código de barras e variações, lançar entrada numa loja e ver o saldo calculado pelo livro, com isolamento e auditoria testados. Pagamentos externos, emissão fiscal, e-mail e provedor de IA dependem de escolhas e credenciais ainda pendentes ([PRODUCT.md](PRODUCT.md#hipóteses-e-pendências)).
