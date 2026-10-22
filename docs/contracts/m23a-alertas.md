# Contrato do módulo `m23a-alertas` — v1

> Arquiteto (Opus), 22/10/2026. Risco **SENSÍVEL**. Nível **A**. Migração **23ª** (`0051`/`0052`).

## 1. Objetivo
Alertas proativos **determinísticos**: regras fixas com limites definidos pela empresa (sem limite configurado, a regra não roda), severidade, loja, responsável e resolução (`open` → `acknowledged` → `resolved`).

## 2. Fora de escopo
Telas (m23b), notificação por e-mail/push (sem provedor), tarefas a partir de alertas (m38a), disparador periódico em produção (pendente de infraestrutura; `runAlertEvaluation` fica pronto).

## 3. Allowlist
`src/db/schema/alerts.ts`, `src/db/schema/index.ts`, `drizzle/**`, `src/server/alerts/rules.ts`, `src/server/alerts/service.ts`, `src/server/authz/permissions.ts`, `src/server/authz/system-roles.ts`, `src/server/audit/labels.ts`, `src/server/audit/service.ts`, `tests/integration/alerts.test.ts`, `docs/data-model.md`, `docs/security.md`, `docs/contracts/m23a-alertas.md`.

## 4. Regras (código) e limites (empresa)
| Regra | Dispara quando | Limite | Resolve sozinha |
|---|---|---|---|
| `low_stock` | disponível (saldo − reservado) ≤ limite, item ativo | quantidade | sim |
| `cash_difference` | sessão fechada nos últimos 2 dias com \|diferença\| ≥ limite | centavos | não |
| `reconciliation_divergent` | fechamento diário (versão mais recente, 7 dias) com divergência | — | não |
| `queue_abandonment` | desistências da loja no dia ≥ limite | quantidade | não |
| `target_at_risk` | meta de loja/vendedor do mês com ≥ 3 dias úteis decorridos e projeção < limite % da meta | percentual | sim |

## 5. Interface
```ts
saveRule(context, kind, { enabled, severity, threshold? }); listRules(context)               // alerts.manage (toda a empresa) / alerts.read
evaluateNow(context); runAlertEvaluation(now?)                                                 // alerts.manage / disparador
listAlerts(context, { status?, storeId?, page }); acknowledgeAlert(context, id); assignAlert(context, id, membershipId); resolveAlert(context, id, { note })
```
Avaliação roda com o contexto do dono da empresa (leitura); cada alerta tem chave de deduplicação única enquanto aberto.

## 6. Permissões e auditoria
`alerts.read` (Financeiro, Coordenador, Gerente de loja, Supervisor) no escopo de lojas; `alerts.manage` (Coordenador, Gerente de loja; Dono/Admin) reconhece, atribui e resolve; regras exigem acesso a toda a empresa. Auditoria: `alert_rule.saved`, `alert.raised|acknowledged|assigned|resolved` (levantado e resolvido automaticamente com ator nulo).

## 9. Critérios de aceite
Integração: regra sem limite não roda; cada regra dispara com dados conhecidos e não duplica; estoque reposto resolve sozinho; resolver exige nota; escopo e isolamento.
