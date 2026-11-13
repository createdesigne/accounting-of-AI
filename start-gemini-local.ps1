# API keys are entered in the browser, never in this launcher.
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
Push-Location $PSScriptRoot
try {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCommand) { throw "Node.js 22 or later is required." }
    if (-not (Test-Path "dist/index.html")) { throw "Run pnpm install --frozen-lockfile and pnpm build first." }
    Write-Host "Open http://127.0.0.1:8787/accounting-of-AI/ and enter your key in AI settings."
    & $nodeCommand.Source (Join-Path $PSScriptRoot "server/index.mjs")
} finally { Pop-Location }
