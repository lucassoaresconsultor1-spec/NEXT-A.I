# Plano de implementação

Plano por fases do [PRODUCT.md](../PRODUCT.md). Cada fase entrega incrementos verificáveis (testes no banco real, lint, tipos, build e e2e) e mantém os requisitos de segurança das anteriores. O estado efetivo do código está em [architecture.md](architecture.md); este documento é **plano**, exceto onde indicado como entregue.

## Mapa de módulos

Classificação do estado no produto (`src/`): **existente**, **parcial**, **ausente** ou **dependente de integração**. "Protótipo na demo" indica que a tela e as regras existem só na demonstração fictícia (`demo/`), sem banco, autenticação real nem testes de produto.

| Módulo | Responsabilidade | Fase | Estado no produto |
|---|---|---|---|
| Identidade e sessão | Cadastro, login, sessões, troca de senha, limitação de tentativas | 1 | Existente |
| Empresas e planos | Organizações, planos, limites, recursos por plano, situação | 1 | Existente |
| Estrutura | Regiões, lojas, departamentos | 1 | Existente |
| Pessoas e acesso | Vínculos, escopo de lojas, perfis do sistema (Dono, Administrador, Financeiro, Coordenador, Gerente de loja, Supervisor, Vendedor, Operador de caixa) e personalizados, permissões | 1 | Existente (permissões financeiras e do vendedor entram com seus módulos) |
| Auditoria | Trilha imutável de alterações | 1 | Existente |
| Plataforma | Cadastro de empresas com o acesso do dono, planos e situação | 1 | Existente |
| Catálogo | Produtos, variações, categorias, marcas, fornecedores, histórico de preço/custo | 2 | Parcial: banco, serviços e testes (`src/server/catalog/`), sem telas · protótipo na demo |
| Estoque | Livro de movimentações, saldo/reserva/trânsito por loja, inventário, transferências, recebimento, pedidos de compra | 2 | Parcial: livro (entrada, saída, ajuste, perda, inventário) e saldo por loja em banco, serviços e testes (`src/server/inventory/`); sem telas, reserva, trânsito, transferências nem pedidos de compra · protótipo na demo |
| PDV e caixa | Venda, carrinho, descontos autorizados, suspensão, sessões de caixa, sangria/suprimento, fechamento e divergência | 2 | Ausente · protótipo na demo |
| Compras e fornecedores | Fornecedores, pedidos de compra, recebimento contra pedido, custo de reposição | 2 (estrutura) · evolução | Ausente |
| Financeiro | Faturamento, recebimentos, conciliação, fechamento de caixa, despesas, relatórios financeiros | 2–4 | Ausente (perfil Financeiro existe) |
| Experiências e PWA | App instalável; app do vendedor (celular), fila (tablet) e PDV (desktop) sobre os mesmos serviços | 2–3 | Ausente · protótipo na demo |
| Pagamentos | Adaptadores de provedor, confirmação por webhook autenticado/consulta, idempotência, estorno | 2 | Dependente de integração (demo: dinheiro local, cartão por NSU, PIX bloqueado) |
| Fiscal | Camada desacoplada para NFC-e/NF-e via provedor especializado | 2–8 | Dependente de integração |
| Atendimento | Fila, distribuição configurável, eventos, vínculo com venda, conversão | 3 | Ausente · protótipo na demo |
| Metas, comissões e campanhas | Metas por escopo/período, regras de comissão versionadas, apuração/aprovação/pagamento | 3 | Ausente · protótipo na demo (sem campanhas) |
| Indicadores e BI | Serviços de métricas compartilhados, dashboards por perfil, drill-down | 4 | Ausente · protótipo na demo (sem drill-down) |
| Relatórios | Central com filtros, exportação CSV/XLSX/PDF, agendamento, histórico | 4 | Ausente · protótipo na demo (CSV por cópia) |
| IA | Adaptador de modelo, ferramentas autorizadas, agente central, uso e custo | 5 | Dependente de integração (provedor) · demo com roteamento por regras locais |
| Multiagente e alertas | Especialistas, regras proativas, recomendações, central de tarefas | 6 | Ausente · protótipo na demo |
| Escritório Virtual 2D | Salas, personagens, estados reais, histórico, conversas, conexões entre agentes | 7 | Ausente · protótipo na demo ([virtual-office.md](virtual-office.md)) |
| Importação | CSV/XLSX com mapeamento, validação, prévia e histórico | 2–4 | Ausente |
| Observabilidade | Erros, latência, consultas lentas, filas, custos de IA por organização | 8 | Ausente |

## Fases

### Fase 1 — Fundação *(entregue nesta versão)*

Estrutura Next.js, banco com RLS forçado, autenticação, organizações e lojas, permissões com escopo, layout corporativo, cadastros de estrutura e equipe, auditoria, planos/limites, administração da plataforma, documentação. Critérios de aceite em [PRODUCT.md](../PRODUCT.md#critérios-de-aceitação); evidências em [setup.md](setup.md).

### Fase 2 — Núcleo comercial

Incrementos, nesta ordem:

1. **Catálogo + estoque por livro:** `products`, `product_variants`, `categories`, `brands`, `suppliers`, `inventory_movements` (entrada, saída, ajuste, perda, inventário) e `inventory_balances` derivado em transação. Saldo nunca é editado diretamente. Histórico de preço/custo versionado. *Back-end entregue: schema, migrations `0005`/`0006`, serviços, permissões e testes unitários; testes de integração escritos, execução pendente de PostgreSQL. Faltam as telas.*
2. **Caixa:** `cash_registers`, `cash_sessions` (abertura, saldo inicial, fechamento, conferência, divergência, reabertura autorizada), `cash_movements` (suprimento, sangria, reforço com justificativa).
3. **PDV online:** interface própria por teclado e leitor (o leitor de código de barras emula teclado), carrinho, vendedor associado, cliente opcional/obrigatório por configuração, descontos e acréscimos sujeitos a permissão, suspensão/recuperação, comprovante não fiscal. `sales`, `sale_items`, `payments` gravados numa transação com a baixa de estoque; chave de idempotência por tentativa de finalização para impedir duplicidade.
4. **Pagamentos:** adaptador por provedor; dinheiro e troco locais; PIX/cartão só confirmados por webhook autenticado ou consulta de status. Nenhum dado sensível de cartão é armazenado. Estorno e conciliação conforme o provedor.
5. **Cancelamentos e devoluções** com autorização, estorno de pagamento, retorno ao estoque e auditoria.
6. **Fiscal (interface):** porta `FiscalProvider` com estados (pendente, autorizada, rejeitada, cancelada, contingência). Nenhuma autorização, número ou protocolo é inventado; emissão real depende de provedor, certificado, credenciamento e validação tributária profissional.

O PDV tem layout próprio para desktop, não depende da IA para vender e trata falhas de conexão e de impressão sem perder a venda (estado pendente visível, reimpressão do comprovante). Cancelamentos, descontos e acréscimos exigem permissão específica. Contingência offline só entra se o negócio exigir, depois do PDV online testado.

Aceite: venda com múltiplos pagamentos atualiza estoque e caixa atomicamente; retentativa não duplica; fechamento aponta divergência; tudo auditado e isolado por empresa/loja.

### Escopo das Fases 3 a 8 (22/10/2026)

O caminho mínimo aprovado mais cedo foi **revogado** pelo dono: todos os 61 módulos do SPEC continuam no plano, na ordem do mapa. A diretriz é não criar código, testes, relatórios ou documentos desnecessários. O m15 (PWA offline) foi avaliado e registrado como não feito (PDV e fila exigem o servidor; ver `docs/contracts/m15-pwa-offline-cache.md`). Integrações que dependem de credencial real do dono (pagamento, fiscal, e-mail, IA, deploy) têm a porta implementada e testada e aparecem como "pendente" na tela, sem nada simulado.

### Fase 3 — Pessoas e atendimento

Vendedores (vínculo com membro), escalas para dias úteis, metas por escopo (rede, região, loja, equipe, pessoa) e período sem alteração silenciosa do histórico, regras de comissão versionadas com estados estimada → apurada → aprovada → paga e estorno por devolução. Fila (`service_tickets`, `service_events`) com status do prompt, distribuição por rodízio/especialidade/setor/manual com motivo registrado, e vínculo atendimento ↔ venda sem dupla contagem. Experiências móveis como PWA (`app/manifest.ts`): app do vendedor no celular (próprios dados por padrão; colegas, comissões de terceiros e relatórios gerenciais por permissão específica) e fila/vez no tablet da entrada da loja, integrada ao app do vendedor, ao PDV e ao dashboard sem cadastro duplicado. Como o tablet se identifica (aparelho vinculado à loja, PIN do vendedor) é proposta a validar com o usuário. Aceite: conversão com denominador documentado e reprodutível em teste.

### Fase 4 — BI e relatórios

Camada `src/server/metrics/` com definições únicas (fórmula, período, filtros, origem) usada por dashboards, relatórios e IA. Faturamento bruto/líquido, recebimento, margem (com custos disponíveis) e lucro (somente com despesas cadastradas) são indicadores distintos. Dashboards executivo, coordenação, financeiro, gerente e vendedor, com comparação entre períodos e entre as lojas do escopo; drill-down para os registros que compõem cada número; relatórios do prompt com exportação respeitando o escopo; agendamento e histórico de execuções. Aceite: o mesmo indicador produz o mesmo valor em todos os canais (teste de consistência com conjunto de dados conhecido).

### Fase 5 — Inteligência artificial

Conforme [ai.md](ai.md): adaptador de provedor, catálogo de ferramentas sobre os serviços de métricas, agente central, respostas com indicador/valor/período/filtros/origem/limitações, relatórios gerados com metodologia, limites e registro de uso/custo por organização. Aceite: testes com números conhecidos, bloqueio de ferramentas não autorizadas e de prompt injection.

### Fase 6 — Inteligência multiagente

Especialistas (BI, comercial, estoque, operações, atendimento, financeiro, procedimentos) acionados pelo orquestrador só quando trazem benefício medido; regras proativas determinísticas (meta em risco, estoque mínimo, caixa não fechado…) com severidade, responsável e resolução; recomendações viram tarefas apenas por ação humana.

### Fase 7 — Escritório Virtual 2D

Conforme [virtual-office.md](virtual-office.md): auditoria da arquitetura de agentes, salas e personagens ligados aos agentes reais, estados derivados das execuções (`ai_tool_runs`), painel do agente, histórico, conversas e conexões de delegação, atualização por Server-Sent Events com reconexão e "última atualização", visão em lista acessível. Aceite: os critérios do documento testados com dados reais, inclusive permissões, isolamento e liberação de recursos. O protótipo da demo valida interface e regras de estado.

### Fase 8 — Robustez e comercialização

Testes ampliados, testes de carga, observabilidade, limites e consumo por plano, backup/restauração testados, documentação de implantação, preparação de integrações fiscais e de ERPs por adaptadores.

### Demonstração

`demo/` antecipa as Fases 2–7 com dados fictícios para validar telas e apresentar o produto. Ao implementar cada fase no produto, reaproveite as fórmulas de `demo/js/metrics.js` como referência de especificação, não como código de produção: o produto calcula no servidor, sobre PostgreSQL com RLS, com testes de integração.

## Riscos

| Risco | Tipo | Mitigação |
|---|---|---|
| Vazamento entre empresas por consulta sem filtro | Técnico, crítico | RLS forçado + FKs compostas + filtro explícito + testes de isolamento por módulo; app sem BYPASSRLS |
| Aplicação conectada como superusuário (RLS ignorado) | Operacional | Papel dedicado documentado; teste de integração recusa papel com BYPASSRLS; checklist de implantação |
| Escalada de privilégio por gerentes | Técnico | Hierarquia por nível, escopo ⊆ escopo do ator, sem autoalteração, invariante de dono; testes |
| Duplicidade de venda/pagamento em falhas de rede | Técnico, financeiro | Idempotência, transações, confirmação de pagamento só por provedor, sem retry automático de operações financeiras |
| Indicadores divergentes entre telas e IA | Técnico, confiança | Serviços de métricas únicos e testes de consistência |
| IA inventando números ou agindo sem autorização | Técnico, reputacional | Ferramentas determinísticas, validação e autorização no backend, confirmação explícita para operações sensíveis |
| Complexidade fiscal brasileira | Regulatório | Provedor especializado, camada desacoplada, validação profissional; nada fiscal simulado |
| Offline do PDV prometido cedo demais | Produto | Só declarar após vendas, estoque, pagamento e sincronização testados |
| Planos e preços não validados | Comercial | Catálogo em dados, alterável por migration; limites centralizados em `entitlements.ts` |
| Dependência de e-mail para convites/recuperação | Produto | Senha provisória + troca obrigatória até haver provedor |
| Pré-sequestro de contas sem prova de posse do e-mail | Técnico, crítico | Conta só readicionada pela empresa que a criou; convite com confirmação por e-mail antes de permitir pessoas em várias empresas |
| Custo de IA por organização | Comercial | Limites por plano, registro de uso/custo, alertas |
| Demonstração confundida com produto pronto | Produto, confiança | Selo "DEMONSTRAÇÃO", aviso fixo, dados fictícios separados em `demo/`, classificação de estado nesta tabela |
| Escritório virtual com estados "decorativos" | Produto, confiança | Estados derivados só de execuções registradas; teste de desconexão; nada aleatório |
| LGPD (dados de clientes e equipe) | Regulatório | Minimização, retenção definida, HMAC para identificadores em logs de autenticação, envio mínimo ao modelo |

## Manutenção

Ao concluir uma fase, mova o que foi entregue para [architecture.md](architecture.md), atualize o estado na tabela de módulos e registre evidências em [setup.md](setup.md) ou na entrega da fase.
