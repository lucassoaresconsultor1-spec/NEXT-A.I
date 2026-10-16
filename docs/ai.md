# Inteligência artificial e agentes — plano

**Estado: planejado (Fases 5 e 6). Nada desta camada está implementado na Fase 1.** Requisitos de origem em [PRODUCT.md](../PRODUCT.md); segurança em [security.md](security.md).

## Princípios

1. **Números vêm do backend.** O modelo nunca calcula nem inventa indicadores críticos. Valores saem de serviços de métricas determinísticos (`src/server/metrics/`, Fase 4), os mesmos usados por dashboards e relatórios.
2. **O modelo interpreta, compara e explica**; separa fatos, hipóteses e recomendações; não afirma causalidade a partir de correlação; declara limitações e falta de dados.
3. **O agente não amplia permissões.** Ele age com o `TenantContext` do usuário: mesma empresa, mesmo escopo de lojas, mesmas permissões.
4. **Recomendação não é ação.** Nada é executado por ter sido sugerido; operações sensíveis exigem permissão, validação no backend e confirmação explícita.
5. **Desacoplado.** Interface e regras não dependem de um provedor; a indisponibilidade da IA não afeta PDV nem operação.

## Arquitetura

```
UI (página /assistente + painel lateral)
  → Server Action / Route Handler (autenticação, limites de uso)
    → Orquestrador (agente central)
        ├─ classifica intenção e período, checa escopo
        ├─ seleciona ferramentas permitidas pelo perfil
        ├─ aciona especialistas quando houver ganho medido (Fase 6)
        └─ consolida resposta estruturada
    → Catálogo de ferramentas (contratos Zod) → serviços de domínio/métricas → PostgreSQL (RLS)
    → Adaptador de modelo (porta ModelProvider) → provedor configurado
  → Registro: conversations, ai_messages, ai_tool_runs, ai_usage_records
```

### Adaptador de modelo

Porta `ModelProvider` com chamada de conversa com ferramentas, streaming opcional, limites de tokens/tempo e mapeamento de erros. Credenciais apenas em variáveis de ambiente do servidor (nunca `NEXT_PUBLIC_*`). O provedor, os modelos e os parâmetros serão escolhidos **na implementação**, conferindo a documentação oficial vigente, preços, limites, retenção de dados e termos de uso; a escolha e a data ficam registradas em `docs/setup.md`.

### Ferramentas (contratos explícitos)

| Ferramenta | Permissão exigida | Retorno |
|---|---|---|
| `get_sales_summary` | `sales.read` (escopo) | Faturamento bruto/líquido, vendas, ticket, itens; período e filtros aplicados |
| `compare_store_performance` | `reports.read` + escopo multi-loja | Indicadores por loja e variação contra período anterior |
| `get_salesperson_metrics` | `sales.read` / próprio vendedor | Vendas, conversão, metas; vendedor só vê a si |
| `get_inventory_alerts` | `inventory.read` | Ruptura, mínimo, excesso, sem giro |
| `get_queue_metrics` | `queue.read` | Espera, desistência, conversão |
| `get_cash_register_status` | `cash.read` | Caixas abertos, pendentes, divergências |
| `generate_report` | `reports.generate` | Relatório estruturado com metodologia e referências |
| `create_manager_task` | `tasks.manage` + confirmação | Tarefa criada (somente após confirmação do usuário) |
| `search_company_procedures` | `procedures.read` | Trechos com fonte documental |

Cada ferramenta: validação de parâmetros, autorização no backend, limites de linhas/tempo, erros tipados e registro em `ai_tool_runs` (parâmetros, duração, resultado resumido, erro). **Proibido** SQL gerado pelo modelo; somente consultas parametrizadas dos serviços.

### Resposta estruturada

Sempre que possível: indicador, valor, período, filtros, comparação, origem dos dados, limitações, explicação e recomendação; tabelas e gráficos montados pela UI a partir dos dados da ferramenta, não do texto do modelo.

## Segurança da IA

- **Prompt injection:** documentos, comentários e dados de clientes são entradas não confiáveis, enviados como dados delimitados; instruções neles não alteram regras. A autorização nunca depende do texto do modelo: a ferramenta reconfere o contexto do usuário.
- **Minimização (LGPD):** enviar agregados e campos necessários; evitar dados pessoais; mascarar identificadores quando possível.
- **Limites:** por organização e usuário, por plano (`ai_assistant`/`ai_reports` em `plan_features`); registro de tokens e custo estimado em `ai_usage_records`.
- **Operações destrutivas** nunca são ferramentas do agente.

## Relatórios gerados por IA (Fase 5)

Fluxo: identificar período e escopo permitido → buscar indicadores reais → comparar com período anterior → identificar desvios → separar fatos, hipóteses e recomendações → gerar relatório estruturado (resumo, indicadores, comparação, lojas, comercial, estoque, atendimento, alertas, oportunidades, recomendações priorizadas, metodologia e limitações, referências) → gravar `reports`/`report_runs` com filtros e momento → visualizar, exportar e consultar histórico. O texto deixa claro que a análise reflete os dados disponíveis naquele momento.

## Multiagente (Fase 6)

Especialistas (BI, comercial, estoque, operações, atendimento, financeiro, procedimentos) como módulos com conjunto restrito de ferramentas. Começa com um agente central e ferramentas confiáveis; especialistas independentes entram quando houver benefício mensurável (qualidade em avaliação com casos de números conhecidos, latência e custo). Lucro líquido só com custos e despesas suficientes.

**Inteligência proativa:** regras determinísticas e configuráveis (meta em risco, estoque mínimo, cancelamentos acima do padrão, espera elevada, caixa não fechado) geram `alerts` com severidade, responsável e estado; a IA contextualiza e prioriza. Regra de limite não é chamada de "preditiva". Previsão de demanda e anomalias estatísticas exigem histórico adequado.

## Testes previstos

Respostas com números conhecidos, ausência de dados, ferramenta não autorizada bloqueada, escopo de lojas respeitado, prompt injection em documento, limites de uso, registro de falhas e custo, e independência do PDV quando o provedor estiver fora do ar.
