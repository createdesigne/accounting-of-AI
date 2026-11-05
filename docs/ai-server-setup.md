# Gemini接続の準備・Windowsでの設定

## APIキーだけお持ちの場合

Google AI Studio（Gemini Developer API）用のキーに対応した接続処理を用意しています。Gemini本体はGoogle側で動きますが、ブラウザーにキーを公開しないため、このアプリとGeminiの間に小さな中継サーバーが必要です。

最初は自分のWindowsパソコン内で中継サーバーを動かせるため、新しいサーバー契約は不要です。提供されたキーのこのアプリでの使用許可は、利用者から確認済みです。許可を取り直す必要はありません。APIの利用料・利用上限・送信できるデータ・使用できるモデルは学校の契約に従うため、モデルIDと利用上限が不明な場合は学校の担当者またはAI Studioで確認します。

キーはチャット、Git、Chrome拡張機能、Reactのコード、`VITE_*`の設定には入れません。実際のキーを送っていただく必要はありません。

## 最初に：キーを保存する場所

このアプリはReact / TypeScript / Viteです。Next.jsの `.env.local` ではなく、**プロジェクト直下の `server` フォルダー内の `.env`** を使います。現在のクラウド環境には、キーを空にしたこのファイルを作成済みです。実際の値は利用者が入力します。

```dotenv
GEMINI_API_KEY=ここに配布されたキーを貼り付ける
GEMINI_MODEL=gemini-3.5-flash-lite
AI_ENABLED=true
```

`GEMINI_API_KEY=` の右側だけを実際のキーに置き換えて保存します。前後の説明文やコードの囲みは貼り付けません。保存したらサーバーを再起動してください。キーを設定するだけで、画面を開いた瞬間にGoogleへ送信することはありません。`AI_ENABLED=true` にし、画面で送信操作を行ったときだけ接続します。

`server/.env` はGit管理対象外です。値を確認する目的でチャットへ貼ったり、ターミナルに表示したりしないでください。ルートの `.env.example` は公開してもよいサーバーURLの見本だけで、キーの保存先ではありません。

## 今回準備したもの

- `server/gemini.mjs`：Google公式SDK **`@google/genai` 2.32.0** の **Interactions API** を使用します。キーはヘッダーにだけ付け、URLには含めません。SDKは `server/package.json` にだけ追加し、画面の依存関係とは分離しています。
- `server/app.mjs`：文章と依頼内容を受け取り、生成結果を文章として返すローカルHTTPサーバー。
- `src/aiClient.ts` と `src/AiWritingPanel.tsx`：レシート候補の「相談テーマ」「AIが足したこと」「自分で決めたこと」を選んで文章を整えます。送信前の説明・読み込み表示・中止・エラー・生成候補の確認・破棄・反映があります。自動送信や自動保存はありません。
- `start-gemini-local.ps1`：Windows用起動スクリプト。通常起動はAPI利用を無効にしたまま。必要な場合だけ非表示入力でキーを受け取り、終了後に起動前の設定を復元します。

キーだけでなく `AI_ENABLED=true` が必要です。初期状態では無効です。新規のSDKインストール・ローカル検証は実施していますが、実APIの有料呼び出し、本番公開、新しいサーバー契約は行っていません。

### 選択モデルと費用

2026年11月5日にGoogle公式SDKと公式Cookbookを確認し、初期モデルは非previewの固定ID **`gemini-3.5-flash-lite`** を選びました。公式Cookbookが3.5系で低コストのモデルと説明しており、短い文章の編集用途に合わせた選定です。将来モデルが変わる `latest` エイリアスは使いません。学校のキーの割り当てで実際に利用可能かは接続後に確認します。利用できない場合は設定を変更し、自動で他のモデルに切り替えません。

InteractionsのAPIバージョンはSDKの既定と公式例に合わせて `v1beta` を使用します。モデルIDの安定性とAPIのバージョンは別です。`store:false` でInteractionsの履歴保存を要求せず、過去のinteraction ID・検索・外部ツール・自動継続は使いません。Google側のデータ取り扱いは学校の契約条件も確認してください。

最大出力は2048トークン、原文は6000文字まで、SDKの自動再試行は無効です。正確な課金額は学校の契約・Googleの料金表・使用モデルに従い、この実装だけで無料を保証するものではありません。

## 1．APIキーなしで起動を確認する

前提はNode.js 22系の最新版以降とpnpmです。今のクラウド環境にはSDKと必要な依存関係をインストール済みです。Windowsへコードをダウンロードして動かす場合は、プロジェクトのフォルダーで最初に `pnpm install --frozen-lockfile` を実行します。Node.jsがなければ、公式サイト `https://nodejs.org/` のLTS版を利用してください。

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

## 2．使用許可済みのキーを設定する

初期モデルは `gemini-3.5-flash-lite` です。学校で別のモデルが指定されていれば `GEMINI_MODEL` で上書きできます。

次のコマンドはGemini接続を有効にするためのものです。使用許可済みのキーを使い、送信内容・モデル・利用上限を確認して実行します。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-gemini-local.ps1 -EnableGemini
```

1. 確認に「はい」と入力します。
2. APIキーを非表示の入力欄へ入力します。キーをコマンド本文に書かないでください。モデルは上記の初期値を使用し、必要なら `-Model gemini-...` を指定します。

スクリプトはキーをファイルに保存しません。起動中のサーバープロセスの環境変数にだけ渡します。停止後に再起動する際は再入力します。学校のキーを共有相手へ配布する必要もありません。

状態確認が `{"status":"configured","configured":true}` になれば設定を読み込んでいます。ただし、この表示だけでキー・モデル・残高が有効と確認されたことにはなりません。実API確認には、次の送信操作が必要です。

## 3．許可後に行う実APIの接続確認

**この操作は選択した文章をGoogleに送信し、APIの利用料が発生する場合があります。** 許可された内容だけで行ってください。こちらではまだ実行していません。

サーバーを起動したまま、別のPowerShellで次を実行します。

```powershell
$body = @{ text = "接続を確認するための文章です。"; instruction = "意味を変えず丁寧に整える" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8787/api/ai/rewrite" -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($body))
```

文章の候補が返れば接続確認ができます。画面上ではレシート候補の文章を送信前・反映前に確認する形で接続します。集計式・思考残高の定義や帳簿データは変えません。

## 4．アプリ画面で使う

サーバー起動中に、もう1つのターミナルで次を実行します。

```sh
pnpm dev:ai
```

下部「レシート」→「サンプル会話を読み込む」または拡張機能からの会話確認へ進みます。候補の下部に「Geminiで文章を整える」が表示されます。対象項目と編集の依頼を確認し、「Geminiに送信して文章を整える」を押すと、その項目の文章だけを送ります。生成した文章は確認・破棄でき、「この文章を候補に反映する」で初めて下書きに反映します。従来どおり発行・保存するまでは帳簿へ保存しません。

元の文章・項目・依頼を変更した場合や画面を離れた場合、古い応答を破棄します。AIによって役割・気持ち・思考残高・集計値を自動判定し直すことはありません。生成された文章の事実・意図は利用者が確認します。

通常の `pnpm dev` と本番ビルドでは、`VITE_AI_SERVER_URL` を設定しなければAI欄は表示されません。この変数に入れるのはサーバーURLだけで、キーは絶対に入れません。本番への反映は別途確認してから行います。

## このクラウド環境での設定

この環境内ではSDK・中継サーバー・アプリの開発起動と、模擬応答を使った一連の検証まで実施できます。新しいサーバー契約は不要です。今の環境が常設の本番公開先であると確認したものではありません。

環境設定の下書きには秘密設定 `GEMINI_API_KEY`、変数 `GEMINI_MODEL`・`AI_ENABLED`、Gemini送信先の許可を準備しています。環境設定はファイルより優先されるため、環境変数側に `AI_ENABLED=false` が設定されている場合は、ファイルだけをtrueにしても有効になりません。クラウドの秘密設定を使う場合は、その設定画面で値を入力します。チャットへの入力は不要です。

この環境で実通信する場合は、保存した設定の適用と、プラットフォーム指定のHTTPSプロキシ経由での接続が必要です。Node.js 24系で `NODE_USE_ENV_PROXY=1 pnpm ai:server` と起動し、既存のプロキシ・CA設定を維持します。ネットワーク制限を迂回して接続しません。

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

開発画面の起動は `pnpm dev:ai`（AI欄あり）または `pnpm dev`（初期状態でAI欄なし）。`/api/ai` はローカルの8787番へ転送されます。ポート変更時は `vite.config.ts` とサーバー設定を合わせます。許可オリジンは開発時の5173番だけです。

リクエストは `{text, instruction?}`、応答は `{text}`。原文6000文字、依頼500文字、結果8000文字、リクエスト全体32KiBが上限です。文字数はJavaScript文字列長で数えます。生成待ちは15秒・同時2件、出力トークン上限2048。自動再試行は行いません。モデルの仕様や費用は学校で許可された設定を別途確認します。

テストではローカルHTTPと模擬Gemini応答だけを使い、実APIや実キーは使いません。Windows PowerShellの実機実行は未確認です。

実装形式の参照（Google公式、実API呼び出しではない資料）：

- https://github.com/googleapis/js-genai
- https://github.com/google-gemini/cookbook/blob/main/README.md
- https://github.com/google-gemini/cookbook/blob/main/quickstarts/Get_started.ipynb
- https://ai.google.dev/gemini-api/docs/interactions
- https://ai.google.dev/gemini-api/docs/pricing
