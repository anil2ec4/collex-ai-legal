$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$PythonExe = Join-Path $ProjectRoot '.venv\Scripts\python.exe'
$CodexConfig = 'C:\Users\anile\.codex\config.toml'
$ClaudeDesktopConfig = 'C:\Users\anile\AppData\Roaming\Claude\claude_desktop_config.json'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path -LiteralPath $PythonExe)) {
    throw "Project Python not found: $PythonExe"
}

# Codex app/CLI/IDE share ~/.codex/config.toml.
$codexText = [IO.File]::ReadAllText($CodexConfig)
if ($codexText -notmatch '(?m)^\[mcp_servers\.(?:"yargi-mevzuat"|yargi-mevzuat)\]\s*$') {
    $codexBackup = "$CodexConfig.yargi-backup"
    if (-not (Test-Path -LiteralPath $codexBackup)) {
        Copy-Item -LiteralPath $CodexConfig -Destination $codexBackup
    }

    $block = @"

[mcp_servers.yargi-mevzuat]
command = '$PythonExe'
args = ["-m", "mcp_server_main"]
cwd = '$ProjectRoot'
startup_timeout_sec = 60
tool_timeout_sec = 300
enabled = true
required = false
default_tools_approval_mode = "auto"
"@
    [IO.File]::AppendAllText($CodexConfig, $block, $Utf8NoBom)
}

# Claude Desktop uses its own JSON config.
$claudeText = [IO.File]::ReadAllText($ClaudeDesktopConfig)
$claudeConfig = $claudeText | ConvertFrom-Json
if ($null -eq $claudeConfig.mcpServers) {
    $claudeConfig | Add-Member -NotePropertyName 'mcpServers' -NotePropertyValue ([PSCustomObject]@{})
}
if ($null -eq $claudeConfig.mcpServers.PSObject.Properties['yargi-mevzuat']) {
    $claudeBackup = "$ClaudeDesktopConfig.yargi-backup"
    if (-not (Test-Path -LiteralPath $claudeBackup)) {
        Copy-Item -LiteralPath $ClaudeDesktopConfig -Destination $claudeBackup
    }

    $server = [PSCustomObject]@{
        command = $PythonExe
        args = @('-m', 'mcp_server_main')
    }
    $claudeConfig.mcpServers | Add-Member -NotePropertyName 'yargi-mevzuat' -NotePropertyValue $server
    $json = $claudeConfig | ConvertTo-Json -Depth 100
    [IO.File]::WriteAllText($ClaudeDesktopConfig, $json + [Environment]::NewLine, $Utf8NoBom)
}

Write-Output 'Codex and Claude Desktop yargi-mevzuat configuration installed.'
