param(
    [switch]$EnableGemini,
    [string]$Model = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw "Node.js 22系以降をインストールしてから実行してください。" }
$version = (& $nodeCommand.Source --version).Trim()
if ($version -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22) { throw "Node.js 22系以降が必要です。" }

# No key is accepted as a command-line argument or written to a file/history.
$names = @("AI_ENABLED", "AI_PROVIDER", "GEMINI_MODEL", "GEMINI_API_KEY", "AI_SERVER_PORT", "AI_ALLOWED_ORIGINS")
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, "Process") }
$secureKey = $null
try {
    $env:AI_ENABLED = "false"
    $env:AI_PROVIDER = "gemini"
    $env:AI_SERVER_PORT = "8787"
    $env:AI_ALLOWED_ORIGINS = "http://127.0.0.1:5173,http://localhost:5173"
    if ($EnableGemini) {
        Write-Host "このモードでは、文章の送信操作を行うとGoogleのGemini APIを利用し、料金が発生する場合があります。"
        Write-Host "学校による外部アプリでの利用許可・モデル・利用上限・送信するデータを確認してください。"
        $consent = Read-Host "上記を確認し、Geminiへの送信を有効にしますか（はい／いいえ）"
        if ($consent -ne "はい") { Write-Host "有効化を中止しました。"; return }
        if (-not $Model) { $Model = Read-Host "学校が許可したモデルID（AI Studioに表示されるgemini-...）" }
        if ($Model -notmatch '^gemini-[a-zA-Z0-9._-]{1,120}$') { throw "モデルIDを確認してください。" }
        $secureKey = Read-Host "Gemini APIキー（入力は表示されず、ファイルには保存しません）" -AsSecureString
        $env:GEMINI_API_KEY = ([System.Net.NetworkCredential]::new("", $secureKey)).Password
        $env:GEMINI_MODEL = $Model
        $env:AI_ENABLED = "true"
    }
    Write-Host "起動確認：http://127.0.0.1:8787/api/ai/health"
    Write-Host "起動・状態確認だけではGeminiに文章を送りません。終了はCtrl+Cです。"
    & $nodeCommand.Source (Join-Path $PSScriptRoot "server/index.mjs")
    if ($LASTEXITCODE -ne 0) { throw "AIサーバーが終了しました。ポートや設定を確認してください。" }
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $previous[$name], "Process") }
    if ($secureKey) { $secureKey.Dispose() }
}
