# Contrato do módulo `<id>` — v1

> Escrito pelo Arquiteto. O worker implementa o que está aqui e nada além.
> Se algo estiver ambíguo, o worker PERGUNTA (ver seção 10); não presume.

## 1. Objetivo
Uma frase: o que este módulo faz e para quem.

## 2. Fora de escopo
- O que o worker NÃO deve fazer (ex.: não mexer em auth, não criar telas).

## 3. Allowlist de arquivos
Somente estes caminhos podem ser criados ou alterados (usados pelo gate):
```
src/<modulo>/**
tests/<modulo>/**
```
Qualquer outro caminho = falha automática do gate.

## 4. Interface pública
Assinaturas, tipos, endpoints ou eventos exatos. Cole código real (interfaces/stubs), não prosa.
```
// exemplo
export interface ProdutoRepo {
  criar(input: NovoProduto): Promise<Produto>;
  buscar(id: string, tenantId: string): Promise<Produto | null>;
}
```

## 5. Dados e esquemas
Tabelas, campos, tipos, índices e constraints. Migrações NÃO são aplicadas pelo worker: ele apenas gera o arquivo, o Arquiteto aprova.

## 6. Invariantes e regras de negócio
- Regras que sempre valem (ex.: estoque nunca negativo; toda consulta filtra por tenant).

## 7. Erros e casos de borda
| Situação | Comportamento esperado |
|----------|------------------------|

## 8. Segurança (obrigatório mesmo em módulo BAIXO)
- Toda entrada externa validada por schema antes do uso.
- Toda leitura/escrita de recurso confere autorização e tenant.
- Sem segredos no código; sem log de dados pessoais.
- Queries parametrizadas; sem concatenação de SQL.

## 9. Critérios de aceite (escritos/aprovados pelo Arquiteto)
Lista de testes que DEVEM existir e passar. O worker implementa até o gate passar; não enfraquece testes.
- [ ] teste: ...
- [ ] teste: ...

## 10. Política de dúvida
O worker pergunta ao Maestro (não ao Arquiteto) quando: contrato ambíguo, interface insuficiente, dependência nova necessária. Perguntas em lote, com a proposta de resposta já escrita. O Maestro só escala ao Arquiteto o que for decisão de arquitetura.

## 11. Dependências
- Permitidas: <libs>
- Proibidas: qualquer outra (pedir aprovação antes de instalar).

## 12. Comandos de verificação
```
lint:      <comando>
typecheck: <comando>
test:      <comando>
```
