# Plano de implementação

Plano por fases do [PRODUCT.md](../PRODUCT.md). Cada fase entrega incrementos verificáveis (testes no banco real, lint, tipos, build e e2e) e mantém os requisitos de segurança das anteriores. O estado efetivo do código está em [architecture.md](architecture.md); este documento é **plano**, exceto onde indicado como entregue.

## Mapa de módulos

| Módulo | Responsabilidade | Fase | Estado |
|---|---|---|---|
| Identidade e sessão | Cadastro, login, sessões, troca de senha, limitação de tentativas | 1 | Entregue |
| Empresas e planos | Organizações, planos, limites, recursos por plano, situação | 1 | Entregue |
| Estrutura | Regiões, lojas, departamentos | 1 | Entregue |
| Pessoas e acesso | Vínculos, escopo de lojas, perfis do sistema e personalizados, permissões | 1 | Entregue |
| Auditoria | Trilha imutável de alterações | 1 | Entregue |
| Plataforma | Administração de empresas clientes e planos | 1 | Entregue |
| Catálogo | Produtos, variações, categorias, marcas, fornecedores, histórico de preço/custo | 2 | Planejado |
| Estoque | Livro de movimentações, saldo/reserva/trânsito por loja, inventário, transferências, recebimento | 2 | Planejado |
| PDV e caixa | Venda, carrinho, descontos autorizados, suspensão, sessões de caixa, sangria/suprimento, fechamento e divergência | 2 | Planejado |
| Pagamentos | Adaptadores de provedor, confirmação por webhook autenticado/consulta, idempotência, estorno | 2 | Planejado |
| Fiscal | Camada desacoplada para NFC-e/NF-e via provedor especializado | 2–7 | Planejado (depende de provedor) |
| Atendimento | Fila, distribuição configurável, eventos, vínculo com venda, conversão | 3 | Planejado |
| Metas, comissões e campanhas | Metas por escopo/período, regras de comissão versionadas, apuração/aprovação/pagamento | 3 | Planejado |
| Indicadores e BI | Serviços de métricas compartilhados, dashboards por perfil, drill-down | 4 | Planejado |
| Relatórios | Central com filtros, exportação CSV/XLSX/PDF, agendamento, histórico | 4 | Planejado |
| IA | Adaptador de modelo, ferramentas autorizadas, agente central, uso e custo | 5 | Planejado |
| Multiagente e alertas | Especialistas, regras proativas, recomendações, central de tarefas | 6 | Planejado |
| Importação | CSV/XLSX com mapeamento, validação, prévia e histórico | 2–4 | Planejado |
| Observabilidade | Erros, latência, consultas lentas, filas, custos de IA por organização | 7 | Planejado |

## Fases

### Fase 1 — Fundação *(entregue nesta versão)*

Estrutura Next.js, banco com RLS forçado, autenticação, organizações e lojas, permissões com escopo, layout corporativo, cadastros de estrutura e equipe, auditoria, planos/limites, administração da plataforma, documentação. Critérios de aceite em [PRODUCT.md](../PRODUCT.md#critérios-de-aceitação); evidências em [setup.md](setup.md).

### Fase 2 — Núcleo comercial

Incrementos, nesta ordem:

1. **Catálogo + estoque por livro:** `products`, `product_variants`, `categories`, `brands`, `suppliers`, `inventory_movements` (entrada, saída, ajuste, perda, inventário) e `inventory_balances` derivado em transação. Saldo nunca é editado diretamente. Histórico de preço/custo versionado.
2. **Caixa:** `cash_registers`, `cash_sessions` (abertura, saldo inicial, fechamento, conferência, divergência, reabertura autorizada), `cash_movements` (suprimento, sangria, reforço com justificativa).
3. **PDV online:** interface própria por teclado e leitor (o leitor de código de barras emula teclado), carrinho, vendedor associado, cliente opcional/obrigatório por configuração, descontos e acréscimos sujeitos a permissão, suspensão/recuperação, comprovante não fiscal. `sales`, `sale_items`, `payments` gravados numa transação com a baixa de estoque; chave de idempotência por tentativa de finalização para impedir duplicidade.
4. **Pagamentos:** adaptador por provedor; dinheiro e troco locais; PIX/cartão só confirmados por webhook autenticado ou consulta de status. Nenhum dado sensível de cartão é armazenado. Estorno e conciliação conforme o provedor.
5. **Cancelamentos e devoluções** com autorização, estorno de pagamento, retorno ao estoque e auditoria.
6. **Fiscal (interface):** porta `FiscalProvider` com estados (pendente, autorizada, rejeitada, cancelada, contingência). Nenhuma autorização, número ou protocolo é inventado; emissão real depende de provedor, certificado, credenciamento e validação tributária profissional.

Aceite: venda com múltiplos pagamentos atualiza estoque e caixa atomicamente; retentativa não duplica; fechamento aponta divergência; tudo auditado e isolado por empresa/loja.

### Fase 3 — Pessoas e atendimento

Vendedores (vínculo com membro), escalas para dias úteis, metas por escopo (rede, região, loja, equipe, pessoa) e período sem alteração silenciosa do histórico, regras de comissão versionadas com estados estimada → apurada → aprovada → paga e estorno por devolução. Fila (`service_tickets`, `service_events`) com status do prompt, distribuição por rodízio/especialidade/setor/manual com motivo registrado, e vínculo atendimento ↔ venda sem dupla contagem. Aceite: conversão com denominador documentado e reprodutível em teste.

### Fase 4 — BI e relatórios

Camada `src/server/metrics/` com definições únicas (fórmula, período, filtros, origem) usada por dashboards, relatórios e IA. Faturamento bruto/líquido, recebimento, margem (com custos disponíveis) e lucro (somente com despesas cadastradas) são indicadores distintos. Dashboards executivo, gerente e vendedor; drill-down para os registros que compõem cada número; relatórios do prompt com exportação respeitando o escopo; agendamento e histórico de execuções. Aceite: o mesmo indicador produz o mesmo valor em todos os canais (teste de consistência com conjunto de dados conhecido).

### Fase 5 — Inteligência artificial

Conforme [ai.md](ai.md): adaptador de provedor, catálogo de ferramentas sobre os serviços de métricas, agente central, respostas com indicador/valor/período/filtros/origem/limitações, relatórios gerados com metodologia, limites e registro de uso/custo por organização. Aceite: testes com números conhecidos, bloqueio de ferramentas não autorizadas e de prompt injection.

### Fase 6 — Inteligência multiagente

Especialistas (BI, comercial, estoque, operações, atendimento, financeiro, procedimentos) acionados pelo orquestrador só quando trazem benefício medido; regras proativas determinísticas (meta em risco, estoque mínimo, caixa não fechado…) com severidade, responsável e resolução; recomendações viram tarefas apenas por ação humana.

### Fase 7 — Robustez e comercialização

Testes ampliados, testes de carga, observabilidade, limites e consumo por plano, backup/restauração testados, documentação de implantação, preparação de integrações fiscais e de ERPs por adaptadores.

## Riscos

| Risco | Tipo | Mitigação |
|---|---|---|
| Vazamento entre empresas por consulta sem filtro | Técnico, crítico | RLS forçado + FKs compostas + filtro explícito + testes de isolamento por módulo; app sem BYPASSRLS |
| Aplicação conectada como superusuário (RLS ignorado) | Operacional | Papel dedicado documentado; teste de integração recusa papel com BYPASSRLS; checklist de implantação |
| Escalada de privilégio por gerentes | Técnico | Hierarquia por nível, escopo ⊆ escopo do ator, sem autoalteração, invariante de proprietário; testes |
| Duplicidade de venda/pagamento em falhas de rede | Técnico, financeiro | Idempotência, transações, confirmação de pagamento só por provedor, sem retry automático de operações financeiras |
| Indicadores divergentes entre telas e IA | Técnico, confiança | Serviços de métricas únicos e testes de consistência |
| IA inventando números ou agindo sem autorização | Técnico, reputacional | Ferramentas determinísticas, validação e autorização no backend, confirmação explícita para operações sensíveis |
| Complexidade fiscal brasileira | Regulatório | Provedor especializado, camada desacoplada, validação profissional; nada fiscal simulado |
| Offline do PDV prometido cedo demais | Produto | Só declarar após vendas, estoque, pagamento e sincronização testados |
| Planos e preços não validados | Comercial | Catálogo em dados, alterável por migration; limites centralizados em `entitlements.ts` |
| Dependência de e-mail para convites/recuperação | Produto | Senha provisória + troca obrigatória até haver provedor |
| Pré-sequestro de contas sem prova de posse do e-mail | Técnico, crítico | Conta só readicionada pela empresa que a criou; convite com confirmação por e-mail antes de permitir pessoas em várias empresas |
| Custo de IA por organização | Comercial | Limites por plano, registro de uso/custo, alertas |
| LGPD (dados de clientes e equipe) | Regulatório | Minimização, retenção definida, HMAC para identificadores em logs de autenticação, envio mínimo ao modelo |

## Manutenção

Ao concluir uma fase, mova o que foi entregue para [architecture.md](architecture.md), atualize o estado na tabela de módulos e registre evidências em [setup.md](setup.md) ou na entrega da fase.
