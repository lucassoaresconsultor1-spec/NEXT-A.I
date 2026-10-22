# Escritório Virtual 2D de agentes

Especificação do módulo diferencial (Fase 7 do [roadmap](roadmap.md)), a partir do "Documento mestre do produto — PRD + especificação técnica" (16/10/2026). Plano dos agentes em [ai.md](ai.md). **Estado: protótipo funcional na demonstração (`demo/`), com dados fictícios; não implementado no produto.**

## Princípio

O escritório torna visível o trabalho real dos agentes. Cada personagem corresponde a um agente do backend; estados, tarefas, conexões e histórico vêm **somente** dos registros de execução. Não há estado aleatório, progresso percentual sem medição nem conexão desenhada sem delegação registrada. O ambiente não concede privilégio: toda ação passa pelos mesmos serviços, permissões e escopo de lojas do SaaS.

## Salas e agentes

| Sala | Agente (nome visual) | Responsabilidade | Ferramentas |
|---|---|---|---|
| 1 Central de Inteligência | Coordenador Central (Otto) | Interpreta, valida contexto, aciona especialistas, consolida, registra | orquestração |
| 2 Business Intelligence | Analista de Dados (Bia) | Indicadores, comparação de lojas, relatórios | `get_sales_summary`, `compare_store_performance`, `generate_report` |
| 3 Comercial | Especialista Comercial (Caio) | Metas, vendedores, ticket, conversão, projeções | `get_goal_status`, `get_salesperson_metrics` |
| 4 Estoque e Logística | Especialista de Estoque (Duda) | Ruptura, excesso, giro, reposição, transferências | `get_inventory_alerts` |
| 5 Financeiro | Analista Financeira (Iara) | Margens, recebimentos, despesas cadastradas, divergências | `get_financial_summary` |
| 6 Atendimento | Especialista de Atendimento (Léo) | Fila, espera, desistências, distribuição | `get_queue_metrics` |
| 7 Operações e Auditoria | Especialista Operacional (Rui) | Caixas, cancelamentos, pendências | `get_cash_register_status` |
| 8 Conhecimento | Especialista de Procedimentos (Sofia) | Manuais e políticas, sempre com fonte | `search_company_procedures` |

O id técnico (`agent.<id>`) é separado do nome e da aparência, que poderão ser personalizados por empresa. Agentes desabilitados aparecem como indisponíveis e suas etapas são bloqueadas.

## Estados

Derivados por regra (`demo/js/agents.js`): **indisponível** (desabilitado) → **analisando / executando / gerando relatório** (etapa em execução) → **aguardando aprovação** (recomendação pendente do agente) → **erro** (última etapa falhou, por 5 min) → **concluído** (etapa terminou há menos de 20 s) → **disponível**. Sem conexão, todos ficam **desatualizados** com o último instante conhecido. Cada estado tem forma própria (postura, balão com ícone distinto, tela do monitor) além da cor, e rótulo em texto na lista.

## Estado no produto (m24a)

`officeSnapshot` (`src/server/office/snapshot.ts`) liga cada agente às ferramentas reais do assistente (m21/m39) e deriva o estado só dos registros: **analisando** (Coordenador, pergunta sem resposta há menos de 2 min), **erro** (última execução do agente falhou há menos de 5 min), **concluído** (terminou há menos de 20 s), **disponível**; **indisponível** sem IA configurada, sem ferramenta própria (Estoque, até existir ferramenta de estoque) ou sem permissão do perfil. "Aguardando aprovação" não é produzido: o backend ainda não tem recomendação pendente de aprovação. `GET /api/escritorio/eventos` entrega um evento `snapshot` a cada 5 s por SSE, reautorizando sessão e empresa antes de cada evento (`fim` ao perder acesso). O histórico mostra agente, situação e horário, sem parâmetros nem autor.

## Interface

Cabeçalho do SaaS, resumo (habilitados, disponíveis, em execução, etapas concluídas, aguardando aprovação, erros, custo de IA quando houver), mapa com zoom e arraste, destaque por estado, painel do agente (estado, tarefa, última atividade, histórico, resultados, erros, custo, ações), histórico de atividades com as delegações e **visão em lista** equivalente. Ações: conversar com o agente, ver tarefas, abrir o módulo, reexecutar a última execução, cancelar execução em andamento, aprovar/rejeitar recomendação e habilitar/desabilitar (proprietário). Painéis da sala exibem números reais do mesmo snapshot (metas das lojas, senha chamada e fila, alertas abertos, alertas de estoque).

## Decisões técnicas

| Decisão | Motivo | Revisar quando |
|---|---|---|
| Canvas 2D próprio, sem engine (Phaser/PixiJS) | Cena estática pequena (480×300 px de arte) com poucos sprites; zero dependência; buffer em resolução de arte ampliado sem suavização | Animações complexas, tilemaps grandes ou física |
| Pixel art desenhada por código (templates recoloridos) | Sem assets externos; variações por cor e acessório | Personagens personalizados por empresa |
| Um snapshot por atualização para mapa, lista e contadores | Nenhuma consulta por personagem; telas sempre consistentes | — |
| Ciclo de vida explícito (`createOffice`/`destroy`) | Libera rAF, listeners, `ResizeObserver` e buffers ao sair da página | — |
| Produto: Server-Sent Events com reconexão e "última atualização" | Fluxo unidirecional servidor→cliente, compatível com Route Handlers do Next.js; polling controlado como alternativa | Necessidade de comandos bidirecionais |

## Acessibilidade

Visão em lista e chips de agentes navegáveis por teclado; mapa focável (setas movem, + e − ajustam o zoom) com descrição textual de todos os estados; foco visível; estados nunca só por cor; `prefers-reduced-motion` reduz o quadro para 2 fps e remove animações.

## Critérios de aceitação (produto)

Mapa carrega; personagens renderizam; clique abre o agente certo; estados refletem o backend; histórico corresponde às execuções; conversa abre o agente certo; desconexão não cria estado falso; layout funciona em desktop e celular; visão alternativa utilizável; permissões e isolamento multiempresa respeitados; recursos liberados ao sair. A demo cobre esses pontos com dados fictícios; no produto, cada um precisa de teste sobre dados reais e do serviço de execuções (Fases 5–6).
