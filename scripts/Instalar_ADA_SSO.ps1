param([switch]$Aplicar)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$src = Join-Path $repo 'integration\possebon-web\App'
$sh = Join-Path $repo 'scripts\ada-sso-install.sh'
$files = @(
 'custom/AdaIntegrationService.php'
 'custom/AdaIdentityApiTrait.php'
 'custom/AdaBrainApiTrait.php'
 'controller/AdaApiController.php'
 'control/AdaEmbedView.php'
)
$ssh = 'C:\Windows\System32\OpenSSH\ssh.exe'
$scp = 'C:\Windows\System32\OpenSSH\scp.exe'
if (-not (Test-Path $ssh)) { $ssh = 'ssh.exe' }
if (-not (Test-Path $scp)) { $scp = 'scp.exe' }
if (-not (Test-Path $sh)) { throw "Script Linux nao encontrado: $sh" }
$servidor = 'acessoconsole01@hc260211epc3151.cloudhialinx.com.br'
$porta = 19301
$stage = Join-Path $env:TEMP ("ada-sso-" + [guid]::NewGuid().ToString('N'))
$localTar = Join-Path $stage 'ada-sso.tar.gz'
$remoteTar = '/tmp/ada-sso-' + [guid]::NewGuid().ToString('N') + '.tar.gz'
$mode = if ($Aplicar) { 'apply' } else { 'check' }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
try {
 foreach ($relative in $files) {
  $from = Join-Path $src ($relative.Replace('/', '\'))
  $to = Join-Path $stage ("app\" + $relative.Replace('/', '\'))
  if (-not (Test-Path $from)) { throw "Arquivo da integracao ausente: $from" }
  New-Item -ItemType Directory -Path (Split-Path $to) -Force | Out-Null
  Copy-Item $from $to
 }
 Copy-Item $sh (Join-Path $stage 'installer.sh')
 & tar.exe -czf $localTar -C $stage app installer.sh
 if ($LASTEXITCODE -ne 0) { throw 'Falha ao montar pacote de implantacao.' }
 Write-Host ''
 Write-Host "===== ADA SSO / MODO $($mode.ToUpperInvariant()) =====" -ForegroundColor Cyan
 Write-Host 'Verificando SHA-256, sintaxe PHP e conflitos antes de escrever na producao.'
 Write-Host 'ApiAppController sera preservado integralmente.'
 if ($Aplicar) {
  Write-Host 'MODO APLICAR: somente novas classes e duas rotas; backup automatico.' -ForegroundColor Yellow
 } else {
  Write-Host 'MODO PREVIEW: nenhum arquivo do POSSEBON sera alterado.' -ForegroundColor Green
 }
 & $scp -P $porta -o ConnectTimeout=20 $localTar "$($servidor):$remoteTar"
 if ($LASTEXITCODE -ne 0) { throw 'Falha ao transferir pacote temporario via SCP.' }
 $command = "tar -xOf '$remoteTar' installer.sh | tr -d '\015' | bash -s -- '$remoteTar' '$mode'"
 & $ssh -T -p $porta -o ConnectTimeout=20 $servidor $command
 if ($LASTEXITCODE -ne 0) { throw 'Validacao/instalacao bloqueada. Verifique a mensagem anterior.' }
 Write-Host ''
 Write-Host 'VALIDACAO ADA SSO CONCLUIDA.' -ForegroundColor Green
 if ($Aplicar) {
  Write-Host 'Novo codigo instalado, mas SSO so funciona apos configuracao de segredos e HTTPS.'
 } else {
  Write-Host 'Preview aprovado. A opcao -Aplicar ativa a instalacao controlada.'
 }
}
finally { Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue }
