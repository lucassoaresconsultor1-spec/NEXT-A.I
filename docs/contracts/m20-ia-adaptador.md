# Contrato do módulo `m20-ia-adaptador` — v1

> Arquiteto (Opus), 22/10/2026. Risco **SENSÍVEL** (dados enviados a terceiro, custo). Nível **A**. Migração **21ª** (`0047`/`0048`).

## 1. Objetivo
Porta `ModelProvider` (conversa com ferramentas, limites de tokens e tempo, erros tipados) com registro **sem adaptador real**: sem provedor configurado, a IA fica **pendente** (nada simulado); toda chamada registra uso e custo em `ai_usage_records`, sem o conteúdo das mensagens.

## 2. Fora de escopo
Escolha e integração de um provedor real (credencial do dono; registrar em `docs/setup.md` quando houver), ferramentas e agente (m21), tela (m22), limites de consumo por plano (m40).

## 3. Allowlist
`src/db/schema/ai.ts`, `src/db/schema/index.ts`, `drizzle/**`, `src/server/ai/port.ts`, `src/server/ai/registry.ts`, `src/server/ai/service.ts`, `src/server/plans/entitlements.ts` (`ai_assistant`), `src/server/authz/permissions.ts`, `src/server/authz/system-roles.ts`, `tests/support/fake-model-provider.ts`, `tests/integration/ai.test.ts`, `docs/data-model.md`, `docs/security.md`, `docs/contracts/m20-ia-adaptador.md`.

## 4. Interface
```ts
// port.ts
interface ModelProvider { key; model; pricing: { inputMicrosPerMillion; outputMicrosPerMillion } | null; chat(request, signal): Promise<ModelResponse> }
class ModelProviderError { kind: "rate_limited" | "timeout" | "unavailable" | "invalid_request" }
// service.ts
aiStatus(context): { configured: boolean; provider: string | null; model: string | null }   // ai.use
callModel(context, { feature: "assistant" | "report", system, messages, tools?, maxOutputTokens? }): Promise<ModelResponse>
```

## 6. Regras
- Exige `ai.use` (Dono, Admin, Financeiro, Coordenador, Gerente de loja, Supervisor) e o recurso `ai_assistant` do plano. Sem provedor: erro `limit` "Assistente de IA pendente: nenhum provedor configurado".
- Tempo máximo de 30 s (AbortController) e até 2.000 tokens de saída por chamada; erros do provedor viram mensagens pt-BR seguras.
- `ai_usage_records` (somente inserção): usuário, recurso, provedor, modelo, tokens de entrada e saída, custo em milionésimos de real calculado só com o preço declarado pelo adaptador (sem preço = nulo), duração, situação e tipo de erro. Nenhum texto de pergunta ou resposta é gravado aqui.

## 9. Critérios de aceite
Integração com adaptador falso de teste: sucesso registra tokens e custo; erro do provedor registra e devolve mensagem segura; sem provedor = pendente; plano sem `ai_assistant` = limite; sem permissão = proibido.
