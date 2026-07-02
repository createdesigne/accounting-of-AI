$ErrorActionPreference = "Stop"

$nodePath = "C:\Users\syet0\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$vitePath = Join-Path $PSScriptRoot "node_modules\vite\bin\vite.js"

if (-not (Test-Path $nodePath)) {
  Write-Host "内蔵Nodeが見つかりません。Node.jsをインストールしてから、npm run dev を実行してください。"
  exit 1
}

if (-not (Test-Path $vitePath)) {
  Write-Host "node_modules が見つかりません。先に依存関係のインストールが必要です。"
  exit 1
}

$env:PATH = (Split-Path $nodePath) + ";" + $env:PATH
& $nodePath $vitePath --host 127.0.0.1
