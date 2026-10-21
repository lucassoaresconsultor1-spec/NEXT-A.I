# Progresso do desenvolvimento autônomo

Resumo das etapas concluídas até **22/10/2026**, no commit `d247855` da branch `build/fases-1-8` (enviada ao GitHub). **Nada foi mesclado na `main` nem publicado.** O plano completo é o [SPEC](SPEC.md) (61 módulos, 8 fases); o registro de decisões é o [DECISIONS](DECISIONS.md); o estado por fase continua no [roadmap](roadmap.md).

## 1. Resumo em números
- **Módulos integrados nesta rodada:** 8 (m01, m02a, m02b, m27, m28a, m29a, m30a e o m44 de correção de teste), mais o back-end de catálogo e estoque e a infraestrutura de esteira.
- **Migrações novas:** 0005 a 0014 (catálogo/estoque, configurações operacionais, clientes, compras, transferências e reservas), todas com RLS forçado.
- **Testes verdes no último módulo integrado:** 260 unitários e **152 de integração** (PostgreSQL real, `varejo_test`).
- **Contratos escritos:** 17 (m01, m02a, m02b, m03, m04, m05a, m06a, m14, m26, m27, m28a, m28b, m29a, m29b, m30a, m30b, m44).
- **Ainda sem verificação manual no navegador** (celular, perfis, acessibilidade): fica para o marco de cada fase.

## 2. Etapas concluídas

| Etapa | Commit | O que entrega | Verificação |
|---|---|---|---|
| Back-end de catálogo e estoque (Fase 2, incremento 1) | `d2cedd8` | Produtos, variações, categorias, marcas, fornecedores, histórico de preço e custo, livro de estoque e saldo por loja (migrações 0005/0006) | Integração 115/115 no PostgreSQL; um defeito real achado e corrigido (preço e custo vinham `null` na leitura) |
| Kit modular (gate, contratos, protocolo) | `b48b6d3`, `7a69ba6` | `tools/gate/`, templates, SPEC com mapa de módulos, ADRs e modelo de ameaças | Gate validado em cenários (PASS, REVIEW, FAIL) |
| **m01 dias úteis** | `5052d8f` | Biblioteca pura de calendário: dia útil, Páscoa, contagem e lista de dias úteis | 74 testes, 3 fusos, gate PASS |
| Dados de feriados de Araruama/RJ | `6ae64f1` | Referência no SPEC (Corpus Christi como ponto facultativo, divergência com a Lei 2709/2025 mantida) | Fontes oficiais citadas; pendente de confirmação profissional |
| Infraestrutura de testes e gate | `ac79fd4`, `da0f21e` | Banco `varejo_test` local, `with-test-db.ps1` (só `varejo_test` em localhost, com **trava exclusiva** contra suítes simultâneas), gate roda a integração em arquivo sensível | 115 e depois 152 testes |
| **m02a categorias e marcas** | `015a53b` | Telas e seção "Catálogo" no menu; filtro de situação, diálogos compartilhados | Gate isolado PASS; build compila as rotas |
| **m27 regras de operação** (1ª migração) | `5b16c4c` | Cliente na venda, teto de desconto e textos do comprovante por empresa e loja (migrações 0007/0008, permissão `settings.operations.manage`) | Gate PASS+REVIEW; revisão de segurança própria |
| **m02b fornecedores** | `7a29ffb` | Tela com busca por nome, situação e paginação | Gate isolado PASS |
| **m28a clientes** (2ª migração) | `7a9c5ab` | Cadastro de clientes com CPF mascarado no servidor, auditoria mascarada, permissões `customers.*` (0009/0010) | PASS+REVIEW; **defeito achado na revisão** (máscaras iguais descartavam edições) corrigido com teste |
| **m44 teste de autenticação estável** | `82d56b9` | Tentativas sem `.catch` que escondia erros, IPs determinísticos, mesma cobertura e limites | 130/130; arquivo 3 vezes mais rápido |
| **m29a compras** (3ª migração) | `77c217a` | Pedidos, recebimento contra pedido (entrada no livro e custo de reposição na mesma transação, idempotente por chave), contador de documentos (0011/0012) | PASS+REVIEW, 142 testes; revisão do recebimento |
| **m30a transferências e reservas** (4ª migração) | `d247855` | Transferências (solicitada → aprovada → em trânsito → recebida/cancelada), reservas, colunas `reserved` e `in_transit`, regra "saldo nunca abaixo do reservado" (0013/0014) | PASS+REVIEW, 152 testes |
| Planejamento | `2eaf3b5`, `4a08335`, `fe7f9d6` | SPEC v8 com 61 módulos, ADR-008 a ADR-020, contratos dos lotes 1 e 2 e do m14 | Revisões do Arquiteto (Opus) |

## 3. Como a esteira funciona
- **Roteamento:** nível básico = Antigravity, intermediário = Codex, avançado = Opus (dono do SPEC e das migrações, uma por vez). Hoje o Antigravity está sem cota (volta por volta de 27/10/2026) e o básico foi para o Codex ([DECISIONS](DECISIONS.md)).
- **Verificação:** cada módulo é verificado **numa cópia limpa do repositório** com o gate sem modificação, porque vários agentes escrevem na mesma árvore. Módulos que tocam banco rodam a suíte de integração pela trava. A revisão de segurança dos arquivos sensíveis é feita à mão, com o [REVIEW-CHECKLIST](REVIEW-CHECKLIST.md).
- **Commit:** só o Maestro mexe no Git, sempre pelos caminhos da allowlist do contrato.

## 4. Achados que a revisão evitou de ir para produção
1. Preço e custo atuais retornavam `null` na leitura de produto (subconsulta correlacionada sem prefixo).
2. Edição de cliente descartada em silêncio quando e-mail, CPF ou telefone novos tinham a mesma máscara dos antigos.
3. Teste de limite de tentativas de login engolia erros de infraestrutura; execuções simultâneas da suíte derrubavam 12 testes.
4. Mudanças pedidas ao próprio gate (ignorar arquivos de outros módulos) foram recusadas: a verificação passou a ser isolada, sem enfraquecer o gate.

## 5. Em andamento e bloqueios
- **Em andamento (Opus):** m05a caixa (5ª migração, arquivos já na árvore sem commit) e o lote 3 de contratos (m06a escrito; faltam m05b, m06b, m06c). O m06a (PDV) é o próximo grande.
- **Parados:** m26 (arquivos na árvore, não verificados), m14, m28b, m29b, m30b, m03 e m04. **Motivo:** o terminal "Codex — Apoio" está ocupado por uma sessão do Claude Code em somente leitura, não pelo Codex CLI. É preciso abrir o Codex CLI nele.
- **Antigravity:** sem cota até cerca de 27/10/2026.

## 6. Riscos e pendências que dependem de você
- **Feriados:** a lista nacional e os dados de Araruama precisam de confirmação contábil/jurídica antes de produção; Corpus Christi está como ponto facultativo no decreto de 2026, mas a Lei 2709/2025 o institui como feriado.
- **LGPD:** retenção e anonimização de clientes a pedido do titular continuam pendência de produto; qualquer membro com `customers.read` vê todos os clientes da empresa (ADR-017); a busca por CPF exato não tem limite de taxa.
- **Reservas de venda** (m06a) não expiram sozinhas nesta versão; a divergência de recebimento de transferência não vira perda automática (precisa do relatório do m18).
- **Credenciais e integrações reais:** provedor de pagamento (PIX e cartão), fiscal, e-mail, IA, Vercel e Neon, domínio. Nenhum foi simulado; dependem de você.
- **Publicação:** nada foi publicado nem mesclado na `main`.
- **Verificação visual e de acessibilidade, e testes e2e**, ainda não executados nesta rodada.

## 7. Próximos passos
1. Abrir o Codex CLI no terminal "Codex — Apoio"; então o Maestro entrega m26, m14, m28b, m29b, m03, m04 e m30b em sequência.
2. Integrar o m05a (caixa) e escrever os contratos restantes do lote 3.
3. m06a (PDV, vendas, pagamentos locais, idempotência) e as telas do PDV; fechar o **marco M2** (fase 2) com venda de pagamentos múltiplos, estoque e caixa atômicos, e e2e.
4. Fases 3 a 8 conforme o SPEC.

## 8. Como retomar
- Estado real: `git log --oneline`, [SPEC](SPEC.md) (mapa e ADRs), [DECISIONS](DECISIONS.md) e `.maestri/progress.json` (não versionado).
- Banco de teste: `pwsh -NoProfile -File tools/gate/with-test-db.ps1 corepack pnpm test:integration` (credenciais em `.env.test-db.local`, ignorado pelo Git; ver [quality](quality.md)).
- Gate de um módulo: `pwsh -NoProfile -Command "& tools/gate/gate.ps1 -Module <id> -Allowed @(...)"` com a allowlist do contrato; repetir numa cópia limpa (`git worktree add --detach`) quando houver trabalho de outros agentes na árvore.
- Prompt mestre: `C:\Users\Usuario\Downloads\kit-modular\protocol\PROMPT-MESTRE-NEXT-AI.md`.
