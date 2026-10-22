# Contrato do módulo `m41-backup-restauracao` — v1

> Arquiteto (Opus), 22/10/2026. Risco **SENSÍVEL** (dados de todas as empresas). Nível **A**. Sem migração.

## 1. Objetivo
Procedimento, workflow e teste de restauração em banco descartável: backup diário criptografado com ensaio automático de restauração comparando a impressão digital (tabelas, linhas, RLS, políticas, migrações) da origem e da cópia.

## 3. Allowlist
`docs/backup.md`, `docs/security.md`, `docs/contracts/m41-backup-restauracao.md`, `.github/workflows/backup.yml`, `tools/backup/fingerprint.ts`, `tools/backup/restore-drill.ps1`, `src/lib/db-fingerprint.ts`, `src/lib/db-fingerprint.test.ts`.

## 6. Regras
Backup com papel só de leitura e `BYPASSRLS` (o papel dono recusa por causa do FORCE RLS); a coleta da impressão digital recusa papel sem `BYPASSRLS`; só o dump criptografado sai do job; restauração local só em banco local terminado em `_restore`.

## 9. Critérios de aceite
Unitário da comparação; coleta recusa papel sem `BYPASSRLS` e `pg_dump` com o papel dono falha sob FORCE RLS (verificados no banco de teste). **Pendente com credencial/infra do dono:** criar o papel de backup, os segredos `BACKUP_DATABASE_URL`/`BACKUP_PASSPHRASE` e a primeira execução do workflow; armazenamento externo e alerta de falha.
