# Contrato do módulo `m24a-escritorio-estado` — v1

> Arquiteto (Opus), 22/10/2026. Risco **SENSÍVEL** (fluxo em tempo real, multiempresa). Nível **A**. Sem migração.

## 1. Objetivo
Estado do Escritório Virtual (docs/virtual-office.md) **derivado só das execuções registradas** (`ai_tool_runs`, `ai_messages`, avaliações do m39) e entregue por **SSE por empresa**, com a sessão e a empresa **reautorizadas a cada evento**.

## 2. Fora de escopo
Mapa 2D e telas (m24b); ações de reexecutar/cancelar/aprovar (não existem execuções longas nem recomendações pendentes no backend: o estado "aguardando aprovação" não é produzido e fica documentado como pendente).

## 3. Allowlist
`src/server/office/snapshot.ts`, `src/app/api/escritorio/eventos/route.ts`, `tests/integration/office.test.ts`, `docs/virtual-office.md`, `docs/security.md`, `docs/contracts/m24a-escritorio-estado.md`.

## 4. Interface
```ts
officeSnapshot(context, now = new Date()): { generatedAt; aiConfigured; agents: OfficeAgent[]; counters; history: { agent; status; at }[]; panels }   // ai.use
GET /api/escritorio/eventos   // text/event-stream: um evento "snapshot" a cada 5 s; "fim" quando a sessão expira, a empresa muda ou o acesso cai
```
`OfficeAgent = { id; name; room; tools; state: "unavailable" | "analyzing" | "done" | "error" | "available"; lastActivityAt; lastError }`.

## 6. Regras
- Agentes e salas da tabela do docs/virtual-office.md, ligados às ferramentas reais do m21/m39; agente sem ferramenta própria (Estoque, até haver ferramenta de estoque) e todos quando a IA não está configurada ficam `unavailable`; agente cujas ferramentas o perfil não pode usar também.
- Estados por regra: `analyzing` (Coordenador: pergunta sem resposta há menos de 2 min); `error` (última execução do agente falhou há menos de 5 min); `done` (terminou há menos de 20 s); senão `available`. Nada aleatório, nenhum progresso inventado.
- Histórico: as últimas 20 execuções da empresa (agente, situação, horário), **sem parâmetros nem autor**. Painéis: alertas abertos e clientes aguardando na fila, só para quem tem a permissão de cada um (senão `null`).
- SSE: autenticação pela sessão do cookie a cada evento; ao perder acesso o fluxo envia `fim` e fecha; intervalo de 5 s; o cliente reconecta.

## 9. Critérios de aceite
Integração: estados derivados de execuções conhecidas (concluído, erro, analisando, disponível, indisponível sem IA), histórico sem parâmetros, painéis respeitam permissões, isolamento entre empresas.
