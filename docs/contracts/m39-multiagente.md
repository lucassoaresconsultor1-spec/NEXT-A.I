# Contrato do módulo `m39-multiagente` — v1

> Arquiteto (Opus), 22/10/2026. Risco **SENSÍVEL** (IA). Nível **A**. Migração **25ª** (`0055`/`0056`).

## 1. Objetivo
Especialistas (vendas, operação, financeiro, procedimentos), cada um com um subconjunto das ferramentas do m21, acionados pelo orquestrador **só com benefício medido**: a última avaliação da empresa precisa mostrar que o especialista acerta mais casos que o agente central, ou o mesmo número (ao menos um) com 20% menos tokens. Inclui a ferramenta `search_company_procedures` (m38a).

## 3. Allowlist
`src/db/schema/ai.ts`, `drizzle/**`, `src/server/ai/{loop,specialists,agent,tools}.ts`, `src/server/authz/permissions.ts`, `src/server/audit/labels.ts`, `src/server/audit/service.ts`, `tests/integration/ai-specialists.test.ts`, `docs/data-model.md`, `docs/security.md`, `docs/contracts/m39-multiagente.md`.

## 4. Interface
`evaluateSpecialistAgainstCentral(context, key, { cases: [{ question, expectTools, expectTexts }] })` (`ai.manage`, Dono/Admin) roda os mesmos casos nos dois caminhos e grava `ai_specialist_evaluations` (somente inserção). `askAssistant` oferece `consult_specialist` com só os especialistas habilitados; o especialista roda o mesmo laço (`runAgentLoop`) com as ferramentas dele que o perfil pode usar, sem poder delegar de novo.

## 6. Regras
Avaliação conferida só por fatos objetivos (ferramenta usada e textos esperados na resposta); sem provedor configurado não há avaliação (pendente); a delegação e as ferramentas do especialista ficam registradas na conversa; nenhuma ferramenta escreve.

## 9. Critérios de aceite
Sem avaliação, sem delegação; avaliação com benefício habilita; especialista só vê as próprias ferramentas; avaliação sem benefício desabilita; busca de procedimentos devolve dados delimitados; sem `ai.manage` não avalia.
