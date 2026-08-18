[CmdletBinding()]
param(
  [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$defaultOutput = Join-Path $projectRoot 'tmp\apk-handoff'
$outputRoot = if ($OutputDirectory) {
  [System.IO.Path]::GetFullPath($OutputDirectory)
} else {
  $defaultOutput
}

if (-not $outputRoot.StartsWith($projectRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Output directory must stay inside the project: $outputRoot"
}

$handoffRoot = Join-Path $outputRoot 'AgriCloudManager2.0'
$zipPath = Join-Path $outputRoot 'AgriCloudManager-APK-Handoff.zip'

if (Test-Path -LiteralPath $outputRoot) {
  $resolvedOutput = (Resolve-Path -LiteralPath $outputRoot).Path
  if ($resolvedOutput -ne $outputRoot) {
    throw "Refusing to clean an unexpected output path: $resolvedOutput"
  }
  Remove-Item -LiteralPath $resolvedOutput -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $handoffRoot | Out-Null

$requiredFiles = @(
  'package.json',
  'package-lock.json',
  'vite.config.js',
  'index.html',
  'shims-uni.d.ts',
  '.env.app',
  '.env.production',
  'project.config.json'
)

Copy-Item -LiteralPath (Join-Path $projectRoot 'src') -Destination (Join-Path $handoffRoot 'src') -Recurse
foreach ($relativePath in $requiredFiles) {
  $source = Join-Path $projectRoot $relativePath
  if (-not (Test-Path -LiteralPath $source)) {
    throw "Required APK handoff file is missing: $source"
  }
  Copy-Item -LiteralPath $source -Destination (Join-Path $handoffRoot $relativePath)
}

Copy-Item -LiteralPath (Join-Path $projectRoot 'deploy\FINAL-HANDOFF-2026-08-23.md') `
  -Destination (Join-Path $handoffRoot 'PACKAGING-CHECKLIST.md')

$iconSource = Join-Path $projectRoot 'unpackage\res\icons'
$iconTargetParent = Join-Path $handoffRoot 'unpackage\res'
if (-not (Test-Path -LiteralPath $iconSource)) {
  throw "Android icon directory is missing: $iconSource"
}
New-Item -ItemType Directory -Force -Path $iconTargetParent | Out-Null
Copy-Item -LiteralPath $iconSource -Destination (Join-Path $iconTargetParent 'icons') -Recurse

$forbiddenPatterns = @(
  'agricloud-api\.onrender\.com',
  '123\.58\.210\.188',
  'OSS_ACCESS_KEY_SECRET\s*=\s*\S+',
  'VIVO_APP_KEY\s*=\s*\S+',
  'JWT_SECRET\s*=\s*\S+'
)

$textFiles = Get-ChildItem -LiteralPath $handoffRoot -Recurse -File |
  Where-Object { $_.Extension -in @('.ts', '.js', '.vue', '.json', '.scss', '.css', '.html', '.app', '.production') -or $_.Name -like '.env.*' }

foreach ($file in $textFiles) {
  $content = Get-Content -LiteralPath $file.FullName -Raw
  foreach ($pattern in $forbiddenPatterns) {
    if ($content -match $pattern) {
      throw "Forbidden value found in APK handoff file $($file.FullName): $pattern"
    }
  }
}

Compress-Archive -Path (Join-Path $handoffRoot '*') -DestinationPath $zipPath -Force

$zip = Get-Item -LiteralPath $zipPath
[PSCustomObject]@{
  HandoffDirectory = $handoffRoot
  ZipPath = $zip.FullName
  ZipBytes = $zip.Length
}
