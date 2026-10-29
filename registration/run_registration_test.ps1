param(
    [Parameter(Mandatory = $true)]
    [string]$InputImage,
    [string]$Output,
    [switch]$Full,
    [switch]$Force,
    [int]$Threads = 8
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $ProjectRoot ".venv-registration\Scripts\python.exe"
$Script = Join-Path $PSScriptRoot "src\map_allen_to_image.py"
$Mode = if ($Full) { "full" } else { "quick" }
$InputImage = (Resolve-Path -LiteralPath $InputImage).Path
if (-not $Output) {
    $InputStem = [System.IO.Path]::GetFileNameWithoutExtension(
        [System.IO.Path]::GetFileNameWithoutExtension($InputImage)
    )
    $SafeStem = $InputStem -replace "[^a-zA-Z0-9_-]+", "-"
    $Output = Join-Path $PSScriptRoot "results\$SafeStem-$Mode"
}

if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) {
    throw "Environnement de recalage introuvable: $Python"
}
if (-not (Test-Path -LiteralPath $InputImage -PathType Leaf)) {
    throw "RARE extraite introuvable: $InputImage"
}

$Arguments = @(
    $Script,
    "--input", $InputImage,
    "--output", $Output,
    "--brain-extracted",
    "--threads", $Threads
)
if (-not $Full) {
    $Arguments += "--quick"
}
if ($Force) {
    $Arguments += "--force"
}

Write-Host "Recalage $Mode vers Allen"
Write-Host "Résultats: $Output"
& $Python @Arguments
if ($LASTEXITCODE -ne 0) {
    throw "Le recalage a échoué avec le code $LASTEXITCODE"
}

Write-Host "Contrôle visuel: $(Join-Path $Output 'registration_qc.png')"
