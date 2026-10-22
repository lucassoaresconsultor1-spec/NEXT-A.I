# Contrato do módulo `m21-ia-ferramentas` — v1

> Arquiteto (Opus), 22/10/2026. Risco **SENSÍVEL** (autorização da IA, prompt injection). Nível **A**. Migração **22ª** (`0049`/`0050`).

## 1. Objetivo
Agente central do assistente: catálogo de **ferramentas** sobre os serviços de métricas e operação (contratos Zod), oferecidas ao modelo **só as que o perfil pode usar**, reexecutadas com a autorização do serviço; **bloqueio** de ferramentas não autorizadas ou desconhecidas; resultados entregues ao modelo como **dados delimitados** (instruções dentro deles não valem); conversas, mensagens e execuções de ferramentas registradas.

## 2. Fora de escopo
Tela (m22), especialistas (m39), ferramentas que alteram dados (proibidas nesta fase; tarefa só por ação humana no m38a).

## 3. Allowlist
`src/db/schema/ai.ts`, `drizzle/**`, `src/server/ai/tools.ts`, `src/server/ai/agent.ts`, `tests/integration/ai-agent.test.ts`, `tests/support/fake-model-provider.ts`, `docs/data-model.md`, `docs/security.md`, `docs/ai.md`, `docs/contracts/m21-ia-ferramentas.md`.

## 4. Interface
```ts
// tools.ts: get_sales_summary, compare_stores, get_salesperson_ranking, get_target_progress, get_queue_metrics, get_open_cash_sessions, get_expenses_total
availableTools(context): AiTool[]                       // só as permitidas
// agent.ts
askAssistant(context, { question, conversationId? }): Promise<{ conversationId; answer; sources: { tool; params }[]; blocked: string[] }>
listConversations(context); getConversation(context, id)   // só as do próprio usuário
```

## 5. Dados
`ai_conversations` (usuário, título, datas), `ai_messages` (conversa, papel `user`/`assistant`, texto), `ai_tool_runs` (conversa, ferramenta, parâmetros validados, situação `ok`/`error`/`blocked`, duração, erro). Somente inserção, FORCE RLS; visíveis só ao dono da conversa.

## 6. Regras
- Até 4 rodadas de ferramenta por pergunta; pergunta até 2.000 caracteres; histórico enviado ao modelo limitado às 10 últimas mensagens.
- Ferramenta fora da lista permitida, desconhecida ou com parâmetros inválidos devolve erro ao modelo e é registrada (`blocked`/`error`); nunca executa.
- Resultado de ferramenta vai ao modelo como `<dados ferramenta="...">JSON</dados>`; o prompt de sistema manda tratar esse conteúdo e a pergunta como dados, usar só números das ferramentas, separar fatos de hipóteses e declarar limitações.
- Exige `ai.use` e o plano (m20). Nenhuma ferramenta escreve.

## 9. Critérios de aceite
Integração com o modelo falso: ferramenta permitida executa com o resultado do serviço; ferramenta sem permissão e desconhecida são bloqueadas e registradas; texto malicioso em dado (nome de loja) chega delimitado e não amplia acesso; conversa visível só ao dono; limite de rodadas.
