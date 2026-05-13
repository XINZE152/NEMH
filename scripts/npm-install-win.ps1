# Windows: stop locks, remove root node_modules if possible, then install root + each app folder.
# (No npm workspaces = no symlink to server/client/admin/inventory-web.)

$ErrorActionPreference = 'Continue'
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $RepoRoot

Write-Host "==> Repo root: $RepoRoot"

Write-Host '==> Stopping node processes...'
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

$nm = Join-Path $RepoRoot 'node_modules'
if (Test-Path -LiteralPath $nm) {
  Write-Host '==> Removing root node_modules (close Cursor/antivirus if this fails with EBUSY)...'
  Remove-Item -LiteralPath $nm -Recurse -Force -ErrorAction Continue
}

Write-Host '==> Running npm run install:all ...'
npm run install:all
$code = $LASTEXITCODE
if ($code -ne 0) {
  Write-Host ''
  Write-Host 'If EBUSY: close this IDE, stop antivirus scan on this folder, then run again.' -ForegroundColor Yellow
  Write-Host 'If other errors: try Developer Mode (Settings - Privacy - For developers).' -ForegroundColor Yellow
  exit $code
}

Write-Host '==> Done.'
