# Contrato do módulo `m44-auth-teste-estavel` — v1

> Escrito pelo Arquiteto (Opus) em 22/10/2026 a pedido do Maestro. Correção só de teste; nenhum código de produto muda.
> Risco: **BAIXO** (teste). Nível: **A** (Opus), por tocar a prova do limite de tentativas de login.

## 1. Objetivo
Tornar `tests/integration/auth.test.ts` determinístico e fazer a causa real aparecer quando ele falhar, sem enfraquecer o que ele prova sobre o limite de tentativas.

## 2. Diagnóstico (análise estática de 22/10/2026)
- O teste "caps attempts against one account across many addresses" (linha ~100) é determinístico **se nenhuma tentativa lançar erro de infraestrutura**: cada uma das 30 falhas de senha conta 1 no limite da conta (30), e a 31ª é recusada. Colisão de IP aleatório entre as 30 tentativas não muda isso (o par conta+IP só bloqueia a partir de 5).
- O defeito do teste é `.catch(() => undefined)`: qualquer outro erro (conexão, tempo esgotado, banco recriado no meio da execução) é engolido. A tentativa não conta, e o teste falha na asserção final com uma mensagem enganosa ("esperava limit"), escondendo a causa.
- Falhas de 12 testes numa execução, que passam na seguinte, combinam com causa de **ambiente**, e não com o limite:
  - duas suítes rodando ao mesmo tempo no `varejo_test` (o `global-setup` apaga e recria o schema `public`);
  - ou CPU saturada, já que cada tentativa verifica um scrypt real com N=2¹⁶ porque a conta é criada pelo `signUp`, e 31 verificações sob carga se aproximam do `testTimeout` de 30 s.
- Nada indica falha real do limite sob concorrência: `hitRateLimit` é um único `INSERT … ON CONFLICT DO UPDATE … RETURNING` atômico, e o teste "counts concurrent attempts atomically" cobre isso.

## 3. Allowlist de arquivos
```
tests/integration/auth.test.ts
```
(`fixtures.ts` não precisa mudar: `createOrganizationFixture` já cria a conta com hash rápido e `TEST_PASSWORD`.)

## 4. Mudanças
1. **IPs determinísticos:** `meta()` passa a gerar endereços únicos por execução com um contador de módulo, na faixa de testes `198.18.0.0/15` (`198.18.{n >> 8}.{n & 255}`), em vez de `Math.random()`. Cada chamada devolve um IP novo; os testes que reusam um mesmo atacante continuam guardando o valor numa variável.
2. **Erros visíveis:** as tentativas que devem falhar usam um helper `expectRejected(promise, codes)`, que exige a rejeição com `code` em `codes` (`"unauthenticated"` para senha errada; `"unauthenticated" | "limit"` onde o bloqueio pode começar no meio do laço). Qualquer outro erro faz o teste falhar com o erro original.
3. **Velocidade:** os testes do bloco de limites ("throttles…", "does not let one address…", "caps attempts…", "counts concurrent attempts…") criam a conta com `createOrganizationFixture()` (hash rápido) e usam `ownerEmail` com `TEST_PASSWORD`. Os testes de cadastro e de hash continuam usando o `signUp` real.
4. Nenhuma asserção existente é removida nem afrouxada; os limites (5/30/50) e o mínimo de 7 bloqueios na concorrência continuam iguais.

## 5. Fora de escopo
- `src/server/auth/**` (só com escalonamento e evidência de falha real).
- **Serialização da suíte** (causa provável de ambiente): recomendação ao Maestro, fora desta allowlist. Em `tools/gate/with-test-db.ps1`, abrir um arquivo de trava exclusivo (ex.: `.git/varejo_test.lock` com `FileShare.None`) antes de rodar o comando e recusar com mensagem clara quando outro processo estiver com ele.

## 6. Critérios de aceite
- [ ] `tests/integration/auth.test.ts` passa 5 vezes seguidas (`pwsh -NoProfile -File tools/gate/with-test-db.ps1 corepack pnpm test:integration tests/integration/auth.test.ts`), e a suíte completa passa.
- [ ] Nenhum `.catch(() => undefined)` em tentativas de login; `Select-String -Path tests/integration/auth.test.ts -Pattern "Math.random"` vazio.
- [ ] Tempo do arquivo menor que antes (relatar antes/depois).
- [ ] `lint` e `typecheck` verdes.

## 7. Dependências
Nenhuma.
