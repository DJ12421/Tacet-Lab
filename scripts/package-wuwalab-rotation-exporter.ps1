$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dist = Join-Path $root 'dist'
$name = "WuwaLab-Rotation-Exporter-Windows-Node-required-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$bundle = Join-Path $dist $name
$zip = Join-Path $dist "$name.zip"
if ((Test-Path -LiteralPath $bundle) -or (Test-Path -LiteralPath $zip)) {
  throw 'This package already exists. Run the packager again in a moment.'
}

New-Item -ItemType Directory -Path (Join-Path $bundle 'scripts') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'scripts/export-wuwalab-rotation.mjs') -Destination (Join-Path $bundle 'scripts')
Copy-Item -LiteralPath (Join-Path $root 'scripts/wuwalab-attack-map.json') -Destination (Join-Path $bundle 'scripts')
Copy-Item -LiteralPath (Join-Path $root 'scripts/wuwalab-rotation-gui.html') -Destination (Join-Path $bundle 'scripts')
Copy-Item -LiteralPath (Join-Path $root 'scripts/open-wuwalab-rotation-exporter.cmd') -Destination (Join-Path $bundle 'scripts')
Copy-Item -LiteralPath (Join-Path $root 'scripts/wuwalab-exporter-README.txt') -Destination (Join-Path $bundle 'README.txt')
Copy-Item -LiteralPath (Join-Path $root 'LICENSE') -Destination (Join-Path $bundle 'TACET-LAB-LICENSE.txt')
Set-Content -LiteralPath (Join-Path $bundle 'Open WuwaLab Rotation Exporter.cmd') -Encoding Ascii -Value '@echo off', 'call "%~dp0scripts\open-wuwalab-rotation-exporter.cmd"'

Compress-Archive -LiteralPath $bundle -DestinationPath $zip -CompressionLevel Optimal
Write-Output "Send this ZIP to testers: $zip"
