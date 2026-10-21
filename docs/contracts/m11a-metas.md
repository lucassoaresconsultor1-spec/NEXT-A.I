# Contrato do módulo `m11a-metas` — v1

> Escrito pelo Arquiteto (Opus) em 22/10/2026. Risco: **SENSÍVEL** (valores monetários, histórico). Nível: **A** (Opus).
> **Ordem de migração:** depois do m10a. Se algo estiver ambíguo, o agente PERGUNTA.

## 1. Objetivo
**Metas de venda** por escopo (empresa, região, loja, vendedor) e período (mês), em valor de faturamento líquido (centavos), com **versões**: mudar a meta de um período já iniciado cria nova versão com motivo e não reescreve a anterior; o **progresso** vem só do m16a (ADR-012), com projeção pelos dias úteis (m01/m32a/m10a).

## 2. Allowlist
```
src/db/schema/targets.ts
src/db/schema/index.ts
drizzle/**
src/server/targets/schemas.ts
src/server/targets/schemas.test.ts
src/server/targets/service.ts
src/server/targets/progress.ts
src/server/authz/permissions.ts
src/server/authz/system-roles.ts
src/server/audit/labels.ts
src/server/audit/service.ts
tests/integration/targets.test.ts
docs/data-model.md
docs/security.md
```

## 3. Dados
- `sales_targets`: empresa, escopo (`organization` | `region` | `store` | `salesperson`) com o id correspondente (FKs compostas opcionais por tipo, check de coerência), mês (`YYYY-MM`), valor (`bigint` > 0), versão (1, 2, …), vigente (`is_current`), motivo da versão (obrigatório a partir da 2), criado por/em. Somente inserção e leitura, exceto a troca de `is_current` (política própria de UPDATE só dessa coluna, ou tabela separada `sales_target_current`: o agente escolhe a forma com teste de que versões antigas não mudam).
- Índice único parcial: uma versão vigente por (escopo, id, mês).

## 4. Interface
```ts
export async function setTarget(context, input: unknown): Promise<{ id; version }>; // targets.manage; escopo dentro do do ator (loja/região no escopo; empresa exige acesso a todas)
export async function listTargets(context, filters);                              // targets.read
export async function targetHistory(context, scope, month);                        // todas as versões com motivo
export async function targetProgress(context, filters): Promise<{ targetCents; achievedCents; percent: string; workingDaysTotal; workingDaysElapsed; projectionCents }[]>;
// achievedCents = netRevenueCents do m16a no escopo e mês; percent com 1 casa (string, sem float exposto); projeção linear pelos dias úteis decorridos
```
- Permissões novas: `targets.read` (Gerente, Supervisor, Coordenador, Financeiro, Vendedor só as próprias), `targets.manage` (Coordenador, Gerente só das lojas dele; Dono/Admin).
- Período passado: meta não pode mais mudar (só leitura).
- Auditoria: `target.set` com versão, valor anterior e motivo.

## 5. Critérios de aceite
- [ ] Integração: criar meta, nova versão com motivo, histórico intacto, mês encerrado imutável; progresso igual ao `netRevenueCents` do m16a para o mesmo escopo; projeção com dias úteis de um mês conhecido; vendedor vê só a própria; escopos e isolamento.
- [ ] `lint`, `typecheck`, `lint:rules`, `test`, `build`; integração verde no gate.

## 6. Dependências
m01, m10a, m16a, m32a.
