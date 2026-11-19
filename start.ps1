param([switch]$Check)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$runtime = $null
$candidates = @()
$onPath = Get-Command node.exe -ErrorAction SilentlyContinue
if ($onPath) { $candidates += $onPath.Source }
$installed = Join-Path $env:LOCALAPPDATA 'Author Software\nvm\installs'
if (Test-Path -LiteralPath $installed) {
    $candidates += Get-ChildItem -LiteralPath $installed -Directory | Sort-Object { try { [version]($_.Name -replace '^v','') } catch { [version]'0.0' } } -Descending | ForEach-Object { Join-Path $_.FullName 'node.exe' }
}
foreach ($candidate in $candidates) {
    if (-not (Test-Path -LiteralPath $candidate)) { continue }
    try {
        $versionOutput = & $candidate --version 2>$null
    } catch {
        continue
    }
    if ($LASTEXITCODE -eq 0 -and "$versionOutput" -match '^v(\d+)\.' -and [int]$Matches[1] -ge 22) { $runtime = $candidate; break }
}
if (-not $runtime) { Write-Host '需要 Node.js 22 或更新版本。请安装或通过 nvm 激活后重试。'; exit 1 }
Write-Host "Node: $runtime"
if ($Check) {
    & $runtime --check (Join-Path $PSScriptRoot 'server.js')
    exit $LASTEXITCODE
}
& $runtime (Join-Path $PSScriptRoot 'server.js')
exit $LASTEXITCODE
