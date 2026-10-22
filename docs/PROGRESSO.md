# Progresso do desenvolvimento autônomo

Resumo das etapas concluídas até **22/10/2026**, no commit `f448b9b` da branch `build/fases-1-8` (enviada ao GitHub). **Nada foi mesclado na `main` nem publicado.** O plano completo é o [SPEC](SPEC.md) (61 módulos, 8 fases); o registro de decisões é o [DECISIONS](DECISIONS.md); o estado por fase continua no [roadmap](roadmap.md).

## 1. Resumo em números
- **Módulos concluídos do SPEC:** 37 de 61.
- **Migrações novas:** 0005 a 0046, todas com RLS forçado.
- **Testes verdes do último módulo integrado (m18):** 375 unitários e **231 de integração** (PostgreSQL real, `varejo_test`).
- **Contratos escritos:** um por módulo em `docs/contracts/`.
- **Ainda sem verificação manual no navegador** (celular, perfis, acessibilidade): fica para o marco de cada fase.

## 2. Etapas concluídas

| Etapa | Commit | O que entrega | Verificação |
|---|---|---|---|
| Back-end de catálogo e estoque (Fase 2, incremento 1) | `d2cedd8` | Produtos, variações, categorias, marcas, fornecedores, histórico de preço e custo, livro de estoque e saldo por loja (migrações 0005/0006) | Integração 115/115 no PostgreSQL; um defeito real achado e corrigido (preço e custo vinham `null` na leitura) |
| Kit modular (gate, contratos, protocolo) | `b48b6d3`, `7a69ba6` | `tools/gate/`, templates, SPEC com mapa de módulos, ADRs e modelo de ameaças | Gate validado em cenários (PASS, REVIEW, FAIL) |
| **m01 dias úteis** | `5052d8f` | Biblioteca pura de calendário: dia útil, Páscoa, contagem e lista de dias úteis | 74 testes, 3 fusos, gate PASS |
| Dados de feriados de Araruama/RJ | `6ae64f1` | Referência no SPEC (Corpus Christi como ponto facultativo, divergência com a Lei 2709/2025 mantida) | Fontes oficiais citadas; pendente de confirmação profissional |
| Infraestrutura de testes e gate | `ac79fd4`, `da0f21e` | Banco `varejo_test` local, `with-test-db.ps1` (só `varejo_test` em localhost, com **trava exclusiva** contra suítes simultâneas), gate roda a integração em arquivo sensível | 115 e depois 152 testes |
| **m02a categorias e marcas** | `015a53b` | Telas e seção "Catálogo" no menu; filtro de situação, diálogos compartilhados | Gate isolado PASS; build compila as rotas |
| **m27 regras de operação** (1ª migração) | `5b16c4c` | Cliente na venda, teto de desconto e textos do comprovante por empresa e loja (migrações 0007/0008, permissão `settings.operations.manage`) | Gate PASS+REVIEW; revisão de segurança própria |
| **m02b fornecedores** | `7a29ffb` | Tela com busca por nome, situação e paginação | Gate isolado PASS |
| **m28a clientes** (2ª migração) | `7a9c5ab` | Cadastro de clientes com CPF mascarado no servidor, auditoria mascarada, permissões `customers.*` (0009/0010) | PASS+REVIEW; **defeito achado na revisão** (máscaras iguais descartavam edições) corrigido com teste |
| **m44 teste de autenticação estável** | `82d56b9` | Tentativas sem `.catch` que escondia erros, IPs determinísticos, mesma cobertura e limites | 130/130; arquivo 3 vezes mais rápido |
| **m29a compras** (3ª migração) | `77c217a` | Pedidos, recebimento contra pedido (entrada no livro e custo de reposição na mesma transação, idempotente por chave), contador de documentos (0011/0012) | PASS+REVIEW, 142 testes; revisão do recebimento |
| **m30a transferências e reservas** (4ª migração) | `d247855` | Transferências (solicitada → aprovada → em trânsito → recebida/cancelada), reservas, colunas `reserved` e `in_transit`, regra "saldo nunca abaixo do reservado" (0013/0014) | PASS+REVIEW, 152 testes |
| **m05a caixa** (5ª migração) | `0065a87` | Caixas, sessões e livro de dinheiro só de inserção (0015/0016); uma sessão aberta por caixa e por operador; esperado sempre somado do livro no servidor; diferença exige justificativa; reabertura autorizada | PASS+REVIEW, 163 testes; revisão do livro e do ciclo da sessão |
| **m06a PDV: vendas e vendas suspensas** (6ª migração) | `2bd28c2` | Venda completa numa transação: preço do servidor (conflito se mudou), desconto com teto e permissão, pagamentos que somam exato, estoque e caixa atômicos, numeração por loja, snapshot de preço e custo, idempotência por chave; suspensão com reserva de estoque, retomada por outro operador e descarte com motivo (0017/0018) | PASS+REVIEW, 175 testes; revisão de `complete.ts` e `suspend.ts` |
| **m26 estados de interface** | `ff09b79` | Skeleton, tela de carregamento e limites de erro com tentar de novo e sem vazar detalhe | Gate PASS isolado; build compila |
| m07 pagamentos | `c57e919` | Pagamentos por porta PaymentProvider, confirmação só por webhook assinado ou consulta ao provedor, sem provedor real nem simulação de confirmação. | gate PASS+REVIEW (185 testes de integração) |
| m09 fiscal | `a07197d` | Interface fiscal com porta FiscalProvider: documento sem provedor fica como não configurado e nada fiscal é emitido ou inventado. | gate PASS+REVIEW (189 testes de integração) |
| m03 produtos | `0eeb2ed` | Telas de produtos com variações, preço e custo, com custo renderizado só no servidor para quem tem permissão. | gate PASS, 193 testes de integração e build compila 4 rotas |
| m04 estoque | `0a4015e` | Saldos por loja e produto, livro de movimentos e lançamentos manuais sobre o serviço de estoque. | gate PASS e build compila 3 rotas |
| m08 cancelamentos | `07aaa2a` | Cancelamento de venda com estorno por método de pagamento, devolução por itens com limite de 90 dias e venda travada por idempotência. | gate PASS+REVIEW (203 testes de integração) |
| m28b clientes | `374b8b3` | Telas de clientes com busca, filtro de situação, criação, edição e ativação/desativação, com CPF mascarado sem permissão de documentos. | gate PASS e build compila a rota |
| m29b compras | `2ea3d47` | Telas de pedidos de compra com aprovação, cancelamento, fechamento e recebimento de mercadoria com chave de idempotência. | gate PASS e build compila 5 rotas |
| m30b transferências | `392169f` | Telas de transferência entre lojas com solicitação, aprovação, despacho, recebimento com motivo de divergência e saldos reservado e em trânsito. | gate PASS e build compila 3 rotas |
| m31 contagem | `3769972` | Contagem de estoque por lote (cega ou não), aprovação e ajuste em lote no livro, com tela de folha de contagem. | gate PASS, build e teste manual no navegador |
| m06c histórico de vendas | `1fa40cf` | Telas de histórico de vendas com filtros, detalhe da venda, itens, pagamentos e devoluções, e reimpressão do comprovante. | gate PASS e build compila 2 rotas |
| m14 manifesto PWA | `a216e91` | Manifesto da app instalável sem service worker, ícones da marca e cor do tema, nada autenticado em cache. | gate PASS e build de produção com rota estática |
| m19 importação (etapa 1) | `00e8079` | Back end de importação CSV de produtos, clientes e saldo inicial com leitura restrita, prévia de linhas e confirmação em lotes. | gate PASS+REVIEW (213 testes de integração) |
| m19 importação (etapa 2) | `6018ad8` | Telas de importação guiada com mapeamento de colunas, prévia com problemas por linha e histórico de importações. | gate PASS em árvore isolada e ações revisadas manualmente |
| m05b caixa | `b41a569` | Telas de caixa: abertura com valor, suprimentos e sangrias, fechamento com cota cega, sessões e reabertura de gerente. | gate PASS em árvore isolada |
| m06b PDV | `a30714a` | Tela de PDV de código de barras e teclado, carrinho, desconto autorizado, pagamento misto, vendas suspensas e comprovante de 80 mm. | gate PASS e tela e ações revisadas manualmente |
| m32a calendário empresa | `b524ad4` | Feriados e dias úteis por empresa e loja, semana de trabalho da loja e opções de calendário para a biblioteca de dias úteis. | gate PASS+REVIEW (215 testes de integração) |
| m32b telas calendário | `9a09258` | Visão anual do calendário de empresa e loja, feriados e dias opcionais e formulário de semana de trabalho da loja. | gate PASS e ações revisadas manualmente |
| m10a vendedores | `3955db4` | Cadastro de vendedores, vínculo com lojas e escalas de trabalho; PDV só aceita vendedor ativo da loja quando há cadastro. | gate PASS+REVIEW (218 testes de integração) |
| m11a metas | `0539765` | Metas por escopo e período com versões, progresso sobre faturamento líquido e projeção de dias úteis do mês. | gate PASS+REVIEW (223 testes de integração) |
| m12a comissões | `5c94369` | Regras versionadas de comissão e apuração mensal com estados estimada, calculada, aprovada, paga e cancelada. | gate PASS+REVIEW (224 testes de integração) |
| m13a fila | `ed4f836` | Fila de atendimento por loja com senha diária, distribuição por rodízio, atribuição manual e perfil de Recepção. | gate PASS+REVIEW (225 testes de integração) |
| m33 pareamento tablet | `a2f51ef` | Pareamento de tablet da fila com código de uso único, token do aparelho como hash e PIN de seis dígitos com limite de tentativas. | gate PASS+REVIEW (227 testes de integração) |
| m36a despesas | `e92f1bb` | Despesas por categoria, loja e mês de competência em centavos, abertas, pagas ou canceladas com motivo. | gate PASS+REVIEW (228 testes de integração) |
| m37a conciliação e fechamento | `89ba93b` | Fechamento diário por loja e conciliação de pagamentos com o provedor, com divergências registradas e sem duplicar versão. | gate PASS+REVIEW (229 testes de integração) |
| m16a métricas de vendas | `3a71081` | Serviço único de métricas de vendas: faturamento bruto/líquido, ticket, quantidade, séries e drill-down por loja, vendedor e período. | gate PASS (220 testes de integração) |
| m16b métricas completas | `af0e010` | Métricas completas com margem pelo custo do snapshot, lucro com despesas, conversão pela fila e comissões do período, campos bloqueados como null. | gate PASS+REVIEW (230 testes de integração) |
| Planejamento | `2eaf3b5`, `4a08335`, `fe7f9d6` | SPEC v8 com 61 módulos, ADR-008 a ADR-020, contratos dos lotes 1 e 2 e do m14 | Revisões do Arquiteto (Opus) |

## 3. Como a esteira funciona
- **Roteamento:** nível básico = Antigravity, intermediário = Codex, avançado = Opus (dono do SPEC e das migrações, uma por vez). Hoje o Antigravity está sem cota (volta por volta de 27/10/2026) e o básico foi para o Codex ([DECISIONS](DECISIONS.md)).
- **Verificação:** cada módulo é verificado **numa cópia limpa do repositório** com o gate sem modificação, porque vários agentes escrevem na mesma árvore. Módulos que tocam banco rodam a suíte de integração pela trava. A revisão de segurança dos arquivos sensíveis é feita à mão, com o [REVIEW-CHECKLIST](REVIEW-CHECKLIST.md).
- **Commit:** só o Maestro mexe no Git, sempre pelos caminhos da allowlist do contrato.

## 4. Achados que a revisão evitou de ir para produção
1. Preço e custo atuais retornavam `null` na leitura de produto (subconsulta correlacionada sem prefixo).
2. Edição de cliente descartada em silêncio quando e-mail, CPF ou telefone novos tinham a mesma máscara dos antigos.
3. Teste de limite de tentativas de login engolia erros de infraestrutura; execuções simultâneas da suíte derrubavam 12 testes.
4. Mudanças pedidas ao próprio gate (ignorar arquivos de outros módulos) foram recusadas: a verificação passou a ser isolada, sem enfraquecer o gate.

## 5. Em andamento e bloqueios
- **Em andamento:** Opus faz a faixa de back-end A; Codex as telas; OpenCode documentação.
- **Backlog do m06a (não bloqueia):** suspender não é idempotente; a lista de suspensas faz uma consulta por linha; vendas suspensas não expiram e seguram estoque reservado; venda sem saldo é recusada (regra de "vender sem saldo" é decisão de produto).

## 6. Riscos e pendências que dependem de você
- **Feriados:** a lista nacional e os dados de Araruama precisam de confirmação contábil/jurídica antes de produção; Corpus Christi está como ponto facultativo no decreto de 2026, mas a Lei 2709/2025 o institui como feriado.
- **LGPD:** retenção e anonimização de clientes a pedido do titular continuam pendência de produto; qualquer membro com `customers.read` vê todos os clientes da empresa (ADR-017); a busca por CPF exato não tem limite de taxa.
- **Reservas de venda** (m06a) não expiram sozinhas nesta versão; a divergência de recebimento de transferência não vira perda automática (precisa do relatório do m18).
- **Credenciais e integrações reais:** provedor de pagamento (PIX e cartão), fiscal, e-mail, IA, Vercel e Neon, domínio. Nenhum foi simulado; dependem de você.
- **Publicação:** nada foi publicado nem mesclado na `main`.
- **Verificação visual e de acessibilidade, e testes e2e**, ainda não executados nesta rodada.

## 7. Próximos passos
1. Telas: m10b (vendedores), m11b (metas), m12b (comissões), m13b (fila), m34 (app do vendedor), m18 (relatórios), m20 a m23 (IA), m38 (tarefas), m17 (dashboards), m24 (escritório virtual), m25 (observabilidade) e m39 a m43 (multiagente, consumo, backup, cargas, docs).
2. Marco de verificação da Fase 2: navegador, e2e e revisão visual.

## 8. Como retomar
- Estado real: `git log --oneline`, [SPEC](SPEC.md) (mapa e ADRs), [DECISIONS](DECISIONS.md) e `.maestri/progress.json` (não versionado).
- Banco de teste: `pwsh -NoProfile -File tools/gate/with-test-db.ps1 corepack pnpm test:integration` (credenciais em `.env.test-db.local`, ignorado pelo Git; ver [quality](quality.md)).
- Gate de um módulo: `pwsh -NoProfile -Command "& tools/gate/gate.ps1 -Module <id> -Allowed @(...)"` com a allowlist do contrato; repetir numa cópia limpa (`git worktree add --detach`) quando houver trabalho de outros agentes na árvore.
- Prompt mestre: `C:\Users\Usuario\Downloads\kit-modular\protocol\PROMPT-MESTRE-NEXT-AI.md`.
