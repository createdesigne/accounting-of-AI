# Gemini接続の準備・Windowsでの設定

## APIキーだけお持ちの場合

Google AI Studio（Gemini Developer API）用のキーに対応した接続処理を用意しています。Gemini本体はGoogle側で動きますが、ブラウザーにキーを公開しないため、このアプリとGeminiの間に小さな中継サーバーが必要です。

最初は自分のWindowsパソコン内で中継サーバーを動かせるため、新しいサーバー契約は不要です。APIの利用料・利用上限・送信できるデータ・使用できるモデルは学校の契約に従います。キーがあるだけで無料・共有可能とは限らないので、学校の担当者に「このアプリからGemini APIを使ってよいか」「許可モデルのID」「利用上限」を確認してください。

キーはチャット、Git、Chrome拡張機能、Reactのコード、`VITE_*`の設定には入れません。実際のキーを送っていただく必要はありません。

## 今回準備したもの

- `server/gemini.mjs`：Google公式のGemini API形式に合わせた接続処理。キーはリクエストヘッダーにだけ付け、URLには含めません。許可されたモデルIDを指定します。
- `server/app.mjs`：文章と依頼内容を受け取り、生成結果を文章として返すローカルHTTPサーバー。
- `src/aiClient.ts`：アプリから呼び出すための接続口。現時点で既存画面からの自動呼び出し・自動保存はありません。
- `start-gemini-local.ps1`：Windows用起動スクリプト。通常起動はAPI利用を無効にしたまま。必要な場合だけ非表示入力でキーを受け取り、終了後に起動前の設定を復元します。

キーだけでなく `AI_ENABLED=true` とモデルの設定が必要です。初期状態では無効です。実APIに接続するテスト、文章送信、本番公開、サーバー契約は今回行っていません。外部AI利用や公開をこちらで実行する場合は、利用者の許可を得てから行います。

## 1．APIキーなしで起動を確認する

前提はNode.js 22系以降です。この中継サーバーには追加ライブラリは不要です。Node.jsがなければ、公式サイト `https://nodejs.org/` のLTS版をインストールし、PowerShellを開き直してください。こちらから新しいPC用ソフトをインストールする作業は行っていません。

プロジェクトのフォルダーでPowerShellを開き、次を実行します。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-gemini-local.ps1
```

この指定は起動するPowerShellだけに適用され、システム全体の実行ポリシーは変更しません。

ブラウザーで `http://127.0.0.1:8787/api/ai/health` を開きます。

```json
{"status":"disabled","configured":false}
```

これは「中継サーバーは起動したがGeminiは無効」を表す正常な状態です。起動や状態確認はGemini APIにアクセスしません。終了はCtrl+Cです。

## 2．学校の許可・費用を確認した後のキー設定

まず学校の担当者またはAI Studioのモデル選択欄で、利用可能なモデルID（`gemini-...`）を確認します。特定モデルを自動選択しない構成です。

次のコマンドはGemini接続を有効にするためのものです。学校の許可・送信内容・費用を確認した後だけ実行してください。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-gemini-local.ps1 -EnableGemini
```

1. 確認に「はい」と入力します。
2. 学校が許可したモデルIDを入力します。
3. APIキーを非表示の入力欄へ入力します。キーをコマンド本文に書かないでください。

スクリプトはキーをファイルに保存しません。起動中のサーバープロセスの環境変数にだけ渡します。停止後に再起動する際は再入力します。学校のキーを共有相手へ配布する必要もありません。

状態確認が `{"status":"configured","configured":true}` になれば設定を読み込んでいます。ただし、この表示だけでキー・モデル・残高が有効と確認されたことにはなりません。実API確認には、次の送信操作が必要です。

## 3．許可後に行う実APIの接続確認

**この操作は選択した文章をGoogleに送信し、APIの利用料が発生する場合があります。** 許可された内容だけで行ってください。こちらではまだ実行していません。

サーバーを起動したまま、別のPowerShellで次を実行します。

```powershell
$body = @{ text = "接続を確認するための文章です。"; instruction = "意味を変えず丁寧に整える" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8787/api/ai/rewrite" -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($body))
```

文章の候補が返れば接続確認ができます。実際の画面のどの文章へ適用するかは別途決め、送信前・保存前に確認する形で接続します。集計式・思考残高の定義や帳簿データは変えません。

代表的なエラー：

| コード | 確認すること |
| --- | --- |
| AI_NOT_CONFIGURED | 接続を有効にする設定があるか |
| AUTH_ERROR | キーが有効か、学校でAPI利用が許可されているか |
| MODEL_UNAVAILABLE | モデルIDとプロジェクトの利用権限 |
| RATE_LIMITED | 学校の利用上限・割り当て・時間帯 |
| CONTENT_BLOCKED | Googleが生成を停止した内容。制限を迂回せず送信内容を見直す |
| OUTPUT_TRUNCATED | 文章を短くする。途中で切れた文章を成功として返さない |

権限エラーのときは、学校のキーの制限を勝手に解除せず担当者へ確認してください。キーや上流のエラー全文はこのサーバーから返しません。

## 一般公開するときの「設置先」

パソコン内のサーバーはそのPCが起動している間だけ使える開発用です。ほかの利用者も本番サイトから使うには、サーバープログラムを継続稼働させる設置先が必要です。GitHub Pagesは画面を公開できますが、このNode.jsサーバーを実行できません。

学校に契約済みの環境があればサービス名だけ確認してください。新規契約や有料サービスの利用は、候補・費用を説明して許可を得てから行います。公開前にログイン認証、利用者別・全体の回数／費用上限、HTTPS、サーバー側の秘密設定を整えます。現在は127.0.0.1だけで待ち受け、公開用認証は未実装です。CORSはログイン認証の代わりにはなりません。

本番のキーは設置先の秘密設定欄 `GEMINI_API_KEY` に登録します。接続先が未定の現在は、ここへキーを渡す必要はありません。

## 開発者向け

`server/.env.example` を `server/.env` にコピーし、必要な場合だけサーバー用の設定を入れられます。`server/.env` はGitの対象外です。キーをファイルに残したくない場合はWindows起動スクリプトを使います。

```sh
pnpm ai:server
node --experimental-strip-types --test tests/*.test.ts
pnpm build
```

開発画面の起動は `pnpm dev`。`/api/ai` はローカルの8787番へ転送されます。ポートを変更した場合は `vite.config.ts` とサーバー側の設定を合わせます。許可オリジンは開発時の5173番だけです。

リクエストは `{text, instruction?}`、応答は `{text}`。原文6000文字、依頼500文字、結果8000文字、リクエスト全体32KiBが上限です。文字数はJavaScript文字列長で数えます。生成待ちは15秒・同時2件、出力トークン上限2048。自動再試行は行いません。モデルの仕様や費用は学校で許可された設定を別途確認します。

テストではローカルHTTPと模擬Gemini応答だけを使い、実APIや実キーは使いません。Windows PowerShellの実機実行は未確認です。

実装形式の参照（Google公式、実API呼び出しではない資料）：

- https://github.com/googleapis/googleapis/blob/master/google/ai/generativelanguage/v1beta/generative_service.proto
- https://github.com/googleapis/js-genai
