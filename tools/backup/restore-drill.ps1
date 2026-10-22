<#
.SYNOPSIS
  Local restore drill (m41): dumps BACKUP_DATABASE_URL, restores into a disposable
  database and compares both fingerprints. Same steps as .github/workflows/backup.yml.

.DESCRIPTION
  BACKUP_DATABASE_URL: read-only role WITH BYPASSRLS (docs/backup.md).
  RESTORE_DATABASE_URL: an EMPTY disposable database on localhost whose name ends in
  "_restore"; anything else is refused, so a real database is never overwritten.
  Requires pg_dump/pg_restore 17 on the PATH (or PG_BIN pointing to their folder).
#>
$ErrorActionPreference = 'Stop'
foreach ($name in 'BACKUP_DATABASE_URL', 'RESTORE_DATABASE_URL') {
  if (-not (Get-Item -Path "Env:$name" -ErrorAction SilentlyContinue)) { Write-Output "[backup] $name ausente"; exit 1 }
}
$target = [Uri]$env:RESTORE_DATABASE_URL
$database = [Uri]::UnescapeDataString($target.AbsolutePath.TrimStart('/'))
if ($target.Host -notin @('localhost', '127.0.0.1', '::1') -or -not $database.EndsWith('_restore')) {
  Write-Output "[backup] RESTORE_DATABASE_URL precisa ser local e terminar em _restore; abortado"
  exit 1
}
$bin = if ($env:PG_BIN) { $env:PG_BIN } else { '' }
$work = Join-Path ([IO.Path]::GetTempPath()) "varejo-restore-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $work | Out-Null
try {
  & corepack pnpm exec tsx tools/backup/fingerprint.ts collect BACKUP_DATABASE_URL (Join-Path $work 'source.json'); if ($LASTEXITCODE) { exit 1 }
  & (Join-Path $bin 'pg_dump') --format=custom --no-owner --no-privileges --file=(Join-Path $work 'backup.dump') $env:BACKUP_DATABASE_URL; if ($LASTEXITCODE) { exit 1 }
  & (Join-Path $bin 'pg_restore') --no-owner --no-privileges --exit-on-error --dbname=$env:RESTORE_DATABASE_URL (Join-Path $work 'backup.dump'); if ($LASTEXITCODE) { exit 1 }
  & corepack pnpm exec tsx tools/backup/fingerprint.ts collect RESTORE_DATABASE_URL (Join-Path $work 'restored.json'); if ($LASTEXITCODE) { exit 1 }
  & corepack pnpm exec tsx tools/backup/fingerprint.ts compare (Join-Path $work 'source.json') (Join-Path $work 'restored.json')
  exit $LASTEXITCODE
} finally {
  Remove-Item -Recurse -Force $work
}
