# Design e acessibilidade

## Direção

Público: gestores e equipes de lojas brasileiras, de donos (desktop, análise) a vendedores e operadores (celular/tablet, rapidez). Interface inteiramente em português do Brasil. Tom: ERP/BI corporativo, sóbrio e denso, sem gradientes excessivos ou decoração sem função. Inspiração em padrões de usabilidade de ERPs e BIs profissionais, sem copiar identidade de concorrentes.

O **PDV** (Fase 2) terá layout próprio, focado em velocidade, teclado e leitor de código de barras; o layout de gestão é analítico. *(direção — ainda não implementado)*

**Identidade NEXT A.I (conceito 01B, escolhido pelo usuário):** logo, cores e regras de uso em [brand/next-ai/](../brand/next-ai/README.md). Não redesenhe o logo: `src/components/brand/logo.tsx` e `demo/js/icons.js` copiam a geometria exata dos SVGs da marca. App e demonstração usam a mesma paleta (lima `#9FE870` sobre verde-floresta `#062F28`) e as mesmas fontes; a demo tem sidebar clara e cards mais arredondados ([demo/README.md](../demo/README.md#visual)). Ícones do app (`src/app/icon.svg`, `apple-icon.png`, `favicon.ico`) vêm de `brand/next-ai/`.

## Sistema existente

Fonte de verdade dos tokens: `@theme` em `src/app/globals.css`.

| Papel | Token | Uso |
|---|---|---|
| Fundo | `canvas` (cinza quente `#EBEBEA`), `surface` (branco) | Página e cartões |
| Linhas | `line`, `line-strong` | Bordas de cartões, tabelas e controles |
| Texto | `ink` (verde-floresta), `ink-soft`, `ink-muted` | Títulos, corpo, apoio (todos ≥ 4,5:1 sobre `canvas`) |
| Sidebar | `sidebar` (verde-floresta), `sidebar-hover`, `sidebar-ink` | Navegação principal; item ativo em pílula `accent` com texto `sidebar` |
| Marca | `brand` (verde-floresta), `brand-strong`, `brand-soft` (verde acinzentado) | Ações primárias, links, foco, avisos informativos |
| Acento | `accent` (lima) | Preenchimento e destaque; nunca texto sobre branco (1,4:1) |
| Estados | `positive`, `critical`, `attention` (+ `-soft`) | Sucesso/indicador positivo, erro/alerta crítico, atenção/pendência |

Tipografia (`next/font/google`): Plus Jakarta Sans no texto (`font-sans`) e Urbanist em `h1`–`h3` (`font-display`); tamanhos contidos (títulos `text-xl`, corpo `text-sm`), números com `tabular-nums`. Botões em pílula, raio `--radius-card` (1 rem), sombra sutil `--shadow-card`.

Componentes (`src/components/ui/`): `Button`/`LinkButton` (primário, secundário, fantasma, perigo), `Field` + `Input`/`Select`/`Textarea`/`Checkbox` + `SubmitButton` (estado de envio e bloqueio de duplo envio), `Notice` (sucesso, erro, atenção, info), `Badge`, `EmptyState`, `Card`/`CardHeader`/`CardBody`/`DetailList`, `PageHeader`, `Table`/`Th`/`Td`/`Tr`/`SortableTh`/`Pagination`, `Dialog` (Radix). Shell (`src/components/shell/`): sidebar com seções, navegação móvel em gaveta, cabeçalho com busca global, seletor de loja e menu do perfil, breadcrumbs, `AccessDenied`.

A biblioteca de componentes é própria, sobre primitivas acessíveis do Radix (`radix-ui`) e ícones `lucide-react`. O registro do shadcn/ui estava inacessível no ambiente de bootstrap; os componentes seguem o mesmo princípio (código no projeto, só o necessário).

## Interação

Use HTML semântico, navegação por teclado, foco visível e contraste adequado. Dê nome a controles e campos. Erros de validação ficam junto do campo; operações assíncronas exibem espera e resultado. Respeite movimento reduzido.

Implementado: link "Pular para o conteúdo"; foco visível global (`:focus-visible` em `brand`); rótulos associados por `id`, dicas e erros por `aria-describedby`/`aria-invalid`; `role="alert"` em erros; `aria-current` na navegação e breadcrumbs; `aria-sort` em colunas ordenáveis; tabelas com `caption` acessível; ícones decorativos com `aria-hidden` e botões só com ícone com `aria-label`; modais com título, foco preso e `Esc` (Radix); redução de movimento global.

## Layout e revisão

- Breakpoints Tailwind: sidebar fixa a partir de `lg` (1024 px), gaveta abaixo; busca do cabeçalho a partir de `sm`; seletor de loja a partir de `md`; grades de indicadores 1 → 2 → 4 colunas.
- Tabelas rolam horizontalmente em telas estreitas (largura mínima 640 px) em vez de quebrar a página.
- Estados: vazio (`EmptyState` com próxima ação), carregamento (`(app)/loading.tsx`), erro (`error.tsx` genérico, `Notice` em formulários), sem permissão (`AccessDenied`), não encontrado (`not-found.tsx`).
- Indicadores comerciais não são exibidos sem dados: o painel explica quando chegam.
- Seletor global de período, notificações e gráficos entram com os módulos que os alimentam (Fases 4 e 6) — não há controles decorativos.

Revisão feita nesta entrega: inspeção visual de capturas (painel, listas, formulários, celular) e checagem dos critérios acima; a revisão completa com a skill `web-design-guidelines` está registrada em [setup.md](setup.md).

## Manutenção

Mudanças visuais e de interação atualizam a fonte de tokens/componentes e esta orientação quando houver alteração de regra. Consulte as skills de UI instaladas nas revisões pertinentes.
