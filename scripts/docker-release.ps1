param(
    [string]$EnvFile = ".env",
    [switch]$SkipDocker
)

$ErrorActionPreference = "Stop"

function Get-NextTag {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Tag
    )

    if ($Tag -match '^(?<prefix>.*?)(?<major>\d+)\.(?<minor>\d+)$') {
        $prefix = $Matches['prefix']
        $major = [int]$Matches['major']
        $minor = [int]$Matches['minor'] + 1
        return "${prefix}${major}.${minor}"
    }

    if ($Tag -match '^(?<prefix>.*?)(?<number>\d+)$') {
        $prefix = $Matches['prefix']
        $number = [int]$Matches['number'] + 1
        return "${prefix}${number}"
    }

    throw "Formato de tag nao suportado: '$Tag'. Use algo como 'PBE-5.2' ou 'v12'."
}

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Command
    )

    Write-Host ">> $($Command -join ' ')"
    & $Command[0] $Command[1..($Command.Length - 1)]

    if ($LASTEXITCODE -ne 0) {
        throw "Comando falhou com exit code ${LASTEXITCODE}: $($Command -join ' ')"
    }
}

$envPath = Join-Path (Get-Location) $EnvFile
if (!(Test-Path -LiteralPath $envPath)) {
    throw "Arquivo de ambiente nao encontrado: $envPath"
}

$originalContent = Get-Content -LiteralPath $envPath -Raw
$tagPattern = '(?m)^(DIALOGY_IMAGE_TAG=)(.+)\s*$'
$match = [regex]::Match($originalContent, $tagPattern)

if (!$match.Success) {
    throw "A chave DIALOGY_IMAGE_TAG nao foi encontrada em $envPath"
}

$currentTag = $match.Groups[2].Value.Trim()
$nextTag = Get-NextTag -Tag $currentTag
$updatedContent = [regex]::Replace(
    $originalContent,
    $tagPattern,
    ('$1' + $nextTag),
    1
)

Write-Host "Tag atual : $currentTag"
Write-Host "Nova tag  : $nextTag"

Set-Content -LiteralPath $envPath -Value $updatedContent -Encoding UTF8

try {
    if ($SkipDocker) {
        Write-Host "Modo dry-run: .env atualizado sem executar docker compose."
    } else {
        Invoke-CheckedCommand -Command @("docker", "compose", "build")
        Invoke-CheckedCommand -Command @("docker", "compose", "push")
        Write-Host "Release concluido com sucesso."
    }
} catch {
    Set-Content -LiteralPath $envPath -Value $originalContent -Encoding UTF8
    Write-Warning "Falha no release. DIALOGY_IMAGE_TAG restaurada para $currentTag."
    throw
}
