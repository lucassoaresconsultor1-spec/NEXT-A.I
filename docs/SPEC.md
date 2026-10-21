# SPEC — <nome do projeto>

> Dono: Arquiteto (Opus/Codex). Workers (Antigravity) NÃO editam este arquivo.
> Versão: 1 · Atualizar a versão a cada mudança de contrato (ver seção 6).

## 0. Visão e restrições
- Objetivo do produto (3 linhas no máximo):
- Stack fixada (linguagem, framework, banco, libs permitidas):
- Restrições não funcionais (desempenho, LGPD, multi-tenant, offline...):

## 1. Mapa de módulos

| ID | Responsabilidade | Depende de | Risco | Quem implementa |
|----|------------------|------------|-------|-----------------|
| m01-auth | ... | - | SENSÍVEL | Arquiteto/Codex (nunca worker) |
| m02-produtos | ... | m01-auth | BAIXO | Worker |

Risco **SENSÍVEL** = auth, autorização, pagamentos, criptografia, migrações destrutivas, segredos, entrada externa não confiável, integrações com terceiros. Esses módulos não vão para o worker gratuito.

## 2. Decisões de arquitetura (ADRs curtos)
- ADR-001: <decisão> — por quê — alternativa descartada.

## 3. Modelo de ameaças
| Superfície | Ameaça | Mitigação obrigatória | Módulo |
|------------|--------|-----------------------|--------|

## 4. Contratos de módulo
Um arquivo por módulo em `docs/contracts/<id>.md`, a partir de `MODULE-CONTRACT.template.md`.
Contrato incompleto = módulo não pode ser delegado.

## 5. Definição de pronto global
- Gate (`gate.ps1`) retorna PASS para o módulo.
- Testes de aceite do contrato existem e passam.
- Nenhum arquivo fora da allowlist foi alterado.
- Nenhuma dependência nova sem aprovação do Arquiteto.
- Módulos de risco SENSÍVEL passaram pela revisão do checklist.

## 6. Registro de mudanças de contrato
| Versão | Data | Módulo | Mudança | Motivo |
|--------|------|--------|---------|--------|
