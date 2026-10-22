# Backup e restauração

> Módulo m41. Objetivo: nenhuma perda além de 24 horas (backup diário) e restauração comprovada todos os dias por um ensaio automático.

## Papel de backup (uma vez, feito pelo dono da infraestrutura)

Todas as tabelas de empresa usam `FORCE ROW LEVEL SECURITY`; até o papel dono das tabelas só enxerga linhas de uma empresa por vez. Por isso o `pg_dump` com o papel dono **recusa** rodar (testado: "a consulta seria afetada pela política de segurança no nível de linha"), em vez de gerar um backup vazio. O backup usa um papel próprio, só de leitura, com `BYPASSRLS`:

```sql
CREATE ROLE varejo_backup LOGIN PASSWORD '<senha longa>' NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE <banco> TO varejo_backup;
GRANT USAGE ON SCHEMA public, drizzle TO varejo_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public, drizzle TO varejo_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO varejo_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE <dono das tabelas> IN SCHEMA public GRANT SELECT ON TABLES TO varejo_backup;
```

A credencial desse papel é secreta e nunca vai para a aplicação (`DATABASE_URL` continua sem `BYPASSRLS`).

## Backup diário automático

Workflow `.github/workflows/backup.yml` (todo dia às 03:00 de São Paulo, ou manual). Segredos do repositório, configurados pelo dono: `BACKUP_DATABASE_URL` (papel acima) e `BACKUP_PASSPHRASE`.

1. Tira a impressão digital da origem (`tools/backup/fingerprint.ts collect`): tabelas, linhas, RLS, políticas e migrações.
2. Faz o dump (`pg_dump --format=custom`).
3. **Ensaio de restauração:** restaura num PostgreSQL 17 descartável do próprio job, tira a impressão digital e compara; qualquer diferença falha o job.
4. Criptografa o dump (AES-256, `gpg`) e guarda só o arquivo criptografado e a impressão digital como artefato por 30 dias.

**Pendente (decisão do dono):** cópia fora do GitHub (armazenamento externo com retenção maior) e alerta quando o job falhar.

## Restaurar depois de um incidente

1. Baixar o artefato do dia escolhido e descriptografar: `gpg --decrypt --output backup.dump backup.dump.gpg`.
2. Criar um banco **novo e vazio** (nunca restaurar por cima do banco em uso) e restaurar com o papel dono: `pg_restore --no-owner --no-privileges --exit-on-error --dbname=<novo banco> backup.dump`.
3. Recriar os privilégios do papel da aplicação (ver `docs/onboarding.md`) e conferir a impressão digital contra o `source.json` do mesmo artefato.
4. Apontar `DATABASE_URL`/`DATABASE_MIGRATION_URL` para o banco restaurado, rodar `pnpm db:migrate` (só aplica o que faltar) e validar o login e uma venda de teste.

## Ensaio local

`tools/backup/restore-drill.ps1` faz os mesmos passos com `BACKUP_DATABASE_URL` e `RESTORE_DATABASE_URL`. O alvo precisa ser local, vazio e terminar em `_restore`; qualquer outro é recusado.
