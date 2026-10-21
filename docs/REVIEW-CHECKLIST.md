# Checklist de revisão (modelo caro, só superfícies sensíveis)

Regra de custo: **nunca ler o módulo inteiro**. Ler apenas (1) a saída do gate, (2) o `git diff --stat`, (3) o diff dos arquivos que o gate marcou como SENSÍVEIS.

## Gatilhos (o gate marca automaticamente por caminho)
auth, middleware, permissões/roles, pagamentos, migrações/SQL, config/segredos, upload, parsing de entrada externa, chamadas a APIs de terceiros.

## Para cada arquivo sensível
**Autorização**
- [ ] Todo acesso a recurso confere dono/tenant/perfil no servidor (não só no front)?
- [ ] Há IDOR possível (id vindo do cliente sem checagem)?

**Entrada**
- [ ] Entrada validada por schema antes de qualquer uso?
- [ ] Queries parametrizadas? Sem concatenação em SQL/shell/caminho de arquivo?
- [ ] Limites de tamanho e tipo em upload e payloads?

**Segredos e dados**
- [ ] Nenhum segredo, token ou chave no código ou em log?
- [ ] Dados pessoais fora de logs e mensagens de erro?
- [ ] Erros não vazam stack trace ou detalhes internos?

**Integridade**
- [ ] Operações financeiras/estoque são atômicas (transação) e idempotentes?
- [ ] Concorrência: há condição de corrida em saldo/estoque/contador?
- [ ] Migração é reversível e não apaga dados sem aprovação?

**Contrato**
- [ ] Interface pública idêntica ao contrato (sem campos extras ou renomeados)?
- [ ] Testes de aceite não foram enfraquecidos, removidos nem pulados (`skip`/`only`)?

## Veredito (formato curto)
```
REVISAO <modulo>: APROVADO | AJUSTES | REJEITADO
Achados: [arquivo:linha] problema → correção exigida
Escalar ao Auditor (Codex/Opus)? sim/não + motivo
```

## Escalar ao Auditor quando
Criptografia, fluxo de autenticação/sessão, regras de autorização novas, pagamentos reais, migração destrutiva, ou dúvida sobre exploração.
