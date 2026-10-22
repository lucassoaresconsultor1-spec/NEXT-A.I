# Contrato do módulo `m40-limites-consumo-plano` — v1

> Arquiteto (Opus), 22/10/2026. Risco **SENSÍVEL** (custo). Nível **A**. Migração **26ª** (`0057`, só coluna no catálogo global de planos).

## 1. Objetivo
Consumo medido por plano (lojas, membros, chamadas, tokens e custo de IA do mês) para a tela de uso, e limite mensal de tokens de IA por plano, cobrado antes de cada chamada ao modelo.

## 3. Allowlist
`src/db/schema/structure.ts` (`plans.max_ai_tokens_per_month`), `drizzle/**`, `src/server/plans/entitlements.ts`, `src/server/plans/usage.ts`, `src/server/ai/service.ts`, `src/server/platform/service.ts`, `tests/integration/plan-usage.test.ts`, `docs/data-model.md`, `docs/security.md`, `docs/contracts/m40-limites-consumo-plano.md`.

## 4. Interface
`getPlanUsage(context)` (`organization.settings.read`): plano, lojas e membros usados × limite, e IA do mês (chamadas, tokens, limite, custo em milionésimos de real e se o custo está completo). `setPlanAiLimit(actorId, planKey, tokens | null)` (administração da plataforma). `assertAiQuota` chamado por `callModel`.

## 6. Regras
Limite `null` = sem limite configurado (nenhum valor inventado; o valor comercial é decisão do dono). Mês civil no fuso da empresa; ao atingir o limite a chamada é recusada antes do provedor. Custo só soma o que o adaptador declarou; `costComplete = false` quando alguma chamada não tem preço. A mudança do limite (catálogo global, sem trilha por empresa) vai para o log do servidor.

## 9. Critérios de aceite
Uso medido; limite só quando configurado; terceira chamada recusada sem chegar ao provedor; só a plataforma altera; remover o limite libera.
