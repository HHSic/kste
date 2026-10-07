param([ValidateSet('session', 'chat', 'file')][string]$Kind = 'session')
# ASCII source also loads correctly in Windows PowerShell 5.1 without a BOM.
$ErrorActionPreference = 'Stop'
$stage = 'encoding'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Report-KsteFailure([string]$Message) {
    $log = $null
    try {
        $logDir = $env:PLUGIN_DATA
        if (-not $logDir) {
            $base = $env:LOCALAPPDATA
            if (-not $base) { $base = [System.IO.Path]::GetTempPath() }
            $logDir = Join-Path $base 'KSTE'
        }
        [System.IO.Directory]::CreateDirectory($logDir) | Out-Null
        $log = Join-Path $logDir 'hook-errors.log'
        # Never log hook stdin, assistant output, or document findings.
        $entry = '{0} PowerShell {1} stage={2} kind={3}: {4}' -f [DateTime]::UtcNow.ToString('o'), $PSVersionTable.PSVersion, $stage, $Kind, $Message
        [System.IO.File]::AppendAllText($log, $entry + [Environment]::NewLine, $utf8)
    } catch { $log = $null }
    $text = 'KSTE did not run (' + $stage + '): ' + $Message
    if ($log) { $text += ' Log: ' + $log }
    @{ systemMessage = $text } | ConvertTo-Json -Compress
}

try {
    $OutputEncoding = $utf8
    [Console]::InputEncoding = $utf8
    [Console]::OutputEncoding = $utf8
    $stage = 'stdin'
    $hookInput = [Console]::In.ReadToEnd()
    $stage = 'node-discovery'
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
            # Embedded quotes are stripped by legacy PowerShell native argument passing.
            & $candidate -e 'process.exit(parseInt(process.versions.node)>=20?0:1)' 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) { $ksteNode = $candidate; break }
        } catch { }
    }
    if (-not $ksteNode) {
        Report-KsteFailure 'Node.js 20+ was not found. Fully quit Codex after installing Node.js. KSTE_NODE_PATH can specify node.exe.'
        exit 0
    }
    $stage = 'node-start'
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = $ksteNode
    $runner = Join-Path $PSScriptRoot 'kste-run-hook.mjs'
    $start.Arguments = '"' + $runner.Replace('"', '\"') + '" ' + $Kind
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.StandardOutputEncoding = $utf8
    $start.StandardErrorEncoding = $utf8
    $child = New-Object System.Diagnostics.Process
    $child.StartInfo = $start
    if (-not $child.Start()) { throw 'Node.js process could not start.' }
    $stage = 'node-io'
    # Drain both streams concurrently; native stderr must not become a PS 5.1 exception.
    $stdoutTask = $child.StandardOutput.ReadToEndAsync()
    $stderrTask = $child.StandardError.ReadToEndAsync()
    $bytes = $utf8.GetBytes($hookInput)
    $child.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
    $child.StandardInput.Close()
    $child.WaitForExit()
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    if ($stdout) { [Console]::Out.Write($stdout) }
    if ($stderr) { [Console]::Error.Write($stderr) }
    $code = $child.ExitCode
    $child.Dispose()
    $stage = 'node-exit'
    if ($code -ne 0 -and $code -ne 2) {
        Report-KsteFailure ('Node.js exited with code ' + $code + '. See stderr from a direct launcher run.')
        exit 0
    }
    exit $code
} catch {
    Report-KsteFailure $_.Exception.Message
    exit 0
}
