# Contrato do módulo `m15-pwa-offline-cache` — v1 (decisão: não feito)

> Arquiteto (Opus), 22/10/2026. Pelo SPEC, o service worker entra "só se fila/PDV exigirem; senão registrado como não feito" (ADR-006).

## Decisão
**Não implementado.** Nenhum dos dois fluxos funciona corretamente sem o servidor, e cache de páginas autenticadas em aparelho compartilhado é o risco que o ADR-006 quer evitar.

- **PDV:** a venda reserva e baixa estoque sob trava (m06a), exige a sessão de caixa aberta do operador (m05a), valida o desconto pelo teto da loja (m27) e confirma pagamento integrado pelo provedor (m07). Vender offline permitiria vender o mesmo item duas vezes e divergência de caixa; a idempotência por chave (ADR-013) já cobre a retentativa após queda de rede.
- **Fila no tablet:** rodízio com travas (m13a), PIN com limite de tentativas e token do aparelho revogável (m33) dependem do servidor a cada ação.
- **O que continua:** o manifesto instalável (m14), sem cache. A queda de conexão aparece como erro de rede na tela, sem estado falso.

## Revisar quando
Houver exigência de operação sem internet registrada pelo dono; então desenhar fila de vendas offline com reconciliação explícita (contrato próprio, nível A), sem cache de páginas autenticadas.
