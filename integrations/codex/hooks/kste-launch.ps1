param([ValidateSet('session', 'chat', 'file')][string]$Kind = 'session')
# Windows GUI가 설치 전 PATH를 유지해도 표준 Node 설치 위치를 탐색한다.
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = $utf8
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$hookInput = [Console]::In.ReadToEnd()
$ksteNode = $null
$candidates = @($env:KSTE_NODE_PATH)
$nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
if ($nodeCommand) { $candidates += $nodeCommand.Source }
foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
    if ($base) { $candidates += (Join-Path $base 'nodejs/node.exe') }
}
if ($env:NVM_HOME) { $candidates += @(Get-ChildItem -Path (Join-Path $env:NVM_HOME 'v*/node.exe') -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }) }
if ($env:NVM_SYMLINK) { $candidates += (Join-Path $env:NVM_SYMLINK 'node.exe') }
if ($env:USERPROFILE) { $candidates += (Join-Path $env:USERPROFILE 'scoop/apps/nodejs-lts/current/node.exe') }
foreach ($candidate in $candidates) {
    if (-not $candidate -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
    try {
        & $candidate -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $ksteNode = $candidate; break }
    } catch { }
}
if (-not $ksteNode) {
    @{ systemMessage = 'KSTE did not run: Node.js 20+ was not found. Install Node.js, fully quit Codex, and reopen it. KSTE_NODE_PATH can specify a custom node.exe path.' } | ConvertTo-Json -Compress
    exit 0
}
$hookInput | & $ksteNode (Join-Path $PSScriptRoot 'kste-run-hook.mjs') $Kind
exit $LASTEXITCODE
