# Contrato do módulo `m26-estados-interface` — v1

> Escrito pelo Arquiteto (Opus) em 21/10/2026. O agente implementa o que está aqui e nada além.
> Se algo estiver ambíguo, o agente PERGUNTA (ver seção 10); não presume.
> Risco: **BAIXO** (apresentação; sem dados, sem regra de acesso). Nível: **I** (Codex), por mexer em `src/components/ui/`, que todas as telas usam.

## 1. Objetivo
Padronizar os estados de **carregando** e **erro** das telas autenticadas, com um componente `Skeleton` reutilizável, para que cada módulo de tela seguinte (m02b em diante) use o mesmo visual premium em vez de inventar o seu.

## 2. Fora de escopo
- Estados de vazio e de "sem permissão": já existem (`EmptyState` em `src/components/ui/feedback.tsx`, `AccessDenied` em `src/components/shell/access-denied.tsx`) e não mudam.
- `loading.tsx` ou `error.tsx` dentro de rotas específicas (`/lojas`, `/equipe`…): cada módulo de tela decide os seus depois, usando o que este módulo cria.
- Telas de autenticação (`src/app/(auth)/`), plataforma (`src/app/plataforma/`) e `global-error`.
- Qualquer arquivo de `src/server/`, `src/db/`, `src/lib/` e `docs/`.

## 3. Allowlist de arquivos
```
src/components/ui/skeleton.tsx
src/app/(app)/loading.tsx
src/app/(app)/error.tsx
src/app/error.tsx
```
Qualquer outro caminho = falha do gate. Veredito esperado: `PASS` (nenhum caminho sensível).

Pré-condição: árvore limpa e `corepack pnpm build` funcionando. Pode rodar em paralelo com o m02a e o m27 (arquivos disjuntos).

## 4. Interface pública
### 4.1 `src/components/ui/skeleton.tsx` (componente de servidor, sem `"use client"`)
```tsx
/** Placeholder block; decorative, so screen readers skip it. */
export function Skeleton(props: { className?: string }): React.JSX.Element;

/** Page placeholder: title, subtitle and a card with `rows` table-like lines. Announces "Carregando…" once. */
export function PageSkeleton(props: { rows?: number }): React.JSX.Element; // rows padrão: 6, mínimo 1, máximo 12
```
Regras visuais:
- `Skeleton` renderiza `<div aria-hidden="true">` com `rounded bg-line` e animação **só com movimento permitido**: `motion-safe:animate-pulse` (respeita `prefers-reduced-motion`). Combina `className` com `cn()` de `@/lib/utils`.
- `PageSkeleton` reproduz o ritmo de uma página real do produto: `Skeleton` de título (`h-6 w-48`), de descrição (`h-4 w-80 max-w-full`) e um `Card` (de `@/components/ui/layout`) com `rows` linhas de `h-4`, larguras alternadas (`w-full`, `w-5/6`, `w-2/3`) separadas por `border-b border-line` como as linhas de `Table`. Envolve tudo em `<div role="status" aria-live="polite">` com `<span className="sr-only">Carregando…</span>`.
- `rows` fora de 1..12 é limitado ao intervalo; valor não inteiro é arredondado para baixo.
- Sem cores fixas: só tokens já existentes (`bg-line`, `border-line`, `bg-surface`).

### 4.2 `src/app/(app)/loading.tsx`
Passa a ser só `export default function Loading() { return <PageSkeleton />; }` (mesmo comportamento de hoje, agora pelo componente).

### 4.3 `src/app/(app)/error.tsx` (novo, `"use client"`)
Limite de erro das telas autenticadas, dentro do layout (a barra lateral continua visível). No Next 16.4 a prop de recuperação é **`retry`** (estável desde 16.3; ver `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`).
```tsx
"use client";
export default function AppError(props: { error: unknown; retry: () => void }): React.JSX.Element;
```
Renderiza um `Card` com `EmptyState` (`icon` = `AlertTriangle` de `lucide-react`):
- título `Não foi possível carregar esta página`
- descrição `Tente novamente. Se o problema continuar, avise o suporte informando o código abaixo.`
- se `error` for `instanceof Error` e tiver `digest` (string), mostra abaixo `Código: {digest}` em `text-xs text-ink-muted` com fonte monoespaçada; **nunca** mostra `error.message` nem stack
- ação: `Button` (`@/components/ui/button`, `variant="primary"`) `Tentar novamente` que chama `retry()`, e `LinkButton` `Voltar ao painel` (`href="/painel"`, `variant="secondary"`)
- sem `console` (a regra `quality/no-direct-console` reprova) e sem `useEffect` de log: o servidor já registra o erro.

### 4.4 `src/app/error.tsx`
Troca `reset` por `retry` (mesma assinatura da 4.3) e mantém o layout e os textos atuais. Nada mais muda.

## 5. Dados e esquemas
Nenhum.

## 6. Invariantes e regras de negócio
- Nenhum detalhe técnico do erro chega à tela, exceto o `digest` (identificador gerado pelo Next para casar com o log do servidor).
- Animações respeitam `prefers-reduced-motion` (`motion-safe:`).
- Textos em pt-BR exatamente como na seção 4; comentários em inglês; arquivos ≤ 350 linhas; sem `any`, sem `console`.

## 7. Erros e casos de borda
| Situação | Comportamento esperado |
|----------|------------------------|
| `error` não é `Error` (valor lançado em componente cliente) | Mesma tela, sem a linha de código |
| `digest` ausente | Sem a linha de código |
| `PageSkeleton rows={0}` / `rows={50}` / `rows={2.7}` | 1 / 12 / 2 linhas |
| Usuário com movimento reduzido | Blocos estáticos, sem pulsar |

## 8. Segurança
- Sem `dangerouslySetInnerHTML`; a mensagem do erro nunca é renderizada.
- Sem acesso a dados, sem segredos, sem log.

## 9. Critérios de aceite
### 9.1 Automáticos
- [ ] `corepack pnpm lint`, `typecheck`, `lint:rules`, `test` e `build` passam (o build valida a assinatura do `error.tsx` com `retry`).
- [ ] Gate `PASS`.
- [ ] `Select-String -Path "src/app/(app)/error.tsx","src/app/error.tsx" -Pattern "error\.message|\.stack|console\."` não encontra nada.
- [ ] `Select-String -Path "src/components/ui/skeleton.tsx" -Pattern "animate-pulse"` só encontra ocorrências precedidas de `motion-safe:`.

### 9.2 Manual (Maestro)
- [ ] Navegar entre telas com rede lenta (DevTools) mostra o `PageSkeleton` dentro do layout.
- [ ] Um erro forçado numa página autenticada (ex.: lançar no `page.tsx` em ambiente local, sem commitar) mostra a tela da 4.3 com a barra lateral; "Tentar novamente" recarrega o segmento.
- [ ] Com "reduzir movimento" ligado no sistema, os blocos não pulsam.
- [ ] Contraste do texto ≥ 4,5:1 (tokens existentes).

## 10. Política de dúvida
Dúvidas ao Maestro, em lote, com a proposta de resposta. PLANO antes de editar e `DEC-xxx` antes de começar. Sem `git add`, sem commit, sem branch.

## 11. Dependências
- Permitidas: nenhuma nova (`react`, `next`, `lucide-react`, componentes de `@/components/ui/*`, `cn` de `@/lib/utils`).
- Proibidas: qualquer outra; nenhuma alteração em `package.json` nem em lockfile.

## 12. Comandos de verificação
```
lint:      corepack pnpm lint
typecheck: corepack pnpm typecheck
rules:     corepack pnpm lint:rules
test:      corepack pnpm test
build:     corepack pnpm build
gate:      pwsh -NoProfile -Command "& tools/gate/gate.ps1 -Module m26-estados-interface -Allowed @('src/components/ui/skeleton.tsx','src/app/(app)/loading.tsx','src/app/(app)/error.tsx','src/app/error.tsx')"
```
