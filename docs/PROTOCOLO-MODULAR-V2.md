PROTOCOLO MODULAR v2. Estende o Protocolo de aprovacao (nao substitui). Objetivo: codigo em volume nos workers gratuitos, tokens caros so em arquitetura, seguranca e integracao.

PAPEIS
- Arquiteto (Opus): SPEC, contratos por modulo, modelo de ameacas, modulos SENSIVEIS, integracao final.
- Auditor (Codex): revisa/implementa SENSIVEIS e responde escalonamentos de seguranca.
- Maestro (Sonnet): valida contratos, distribui, aprova planos, revisa diffs sensiveis.
- Workers (Antigravity): implementam modulos de risco BAIXO dentro da allowlist.
- Gate (script, sem LLM): tools/gate/gate.ps1 decide PASS, PASS+REVIEW ou FAIL.

FLUXO
0. Pre-requisito: o repositorio tem docs/ e tools/gate/ (kit modular, init-project.ps1). Se faltar, o Maestro pede autorizacao explicita ao usuario antes de instalar, pois isso altera o repositorio. O gate pula (e informa) scripts npm que o projeto ainda nao tem.
0b. Ponto de partida do gate: antes de o worker comecar, o ideal e um commit base. Se a arvore tem alteracoes nao commitadas (ex.: modulos em andamento), o Maestro roda uma vez `pwsh tools/gate/gate.ps1 -Module <id> -InitBaseline` e o gate passa a contar so o que mudar depois. Sem isso tudo aparece como "fora da allowlist".
1. Arquiteto escreve docs/SPEC.md e docs/contracts/<id>.md (templates do kit). Sem contrato completo nao ha delegacao.
2. Maestro valida o contrato e delega via `maestri ask --batch`, um modulo por worker, com ask back.
3. Worker envia PLANO (protocolo de aprovacao), recebe DEC-xxx, implementa so a allowlist e roda o gate ate verde.
4. Worker reporta: saida do gate, git diff --stat, arquivos sensiveis tocados, duvidas. Sem colar codigo.
5. Maestro decide pelo gate:
   - FAIL: devolve a saida ao worker (sem ler codigo).
   - PASS: integra.
   - PASS+REVIEW: revisa so o diff dos arquivos sensiveis com docs/REVIEW-CHECKLIST.md. Escala ao Auditor se o checklist mandar.
6. Duvida de contrato: worker -> Maestro (em lote, com proposta). Maestro -> Arquiteto so se for decisao de arquitetura. Contrato alterado = versao nova no SPEC secao 6.
7. Apos varios modulos verdes, Arquiteto fecha a integracao (fluxo ponta a ponta).

NUNCA DELEGAR A WORKER GRATUITO
Criptografia; autenticacao e sessao; regras de autorizacao; pagamentos reais; migracao destrutiva; segredos e .env; qualquer coisa sem teste que a cubra.

REGRAS DE CUSTO (modelos caros)
- Nao ler modulo inteiro: gate + diff --stat + diff dos arquivos sensiveis.
- Duvidas em lote, com a resposta proposta.
- Citar caminhos em vez de colar contexto longo.
- Revisao e por excecao (PASS+REVIEW), nao por rotina.

QUALIDADE
- Testes de aceite pertencem ao contrato: worker nao enfraquece, pula nem apaga (o gate detecta).
- Dependencia nova, .env e arquivos fora da allowlist sao FAIL automatico.
- Cota do worker acabou: pausar, commitar o que esta verde, avisar o usuario. Modulo sensivel nao troca de executor sem aprovacao.

LIMITES DO GATE (o que ele NAO ve): asserts enfraquecidos (ele so marca REVIEW quando ha mais asserts removidos que adicionados), regras de negocio erradas, RLS/saldo sem a suite de integracao. Para isso o Arquiteto escreve os testes de aceite e `sensitiveCommands` no gate.config.json roda a suite de integracao quando um arquivo sensivel e tocado.

LIMITE: convencao de trabalho, nao bloqueio tecnico. O Maestri nao impede edicoes fora do fluxo; o gate e a verificacao objetiva.
