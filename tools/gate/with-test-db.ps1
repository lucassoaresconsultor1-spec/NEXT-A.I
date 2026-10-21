<#
.SYNOPSIS
  Runs a command with TEST_DATABASE_URL / TEST_DATABASE_MIGRATION_URL loaded from the
  git-ignored file .env.test-db.local (repo root). Used by the gate's integration step.

.DESCRIPTION
  The integration suite DROPS AND RECREATES the schema of the target database, so this
  script refuses to run unless both URLs point at a database named "varejo_test" on
  localhost. Credentials never live in the repository: create .env.test-db.local with
  the two variables (see docs/quality.md).

.EXAMPLE
  pwsh -NoProfile -File tools/gate/with-test-db.ps1 corepack pnpm test:integration
#>
param(
  [Parameter(Mandatory, ValueFromRemainingArguments)][string[]]$Command
)

$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$envFile = Join-Path $root '.env.test-db.local'
if (-not (Test-Path -LiteralPath $envFile)) {
  Write-Output "[test-db] arquivo ausente: .env.test-db.local (veja docs/quality.md); integracao nao executada"
  exit 1
}

$vars = @{}
foreach ($line in Get-Content -LiteralPath $envFile) {
  if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { $vars[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'") }
}

foreach ($name in 'TEST_DATABASE_URL', 'TEST_DATABASE_MIGRATION_URL') {
  if (-not $vars.ContainsKey($name)) { Write-Output "[test-db] $name ausente em .env.test-db.local"; exit 1 }
  $uri = [Uri]$vars[$name]
  $database = [Uri]::UnescapeDataString($uri.AbsolutePath.TrimStart('/'))
  if ($database -ne 'varejo_test') { Write-Output "[test-db] $name nao aponta para o banco varejo_test; abortado"; exit 1 }
  if ($uri.Host -notin @('localhost', '127.0.0.1', '::1')) { Write-Output "[test-db] $name nao e local; abortado"; exit 1 }
  Set-Item -Path "Env:$name" -Value $vars[$name]
}

Write-Output '[test-db] URLs validadas para varejo_test (valores omitidos)'

# Exclusive machine-wide lock: the suite recreates the schema, so two runs at once
# (agents, gates in other worktrees) would corrupt each other. Waits up to 20 minutes.
$lockPath = Join-Path ([IO.Path]::GetTempPath()) 'varejo_test.lock'
$deadline = (Get-Date).AddMinutes(20)
$lock = $null
$announced = $false
while ($null -eq $lock) {
  try {
    $lock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  } catch [IO.IOException] {
    if ((Get-Date) -gt $deadline) { Write-Output '[test-db] varejo_test em uso ha mais de 20 minutos por outra execucao; abortado'; exit 1 }
    if (-not $announced) { Write-Output '[test-db] aguardando outra execucao liberar o varejo_test...'; $announced = $true }
    Start-Sleep -Seconds 5
  }
}
try {
  & $Command[0] @($Command | Select-Object -Skip 1)
  $code = $LASTEXITCODE
} finally {
  $lock.Dispose()
}
exit $code
