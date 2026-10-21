# SPEC — NEXT A.I

> Dono: Arquiteto (Opus/Codex). Workers (Antigravity) NÃO editam este arquivo.
> Versão: 3 · Atualizar a versão a cada mudança de contrato (ver seção 6).
> Primeiro preenchimento escrito pelo Maestro a pedido do usuário (20/10/2026); a revisão do Arquiteto está pendente e pode alterar a seção 1 antes de qualquer delegação.

Este documento organiza o **trabalho restante** em módulos entregáveis. Escopo, requisitos e critérios de aceite estão em [PRODUCT.md](../PRODUCT.md); fases, estado atual e riscos de produto em [roadmap.md](roadmap.md); estrutura e decisões já tomadas em [architecture.md](architecture.md); controles em [security.md](security.md). Nada disso é repetido aqui: a SPEC só acrescenta a divisão em módulos, a classificação de risco para delegação e o modelo de ameaças por superfície nova.

## 0. Visão e restrições
- Objetivo do produto: plataforma SaaS multiempresa de gestão para varejo (PDV, caixa, estoque, atendimento, metas, comissões, BI e IA) com números calculados só por serviços do servidor ([PRODUCT.md](../PRODUCT.md#problema-e-objetivo)).
- Stack fixada: Next.js 16.4 (App Router), React 19.3, TypeScript strict, Tailwind 4, Drizzle ORM + PostgreSQL com RLS forçado, Zod 4, Pino, Vitest, Playwright, pnpm 10 ([PRODUCT.md](../PRODUCT.md#restrições-e-decisões-técnicas)). Dependência nova só com aprovação do Arquiteto e registro em [setup.md](setup.md).
- Restrições não funcionais: isolamento por empresa no banco (RLS + FKs compostas + filtro explícito); autorização no servidor em toda página, ação e serviço; dinheiro em centavos inteiros; datas no fuso da empresa/loja; textos em pt-BR; auditoria de toda mutação; LGPD por minimização; nenhuma integração simulada como pronta ([AGENTS.md](../AGENTS.md#regras-do-domínio-obrigatórias)).

## 1. Mapa de módulos

Módulos já entregues (Fase 1 e Fase 2, incremento 1 em back-end) estão no [roadmap](roadmap.md#mapa-de-módulos) e **não** entram abaixo, exceto as telas que ainda faltam. Ordem de execução = ordem da tabela, respeitando "Depende de".

| ID | Responsabilidade | Fase | Depende de | Risco | Quem implementa |
|----|------------------|------|------------|-------|-----------------|
| m01-dias-uteis | Biblioteca pura de calendário: dia útil, feriados nacionais fixos, contagem de dias úteis num período (base de escalas e metas) | 3 | - | BAIXO | Worker |
| m02-telas-cadastros | Telas de categorias, marcas e fornecedores sobre `src/server/catalog` (listar, criar, editar, ativar/desativar) | 2 | catálogo (existente) | BAIXO | Worker |
| m03-telas-produtos | Telas de produtos, variações, preço e custo (custo só com `catalog.costs.read`) | 2 | m02 | SENSÍVEL (dinheiro, custo) | Arquiteto/Codex |
| m04-telas-estoque | Telas de saldos e movimentações; lançamento manual | 2 | m03 | SENSÍVEL (estoque) | Arquiteto/Codex |
| m05-caixa | `cash_registers`, `cash_sessions`, `cash_movements`; abertura, sangria, suprimento, fechamento e divergência | 2 | m04 | SENSÍVEL (dinheiro, tabelas com RLS, migração) | Arquiteto/Codex |
| m06-pdv | Venda, carrinho, descontos autorizados, suspensão, comprovante não fiscal; baixa de estoque na mesma transação | 2 | m05 | SENSÍVEL (dinheiro, estoque, idempotência) | Arquiteto/Codex |
| m07-pagamentos | Porta de provedor, dinheiro/troco locais, PIX/cartão por webhook autenticado ou consulta, estorno | 2 | m06 | SENSÍVEL (terceiros, webhook, segredos) | Arquiteto/Codex |
| m08-cancelamentos | Cancelamento e devolução com autorização, estorno e retorno ao estoque | 2 | m07 | SENSÍVEL (dinheiro, autorização) | Arquiteto/Codex |
| m09-fiscal-interface | Porta `FiscalProvider` com estados; sem emissão real | 2 | m06 | SENSÍVEL (terceiros, fiscal) | Arquiteto/Codex |
| m10-vendedores | Vínculo vendedor ↔ membro e escala por dias úteis | 3 | m01 | SENSÍVEL (tabela com RLS, migração) | Arquiteto/Codex |
| m11-metas | Metas por escopo e período, sem alterar histórico | 3 | m01, m10 | SENSÍVEL (tabela com RLS, valores monetários) | Arquiteto/Codex |
| m12-comissoes | Regras versionadas e apuração (estimada → apurada → aprovada → paga, estorno) | 3 | m08, m11 | SENSÍVEL (dinheiro) | Arquiteto/Codex |
| m13-fila-atendimento | `service_tickets`, `service_events`, distribuição configurável, vínculo com venda | 3 | m06, m10 | SENSÍVEL (tabelas com RLS, concorrência) | Arquiteto/Codex |
| m14-pwa-manifesto | Manifesto e ícones do app instalável, sem service worker | 3 | - | BAIXO | Worker |
| m15-pwa-offline-cache | Service worker e cache de páginas | 3+ | m14 | SENSÍVEL (dados autenticados em aparelho compartilhado) | Arquiteto/Codex |
| m16-metricas | `src/server/metrics/`: fórmulas únicas de faturamento, margem, conversão, ticket | 4 | m06, m12, m13 | SENSÍVEL (consultas sobre tenant, dinheiro) | Arquiteto/Codex |
| m17-dashboards-ui | Dashboards por perfil sobre m16: gráficos, comparação de períodos, estados de vazio e erro | 4 | m16 | BAIXO (só apresentação de dados já autorizados) | Worker |
| m18-relatorios | Central de relatórios, exportação CSV/XLSX/PDF, agendamento e histórico | 4 | m16 | SENSÍVEL (exportação, escopo, injeção de fórmula) | Arquiteto/Codex |
| m19-importacao | Importação CSV/XLSX com mapeamento, prévia e histórico | 2-4 | m03 | SENSÍVEL (arquivo não confiável) | Arquiteto/Codex |
| m20-ia-adaptador | Adaptador de provedor de modelo, registro de uso e custo por organização | 5 | m16 | SENSÍVEL (terceiros, segredos, dados enviados) | Arquiteto/Codex |
| m21-ia-ferramentas | Catálogo de ferramentas sobre métricas, agente central, bloqueio de ferramentas não autorizadas | 5 | m20 | SENSÍVEL (autorização, prompt injection) | Arquiteto/Codex |
| m22-ia-chat-ui | Interface conversacional sobre m21, fontes e limitações visíveis | 5 | m21 | BAIXO (apresentação) | Worker |
| m23-alertas | Regras proativas determinísticas, severidade, responsável e resolução | 6 | m16 | SENSÍVEL (consultas sobre tenant) | Arquiteto/Codex |
| m24-escritorio-virtual | Salas e personagens ligados às execuções reais, SSE, visão em lista acessível | 7 | m21, m23 | SENSÍVEL (SSE por tenant, estados reais) | Arquiteto/Codex |
| m25-observabilidade | Erros, latência, consultas lentas e custo de IA por organização | 8 | m20 | SENSÍVEL (logs sem dados pessoais) | Arquiteto/Codex |

Risco **SENSÍVEL** = auth, autorização, pagamentos, criptografia, migrações destrutivas, segredos, entrada externa não confiável, integrações com terceiros. Esses módulos não vão para o worker gratuito. Neste projeto também contam como SENSÍVEL: **tabelas com RLS**, **dinheiro**, **estoque** e qualquer coisa que toque `src/db/**`, `drizzle/**` ou os módulos `authz`, `audit`, `plans`, `members`, `platform` e `inventory` (lista aplicada pelo gate em `tools/gate/gate.config.json`).

Fora do mapa por dependerem de decisão externa registrada em [PRODUCT.md](../PRODUCT.md#hipóteses-e-pendências): e-mail transacional, provedores de pagamento/fiscal/IA, hospedagem e cobrança. O módulo que usa cada um fica bloqueado até a decisão.

**Pendência de produção (m01, ver ADR-003):** a lista de feriados nacionais fixos do contrato `m01-dias-uteis` precisa de confirmação profissional antes de produção. Até lá o módulo pode ser implementado e testado, mas nenhum módulo que dependa dele (m10, m11, m12) vai para produção com a lista sem confirmar.

**Dados de referência: feriados de Araruama/RJ** (pesquisa de 21/10/2026 em fontes oficiais). Não fazem parte do código do m01: entram como `extraHolidays` pelo chamador, quando existir a configuração de calendário por empresa/loja (módulo ainda não mapeado). Ponto facultativo **não** é feriado e não entra em `extraHolidays` por padrão; a decisão de dar folga é da empresa.

| Data | Nome | Nível | Situação | Fonte |
|------|------|-------|----------|-------|
| 20/01 | Dia de São Sebastião (padroeiro) | Municipal | Feriado no calendário oficial de 2026; **lei de origem não localizada** | Decreto nº 5, de 14/01/2026, e site da Prefeitura |
| 06/02 | Aniversário / emancipação de Araruama | Municipal | Feriado no calendário oficial de 2026; **lei de origem não localizada** | idem |
| 23/04 | Dia de São Jorge | Estadual (RJ) | Feriado; Lei estadual 5.198/2008, declarada constitucional pelo STF (ADI 4092) | ALERJ, STF |
| 20/11 | Dia da Consciência Negra | Estadual (RJ) até 2023; nacional desde 2024 | Lei estadual 4.007/2002 (em vigor). O m01 embute a data só a partir de 2024; para anos anteriores o chamador a informa | ALERJ |
| Páscoa + 60 dias (04/06/2026) | Corpus Christi | Municipal | **Ponto facultativo**, como no Decreto nº 5/2026 e por orientação do usuário. **Divergência a confirmar com a Prefeitura:** a Lei municipal 2709/2025 o institui como feriado religioso. Até a confirmação, não entra como feriado | Decreto nº 5/2026; Lei 2709/2025 |
| 16 a 18/02/2026 | Carnaval | - | Ponto facultativo no decreto; não entra | Decreto nº 5/2026 |
| 28/10 | Dia do Servidor Público | - | Feriado só para as repartições municipais; não se aplica a empresas privadas; não entra | Decreto nº 5/2026 |
| Páscoa - 2 dias | Sexta-feira Santa | - | Sem lei municipal localizada e ausente do calendário de 2026; não entra | - |

Limites da pesquisa: li a matéria da Prefeitura que reproduz o Decreto nº 5/2026 e o texto da Lei 2709/2025, não o PDF do decreto; a lista do 20/01 e do 06/02 depende de lei que não encontrei; a lei estadual do Carnaval (5.243/2008, citada por sites de calendário) não foi confirmada. Tudo isso precisa de confirmação profissional antes de produção.

## 2. Decisões de arquitetura (ADRs curtos)
As decisões estruturais já tomadas estão em [architecture.md](architecture.md#decisões) (RLS forçado, autenticação própria, permissões no código, hierarquia por `rank`, planos em `entitlements.ts`). Os ADRs abaixo valem **para a delegação**.

- ADR-001: um worker só recebe módulo de risco BAIXO com contrato completo e allowlist; a classificação é do Arquiteto e o Maestro valida antes de delegar — por quê: o erro de um módulo sensível custa mais que o ganho de custo — alternativa descartada: delegar e revisar depois.
- ADR-002: lógica pura (datas, quantidades, regras de cálculo) fica em `src/lib/` sem banco nem I/O, com teste unitário ao lado; módulos com banco ficam em `src/server/<módulo>/` — por quê: lógica pura é verificável sem PostgreSQL e serve a vários módulos — alternativa descartada: espalhar cálculos nos serviços.
- ADR-003: feriados nacionais fixos vão em código com a regra de vigência (`fromYear`); feriados estaduais, municipais e pontos facultativos entram por parâmetro do chamador — por quê: dependem da empresa/loja e não podem ser inventados nem buscados em serviço externo — alternativa descartada: tabela de feriados de todo o país embutida. **Pendência:** a lista fixa (`NATIONAL_FIXED_HOLIDAYS`) é só dado do contrato m01; precisa de confirmação profissional (contábil/jurídica) antes de ir para produção ou alimentar folha, metas e comissões.
- ADR-004: módulos que usam banco passam pelo gate com `tools/gate/gate.integration.config.json` (variáveis `TEST_DATABASE_URL`/`TEST_DATABASE_MIGRATION_URL` do shell, nunca de arquivo) — por quê: o gate padrão só roda testes unitários e `PASS` não prova RLS nem saldo — alternativa descartada: integração só no fim da fase.
- ADR-005: pagamentos e fiscal entram por porta (interface + adaptador); nenhum protocolo, autorização ou confirmação é simulado — por quê: depende de provedor e validação profissional — alternativa descartada: implementar um provedor falso "temporário".
- ADR-006: PWA em duas etapas: manifesto primeiro (m14), service worker só depois de decidir o que pode ficar em cache (m15) — por quê: cache de páginas autenticadas em tablet compartilhado é risco de vazamento — alternativa descartada: service worker junto do manifesto.
- ADR-007: telas só chamam serviços de `src/server/` e cada página/ação chama `requireTenantContext()`; módulos de tela BAIXO herdam a autorização dos serviços já testados — por quê: não duplicar regra de acesso na apresentação — alternativa descartada: checar permissão na página em vez do serviço.

## 3. Modelo de ameaças
O modelo geral e as camadas implementadas estão em [security.md](security.md#modelo-de-ameaças-considerado). A tabela cobre **só as superfícies novas** dos módulos restantes.

| Superfície | Ameaça | Mitigação obrigatória | Módulo |
|------------|--------|-----------------------|--------|
| Tabelas novas por empresa | Leitura/escrita entre empresas | `organization_id`, `tenantIsolationPolicy()`, `UNIQUE (organization_id, id)`, FKs compostas, `FORCE ROW LEVEL SECURITY`, teste de isolamento por módulo | m05, m06, m10, m11, m12, m13 |
| Telas e Server Actions | IDOR e acesso sem permissão | `requireTenantContext()` na página e na ação; id fora do escopo = "não encontrado"; permissão checada no serviço | m02, m03, m04, m17, m22 |
| Custos de produto | Vazamento a quem não tem `catalog.costs.read` | Custo fora do DTO sem a permissão; tela só pede o campo quando autorizada | m03, m16 |
| Finalização de venda e pagamento | Duplicidade por retentativa ou corrida | Chave de idempotência por finalização, transação única com baixa de estoque, sem retry automático de operação financeira | m06, m07, m08 |
| Webhook de pagamento | Confirmação forjada ou repetida | Assinatura/autenticação do provedor verificada, idempotência por id do evento, confirmação só por webhook autenticado ou consulta ao provedor | m07 |
| Caixa | Divergência escondida, reabertura sem autorização | Permissão específica, justificativa obrigatória, auditoria; fechamento aponta divergência | m05 |
| Comissões e metas | Alteração silenciosa de histórico | Regras versionadas, estados imutáveis após aprovação, estorno por devolução registrado | m11, m12 |
| Importação (CSV/XLSX) | Arquivo malicioso, volume excessivo, dados de outra empresa | Limite de tamanho e linhas, parsing validado por schema, prévia antes de gravar, escopo da empresa no servidor | m19 |
| Exportação (CSV/XLSX/PDF) | Injeção de fórmula na planilha; dados fora do escopo | Escapar células que começam com `=`, `+`, `-`, `@`; exportar só o escopo do solicitante | m18 |
| IA e provedor | Prompt injection, dados demais enviados, custo sem limite | Ferramentas determinísticas autorizadas no backend, envio mínimo, limite e registro de uso por plano, credenciais só no servidor | m20, m21 |
| PWA e tablet da fila | Dados autenticados em cache de aparelho compartilhado; identificação do vendedor | Manifesto sem cache até o ADR-006; identificação do tablet (aparelho vinculado à loja, PIN do vendedor) é **proposta a validar com o usuário** | m14, m15, m13 |
| SSE do escritório virtual | Eventos de uma empresa entregues a outra | Canal por empresa, autorização na conexão e a cada evento, estados só de execuções registradas | m24 |
| Logs e observabilidade | Dados pessoais e segredos em log | Pino sem corpo completo, HMAC para identificadores, nenhum segredo | m25 e todos |
| Dependências novas | Cadeia de suprimentos | Sem dependência sem aprovação; gate reprova `package.json`/lockfile alterado | todos |

## 4. Contratos de módulo
Um arquivo por módulo em `docs/contracts/<id>.md`, a partir de [_TEMPLATE.md](contracts/_TEMPLATE.md). Contrato incompleto = módulo não pode ser delegado.

| Contrato | Estado |
|----------|--------|
| [m01-dias-uteis](contracts/m01-dias-uteis.md) | Escrito (v2, ajustado após a revisão do Arquiteto); aguarda a reconfirmação do Arquiteto antes de delegar |
| m02 a m25 | Não escritos; o Arquiteto escreve um por vez, na ordem do mapa |

## 5. Definição de pronto global
- Gate (`pwsh tools/gate/gate.ps1`) retorna PASS para o módulo (PASS+REVIEW só depois da revisão do checklist).
- Testes de aceite do contrato existem e passam.
- Nenhum arquivo fora da allowlist foi alterado.
- Nenhuma dependência nova sem aprovação do Arquiteto.
- Módulos de risco SENSÍVEL passaram pela revisão do checklist ([REVIEW-CHECKLIST.md](REVIEW-CHECKLIST.md)).
- Módulos com banco: suíte de integração passou contra PostgreSQL descartável e a documentação responsável ([AGENTS.md](../AGENTS.md#padrões-e-documentação)) foi atualizada.

## 6. Registro de mudanças de contrato
| Versão | Data | Módulo | Mudança | Motivo |
|--------|------|--------|---------|--------|
| 1 | 20/10/2026 | SPEC, m01-dias-uteis | Mapa de módulos, ADRs, modelo de ameaças e primeiro contrato | Preenchimento inicial a pedido do usuário |
| 2 | 21/10/2026 | m01-dias-uteis | Opções hostis com `RangeError`, `isValidCalendarDay(unknown)`, `MAX_EXTRA_HOLIDAYS`, `NaN`/`Infinity`, borda de 3660/3661 dias, comandos de fuso e motivo de `easterSunday` | Revisão do Arquiteto (Opus): sete ajustes |
| 3 | 21/10/2026 | SPEC | Dados de referência dos feriados de Araruama/RJ (Corpus Christi como ponto facultativo, divergência com a Lei 2709/2025 registrada) | Pedido do usuário após pesquisa em fontes oficiais |
