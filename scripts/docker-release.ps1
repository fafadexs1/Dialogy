param(
    [string]$EnvFile = ".env",
    [string]$ComposeFile = "docker-compose.yml",
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

function Get-EnvValue {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Content,
        [Parameter(Mandatory = $true)]
        [string]$Key
    )

    $pattern = "(?m)^(${Key}=)(.+)\s*$"
    $match = [regex]::Match($Content, $pattern)

    if (!$match.Success) {
        throw "A chave ${Key} nao foi encontrada em $envPath"
    }

    return $match.Groups[2].Value.Trim()
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

function Update-ComposeImages {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string[]]$Lines,
        [Parameter(Mandatory = $true)]
        [string]$DialogyImage,
        [Parameter(Mandatory = $true)]
        [string]$WorkerImage,
        [Parameter(Mandatory = $true)]
        [string]$WorkerAiImage
    )

    $updatedLines = New-Object System.Collections.Generic.List[string]
    $inServices = $false
    $currentService = $null
    $dialogyUpdated = $false
    $cacheInitUpdated = $false
    $workerUpdated = $false
    $workerAiUpdated = $false
    $workerCampaignUpdated = $false
    $workerMetaRelayUpdated = $false

    foreach ($line in $Lines) {
        if ($line -match '^services:\s*$') {
            $inServices = $true
            $currentService = $null
            $updatedLines.Add($line)
            continue
        }

        if ($inServices -and $line -match '^  ([A-Za-z0-9_-]+):\s*$') {
            $currentService = $Matches[1]
            $updatedLines.Add($line)
            continue
        }

        if ($inServices -and $currentService -eq 'dialogy' -and $line -match '^    image:\s*') {
            $updatedLines.Add("    image: $DialogyImage")
            $dialogyUpdated = $true
            continue
        }

        if ($inServices -and $currentService -eq 'ai-cache-init' -and $line -match '^    image:\s*') {
            $updatedLines.Add("    image: $WorkerAiImage")
            $cacheInitUpdated = $true
            continue
        }

        if ($inServices -and $currentService -eq 'worker' -and $line -match '^    image:\s*') {
            $updatedLines.Add("    image: $WorkerImage")
            $workerUpdated = $true
            continue
        }

        if ($inServices -and $currentService -eq 'worker-ai' -and $line -match '^    image:\s*') {
            $updatedLines.Add("    image: $WorkerAiImage")
            $workerAiUpdated = $true
            continue
        }

        if ($inServices -and $currentService -eq 'worker-campaign' -and $line -match '^    image:\s*') {
            $updatedLines.Add("    image: $WorkerImage")
            $workerCampaignUpdated = $true
            continue
        }

        if ($inServices -and $currentService -eq 'worker-meta-relay' -and $line -match '^    image:\s*') {
            $updatedLines.Add("    image: $WorkerImage")
            $workerMetaRelayUpdated = $true
            continue
        }

        $updatedLines.Add($line)
    }

    if (!$dialogyUpdated) {
        throw "Nao foi possivel localizar a linha image do servico 'dialogy' em $composePath"
    }

    if (!$cacheInitUpdated) {
        throw "Nao foi possivel localizar a linha image do servico 'ai-cache-init' em $composePath"
    }

    if (!$workerUpdated) {
        throw "Nao foi possivel localizar a linha image do servico 'worker' em $composePath"
    }

    if (!$workerAiUpdated) {
        throw "Nao foi possivel localizar a linha image do servico 'worker-ai' em $composePath"
    }

    if (!$workerCampaignUpdated) {
        throw "Nao foi possivel localizar a linha image do servico 'worker-campaign' em $composePath"
    }

    if (!$workerMetaRelayUpdated) {
        throw "Nao foi possivel localizar a linha image do servico 'worker-meta-relay' em $composePath"
    }

    return $updatedLines
}

$envPath = Join-Path (Get-Location) $EnvFile
if (!(Test-Path -LiteralPath $envPath)) {
    throw "Arquivo de ambiente nao encontrado: $envPath"
}

$composePath = Join-Path (Get-Location) $ComposeFile
if (!(Test-Path -LiteralPath $composePath)) {
    throw "Arquivo docker-compose nao encontrado: $composePath"
}

$originalContent = Get-Content -LiteralPath $envPath -Raw
$originalComposeLines = Get-Content -LiteralPath $composePath
$tagPattern = '(?m)^(DIALOGY_IMAGE_TAG=)(.+)\s*$'
$match = [regex]::Match($originalContent, $tagPattern)

if (!$match.Success) {
    throw "A chave DIALOGY_IMAGE_TAG nao foi encontrada em $envPath"
}

$dialogyRepo = Get-EnvValue -Content $originalContent -Key "DIALOGY_IMAGE_REPO"
$workerRepo = Get-EnvValue -Content $originalContent -Key "DIALOGY_WORKER_IMAGE_REPO"
$workerAiRepo = Get-EnvValue -Content $originalContent -Key "DIALOGY_WORKER_AI_IMAGE_REPO"
$currentTag = $match.Groups[2].Value.Trim()
$nextTag = Get-NextTag -Tag $currentTag

$updatedContent = [regex]::Replace(
    $originalContent,
    $tagPattern,
    ('$1' + $nextTag),
    1
)

$dialogyImage = "${dialogyRepo}:${nextTag}"
$workerImage = "${workerRepo}:${nextTag}"
$workerAiImage = "${workerAiRepo}:${nextTag}"

Write-Host "Tag atual     : $currentTag"
Write-Host "Nova tag      : $nextTag"
Write-Host "Imagem dialogy: $dialogyImage"
Write-Host "Imagem worker : $workerImage"
Write-Host "Imagem worker-ai : $workerAiImage"

Set-Content -LiteralPath $envPath -Value $updatedContent -Encoding UTF8
Update-ComposeImages -Lines $originalComposeLines -DialogyImage $dialogyImage -WorkerImage $workerImage -WorkerAiImage $workerAiImage |
    Set-Content -LiteralPath $composePath -Encoding UTF8

try {
    if ($SkipDocker) {
        Write-Host "Modo dry-run: .env e docker-compose.yml atualizados sem executar build/push."
    } else {
        $env:DOCKER_BUILDKIT = "1"
        $dockerBuildSecret = "id=dotenv,src=$envPath"
        Invoke-CheckedCommand -Command @("docker", "build", "--secret", $dockerBuildSecret, "-f", "Dockerfile", "--target", "runner", "-t", $dialogyImage, ".")
        Invoke-CheckedCommand -Command @("docker", "build", "--secret", $dockerBuildSecret, "-f", "Dockerfile", "--target", "worker-runner", "-t", $workerImage, ".")
        Invoke-CheckedCommand -Command @("docker", "build", "--secret", $dockerBuildSecret, "-f", "Dockerfile", "--target", "worker-ai-runner", "-t", $workerAiImage, ".")
        Invoke-CheckedCommand -Command @("docker", "push", $dialogyImage)
        Invoke-CheckedCommand -Command @("docker", "push", $workerImage)
        Invoke-CheckedCommand -Command @("docker", "push", $workerAiImage)
        Write-Host "Release concluido com sucesso."
    }
} catch {
    Set-Content -LiteralPath $envPath -Value $originalContent -Encoding UTF8
    Set-Content -LiteralPath $composePath -Value $originalComposeLines -Encoding UTF8
    Write-Warning "Falha no release. DIALOGY_IMAGE_TAG e docker-compose.yml restaurados para $currentTag."
    throw
}
