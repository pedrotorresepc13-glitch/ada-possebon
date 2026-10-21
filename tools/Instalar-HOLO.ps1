# Instalacao assistida do HOLO no Windows (sem alterar POSSEBON Web ou My Import).
# Por padrao, modelos Ollama e memoria HOLO ficam em D:\HOLO.
[CmdletBinding()]
param(
  [ValidateSet('llama3.2:1b','llama3.2:3b','qwen3.5:4b')]
  [string]$Modelo = 'llama3.2:3b',
  [ValidatePattern('^[D-d]:\\')]
  [string]$PastaDados = 'D:\HOLO'
)
$ErrorActionPreference = 'Stop'
$raiz = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $raiz

Write-Host '=== HOLO Enterprise - Assistente Local ===' -ForegroundColor Cyan
Write-Host 'Este instalador NAO modifica POSSEBON Web, My Import ou outros servicos.' -ForegroundColor Cyan

# Falhar ANTES de instalar/baixar se o disco D nao estiver disponivel.
$drive = Get-PSDrive -Name D -PSProvider FileSystem -ErrorAction SilentlyContinue
if (-not $drive -or -not (Test-Path 'D:\')) {
  throw 'O disco D: nao esta acessivel. Conecte ou habilite o disco e execute novamente. Nada sera baixado para C: no lugar dele.'
}

$pastaDados = [IO.Path]::GetFullPath($PastaDados).TrimEnd('\')
$modelsDir = Join-Path $pastaDados 'Modelos-Ollama'
$memoryDir = Join-Path $pastaDados 'Memoria-HOLO'
$appsDir = Join-Path $pastaDados 'Aplicativos'
$ollamaInstallDir = Join-Path $appsDir 'Ollama'
foreach ($dir in @($pastaDados,$modelsDir,$memoryDir,$appsDir)) {
  New-Item -Path $dir -ItemType Directory -Force | Out-Null
}

# A variavel do usuario e persistente, inclusive apos reiniciar o Windows.
$oldOllamaModels = [Environment]::GetEnvironmentVariable('OLLAMA_MODELS', 'User')
[Environment]::SetEnvironmentVariable('OLLAMA_MODELS', $modelsDir, 'User')
[Environment]::SetEnvironmentVariable('HOLO_LOCAL_DATA_DIR', $memoryDir, 'User')
$env:OLLAMA_MODELS = $modelsDir
$env:HOLO_LOCAL_DATA_DIR = $memoryDir
$env:HOLO_AI_PROVIDER = 'local'
$env:HOLO_LOCAL_MODEL = $Modelo

Write-Host "Modelos da IA: $modelsDir" -ForegroundColor Green
Write-Host "Memoria da assistente: $memoryDir" -ForegroundColor Green
Write-Host "Projeto HOLO atual: $raiz"

function Executavel([string]$nome, [string[]]$alternativas) {
  $cmd = Get-Command $nome -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($p in $alternativas) {
    if ($p -and (Test-Path -LiteralPath $p)) { return $p }
  }
  return $null
}
function Install-UsingWinget([string]$id, [string]$instalarEm = '') {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw 'winget nao encontrado. Instale o App Installer da Microsoft.'
  }
  $args = @('install','--id',$id,'--exact','--accept-source-agreements','--accept-package-agreements')
  if ($instalarEm) { $args += @('--location',$instalarEm) }
  Write-Host "Instalando $id..." -ForegroundColor Yellow
  & winget.exe @args
  if ($LASTEXITCODE -ne 0) {
    throw "A instalacao de $id falhou (codigo $LASTEXITCODE). Nenhuma instalacao alternativa no C: sera iniciada automaticamente."
  }
}

# Evita reinstalar componentes ja existentes. O Node.js do sistema pode estar no C:.
$node = Executavel 'node' @("$env:ProgramFiles\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")
if (-not $node) {
  Install-UsingWinget 'OpenJS.NodeJS.LTS'
  $node = Executavel 'node' @("$env:ProgramFiles\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")
}
if (-not $node) { throw 'Node.js instalado, mas nao localizado. Reabra o terminal e tente novamente.' }
$versionText = ((& $node --version) -replace '^v','').Split('-')[0]
if ([version]$versionText -lt [version]'22.0.0') {
  throw "Node.js $versionText detectado. E necessario Node.js 22 ou superior."
}

$ollama = Executavel 'ollama' @(
  (Join-Path $ollamaInstallDir 'ollama.exe'),
  "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
  "$env:ProgramFiles\Ollama\ollama.exe"
)
if (-not $ollama) {
  # O instalador Ollama aceita localizacao personalizada. O winget passa --location;
  # se o pacote nao suportar, falha sem cair silenciosamente no C:.
  Install-UsingWinget 'Ollama.Ollama' $ollamaInstallDir
  $ollama = Executavel 'ollama' @(
    (Join-Path $ollamaInstallDir 'ollama.exe'),
    "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
    "$env:ProgramFiles\Ollama\ollama.exe"
  )
}
if (-not $ollama) {
  throw 'Ollama nao encontrado. Reabra o terminal ou confira onde o instalador colocou o programa.'
}

# IMPORTANTE: o processo Ollama que ja esta rodando nao absorve nova variavel.
# Reiniciar somente o Ollama, com confirmacao, sem tocar no My Import.
$wasRunning = $false
try { $null = Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2; $wasRunning = $true } catch {}
if ($wasRunning -and $oldOllamaModels -ne $modelsDir) {
  Write-Host 'O Ollama ja esta ativo com uma configuracao anterior.' -ForegroundColor Yellow
  $confirmation = Read-Host 'Reiniciar SOMENTE o Ollama para salvar novos modelos no D:? [S/n]'
  if ($confirmation -and $confirmation.Trim().ToLowerInvariant() -notin @('s','sim','y','yes')) {
    throw 'Reinicio cancelado. Saia do Ollama na bandeja do Windows, reabra este instalador e tente novamente. Nenhum modelo novo foi baixado.'
  }
  $processes = @(Get-Process -Name 'ollama','ollama app' -ErrorAction SilentlyContinue)
  if (-not $processes.Count) { throw 'Servidor da porta 11434 nao identificado como Ollama. Encerre-o manualmente antes de continuar.' }
  $processes | Stop-Process -Force -ErrorAction Stop
  Start-Sleep -Seconds 2
  try {
    $null = Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2
    throw 'Ollama reiniciou automaticamente com a configuracao antiga. Feche-o pela bandeja e execute novamente.'
  } catch {
    if ($_.Exception.Message -match 'reiniciou automaticamente') { throw }
  }
  $wasRunning = $false
}

# Migra por COPIA apenas se destino estiver vazio. Nunca exclui os modelos do C:.
$oldDefaultModels = Join-Path (Join-Path $env:USERPROFILE '.ollama') 'models'
$hasNewModels = @(Get-ChildItem -LiteralPath $modelsDir -Force -ErrorAction SilentlyContinue).Count -gt 0
if (-not $hasNewModels -and (Test-Path -LiteralPath $oldDefaultModels -PathType Container)) {
  Write-Host 'Copiando modelos ja baixados para D:. Os arquivos originais serao preservados.' -ForegroundColor Yellow
  & robocopy $oldDefaultModels $modelsDir /E /XJ /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw 'Nao foi possivel copiar os modelos existentes. Verifique espaco e permissoes do D:. Originais preservados.' }
}

if (-not $wasRunning) {
  Write-Host 'Iniciando Ollama com modelos no disco D:...'
  Start-Process -FilePath $ollama -ArgumentList 'serve' -WindowStyle Hidden | Out-Null
  $ready = $false
  for ($i=0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    try { $null = Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2; $ready=$true; break } catch {}
  }
  if (-not $ready) { throw 'Ollama nao iniciou. Confira logs e reinicie o instalador.' }
}

Write-Host "Baixando/verificando modelo $Modelo em $modelsDir..." -ForegroundColor Cyan
& $ollama pull $Modelo
if ($LASTEXITCODE -ne 0) { throw 'Falha ao baixar o modelo. Confira internet e espaco disponivel no D:.' }

# Preserva historico antigo sem apagar nada no perfil C:.
$oldMemoryFile = Join-Path (Join-Path $env:USERPROFILE '.holo-enterprise') 'conversas.json'
$newMemoryFile = Join-Path $memoryDir 'conversas.json'
if ((Test-Path -LiteralPath $oldMemoryFile) -and -not (Test-Path -LiteralPath $newMemoryFile)) {
  Copy-Item -LiteralPath $oldMemoryFile -Destination $newMemoryFile -ErrorAction Stop
  Write-Host 'Historico anterior copiado para D:. Original preservado.'
}

$serverScript = Join-Path $raiz 'services\holo-companion.mjs'
if (-not (Test-Path -LiteralPath $serverScript)) { throw 'Repositorio incompleto: servidor HOLO nao encontrado.' }
$holoRunning = $false
try {
  $health = Invoke-RestMethod 'http://127.0.0.1:4891/api/health' -TimeoutSec 2
  if ($health.ok -and $health.mode -eq 'local') { $holoRunning = $true }
  else { throw 'Porta 4891 ocupada por outra aplicacao.' }
} catch {
  if ($_.Exception.Message -match 'ocupada por outra') { throw }
}
if ($holoRunning) {
  Write-Host 'HOLO ja esta rodando. Para aplicar o novo caminho da memoria, encerre somente o HOLO e execute novamente.' -ForegroundColor Yellow
  Start-Process 'http://127.0.0.1:4891/'
  exit 0
}

Write-Host 'Iniciando HOLO local...'
$processo = Start-Process -FilePath $node -ArgumentList ('"' + $serverScript + '"') -WorkingDirectory $raiz -PassThru -WindowStyle Hidden
$pronto = $false
for ($i=0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $health = Invoke-RestMethod 'http://127.0.0.1:4891/api/health' -TimeoutSec 2
    if ($health.ok -and $health.mode -eq 'local') { $pronto=$true; break }
  } catch {}
  if ($processo.HasExited) { break }
}
if (-not $pronto) { throw 'Servidor nao iniciou. Execute node services/holo-companion.mjs para diagnosticar.' }
Write-Host 'HOLO pronto: http://127.0.0.1:4891/' -ForegroundColor Green
Write-Host "IA em $modelsDir | Memoria em $memoryDir" -ForegroundColor Green
Write-Host 'A conexao ao POSSEBON Brain exige configuracao e autorizacao de leitura.'
Start-Process 'http://127.0.0.1:4891/'
