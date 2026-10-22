# Contrato das telas de comissões — m12b v1

## Objetivo e escopo
Criar telas para regras versionadas, estimativa, apuração mensal por vendedor/loja e transições de aprovar, pagar e cancelar. Pagamento é registro de referência de uma operação externa; não processar dinheiro. Somente arquivos novos em `src/app/(app)/comissoes/**`; reutilizar componentes existentes, sem mudar m12a, banco, menu ou infraestrutura.

## APIs reais
Usar apenas funções exportadas:

```ts
// src/server/commissions/rules.ts
listRules(context, filters?)
createRule(context, rawInput)
// src/server/commissions/calculate.ts
estimateCommission(context, rawKey)
// src/server/commissions/statements.ts
calculateStatement(context, rawKey)
listStatements(context, rawFilters)
getStatement(context, statementId)
approveStatement(context, statementId)
payStatement(context, statementId, rawInput)
cancelStatement(context, statementId, rawInput)
```

Schemas reais: `ruleInputSchema`, `statementKeySchema`, `statementFiltersSchema`, `paySchema`, `cancelSchema`; estados/rótulos `STATEMENT_STATUSES` e `STATEMENT_STATUS_LABELS`, de `src/server/commissions/schemas.ts`.

## Interface e regras
- Filtros de apuração: mês, loja, situação e página. Detalhe apresenta linhas e totais retornados por `getStatement`; valores em centavos inteiros, exibidos com `formatCurrencyCents`.
- Regras exibem vigência, versão, taxa padrão e taxas por categoria. Nova versão pede início de vigência, taxas em pontos-base e motivo quando exigido pelo schema/serviço.
- Estimativa chama `estimateCommission` sem gravar. Apuração chama `calculateStatement`; estados seguem somente o serviço: calculada → aprovada → paga, ou cancelada quando permitido.
- Pagamento recebe referência do pagamento externo; cancelamento recebe motivo. Não oferecer edição de linhas nem prometer transferência bancária.
- Taxas vigem por data local da loja; vendas, descontos, cancelamentos e devoluções já são calculados no serviço. A tela não recalcula nem arredonda comissão.

## Permissões, segurança e aceite
- `commissions.read`: regras, estimativa permitida pelo serviço, listagem e detalhe. `commissions.manage`: criar regra, apurar e cancelar. `commissions.approve`: aprovar. `commissions.pay`: registrar pagamento. Cada ação verifica `requireTenantContext()` e autorização antes de chamar o serviço; fora do escopo é tratado como não encontrado/negado.
- Actions usam `pick()` e schemas existentes, delegam auditoria, escopo e transições ao serviço; nenhuma consulta direta ao banco. Sem permissão, `AccessDenied`; falhas e vazios têm estados acessíveis, sem valores simulados.
- Aceite: usuário consegue consultar regras e apurações, estimar sem persistência, apurar, aprovar conforme segregação, registrar referência de pagamento e cancelar apenas nos estados permitidos; nenhum valor financeiro é calculado no cliente.
