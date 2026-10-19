# Instalacao assistida HOLO no Windows. Nao altera POSSEBON Web ou My Import.
[CmdletBinding()]
param([ValidateSet('llama3.2:1b','llama3.2:3b','qwen3.5:4b')][string]$Modelo='llama3.2:3b')
$ErrorActionPreference='Stop'
$raiz=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $raiz
Write-Host '=== HOLO Enterprise - Assistente Local ===' -ForegroundColor Cyan
Write-Host 'Baixa Ollama, um modelo gratuito e inicia o site local. Requer internet e espaco em disco.'
function Executavel([string]$nome,[string[]]$alternativas) {
  $cmd=Get-Command $nome -ErrorAction SilentlyContinue
  if($cmd){return $cmd.Source}
  foreach($p in $alternativas){if($p -and (Test-Path -LiteralPath $p)){return $p}}
  return $null
}
function Winget([string]$id) {
  if(-not (Get-Command winget -ErrorAction SilentlyContinue)){throw 'winget nao encontrado. Instale o App Installer da Microsoft.'}
  Write-Host "Instalando $id..." -ForegroundColor Yellow
  & winget install --id $id --exact --accept-source-agreements --accept-package-agreements
  if($LASTEXITCODE -ne 0){throw "Nao foi possivel instalar $id. Codigo: $LASTEXITCODE"}
}
$node=Executavel 'node' @("$env:ProgramFiles\nodejs\node.exe","$env:LOCALAPPDATA\Programs\nodejs\node.exe")
if(-not $node){
  Winget 'OpenJS.NodeJS.LTS'
  $node=Executavel 'node' @("$env:ProgramFiles\nodejs\node.exe","$env:LOCALAPPDATA\Programs\nodejs\node.exe")
}
if(-not $node){throw 'Reabra o terminal apos instalar Node.js e tente novamente.'}
$v=(& $node --version)-replace '^v',''
if([version]$v -lt [version]'22.0.0'){throw "Node.js $v detectado. Requer Node.js 22 ou superior."}
$ollama=Executavel 'ollama' @("$env:LOCALAPPDATA\Programs\Ollama\ollama.exe","$env:ProgramFiles\Ollama\ollama.exe")
if(-not $ollama){
  Winget 'Ollama.Ollama'
  $ollama=Executavel 'ollama' @("$env:LOCALAPPDATA\Programs\Ollama\ollama.exe","$env:ProgramFiles\Ollama\ollama.exe")
}
if(-not $ollama){throw 'Ollama instalado, mas nao encontrado. Reabra o terminal e tente novamente.'}
try{$null=Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2}
catch{
  Write-Host 'Iniciando Ollama...'
  Start-Process -FilePath $ollama -ArgumentList 'serve' -WindowStyle Hidden | Out-Null
  $ready=$false
  for($i=0;$i -lt 24;$i++){
    Start-Sleep -Milliseconds 500
    try{$null=Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2;$ready=$true;break}catch{}
  }
  if(-not $ready){throw 'Ollama nao iniciou. Abra o aplicativo Ollama e execute novamente.'}
}
Write-Host "Instalando modelo $Modelo. O download pode ocupar alguns GB." -ForegroundColor Cyan
& $ollama pull $Modelo
if($LASTEXITCODE -ne 0){throw 'Falha no download do modelo. Confira internet e espaco livre.'}
$env:HOLO_AI_PROVIDER='local'
$env:HOLO_LOCAL_MODEL=$Modelo
$script=Join-Path $raiz 'services\holo-companion.mjs'
if(-not (Test-Path $script)){throw 'Repositorio incompleto: servidor HOLO nao encontrado.'}
try{
  $h=Invoke-RestMethod 'http://127.0.0.1:4891/api/health' -TimeoutSec 2
  if($h.ok -and $h.mode -eq 'local'){
    Write-Host 'HOLO ja iniciado: http://127.0.0.1:4891/'
    Start-Process 'http://127.0.0.1:4891/'
    exit 0
  }
  throw 'Outra aplicacao usa a porta 4891.'
}catch{
  if($_.Exception.Message -match 'Outra aplicacao'){throw}
}
Write-Host 'Iniciando HOLO local...'
$processo=Start-Process -FilePath $node -ArgumentList ('"' + $script + '"') -WorkingDirectory $raiz -PassThru -WindowStyle Hidden
$pronto=$false
for($i=0;$i -lt 30;$i++){
  Start-Sleep -Milliseconds 500
  try{$h=Invoke-RestMethod 'http://127.0.0.1:4891/api/health' -TimeoutSec 2;if($h.ok -and $h.mode -eq 'local'){$pronto=$true;break}}catch{}
  if($processo.HasExited){break}
}
if(-not $pronto){throw 'Servidor nao iniciou. Execute node services/holo-companion.mjs para diagnosticar.'}
Write-Host 'HOLO pronto: http://127.0.0.1:4891/' -ForegroundColor Green
Write-Host 'A conexao com a POSSEBON exige configuracao autorizada conforme docs/INSTALACAO-HOLO-LOCAL.md'
Start-Process 'http://127.0.0.1:4891/'
