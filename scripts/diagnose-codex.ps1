param([string]$CodexHome = $env:CODEX_HOME)
# Read-only Windows diagnostics. Uses a synthetic status prompt, never a user's chat.
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = $utf8
[Console]::OutputEncoding = $utf8
if (-not $CodexHome) { $CodexHome = Join-Path $env:USERPROFILE '.codex' }
Write-Output ('Codex home: ' + $CodexHome)
Write-Output ('PowerShell: ' + $PSVersionTable.PSVersion)
$config = Join-Path $CodexHome 'config.toml'
if (Test-Path -LiteralPath $config) {
    $inMarketplace = $false
    foreach ($line in [System.IO.File]::ReadAllLines($config)) {
        if ($line -match '^\s*\[') { $inMarketplace = $line -match '^\s*\[marketplaces\.kste\]\s*$' }
        if ($inMarketplace -and $line -match '^\s*ref\s*=') { Write-Output ('Marketplace ' + $line.Trim()) }
    }
}
$cache = Join-Path $CodexHome 'plugins/cache/kste/kste'
$manifests = @(Get-ChildItem -LiteralPath $cache -Filter plugin.json -Recurse -Force | Where-Object { $_.FullName -match '[\\/]\.codex-plugin[\\/]plugin\.json$' })
if (-not $manifests.Count) { throw 'No Codex KSTE manifest found. Run codex plugin list to check the installed version and cache.' }
$manifest = $manifests | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$metadata = Get-Content -LiteralPath $manifest.FullName -Raw | ConvertFrom-Json
$root = Split-Path (Split-Path $manifest.FullName -Parent) -Parent
$launcher = Join-Path $root 'integrations/codex/hooks/kste-launch.ps1'
Write-Output ('Cached KSTE version: ' + $metadata.version)
Write-Output ('Launcher: ' + $launcher)
Write-Output 'Running a synthetic status prompt through the Windows launcher...'
$payload = @{ hook_event_name = 'UserPromptSubmit'; prompt = '/kste status'; cwd = (Get-Location).Path } | ConvertTo-Json -Compress
$payload | & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $launcher -Kind chat
Write-Output ('Launcher exit: ' + $LASTEXITCODE)
