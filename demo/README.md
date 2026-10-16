# Demonstração com dados fictícios

Página interativa que mostra a visão completa do produto: painéis por perfil, PDV, caixa, estoque, fila, metas e comissões, relatórios, assistente de IA, alertas e tarefas, auditoria e o **Escritório Virtual 2D** dos agentes. Ela fica **separada da aplicação** (`src/`) e não toca o banco.

- **Link (privado, compartilhável pelo menu Share):** https://claude.ai/artifact/SqQ3ETNacUbsf9W85oNtnL
- **Empresa e dados:** "Grupo Vitrine Sul" e tudo que aparece nela são **fictícios**, gerados no navegador por semente fixa (`js/seed.js`, semente 276) a partir do dia em que a página é aberta. Recarregar restaura o estado inicial.

## O que é real e o que não é

| Funciona de verdade (na página) | Não existe ou não é processado |
|---|---|
| Cálculos determinísticos únicos (`js/metrics.js`) usados por painéis, relatórios e agentes | Banco de dados, login e multiempresa real: a demo roda só no navegador |
| PDV com validações, desconto com autorização, idempotência por tentativa, baixa de estoque pelo livro | Pagamento: dinheiro é contado localmente; cartão só registra o NSU da maquininha; **PIX fica bloqueado** (integração pendente) |
| Caixa com sangria/suprimento justificados e fechamento com divergência | Emissão fiscal (NFC-e): integração pendente; o comprovante diz "documento não fiscal" |
| Fila com preferencial, lista da vez e vínculo com a venda | Modelo de IA: **nenhum é chamado**; o coordenador roteia por regras locais |
| Agentes chamando ferramentas com permissão e escopo do perfil, separando fatos, hipóteses e recomendações | Custos de IA: não se aplicam |
| Escritório 2D com estados derivados só dos registros de execução; queda de conexão simulada mostra estado "desatualizado" | Tempo real por servidor (SSE): na demo o "servidor" é o próprio navegador |
| Perfis "Ver como" (proprietária, gerente, vendedora) com permissões e lojas diferentes | Contas reais: os três perfis são fixos e fictícios |

As etapas dos agentes têm duração mínima de 0,9 s só para a animação ser acompanhada; isso está escrito na página.

## Estrutura

`index.html` e `styles.css` (página), `js/` com módulos ES sem etapa de build. React 18.3.1 e htm 3.1.1 vêm de CDN fixado por versão.

| Arquivo | Papel |
|---|---|
| `catalog.js`, `seed.js` | Dados mestres e histórico fictícios (vendas, atendimentos, livro de estoque, caixas, metas) |
| `metrics.js` | Indicadores com fórmula documentada (faturamento bruto/líquido, ticket, margem, conversão, espera, metas, estoque, caixa, comissão) |
| `store.js`, `pdv-ops.js`, `ops.js` | "Backend" da página: perfis, permissões, escopo, mutações e auditoria |
| `tools.js`, `agents.js`, `orchestrator.js` | Ferramentas autorizadas, registro dos 8 agentes, estados derivados, orquestração, alertas e aprovações |
| `office.js`, `office-rooms.js`, `sprites.js` | Mapa em Canvas 2D (pixel art desenhada por código), câmera, zoom, cliques e ciclo de vida |
| `ui.js`, `charts.js`, `views/` | Componentes e telas |

## Verificar

```bash
node demo/selfcheck.mjs   # asserções do motor: ledger, consistência de indicadores, PDV, permissões, roteamento, alertas
pnpm lint                 # inclui demo/js
```

Para abrir localmente, sirva a pasta (ex.: `python3 -m http.server -d demo 8080`) com acesso à internet para os CDNs.
