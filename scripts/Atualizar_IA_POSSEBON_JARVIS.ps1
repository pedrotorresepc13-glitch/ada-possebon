# IA POSSEBON - Atualizacao local preservando o estado.
# Execute em um PowerShell NOVO com a API/worker parados.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Repo = Join-Path $env:USERPROFILE 'source\possebon.ia'
$Branch = 'feat/ada-sso-real-20261029'
if (-not (Test-Path (Join-Path $Repo '.git'))) { throw "Repositorio nao localizado: $Repo" }
Set-Location $Repo

Write-Host '==== VERIFICACAO DE SEGURANCA ====' -ForegroundColor Cyan
$active = (& git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $active -ne $Branch) {
    throw "Branch atual '$active' diferente de '$Branch'. Nenhum arquivo alterado."
}
$tracked = @(& git status --porcelain --untracked-files=no)
if ($LASTEXITCODE -ne 0 -or @($tracked | Where-Object { $_ }).Count -gt 0) {
    throw 'Arquivos versionados modificados localmente. Preserve o trabalho antes de atualizar. Nada foi alterado.'
}
$ports = @(Get-NetTCPConnection -LocalPort 4800 -State Listen -ErrorAction SilentlyContinue)
if ($ports.Count -gt 0) { throw 'A porta 4800 esta ativa. Pare a IA/worker normalmente antes de atualizar.' }

$EnvPath = Join-Path $Repo '.env'
if (-not (Test-Path $EnvPath)) { throw 'Arquivo .env nao encontrado. Nenhuma mudanca realizada.' }
$DataRoot = Join-Path $Repo '.data'
if (-not (Test-Path $DataRoot)) { throw 'Pasta .data ausente. Confirme o banco existente antes de continuar.' }
$Data = @(Get-ChildItem -LiteralPath $DataRoot -Directory |
          Where-Object { $_.Name -like 'pglite*' })
if ($Data.Count -eq 0) { throw 'Nao foi encontrado PGlite em .data. Nenhuma alteracao realizada.' }

$Stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$Backup = Join-Path (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'IA_POSSEBON_Backups') ("pre_jarvis_$Stamp")
New-Item -ItemType Directory -Path $Backup -Force | Out-Null
Copy-Item -LiteralPath $EnvPath -Destination (Join-Path $Backup '.env') -Force
foreach ($item in $Data) {
    Write-Host "Preservando banco: $($item.Name)"
    Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $Backup $item.Name) -Recurse -Force
    $origin = @(Get-ChildItem -LiteralPath $item.FullName -Recurse -File)
    $copyPath = Join-Path $Backup $item.Name
    $copy = @(Get-ChildItem -LiteralPath $copyPath -Recurse -File)
    if ($origin.Count -ne $copy.Count -or
        ($origin | Measure-Object Length -Sum).Sum -ne ($copy | Measure-Object Length -Sum).Sum) {
        throw "Falha na conferencia do backup de $($item.Name). Atualizacao cancelada."
    }
}
Write-Host "Backup concluido em $Backup" -ForegroundColor Green
Write-Host 'Importante: backup contem o .env privado; nao compartilhe essa pasta.' -ForegroundColor Yellow

Write-Host '==== ATUALIZANDO CODIGO SEM RESET ====' -ForegroundColor Cyan
& git fetch origin $Branch
if ($LASTEXITCODE -ne 0) { throw 'Git fetch falhou; dados e backup permanecem intactos.' }
& git merge --ff-only "origin/$Branch"
if ($LASTEXITCODE -ne 0) { throw 'Fast-forward nao foi possivel; nenhum reset foi realizado.' }

Write-Host '==== INSTALANDO E VALIDANDO ====' -ForegroundColor Cyan
$checks = @(
    @('ci','--no-audit','--no-fund'),
    @('run','lint'),
    @('run','typecheck'),
    @('run','test'),
    @('run','build')
)
foreach ($a in $checks) {
    Write-Host "npm $($a -join ' ')" -ForegroundColor Cyan
    & npm.cmd @a
    if ($LASTEXITCODE -ne 0) { throw "Falhou: npm $($a -join ' '). Verifique a saida acima. Dados locais preservados." }
}
Write-Host '==== CONCLUIDO ====' -ForegroundColor Green
Write-Host 'Codigo atualizado; PGlite e .env intactos. Valide SSO e conexao PostgreSQL antes de testar consultas.'
Write-Host "Backup: $Backup"
