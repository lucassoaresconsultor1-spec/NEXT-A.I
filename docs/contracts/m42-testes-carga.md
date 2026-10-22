# Contrato do módulo `m42-testes-carga` — v1

> Arquiteto (Opus), 22/10/2026. Risco **BAIXO**. Sem migração. Sem dependência nova.

## 1. Objetivo
Testes de carga dos fluxos críticos (PDV, fila, métricas) nos serviços, contra o banco descartável e com o pool real da aplicação: correção sob concorrência e latência p50/p95 e vazão medidas.

## 3. Allowlist
`vitest.load.config.mts`, `tests/load/critical-flows.load.ts`, `docs/quality.md`, `docs/contracts/m42-testes-carga.md`.

## 9. Critérios de aceite
120 vendas simultâneas de 8 caixas para 100 unidades = exatamente 100, números 1..100, saldo 0; 15 chamadas simultâneas com 10 vendedores = 10 atendimentos distintos; medidas registradas em `docs/quality.md`. Carga HTTP fim a fim: pendente do ambiente de homologação do dono.
