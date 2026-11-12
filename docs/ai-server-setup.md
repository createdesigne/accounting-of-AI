# AI設定・起動・デプロイ

## 利用者が画面から設定する

1. アプリ上部の歯車「AI設定」を開く。
2. Google AI StudioのGemini APIキーを入力する。モデルは配布元・Googleのプロジェクトで利用可能なIDを指定する。
3. 「この画面で使う」を押して閉じる。この時点ではAPI通信しない。
4. レシート候補で、整える項目・文章の整え方を確認し「Geminiに送信して文章を整える」を押す。
5. 生成候補を確認し、必要なら反映する。レシートの発行・帳簿への保存は別の操作。

既定モデルは元のGemini開発ブランチと同じ `gemini-3.5-flash-lite`。モデル欄から変更でき、利用できないモデルを別のモデルに自動置換しない。入力済みの表示は接続成功を意味しない。キーの有効性・モデルの利用権限・割当は送信時に確認される。

API利用料・上限は利用者のキーに紐づくGoogleのプロジェクトに適用される。ChatGPT等のWeb版の契約とは別。実キーをGit、チャット、VITE変数へ書かない。

## キーと文章の扱い

- キーはReactのメモリだけに保持する。localStorage・sessionStorage・Cookie・URL・レシート・QR・拡張・環境変数・サーバーのファイルには保存しない。
- 再読み込みやタブを閉じた後は再入力が必要。「キーを削除する」で現在のメモリから除き、生成待ちも中止する。別タブとは共有しない。
- キー設定・削除・画面表示・ヘルスチェックはGoogleへ送信しない。
- 送信時だけ `Authorization: Bearer ...` ヘッダーで中継サーバーへ送り、GoogleへはSDKの `x-goog-api-key` ヘッダーで渡す。キーを隠して保存している仕組みではなく、利用者が入力した秘密を一時的に中継する仕組み。
- 各リクエストで別のSDKクライアントを作る。利用者AのキーをBへ流用せず、キー未設定時に運営者の環境変数へフォールバックしない。
- JSON本文は `{text, instruction?}`、応答は `{text}`。選択した文章だけを送り、元の会話全体・帳簿は送らない。
- アプリはキー・リクエスト本文・上流エラー全文をログへ出さない。公開先でもAuthorizationヘッダーや本文を記録する監視設定は使わない。運営サーバーは通信中のキーを扱うため、利用者は信頼できる設置先で使う。
- 公開通信はHTTPS。Google側のデータ取り扱いは利用契約に従う。Interactions APIには `store:false` を指定する。

生成は原文6000文字、編集依頼500文字、応答8000文字、リクエスト32KiB、出力2048トークン。サーバー待機15秒、同時2件、自動再試行なし。キー・モデル・文章・項目の変更や中止時は古い生成結果を反映しない。

## ローカル起動

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

`http://127.0.0.1:8787/accounting-of-AI/` に画面とAPIを同じサーバーから配信する。開発時は `pnpm ai:server` と `pnpm dev` を別ターミナルで起動し、`http://127.0.0.1:5173/accounting-of-AI/` を使う。Viteが `/api/ai` を8787番へ中継する。

`/api/ai/health` は `{"status":"requires_key","configured":false,"credentialMode":"per_request"}` を返す。キーを保存していない正常な状態を表す。

`pnpm ai:setup` は画面での設定方法を案内する。Windowsではビルド後に `start-gemini-local.ps1` からも起動できる。以前の `server/.env` からキーを読み込む処理は通常の起動経路では使わない。旧設定用の内部ヘルパーとテストは残しているが、新方式で実行する必要はない。

## デプロイ先の比較

| 設置先 | この構成への適合 | 判断 |
| --- | --- | --- |
| Render Web Service | Nodeサーバーが画面とAPIを同時配信。永続ディスク・DBは不要 | 小規模な試用の第一候補。リポジトリに `render.yaml` を用意 |
| Railway | Nodeサーバーを起動し、PORTと公開URLを設定できる | 同じコードを使える代替候補。既存契約がある場合に向く |
| GitHub Pages | HTML・CSS・JSの静的配信のみ | 現在の画面公開は継続できるが、中継APIを別途置く必要がある |

Render無料Web Serviceは15分アクセスがないと停止し、再開に約1分かかる。無料枠は試用向けで、継続する実験・常時利用では有料枠を検討する。750インスタンス時間/月などの制限があり、通信量・ビルド時間の枠も別にある。ホスティング代とGemini API代は別。料金・条件は契約時に公式ページで確認する。

## Renderへ配置する手順

1. 対象ブランチをGitHubへpushし、Renderでリポジトリを接続する。変更を含むブランチを明示的に選ぶ。
2. Blueprintでリポジトリ直下の `render.yaml` を使う。またはWeb Serviceを手動作成する。
3. ビルドは `pnpm install --frozen-lockfile && pnpm build`、起動は `pnpm start`、Nodeは22系、`NODE_ENV=production`、ヘルスチェックは `/api/ai/health`。
4. `GEMINI_API_KEY` はRenderに登録しない。標準のonrender.com URLは `RENDER_EXTERNAL_URL` から使う。独自ドメインでは `PUBLIC_ORIGIN=https://実際のホスト名` を設定する。末尾スラッシュ・パスは付けない。
5. `https://実際のホスト名/accounting-of-AI/` を開く。ルート `/` からも転送される。生成したJS/CSSとAPIが同じ公開先から返ることを確認する。
6. 公開先を確定したら `chrome-extension/popup.js` の送信先 `WEB_APP_URLS` を更新し、`python3 scripts/package-extension.py` で配布ZIPを更新する。現在の拡張は既存のPages・preview・localhostを参照するため、新しい公開先への切替はこの操作が必要。

Blueprintは無料プラン・自動デプロイ無効の初期設定。新規契約やサービス作成・公開はこの変更では実行しない。Render固有のURL以外では `PUBLIC_ORIGIN` とプラットフォームの `PORT` を指定すれば同じNodeサーバーを使える。公開時は0.0.0.0、開発時は127.0.0.1にバインドする。

ブラウザの帳簿はURLのオリジン単位で保存される。Pagesから新しいRender URLへ移しても、以前の帳簿は自動転送されない。旧サイトを消さず、必要なデータの移行方式を決めてから本番の入口を切り替える。端末間同期・ユーザーログイン・サーバー側の帳簿保存は未実装。

全員が自分のキーを持ち込む小規模な試用を対象とする。CORSは認証ではなく、公開APIの第三者からの直接アクセスを防ぐものではない。不特定多数に提供する場合はアプリ利用者の認証・アクセス頻度制限を別途設計する。現状は同時実行数・サイズ・時間を制限しているが、利用者別の回数制限はない。

## 検証

```sh
TZ=Asia/Tokyo node --experimental-strip-types --test tests/*.test.ts
TZ=America/Los_Angeles node --experimental-strip-types --test tests/*.test.ts
python3 -m unittest tests/test_package_extension.py
python3 scripts/package-extension.py --check
pnpm build
```

ブラウザテストはViteを起動した状態で `tests/browser/geminiWriting.cjs` を実行する。Playwrightの場所は `PLAYWRIGHT_MODULE`、Chromiumの実行ファイルは `CHROMIUM_PATH` で指定できる。テストが8787番に模擬Google通信のサーバーを起動するため、通常のAIサーバーは停止しておく。架空のキーと応答だけを使い、実Geminiへの課金呼び出しはしない。

## 公式資料

- Render Node: https://render.com/docs/deploy-node-express-app
- Render Blueprint: https://render.com/docs/blueprint-spec
- Render無料枠: https://render.com/docs/free
- Render料金: https://render.com/pricing
- Railway Node: https://railway.com/guides/express
- GitHub Pages: https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
- Geminiキー: https://ai.google.dev/gemini-api/docs/api-key
- Gemini Interactions: https://ai.google.dev/gemini-api/docs/interactions
