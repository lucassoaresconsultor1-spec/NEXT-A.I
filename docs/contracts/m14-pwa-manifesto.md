# Contrato do módulo `m14-pwa-manifesto` — v1

> Escrito pelo Maestro em 22/10/2026 (módulo de nível básico, permitido pelo prompt mestre, seção 4), a partir do plano do Arquiteto (#23 do SPEC e ADR-006). O worker implementa o que está aqui e nada além.
> Se algo estiver ambíguo, o worker PERGUNTA (seção 10); não presume.
> Risco: **BAIXO**. Só metadados do app instalável: sem service worker, sem cache, sem rede, sem dados do usuário.

## 1. Objetivo
Tornar o NEXT A.I **instalável** como app (celular do vendedor, tablet da fila, desktop do PDV) com um manifesto web e a cor do tema, sem nenhuma capacidade offline ([ADR-006](../SPEC.md): o service worker é o m15).

## 2. Fora de escopo
- Service worker, cache, página offline, notificações push, atalhos de instalação personalizados, `beforeinstallprompt`.
- Ícone "maskable" (exige arte própria com margem de segurança; fica registrado como melhoria futura).
- Alterar `src/proxy.ts`, `public/icons/**`, `package.json`, lockfile ou `docs/`: o Maestro faz a mudança de uma linha no `proxy.ts` e fornece os ícones (seção 3).
- Qualquer tela nova.

## 3. Allowlist de arquivos
Somente estes caminhos podem ser criados ou alterados (usados pelo gate):
```
src/app/manifest.ts
src/app/manifest.test.ts
src/app/layout.tsx
```
**Fornecido pelo Maestro antes da delegação (o worker não cria nem altera):**
- `public/icons/icon-192.png` e `public/icons/icon-512.png`: cópias de `brand/next-ai/png/icon-192.png` e `icon-512.png` (arte oficial da marca, não redesenhar).
- Em `src/proxy.ts`, o `matcher` passa a excluir `manifest.webmanifest` (o navegador busca o manifesto sem sessão; sem isso ele seria redirecionado ao login e o app não seria instalável). As imagens em `/icons/*.png` já são excluídas pela regra de extensão existente.

Pré-condição: árvore limpa dos arquivos da allowlist; `corepack pnpm build` funcionando.

## 4. Interface pública
### 4.1 `src/app/manifest.ts` (convenção de arquivo do Next 16: serve `/manifest.webmanifest`)
```ts
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "NEXT A.I",
    short_name: "NEXT A.I",
    description: "Gestão de lojas, equipes e operação de varejo.",
    lang: "pt-BR",
    dir: "ltr",
    start_url: "/painel",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#062F28",
    theme_color: "#062F28",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
```
Os valores acima são exatos (cor `#062F28` = verde-floresta da identidade; `start_url` abre no painel, que redireciona ao login quando não há sessão). Nenhum campo extra (nada de `shortcuts`, `screenshots` ou `related_applications`).

### 4.2 `src/app/layout.tsx`
Acrescentar apenas a exportação de viewport, sem mudar o resto do layout:
```ts
import type { Metadata, Viewport } from "next";

export const viewport: Viewport = { themeColor: "#062F28" };
```
(o `metadata` existente, as fontes e o `<html lang="pt-BR">` permanecem como estão; o Next já liga o manifesto pela convenção de arquivo, sem `metadata.manifest`.)

## 5. Dados e esquemas
Nenhum. Sem banco, sem migração.

## 6. Invariantes e regras de negócio
- O manifesto é **estático e público**: não lê sessão, empresa, cookies nem banco, e não exporta nada que dependa do usuário.
- Nenhum caminho do manifesto aponta para fora de `/icons/`, `/painel` e `/`.
- Sem service worker: nada em `public/` registra um, e `layout.tsx` não importa script novo.
- Arquivos com no máximo 350 linhas; comentários em inglês; sem `any`; textos em pt-BR.

## 7. Erros e casos de borda
| Situação | Comportamento esperado |
|----------|------------------------|
| Acesso a `/manifest.webmanifest` sem sessão | `200` com o JSON (depois da mudança do Maestro no `proxy.ts`) |
| Ícone ausente em `public/icons/` | O teste da seção 9 falha (o worker avisa o Maestro; não cria ícones) |
| Instalação em aparelho compartilhado (tablet) | Não há dados em cache; a sessão continua sendo a do cookie (ADR-006) |

## 8. Segurança (obrigatório mesmo em módulo BAIXO)
- Nenhum segredo, token, identificador de empresa ou usuário no manifesto.
- Nenhuma capacidade nova: sem service worker, sem cache de páginas autenticadas (risco do ADR-006), sem push.
- `layout.tsx` continua sem scripts de terceiros.

## 9. Critérios de aceite (escritos/aprovados pelo Arquiteto)
Em `src/app/manifest.test.ts` (Vitest; o projeto não tem teste de componente, mas `manifest()` é uma função pura):
- [ ] `manifest()` devolve `name`, `short_name`, `lang` `"pt-BR"`, `start_url` `"/painel"`, `scope` `"/"`, `display` `"standalone"`, `theme_color` e `background_color` `"#062F28"`, exatamente como na seção 4.1.
- [ ] Os ícones são exatamente dois (192 e 512), `type` `"image/png"`, `purpose` `"any"`, e cada `src` começa com `/icons/`.
- [ ] Cada ícone existe em `public/` (`fs.existsSync` do caminho `public` + `src`) e o arquivo não está vazio.
- [ ] O manifesto não contém as chaves `shortcuts`, `screenshots` nem `related_applications`.
- [ ] O arquivo de teste não usa `any`, `skip` nem `only`.

Verificação por inspeção (Maestro): `layout.tsx` exporta `viewport` com `themeColor` e o restante do arquivo ficou igual; `GET /manifest.webmanifest` responde sem sessão; DevTools > Application > Manifest sem erros.

## 10. Política de dúvida
Dúvidas ao Maestro, em lote, com a proposta de resposta. Sem `git add`/`checkout`/`commit`, sem scripts auxiliares, sem ler o terminal do Maestro. Execução de um módulo por vez.

## 11. Dependências
- Permitidas: nenhuma nova (`next`, `vitest`, `node:fs` e `node:path` no teste).
- Proibidas: qualquer pacote de PWA (`next-pwa`, `serwist`, `workbox` etc.). Nenhuma alteração em `package.json` nem em lockfile.

## 12. Comandos de verificação
```
lint:      corepack pnpm lint
typecheck: corepack pnpm typecheck
rules:     corepack pnpm lint:rules
test:      corepack pnpm exec vitest run src/app/manifest.test.ts
test (todos): corepack pnpm test
build:     corepack pnpm build        (a rota /manifest.webmanifest aparece na saída)
gate:      pwsh -NoProfile -Command "& tools/gate/gate.ps1 -Module m14-pwa-manifesto -Allowed @('src/app/manifest.ts','src/app/manifest.test.ts','src/app/layout.tsx')"
sem service worker (não deve encontrar nada):
           Select-String -Path "src/app/*.ts*","public/**/*.js" -Pattern "serviceWorker|workbox|next-pwa|serwist" -ErrorAction SilentlyContinue
```
Resultado esperado do gate: `PASS`. O `build` fica de fora do gate: o worker o executa e relata.
