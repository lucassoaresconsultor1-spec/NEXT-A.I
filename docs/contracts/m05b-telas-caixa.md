# Contrato do módulo `m05b-telas-caixa` — v1

> Escrito pelo Arquiteto (Opus) em 22/10/2026. O agente implementa o que está aqui e nada além.
> Se algo estiver ambíguo, o agente PERGUNTA (ver seção 10); não presume.
> Risco: **SENSÍVEL** (dinheiro). Nível: **A** (Opus), pelo ADR-008: a tela de caixa guarda chaves de idempotência e conduz o fechamento cego.

## 1. Objetivo
Telas do **caixa**: abrir o próprio caixa com troco inicial, registrar suprimento e sangria, fechar com contagem **cega** (o operador informa o contado antes de ver o esperado), consultar sessões e reabrir (gerente), e cadastrar caixas da loja.

## 2. Fora de escopo
- Vendas (m06b), conciliação e fechamento diário financeiro (m37), impressão de relatório de caixa.
- Qualquer alteração em `src/server/**`, `src/db/**`, `drizzle/**`, `src/components/ui/**`, `src/lib/**`.
- `nav.ts`/`shell.ts` (seção 4.7).

## 3. Allowlist de arquivos
```
src/app/(app)/caixa/page.tsx
src/app/(app)/caixa/actions.ts
src/app/(app)/caixa/cash-dialogs.tsx
src/app/(app)/caixa/close-form.tsx
src/app/(app)/caixa/caixas/page.tsx
src/app/(app)/caixa/caixas/register-dialogs.tsx
src/app/(app)/caixa/sessoes/page.tsx
src/app/(app)/caixa/sessoes/session-filters.tsx
src/app/(app)/caixa/sessoes/[sessionId]/page.tsx
src/app/(app)/caixa/sessoes/[sessionId]/reopen-dialog.tsx
```
Veredito esperado: `PASS`. Pré-condições: **m05a, m03 (money.ts) e m26 integrados**.

## 4. Interface pública
### 4.1 Regras gerais
`requireTenantContext()` em toda página e ação; `params`/`searchParams` são `Promise`. Valores digitados em reais convertidos com `parseBrlToCents` (`@/lib/money`); exibidos com `formatCurrencyCents`; datas com `formatDateTime` no fuso da empresa.

### 4.2 `/caixa` (meu caixa)
- Sem `cash.operate` nem `cash.read` → `<AccessDenied />`. Loja: `context.activeStoreId` quando está no escopo, senão a primeira de `listStoreOptions`; seletor de loja (`?loja=`) quando o membro tem mais de uma.
- Sem sessão aberta (`findOpenSessionForOperator`): cartão "Abrir caixa" com Caixa (`registerId`, caixas ativos da loja sem sessão aberta, de `listRegisters`), Troco inicial (`openingAmount`, em reais, padrão vazio, obrigatório; `0,00` permitido) e botão `Abrir caixa`. A chave `idempotencyKey` é gerada **no servidor** por renderização (`randomUUID()` em campo oculto). Sem caixa disponível: `Notice` `Nenhum caixa livre nesta loja. Peça a um gerente para cadastrar ou liberar um caixa.`
- Com sessão aberta: resumo (caixa, aberto em, por quem) e ações `Suprimento`, `Sangria` e `Fechar caixa`. **Não** mostrar o esperado nem os totais ao operador sem `cash.read` antes do fechamento (fechamento cego); com `cash.read` mostrar os totais de `getSessionSummary`.
- `cash-dialogs.tsx` (`"use client"`): Suprimento/Sangria com Valor (`amount`, reais) e Motivo (`reason`, 3..240); a chave `idempotencyKey` é gerada com `crypto.randomUUID()` **quando o diálogo abre** e reenviada em toda tentativa daquele diálogo. Sucesso fecha o diálogo com `Notice` `Suprimento registrado.` / `Sangria registrada.`
- `close-form.tsx` (`"use client"`): Valor contado em dinheiro (`countedAmount`) e Observação (`note`, até 500; dica `Obrigatória quando houver diferença.`); botão `Fechar caixa` com confirmação `Depois de fechado, só um gerente pode reabrir.`. Resultado: página mostra o esperado, o contado e a diferença (`Diferença de {valor}` em `critical` quando ≠ 0, `Sem diferença` em `positive`).

### 4.3 `/caixa/caixas` (gerente)
- Sem `cash.manage` → `<AccessDenied />`. Lista de `listRegisters` (todas as lojas do escopo): Loja, Caixa, Situação, Sessão aberta (operador e desde quando ou `—`). Ações (`register-dialogs.tsx`): `Novo caixa` (loja e nome 2..60), `Renomear`, `Ativar/Desativar` (desativar com sessão aberta mostra o erro do serviço).

### 4.4 `/caixa/sessoes` e detalhe
- Lista (`listSessions` com `sessionFiltersSchema`): filtros Loja, Caixa, Situação (`aberta`/`fechada` na URL → `open`/`closed`), De/Até. Colunas: Caixa, Loja, Operador, Abertura, Fechamento, Diferença (`—` aberta; vermelho ≠ 0). Quem só tem `cash.operate` vê as próprias (o serviço filtra).
- Detalhe (`getSessionSummary`; null → `notFound()`): totais (abertura, suprimentos, sangrias, vendas em dinheiro, devoluções, esperado; contado e diferença quando fechada), movimentos (tipo com `CASH_MOVEMENT_LABELS`, valor, motivo, quem, quando) e eventos (aberto, fechado, reaberto com motivo). Com `cash.manage` e sessão fechada: `Reabrir caixa` (`reopen-dialog.tsx`, motivo 3..240; aviso `Use só para corrigir um fechamento. A reabertura fica registrada.`); com `cash.manage` e sessão aberta de outro operador: `Fechar caixa` (mesmo formulário da 4.2).

### 4.5 Server Actions (`actions.ts`)
`"use server"`; só funções async; `_state` primeiro; `requireTenantContext()` na primeira linha; ids com `z.uuid()`; reais → centavos com `parseBrlToCents` (inválido → erro no campo `Informe um valor em reais, como 12,90.` sem chamar o serviço).
```ts
export async function openSessionAction(_state: ActionState, formData: FormData): Promise<ActionState>;
export async function recordMovementAction(_state: ActionState, formData: FormData): Promise<ActionState>;
export async function closeSessionAction(_state: ActionState, formData: FormData): Promise<ActionState & { expectedCents?: number; differenceCents?: number }>;
export async function reopenSessionAction(_state: ActionState, formData: FormData): Promise<ActionState>;
export async function saveRegisterAction(_state: ActionState, formData: FormData): Promise<ActionState>;
export async function setRegisterActiveAction(_state: ActionState, formData: FormData): Promise<ActionState>;
```
Mensagens: `Caixa aberto.`, `Caixa fechado.`, `Caixa reaberto.`, `Caixa cadastrado.`, `Caixa atualizado.`, `Caixa ativado.`/`Caixa desativado.`; repetição idempotente (`replayed`) mostra a mesma mensagem. `revalidatePath("/caixa")`, `/caixa/sessoes` e do detalhe.

### 4.6 Estados e acessibilidade
Carregando, vazio, erro, sem permissão, sucesso; valores com `tabular-nums`; campos de valor com `inputMode="decimal"` e prefixo visual `R$`; foco no primeiro erro; celular sem rolagem horizontal da página.

### 4.7 Menu (aplicado pelo Maestro, ADR-009)
- `nav.ts`: na seção "Vendas", antes de "Clientes": `{ href: "/caixa", label: "Caixa", icon: Wallet }` e, depois dele, `{ href: "/caixa/sessoes", label: "Sessões de caixa", icon: ReceiptText }`.
- `shell.ts`: `"/caixa": "cash.operate"`, `"/caixa/sessoes": "cash.read"`.

## 5. Dados e esquemas
Nenhuma tabela. Consumidos (não alterar): `@/server/cash/registers`, `@/server/cash/sessions`, `@/server/cash/session-queries`, `@/server/cash/schemas`, `listStoreOptions`, `parseBrlToCents`/`formatCentsInput`, `formatCurrencyCents`, `formatDateTime`.

## 6. Invariantes
- A tela não calcula esperado nem diferença; mostra o que o serviço devolve.
- Fechamento cego: o operador sem `cash.read` só vê o esperado depois de fechar.
- Chaves de idempotência: abertura gerada no servidor por renderização; suprimento/sangria por abertura do diálogo.
- Comentários em inglês; arquivos ≤ 350 linhas; sem `any`, `console`, `dangerouslySetInnerHTML`, `@/db`.

## 7. Erros e casos de borda
| Situação | Comportamento esperado |
|----------|------------------------|
| Caixa já aberto por outro / operador com outro caixa | Mensagem de conflito do serviço |
| Duplo clique em abrir, suprimento ou sangria | Uma só sessão / um só movimento |
| Sangria acima do disponível | Erro no campo `amount` |
| Fechar com diferença sem observação | Erro no campo `note` |
| Sessão de outro operador | `notFound()` para quem não tem `cash.manage` |
| Plano sem `pos` | Mensagem do serviço (`limit`) num `Card` |

## 8. Segurança
`requireTenantContext()` em páginas e ações; o servidor decide permissão, escopo e valores; nenhuma soma feita no cliente vai para o servidor.

## 9. Critérios de aceite
### 9.1 Automáticos
- [ ] `lint`, `typecheck`, `lint:rules`, `test`, `build` verdes; gate `PASS`.
- [ ] `Select-String` sem `@/db|drizzle-orm|dangerouslySetInnerHTML|console\.` em `src/app/(app)/caixa/**`; `requireTenantContext` em todas as `page.tsx` e no `actions.ts`.

### 9.2 Manual (Maestro, banco descartável)
- [ ] Operador abre com R$ 100,00, faz suprimento e sangria, fecha contando a menos: vê a diferença só depois de fechar; observação exigida.
- [ ] Duplo clique em "Abrir caixa" e em "Registrar sangria" não duplica.
- [ ] Gerente reabre a sessão com motivo; histórico mostra os eventos; fecha sessão de outro operador.
- [ ] Financeiro vê sessões e detalhes sem botões; Vendedor sem acesso.
- [ ] Celular sem rolagem horizontal; diálogos utilizáveis só com teclado.

## 10. Política de dúvida
Dúvidas ao Maestro, em lote, com proposta. PLANO antes de editar e `DEC-xxx` antes de começar. Sem `git add`, sem commit, sem branch.

## 11. Dependências
Nenhuma nova; nenhuma alteração em `package.json` nem em lockfile.

## 12. Comandos de verificação
```
lint/typecheck/rules/test/build: corepack pnpm lint | typecheck | lint:rules | test | build
gate: pwsh -NoProfile -Command "& tools/gate/gate.ps1 -Module m05b-telas-caixa -Allowed @('src/app/(app)/caixa/**')"
```
