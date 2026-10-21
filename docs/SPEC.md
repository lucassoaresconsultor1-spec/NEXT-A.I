# SPEC — NEXT A.I

> Dono: Arquiteto (Opus/Codex). Workers (Antigravity) NÃO editam este arquivo.
> Versão: 11 · Atualizar a versão a cada mudança de contrato (ver seção 6).
> Primeiro preenchimento escrito pelo Maestro (20/10/2026); seção 1 refeita pelo Arquiteto (Opus) em 21/10/2026 com o plano completo das Fases 2 a 8, aceito pelo Maestro.

Este documento organiza o **trabalho restante** em módulos entregáveis. Escopo, requisitos e critérios de aceite estão em [PRODUCT.md](../PRODUCT.md); fases, estado atual e riscos de produto em [roadmap.md](roadmap.md); estrutura e decisões já tomadas em [architecture.md](architecture.md); controles em [security.md](security.md). Nada disso é repetido aqui: a SPEC só acrescenta a divisão em módulos, a classificação de risco para delegação e o modelo de ameaças por superfície nova.

## 0. Visão e restrições
- Objetivo do produto: plataforma SaaS multiempresa de gestão para varejo (PDV, caixa, estoque, atendimento, metas, comissões, BI e IA) com números calculados só por serviços do servidor ([PRODUCT.md](../PRODUCT.md#problema-e-objetivo)).
- Stack fixada: Next.js 16.4 (App Router), React 19.3, TypeScript strict, Tailwind 4, Drizzle ORM + PostgreSQL com RLS forçado, Zod 4, Pino, Vitest, Playwright, pnpm 10 ([PRODUCT.md](../PRODUCT.md#restrições-e-decisões-técnicas)). Dependência nova só com aprovação do Arquiteto e registro em [setup.md](setup.md).
- Restrições não funcionais: isolamento por empresa no banco (RLS + FKs compostas + filtro explícito); autorização no servidor em toda página, ação e serviço; dinheiro em centavos inteiros; datas no fuso da empresa/loja; textos em pt-BR; auditoria de toda mutação; LGPD por minimização; nenhuma integração simulada como pronta ([AGENTS.md](../AGENTS.md#regras-do-domínio-obrigatórias)).

## 1. Mapa de módulos

Módulos já entregues (Fase 1 e Fase 2, incremento 1 em back-end) estão no [roadmap](roadmap.md#mapa-de-módulos) e **não** entram abaixo, exceto as telas que ainda faltam. A coluna **#** é a ordem de execução; "Depende de" manda mais que a ordem. IDs com sufixo `a`/`b` seguem o ADR-008 (`a` = back-end, `b` = telas).

**Níveis** (prompt mestre, seção 4): **B** = básico (Antigravity), **I** = intermediário (Codex), **A** = avançado (Opus). **Tab** = cria tabela com RLS e migração (faixa A, uma migração por vez, ADR-010). **∥** = pode rodar em paralelo com os módulos citados (arquivos disjuntos, faixas diferentes, ADR-009).

#### Fase 2 — núcleo comercial
| # | ID | Responsabilidade | Depende de | Risco | Nível | Tab | ∥ |
|---|----|------------------|------------|-------|-------|-----|---|
| - | m01-dias-uteis | Biblioteca pura de calendário (dia útil, feriados nacionais fixos, contagem) | - | BAIXO | B | - | **integrado** (5052d8f) |
| 1 | m02a-telas-categorias-marcas | Telas de categorias e marcas e seção "Catálogo" do menu | catálogo | BAIXO | B | - | m26, m27 |
| 2 | m26-estados-interface | `Skeleton`, `loading.tsx`/`error.tsx` das rotas, estado "sem permissão" padronizado | - | BAIXO | I | - | m02a, m27 |
| 3 | m27-config-operacional | Configurações tipadas da empresa/loja: cliente no PDV, teto de desconto, cabeçalho do comprovante; serviço e tela | - | SENSÍVEL | A | sim | m02a, m26 |
| 4 | m02b-telas-fornecedores | Tela de fornecedores com busca, situação e paginação | m02a | BAIXO | B | - | m03, m28a |
| 5 | m03-telas-produtos | Telas de produtos, variações, preço e custo (custo só com `catalog.costs.read`) | m02b | SENSÍVEL | I | - | m28a |
| 6 | m28a-clientes | `customers` com dados mínimos (LGPD), CPF opcional, serviço e testes | - | SENSÍVEL | A | sim | m03, m02b |
| 7 | m04-telas-estoque | Saldos, livro de movimentações e lançamento manual | m03 | SENSÍVEL | I | - | m29a |
| 8 | m29a-compras | Pedidos de compra, recebimento contra pedido (entrada no livro e custo de reposição na mesma transação) | m28a (fila A) | SENSÍVEL | A | sim | m04 |
| 9 | m28b-telas-clientes | Telas de clientes | m28a | SENSÍVEL | I | - | m30a |
| 10 | m30a-transferencias-reservas | Transferências entre lojas (solicitada → aprovada → em trânsito → recebida/cancelada), reserva e trânsito no saldo | m29a (fila A) | SENSÍVEL | A | sim | m28b, m29b |
| 11 | m29b-telas-compras | Telas de pedidos e recebimento | m29a | SENSÍVEL | I | - | m05a |
| 12 | m05a-caixa | Caixas, sessões e movimentos (abertura, sangria, suprimento, fechamento, divergência, reabertura autorizada) | m27 | SENSÍVEL | A | sim | m29b, m30b |
| 13 | m30b-telas-transferencias | Telas de transferências | m30a | SENSÍVEL | I | - | m05b |
| 14 | m05b-telas-caixa | Telas de caixa | m05a | SENSÍVEL | A | - | m30b |
| 15 | m06a-pdv-vendas | Vendas, itens com snapshot de preço/custo, pagamentos locais, idempotência, numeração por loja, desconto por permissão, suspensão com reserva, baixa de estoque na mesma transação | m05a, m27, m28a, m30a | SENSÍVEL | A | sim | - |
| 16 | m06b-pdv-tela | PDV de desktop por teclado e leitor, pagamento, comprovante não fiscal, pendências visíveis | m06a, m05b | SENSÍVEL | A | - | m06c |
| 17 | m06c-telas-vendas | Histórico de vendas, detalhe e reimpressão | m06a | SENSÍVEL | I | - | m06b, m07 |
| 18 | m07-pagamentos | Porta `PaymentProvider`, PIX/cartão por webhook autenticado ou consulta, estorno; nenhum provedor real ligado | m06a | SENSÍVEL | A | sim | m06c |
| 19 | m09-fiscal-interface | Porta `FiscalProvider`, documentos com estados; sem emissão | m06a | SENSÍVEL | A | sim | - |
| 20 | m08-cancelamentos | Cancelamento e devolução com autorização, estorno e retorno ao estoque | m07 | SENSÍVEL | A | sim | - |
| 21 | m31-inventario-lote | Contagem por lote (cega), aprovação e ajuste em lote no livro, com tela | m04 | SENSÍVEL | A | sim | - |
| 22 | m19-importacao | Importação CSV de produtos, clientes e saldo inicial com mapeamento, prévia e histórico | m03, m28a | SENSÍVEL | A | sim | - |
| **M2** | marco | `pnpm check`, integração, e2e (venda com pagamentos múltiplos baixa estoque e caixa atomicamente; retentativa não duplica; fechamento aponta divergência), revisão visual e de segurança | todos acima | | | | |

#### Fase 3 — pessoas e atendimento
| # | ID | Responsabilidade | Depende de | Risco | Nível | Tab | ∥ |
|---|----|------------------|------------|-------|-------|-----|---|
| 23 | m14-pwa-manifesto | Manifesto e ícones do app instalável, sem service worker | - | BAIXO | B | - | toda a fase |
| 24 | m16a-metricas-vendas | Núcleo de `src/server/metrics/`: faturamento bruto/líquido, ticket, quantidade por loja/vendedor/período, com drill-down (ADR-012) | m06a, m08 | SENSÍVEL | A | - | m14 |
| 25 | m32a-calendario-empresa | Feriados por empresa/loja (`extraHolidays` do m01) e dias de trabalho da loja | m01 | SENSÍVEL | A | sim | m14 |
| 26 | m32b-telas-calendario | Telas do calendário | m32a | BAIXO | B | - | m10a |
| 27 | m10a-vendedores | Vendedor ↔ membro e escala por dias úteis | m32a | SENSÍVEL | A | sim | m32b |
| 28 | m10b-telas-vendedores | Telas de vendedores e escalas | m10a | SENSÍVEL | I | - | m11a |
| 29 | m11a-metas | Metas por escopo e período, versionadas, progresso pelo m16a | m10a, m16a | SENSÍVEL | A | sim | m10b |
| 30 | m11b-telas-metas | Telas de metas | m11a | SENSÍVEL | I | - | m12a |
| 31 | m12a-comissoes | Regras versionadas e apuração (estimada → apurada → aprovada → paga, estorno por devolução) | m08, m11a | SENSÍVEL | A | sim | m11b |
| 32 | m12b-telas-comissoes | Telas de comissões | m12a | SENSÍVEL | I | - | m35a |
| 33 | m35a-campanhas | Campanhas por período, produtos/categorias e bônus que entra na apuração | m12a | SENSÍVEL | A | sim | m12b |
| 34 | m35b-telas-campanhas | Telas de campanhas | m35a | SENSÍVEL | I | - | m33 |
| 35 | m33-dispositivos-fila | Pareamento do tablet com a loja e PIN do vendedor (ADR-011) | m10a | SENSÍVEL | A | sim | m35b |
| 36 | m13a-fila | Fila e eventos, distribuição (rodízio, especialidade, setor, manual com motivo), vínculo com venda, conversão com denominador documentado | m06a, m10a, m33 | SENSÍVEL | A | sim | - |
| 37 | m13b-telas-fila | Tela do tablet da entrada e visão do gerente | m13a | SENSÍVEL | I | - | m34 |
| 38 | m34-app-vendedor | Visões de celular: meu desempenho, metas, comissões estimadas, meus atendimentos | m11a, m12a, m13a, m16a | SENSÍVEL | I | - | m13b |
| **M3** | marco | Idem M2 para a fase; conversão reprodutível em teste | | | | | |

#### Fase 4 — BI, relatórios e financeiro
| # | ID | Responsabilidade | Depende de | Risco | Nível | Tab | ∥ |
|---|----|------------------|------------|-------|-------|-----|---|
| 39 | m36a-despesas | Despesas por loja, período e categoria; permissões financeiras | - | SENSÍVEL | A | sim | - |
| 40 | m36b-telas-despesas | Telas de despesas | m36a | SENSÍVEL | I | - | m37a |
| 41 | m37a-conciliacao-fechamento | Conciliação com o retorno do provedor e fechamento diário por loja | m07, m05a | SENSÍVEL | A | sim | m36b |
| 42 | m37b-telas-financeiro | Telas de conciliação e fechamento | m37a | SENSÍVEL | I | - | m16b |
| 43 | m16b-metricas-completas | Margem (custo do snapshot), lucro (só com despesas), conversão, comissões; teste de consistência entre canais | m16a, m12a, m13a, m36a | SENSÍVEL | A | - | m37b |
| 44 | m17-dashboards-ui | Dashboards por perfil, comparação de períodos e lojas, drill-down, gráficos SVG próprios (ADR-020) | m16b | BAIXO | I | - | m18 |
| 45 | m18-relatorios | Central, filtros, exportação CSV (XLSX/PDF só com dependência aprovada, ADR-019), agendamento, histórico | m16b | SENSÍVEL | A | sim | m17 |
| **M4** | marco | Mesmo indicador, mesmo valor em todos os canais (teste com conjunto conhecido) | | | | | |

#### Fases 5 a 8
| # | ID | Responsabilidade | Depende de | Risco | Nível | Tab | ∥ |
|---|----|------------------|------------|-------|-------|-----|---|
| 46 | m20-ia-adaptador | Porta de provedor de modelo, registro de uso e custo; sem provedor configurado = "pendente", nada simulado | m16b | SENSÍVEL | A | sim | - |
| 47 | m21-ia-ferramentas | Ferramentas sobre métricas, agente central, bloqueio de ferramentas não autorizadas e de prompt injection | m20 | SENSÍVEL | A | sim | - |
| 48 | m22-ia-chat-ui | Interface conversacional com fontes e limitações visíveis | m21 | BAIXO | I | - | m23a |
| **M5** | marco | Testes com números conhecidos; bloqueios de ferramenta e de injeção | | | | | |
| 49 | m23a-alertas | Regras proativas determinísticas, severidade, responsável e resolução | m16b | SENSÍVEL | A | sim | m22 |
| 50 | m23b-telas-alertas | Telas de alertas | m23a | SENSÍVEL | I | - | m38a |
| 51 | m38a-tarefas | Tarefas, eventos e procedimentos; recomendação vira tarefa só por ação humana | m23a | SENSÍVEL | A | sim | m23b |
| 52 | m38b-telas-tarefas | Central de tarefas | m38a | SENSÍVEL | I | - | m39 |
| 53 | m39-multiagente | Especialistas acionados pelo orquestrador só com benefício medido | m21, m23a, m38a | SENSÍVEL | A | - | m38b |
| **M6** | marco | | | | | | |
| 54 | m24a-escritorio-estado | Estados derivados das execuções reais, SSE por empresa com autorização por evento | m21, m23a | SENSÍVEL | A | - | - |
| 55 | m24b-escritorio-2d | Salas e personagens 2D, painel do agente, visão em lista acessível | m24a | SENSÍVEL | A | - | - |
| **M7** | marco | Critérios de [virtual-office.md](virtual-office.md) com dados reais | | | | | |
| 56 | m40-limites-consumo-plano | Consumo medido por plano e tela de uso | m20 | SENSÍVEL | A | sim | m42 |
| 57 | m25-observabilidade | Erros, latência, consultas lentas e custo de IA por organização | m20 | SENSÍVEL | A | - | m42, m43 |
| 58 | m41-backup-restauracao | Procedimento, workflow e teste de restauração em banco descartável | - | SENSÍVEL | A | - | m42, m43 |
| 59 | m42-testes-carga | Testes de carga dos fluxos críticos | M7 | BAIXO | I | - | m40, m25, m41 |
| 60 | m15-pwa-offline-cache | Service worker e cache, só se fila/PDV exigirem; senão registrado como não feito | m14 | SENSÍVEL | A | - | - |
| 61 | m43-docs-implantacao | Documentação de implantação e operação | M7 | BAIXO | B | - | m25, m41 |
| **M8** | marco | Relatório final e publicação (prompt mestre, seções 10 e 11) | | | | | |

Risco **SENSÍVEL** = auth, autorização, pagamentos, criptografia, migrações destrutivas, segredos, entrada externa não confiável, integrações com terceiros. Esses módulos não vão para o worker gratuito. Neste projeto também contam como SENSÍVEL: **tabelas com RLS**, **dinheiro**, **estoque**, **dados pessoais** e qualquer coisa que toque `src/db/**`, `drizzle/**` ou os módulos `authz`, `audit`, `plans`, `members`, `platform` e `inventory` (lista aplicada pelo gate em `tools/gate/gate.config.json`). Telas SENSÍVEIS de nível I seguem o ADR-008: o Maestro revisa à mão os `actions.ts` mesmo com o gate em `PASS`.

Fora do mapa por dependerem de decisão externa registrada em [PRODUCT.md](../PRODUCT.md#hipóteses-e-pendências): e-mail transacional, provedores de pagamento/fiscal/IA, hospedagem e cobrança. O módulo que usa cada um fica bloqueado até a decisão.

**Pendência de produção (m01, ver ADR-003):** a lista de feriados nacionais fixos do contrato `m01-dias-uteis` precisa de confirmação profissional antes de produção. Até lá o módulo pode ser implementado e testado, mas nenhum módulo que dependa dele (m10, m11, m12) vai para produção com a lista sem confirmar.

**Dados de referência: feriados de Araruama/RJ** (pesquisa de 21/10/2026 em fontes oficiais). Não fazem parte do código do m01: entram como `extraHolidays` pelo chamador, pela configuração de calendário por empresa/loja (m32a). Ponto facultativo **não** é feriado e não entra em `extraHolidays` por padrão; a decisão de dar folga é da empresa.

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
- ADR-008: cada área sensível se divide em `a` (back-end: tabela, serviço, permissões, auditoria e testes de integração; nível A) e `b` (telas sobre o serviço já integrado com a suíte verde; nível I, com revisão manual do Maestro nos `actions.ts`). Caixa, PDV e escritório virtual ficam em nível A também na tela — por quê: o risco está no serviço, e a tela que só chama o serviço não decide regra; no caixa e no PDV a tela guarda estado de operação e a chave de idempotência — alternativa descartada: um módulo grande por área, todo em nível A (custo e fila única).
- ADR-009: registros compartilhados têm dono único. `src/components/shell/nav.ts` e `NAV_PERMISSIONS` de `src/server/shell.ts` são editados só pelo Maestro na integração, a partir do m03 (o contrato descreve as linhas). `permissions.ts`, `system-roles.ts`, `audit/labels.ts`, `audit/service.ts`, `plans/entitlements.ts`, `db/schema/index.ts` e `drizzle/` só pela faixa A — por quê: são os arquivos que mais geram conflito entre módulos paralelos — alternativa descartada: cada módulo edita o menu e o catálogo de permissões.
- ADR-010: migrações em série. Só uma migração aberta por vez na faixa A, gerada (`pnpm db:generate`) sobre o HEAD já integrado; cada tabela nova traz `tenantIsolationPolicy()` (ou as políticas de somente inserção), `UNIQUE (organization_id, id)`, FKs compostas e `FORCE ROW LEVEL SECURITY` numa migration custom no mesmo módulo; o número sai na geração. O contrato informa a **ordem** da migração na fila A — por quê: dois módulos gerando migrações em paralelo colidem no `_journal.json` e nos snapshots — alternativa descartada: numerar no contrato.
- ADR-011: tablet da fila. O gerente gera na loja um código de pareamento de uso único e curta validade; o tablet o troca por um token de aparelho guardado só como hash (como as sessões), vinculado à loja e revogável; a sessão do aparelho só executa ações da fila. O vendedor se identifica por PIN próprio (hash scrypt, limite de tentativas por aparelho e por vendedor). Nenhuma tela de gestão abre no tablet — por quê: aparelho compartilhado na entrada da loja; PIN sozinho não identifica a loja e login completo no tablet expõe a sessão do gerente — alternativas descartadas: só PIN; login de usuário no tablet.
- ADR-012: métricas incrementais. O m16a cria `src/server/metrics/` antes da Fase 3 e todo número exibido (metas, app do vendedor, dashboards, relatórios, IA) vem de lá; o m16b completa margem, lucro e conversão — por quê: metas e app do vendedor precisam de faturamento antes da Fase 4, e duas fórmulas divergem — alternativa descartada: cada módulo calcular o próprio número até a Fase 4.
- ADR-013: idempotência da venda. O cliente gera uma chave UUID ao abrir a finalização e a reenvia em toda retentativa; `UNIQUE (organization_id, key)` com o resultado gravado na mesma transação da venda; retentativa devolve a mesma venda; sem retry automático de operação financeira — por quê: queda de rede entre o servidor e o PDV não pode duplicar venda — alternativa descartada: deduplicar por conteúdo do carrinho.
- ADR-014: número da venda sequencial por loja, de uma linha contadora travada com `FOR UPDATE` na mesma transação da venda; só venda gravada consome número (retentativa idempotente não consome) — por quê: sequência do PostgreSQL pula números em rollback e não é por loja — alternativa descartada: `sequence` global.
- ADR-015: reserva e trânsito. `inventory_balances` ganha `reserved` e `in_transit`, mantidos só pelo serviço de estoque; disponível = `quantity - reserved`; reservas ficam em `inventory_reservations` (origem transferência ou venda) e `reserved` é a soma das ativas; o despacho de transferência consome a reserva, lança `exit` na origem e soma ao trânsito do destino; o recebimento tira do trânsito e lança `entry` no destino; diferença no recebimento fica registrada no item da transferência com motivo obrigatório (não entra em saldo de loja). Sem tipos novos no enum do livro: os movimentos citam o número da transferência e os itens guardam os ids dos movimentos — por quê: saldo derivado do livro continua a única verdade, e reserva não é movimento físico — alternativa descartada: tabela de reservas separada somada em toda consulta.
- ADR-016: custo. `sale_items` guarda o preço e o custo vigentes no momento da venda (snapshot); custo de reposição = último custo de entrada, gravado em `product_costs` pelo recebimento de compra; custo médio fica fora até haver pedido — por quê: margem histórica não pode mudar quando o custo muda — alternativa descartada: calcular margem com o custo atual.
- ADR-017: clientes e LGPD. Campos mínimos (nome, e-mail e telefone opcionais, CPF opcional normalizado e único por empresa quando informado, consentimento de contato); o CPF aparece mascarado sem `customers.documents.read` e nunca vai para log; retenção e exclusão a pedido do titular são pendência de produto registrada — por quê: minimização e o que o PDV precisa para identificar o comprador — alternativa descartada: cadastro completo com endereço desde o início.
- ADR-018: recursos por plano. Os módulos usam as chaves já semeadas em `plan_features` (`pos`, `inventory`, `basic_reports`, `targets_commissions`, `service_queue`, `advanced_reports`, `alerts`, `ai_assistant`, `ai_reports`, `multi_store`, `regional_consolidation`) e chamam `assertFeature`; chave nova só por migração e registro em `entitlements.ts`; o consumo medido é do m40 — por quê: regra comercial num lugar só — alternativa descartada: checar o plano por nome no módulo.
- ADR-019: CSV sai e entra sem dependência nova; XLSX e PDF só com dependência aprovada pelo Arquiteto no contrato do m18/m19, registrada em `docs/setup.md` — por quê: cadeia de suprimentos e tamanho do bundle — alternativa descartada: adotar uma biblioteca de planilhas já no m19.
- ADR-020: gráficos em componentes SVG próprios (`src/components/charts/`), seguindo a skill `dataviz` e os tokens do tema — por quê: sem dependência nova, identidade visual controlada, acessibilidade (tabela alternativa) — alternativa descartada: biblioteca de gráficos de terceiros.

## 3. Modelo de ameaças
O modelo geral e as camadas implementadas estão em [security.md](security.md#modelo-de-ameaças-considerado). A tabela cobre **só as superfícies novas** dos módulos restantes.

| Superfície | Ameaça | Mitigação obrigatória | Módulo |
|------------|--------|-----------------------|--------|
| Tabelas novas por empresa | Leitura/escrita entre empresas | `organization_id`, `tenantIsolationPolicy()`, `UNIQUE (organization_id, id)`, FKs compostas, `FORCE ROW LEVEL SECURITY`, teste de isolamento por módulo | todos os módulos com Tab |
| Telas e Server Actions | IDOR e acesso sem permissão | `requireTenantContext()` na página e na ação; id fora do escopo = "não encontrado"; permissão checada no serviço | m02a, m02b, m03, m04, todos os `b`, m17, m22 |
| Configuração operacional | Teto de desconto ou exigência de cliente alterados por quem não pode; mudança sem rastro | Permissão `settings.operations.manage` só para dono/administrador, escopo de loja, auditoria com valor anterior e novo | m27 |
| Dados de clientes (LGPD) | Coleta excessiva, CPF exposto em tela ou log, enumeração de clientes | Campos mínimos (ADR-017), CPF mascarado sem permissão, busca paginada com limite, nada pessoal em log | m28a, m28b, m19 |
| Compras e recebimento | Entrada de estoque e custo forjados ou duplicados; recebimento acima do pedido | Recebimento só contra pedido aprovado, na mesma transação do livro e do custo; quantidade recebida ≤ pendente (excesso recusado; pendência encerrada só por quem aprova, com motivo); idempotência por chave de recebimento | m29a |
| Transferências e reservas | Saldo "criado" no destino sem saída na origem; reserva presa | Despacho e recebimento em transações únicas com trava das duas linhas de saldo em ordem fixa; reserva com dono e liberação explícita | m30a, m06a |
| Despesas e conciliação | Lançamento financeiro alterado sem rastro; conciliação marcando pago o que não foi | Somente inserção com estorno por novo lançamento; conciliação só com dado do provedor ou conferência manual com responsável | m36a, m37a |
| Backup e restauração | Cópia com dados de clientes exposta; restauração sobre produção | Cópia cifrada no provedor do banco, teste de restauração só em banco descartável, nenhum dump no repositório | m41 |
| Custos de produto | Vazamento a quem não tem `catalog.costs.read` | Custo fora do DTO sem a permissão; tela só pede o campo quando autorizada | m03, m16 |
| Finalização de venda e pagamento | Duplicidade por retentativa ou corrida | Chave de idempotência por finalização, transação única com baixa de estoque, sem retry automático de operação financeira | m06, m07, m08 |
| Webhook de pagamento | Confirmação forjada ou repetida | Assinatura/autenticação do provedor verificada, idempotência por id do evento, confirmação só por webhook autenticado ou consulta ao provedor | m07 |
| Caixa | Divergência escondida, reabertura sem autorização | Permissão específica, justificativa obrigatória, auditoria; fechamento aponta divergência | m05 |
| Comissões e metas | Alteração silenciosa de histórico | Regras versionadas, estados imutáveis após aprovação, estorno por devolução registrado | m11, m12 |
| Importação (CSV/XLSX) | Arquivo malicioso, volume excessivo, dados de outra empresa | Limite de tamanho e linhas, parsing validado por schema, prévia antes de gravar, escopo da empresa no servidor | m19 |
| Exportação (CSV/XLSX/PDF) | Injeção de fórmula na planilha; dados fora do escopo | Escapar células que começam com `=`, `+`, `-`, `@`; exportar só o escopo do solicitante | m18 |
| IA e provedor | Prompt injection, dados demais enviados, custo sem limite | Ferramentas determinísticas autorizadas no backend, envio mínimo, limite e registro de uso por plano, credenciais só no servidor | m20, m21 |
| PWA e tablet da fila | Dados autenticados em cache de aparelho compartilhado; identificação do vendedor | Manifesto sem cache até o ADR-006; tablet pareado com a loja por código de uso único, token do aparelho só como hash, sessão restrita à fila e PIN do vendedor com limite de tentativas (ADR-011) | m14, m15, m33, m13a |
| SSE do escritório virtual | Eventos de uma empresa entregues a outra | Canal por empresa, autorização na conexão e a cada evento, estados só de execuções registradas | m24 |
| Logs e observabilidade | Dados pessoais e segredos em log | Pino sem corpo completo, HMAC para identificadores, nenhum segredo | m25 e todos |
| Dependências novas | Cadeia de suprimentos | Sem dependência sem aprovação; gate reprova `package.json`/lockfile alterado | todos |

## 4. Contratos de módulo
Um arquivo por módulo em `docs/contracts/<id>.md`, a partir de [_TEMPLATE.md](contracts/_TEMPLATE.md). Contrato incompleto = módulo não pode ser delegado.

| Contrato | Estado |
|----------|--------|
| [m01-dias-uteis](contracts/m01-dias-uteis.md) | v2 · integrado (5052d8f) |
| [m02a-telas-categorias-marcas](contracts/m02a-telas-categorias-marcas.md) | v1 · reconfirmado pelo Arquiteto · em implementação (Antigravity) |
| [m02b-telas-fornecedores](contracts/m02b-telas-fornecedores.md) | v1 · reconfirmado pelo Arquiteto · aguarda o m02a |
| [m26-estados-interface](contracts/m26-estados-interface.md) | v1 · lote 1 · pronto para delegar (I) |
| [m27-config-operacional](contracts/m27-config-operacional.md) | v1 · integrado (5b16c4c) |
| [m03-telas-produtos](contracts/m03-telas-produtos.md) | v1 · lote 1 · pronto para delegar (I) depois do m02b |
| [m28a-clientes](contracts/m28a-clientes.md) | v2 · 2ª migração da fila A · implementado, em verificação do Maestro |
| [m04-telas-estoque](contracts/m04-telas-estoque.md) | v1 · lote 1 · pronto para delegar (I) depois do m03 |
| [m29a-compras](contracts/m29a-compras.md) | v1 · integrado (77c217a) |
| [m28b-telas-clientes](contracts/m28b-telas-clientes.md) | v1 · lote 2 · pronto (I) depois do m28a |
| [m30a-transferencias-reservas](contracts/m30a-transferencias-reservas.md) | v2 · integrado |
| [m06a-pdv-vendas](contracts/m06a-pdv-vendas.md) | v1 · integrado (2bd28c2) |
| [m30b-telas-transferencias](contracts/m30b-telas-transferencias.md) | v1 · lote 3 · pronto (I) depois do m30a, m29b e m04 |
| [m05b-telas-caixa](contracts/m05b-telas-caixa.md) | v1 · lote 3 · pronto (A) depois do m05a |
| [m06b-pdv-tela](contracts/m06b-pdv-tela.md) | v1 · lote 3 · pronto (A) depois do m06a, m05b e m28b |
| [m06c-telas-vendas](contracts/m06c-telas-vendas.md) | v1 · lote 3 · pronto (I) depois do m06a |
| [m07-pagamentos](contracts/m07-pagamentos.md) | v2 · 7ª migração · implementado, em verificação do Maestro |
| [m09-fiscal-interface](contracts/m09-fiscal-interface.md) | v1 · lote 4 · pronto (A) · 8ª migração da fila A |
| [m08-cancelamentos](contracts/m08-cancelamentos.md) | v1 · lote 4 · pronto (A) · 9ª migração da fila A |
| [m31-inventario-lote](contracts/m31-inventario-lote.md) | v1 · lote 4 · pronto (A) · 10ª migração da fila A |
| [m19-importacao](contracts/m19-importacao.md) | v1 · lote 4 · pronto (A) · 11ª migração da fila A |
| [m29b-telas-compras](contracts/m29b-telas-compras.md) | v1 · lote 2 · pronto (I) depois do m29a, m03 e m04 |
| [m05a-caixa](contracts/m05a-caixa.md) | v1 · integrado (0065a87) |
| Demais | Não escritos; o Arquiteto escreve por lotes na ordem da coluna **#** |

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
| 4 | 21/10/2026 | m02-telas-cadastros | Primeiro contrato de módulo de telas (categorias, marcas e fornecedores) | Próximo módulo BAIXO do mapa |
| 5 | 21/10/2026 | m02a, m02b | O contrato m02 foi dividido em m02a (categorias e marcas) e m02b (fornecedores); a pré-condição de integração do catálogo verde, o texto fixo, o `FormAction` do hook, as regras de `"use server"` e as interfaces dos diálogos de fornecedor foram especificados | Revisão do Arquiteto (Opus): ajustes 1 a 9 |
| 6 | 21/10/2026 | SPEC, m26, m27, m03, m28a, m04 | Mapa completo das Fases 2 a 8 (61 módulos, níveis B/I/A, marcos M2 a M8), ADR-008 a ADR-020, ameaças novas e contratos do lote 1 | Plano do Arquiteto aceito pelo Maestro (prompt mestre, seção 6) |
| 7 | 22/10/2026 | m28a-clientes (v2) | Allowlist ampliada com `tests/integration/roles.test.ts`, só para a lista esperada de permissões do Vendedor (inclui `customers.read` e `customers.manage`) | O teste fixava as permissões antigas do perfil do sistema; o que ele prova (perfil imutável, sem exclusão, sem linhas em `role_permissions`) não muda |
| 8 | 22/10/2026 | m29a, m28b, m30a, m29b, m05a; ADR-015 | Contratos do lote 2; ADR-015 detalhado (reservas em tabela própria, despacho/recebimento com `exit`/`entry` sem tipos novos no enum, divergência registrada no item); ameaça de compras ajustada (excesso recusado) | Plano do Arquiteto; enum novo não pode ser usado num CHECK na mesma transação de migração |
| 9 | 22/10/2026 | m30a-transferencias-reservas (v2); m06a, m30b | Allowlist do m30a ampliada com `src/server/inventory/transfer-queries.ts` (leitura de transferências separada para respeitar o teto de 350 linhas); contratos m06a e m30b do lote 3 | Teto de linhas; plano do Arquiteto |
| 10 | 22/10/2026 | m07, m09, m08 | Contratos do lote 4: pagamentos por porta com intenção confirmada só por webhook autenticado ou consulta (sem provedor real ligado), interface fiscal sem emissão, cancelamento e devolução com estorno e retorno ao estoque | Plano do Arquiteto; ADR-005 |
| 11 | 22/10/2026 | m07-pagamentos (v2); m31, m19 | m07: `src/proxy.ts` na allowlist só para tornar público o prefixo `/api/pagamentos/webhook`; tabela global `payment_provider_references` (só ids) no lugar da função `SECURITY DEFINER`; webhook resolve o provedor e o tamanho declarado antes de ler o corpo e lê em stream limitado a 64 KB (achado da revisão do Maestro). Contratos m31 e m19 | Com FORCE RLS a função não enxergaria as intenções sem `BYPASSRLS`; rota pública não pode ler corpo ilimitado |
