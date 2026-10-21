<#
.SYNOPSIS
  Portao de qualidade sem LLM para modulos entregues por workers.
  Roda na raiz do repositorio git. Saida curta de proposito (poupa tokens de quem le).

.PARAMETER Module        Id do modulo (rotula a saida e o baseline).
.PARAMETER Allowed       Globs de arquivos que o worker pode alterar (allowlist do contrato).
.PARAMETER Config        Caminho do gate.config.json (padrao: ao lado deste script).
.PARAMETER Base          Ref de comparacao do git (padrao: HEAD).
.PARAMETER AllowDeps     Permite alterar arquivos de dependencia (so com aprovacao do Arquiteto).
.PARAMETER InitBaseline  Grava o estado atual da arvore de trabalho como ponto de partida do
                         modulo. Rode UMA vez, antes do worker comecar, quando a arvore tem
                         alteracoes nao commitadas. Nas rodas seguintes so conta o que mudou
                         depois disso. O ideal continua sendo commitar um commit base.
.PARAMETER SkipCommands  Nao roda lint/typecheck/test (so as verificacoes estaticas).

.NOTES
  Exit 0 = PASS, 2 = PASS + REVIEW (arquivo sensivel ou asserts removidos), 1 = FAIL.

.EXAMPLE
  ./gate.ps1 -Module m02-produtos -InitBaseline
  ./gate.ps1 -Module m02-produtos -Allowed 'src/produtos/**','tests/produtos/**'
#>
param(
  [Parameter(Mandatory)][string]$Module,
  [string[]]$Allowed = @(),
  [string]$Config = (Join-Path $PSScriptRoot 'gate.config.json'),
  [string]$Base = 'HEAD',
  [switch]$AllowDeps,
  [switch]$InitBaseline,
  [switch]$SkipCommands
)

$ErrorActionPreference = 'Stop'

function Convert-Glob([string]$Glob) {
  $g = ($Glob.Replace('\', '/')) -replace '^\./', ''
  $r = [regex]::Escape($g)
  $r = $r -replace '\\\*\\\*/', '(.*/)?' -replace '\\\*\\\*', '.*' -replace '\\\*', '[^/]*'
  return "^$r$"
}

function Test-AnyGlob([string]$Path, [string[]]$Globs) {
  foreach ($g in $Globs) { if ($Path -match (Convert-Glob $g)) { return $true } }
  return $false
}

# le uma chave opcional do config (configs antigos nao quebram)
function Get-Cfg([string]$Key, $Default) {
  if ($cfg.PSObject.Properties.Name -contains $Key -and $null -ne $cfg.$Key) { return $cfg.$Key }
  return $Default
}

function Get-Sig([string]$Path) {
  if (Test-Path -LiteralPath $Path -PathType Leaf) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA1).Hash }
  return 'DELETED'
}

# roda um comando em processo filho (um `exit` ou erro nele nao derruba o gate)
function Invoke-GateCommand([string]$Name, [string]$Cmd) {
  if (-not $Cmd) { return $true }
  # script de package.json inexistente: pula e avisa, em vez de reprovar por culpa do projeto
  if ($Cmd -match '^(?:corepack\s+)?(?:npm|pnpm|yarn)\s+(?:run\s+)?([\w:.-]+)' -and (Test-Path package.json)) {
    $word = $Matches[1]
    if (@('exec', 'dlx', 'x', 'install', 'i', 'add', 'ci') -notcontains $word) {
      $scripts = (Get-Content package.json -Raw | ConvertFrom-Json).scripts
      if (-not ($scripts -and $scripts.PSObject.Properties.Name -contains $word)) { $skipped.Add($Name); return $true }
    }
  }
  try { $out = & (Get-Process -Id $PID).Path -NoProfile -Command $Cmd 2>&1 | Out-String } catch { $out = $_.Exception.Message; $global:LASTEXITCODE = 1 }
  if ($LASTEXITCODE -ne 0) {
    $tail = ($out -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -Last $cfg.maxOutputLines) -join "`n    "
    $fail.Add(" [$Name] falhou (exit $LASTEXITCODE) - ultimas linhas:`n    $tail")
    return $false
  }
  return $true
}

if (-not $InitBaseline -and $Allowed.Count -eq 0) { Write-Output "GATE ${Module}: FAIL`n [uso] informe -Allowed com a allowlist do contrato"; exit 1 }
if (-not (Test-Path $Config)) { Write-Output "GATE ${Module}: FAIL`n [config] nao encontrado: $Config"; exit 1 }
$cfg = Get-Content $Config -Raw | ConvertFrom-Json

$null = git rev-parse --is-inside-work-tree 2>&1
if ($LASTEXITCODE -ne 0) { Write-Output "GATE ${Module}: FAIL`n [git] execute na raiz de um repositorio git"; exit 1 }
$gitDir = (git rev-parse --git-dir | Select-Object -First 1).Trim()
$baseFile = Join-Path $gitDir "gate-baseline-$Module.json"

# --- arquivos alterados (rastreados + novos), sempre com '/'
$tracked = @(git diff --name-only $Base)
$untracked = @(git ls-files --others --exclude-standard)
$ignore = @(Get-Cfg 'ignoreGlobs' @())
$changed = @($tracked + $untracked | Where-Object { $_ } | ForEach-Object { $_.Replace('\', '/') } |
  Where-Object { -not (Test-AnyGlob $_ $ignore) } | Sort-Object -Unique)
$deleted = @(git diff --name-only --diff-filter=D $Base | Where-Object { $_ } | ForEach-Object { $_.Replace('\', '/') })

# --- baseline: grava o estado atual ou descarta o que ja existia antes do worker
if ($InitBaseline) {
  $map = [ordered]@{}
  foreach ($f in $changed) { $map[$f] = Get-Sig $f }
  $map | ConvertTo-Json | Set-Content -LiteralPath $baseFile -Encoding UTF8
  Write-Output "GATE ${Module}: BASELINE gravado ($($changed.Count) arquivos preexistentes ignorados nas proximas rodadas)"
  exit 0
}
$baselineNote = ''
if (Test-Path -LiteralPath $baseFile) {
  $baseline = Get-Content -LiteralPath $baseFile -Raw | ConvertFrom-Json -AsHashtable
  $before = $changed.Count
  $changed = @($changed | Where-Object { -not ($baseline.ContainsKey($_) -and $baseline[$_] -eq (Get-Sig $_)) })
  $baselineNote = " | baseline: $($before - $changed.Count) preexistentes ignorados"
}
$deleted = @($deleted | Where-Object { $changed -contains $_ })
$existing = @($changed | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })

$fail = New-Object System.Collections.Generic.List[string]
$review = New-Object System.Collections.Generic.List[string]
$skipped = New-Object System.Collections.Generic.List[string]

if ($changed.Count -eq 0) { $fail.Add(' [vazio] nenhuma alteracao encontrada') }

# 1) escopo
$outside = @($changed | Where-Object { -not (Test-AnyGlob $_ $Allowed) })
if ($outside.Count) {
  $shown = ($outside | Select-Object -First 15) -join ', '
  $more = if ($outside.Count -gt 15) { " (+$($outside.Count - 15) outros; arvore suja? use -InitBaseline ou um commit base)" } else { '' }
  $fail.Add(" [escopo] fora da allowlist: $shown$more")
}

# 2) arquivos proibidos (.env, chaves)
$forbidden = @($changed | Where-Object { Test-AnyGlob (Split-Path $_ -Leaf) $cfg.forbiddenFiles })
if ($forbidden.Count) { $fail.Add(" [proibido] " + ($forbidden -join ', ')) }

# 3) dependencias
if (-not $AllowDeps) {
  $deps = @($changed | Where-Object { $cfg.dependencyFiles -contains (Split-Path $_ -Leaf) })
  if ($deps.Count) { $fail.Add(" [dependencia] alterou " + ($deps -join ', ') + " sem aprovacao") }
}

# 4) testes apagados, pulados ou com asserts removidos
$delTests = @($deleted | Where-Object { Test-AnyGlob $_ $cfg.testGlobs })
if ($delTests.Count) { $fail.Add(" [teste] apagou: " + ($delTests -join ', ')) }
$tamper = $cfg.testTamperPatterns -join '|'
foreach ($f in ($existing | Where-Object { Test-AnyGlob $_ $cfg.testGlobs })) {
  if ((Get-Item -LiteralPath $f).Length -gt 1MB) { continue }
  $hit = Select-String -LiteralPath $f -Pattern $tamper | Select-Object -First 1
  if ($hit) { $fail.Add(" [teste] skip/only em ${f}:$($hit.LineNumber)") }
  # heuristica: mais linhas com expect/assert removidas que adicionadas -> revisao humana
  $diff = @(git diff $Base -U0 -- $f)
  $rem = @($diff | Where-Object { $_ -match '^-(?!--)' -and $_ -match '\b(expect|assert)\w*\s*[.(]' }).Count
  $add = @($diff | Where-Object { $_ -match '^\+(?!\+\+)' -and $_ -match '\b(expect|assert)\w*\s*[.(]' }).Count
  if ($rem -gt $add) { $review.Add("$f (asserts removidos: -$rem/+$add)") }
}

# 5) segredos no conteudo. Padroes fortes valem em qualquer arquivo; os fracos
#    (senha/chave literal) ficam de fora de testes, fixtures e mocks.
$weakSkip = @(Get-Cfg 'weakSecretSkipGlobs' @($cfg.testGlobs))
$weak = @(Get-Cfg 'weakSecretPatterns' @())
foreach ($f in $existing) {
  if ((Get-Item -LiteralPath $f).Length -gt 1MB) { continue }
  $patterns = @($cfg.secretPatterns)
  if (-not (Test-AnyGlob $f $weakSkip)) { $patterns += $weak }
  foreach ($p in $patterns) {
    $hit = Select-String -LiteralPath $f -Pattern $p | Select-Object -First 1
    if ($hit) { $fail.Add(" [segredo] possivel segredo em ${f}:$($hit.LineNumber)"); break }
  }
}

# 6) superficies sensiveis -> revisao
$sensHits = @($changed | Where-Object { Test-AnyGlob $_ $cfg.sensitiveGlobs })
foreach ($f in $sensHits) { $review.Add($f) }

# 7) lint / typecheck / test (so se nada acima falhou)
if ($fail.Count -eq 0 -and -not $SkipCommands) {
  foreach ($name in $cfg.commands.PSObject.Properties.Name) {
    if (-not (Invoke-GateCommand $name $cfg.commands.$name)) { break }
  }
  # comandos extras (ex.: suite de integracao com banco) so quando tocou superficie sensivel
  $extra = Get-Cfg 'sensitiveCommands' $null
  if ($fail.Count -eq 0 -and $sensHits.Count -gt 0 -and $extra) {
    foreach ($name in $extra.PSObject.Properties.Name) {
      if (-not (Invoke-GateCommand $name $extra.$name)) { break }
    }
  }
}

# --- veredito
if ($fail.Count) {
  Write-Output "GATE ${Module}: FAIL"
  $fail | ForEach-Object { Write-Output $_ }
  exit 1
}
$note = $baselineNote
if ($skipped.Count) { $note += " | NAO executados (script ausente): " + ($skipped -join ', ') }
if ($review.Count) {
  Write-Output "GATE ${Module}: PASS+REVIEW"
  Write-Output (" arquivos: " + $changed.Count + " | revisar: " + ($review -join ', ') + $note)
  exit 2
}
Write-Output "GATE ${Module}: PASS"
Write-Output (" arquivos: " + $changed.Count + $note)
exit 0
