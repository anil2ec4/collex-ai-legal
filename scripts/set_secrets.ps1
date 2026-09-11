$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$EnvFile = Join-Path $ProjectRoot '.env'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path -LiteralPath $EnvFile)) {
    Copy-Item -LiteralPath (Join-Path $ProjectRoot '.env.example') -Destination $EnvFile
}

function Read-SecretValue([string]$Prompt) {
    $secure = Read-Host $Prompt -AsSecureString
    if ($secure.Length -eq 0) { return '' }
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
}

function Set-EnvValue([string]$Text, [string]$Name, [string]$Value) {
    if ($Value -match "[`r`n]") {
        throw "$Name contains a newline and cannot be stored in .env"
    }
    $escapedName = [Regex]::Escape($Name)
    $line = "$Name=$Value"
    if ($Text -match "(?m)^$escapedName=.*$") {
        return [Regex]::Replace($Text, "(?m)^$escapedName=.*$", [Text.RegularExpressions.MatchEvaluator]{ param($m) $line })
    }
    return $Text.TrimEnd() + [Environment]::NewLine + $line + [Environment]::NewLine
}

Write-Host 'OpenRouter anahtarı ekranda gösterilmeyecek ve yalnızca Git-ignore edilen .env dosyasına yazılacak.'

$openRouter = Read-SecretValue 'OPENROUTER_API_KEY'
if ([string]::IsNullOrWhiteSpace($openRouter) -or
    -not $openRouter.StartsWith('sk-or-v1-', [StringComparison]::Ordinal) -or
    $openRouter.Length -lt 40) {
    $openRouter = $null
    throw 'Geçersiz OpenRouter anahtarı. OpenRouter Keys sayfasından alınan, sk-or-v1- ile başlayan tam anahtarı yapıştırın.'
}

$text = [IO.File]::ReadAllText($EnvFile)
$text = Set-EnvValue $text 'OPENROUTER_API_KEY' $openRouter
[IO.File]::WriteAllText($EnvFile, $text, $Utf8NoBom)

$openRouter = $null

Write-Host 'OpenRouter anahtarı kaydedildi. Değer yazdırılmadı.'
