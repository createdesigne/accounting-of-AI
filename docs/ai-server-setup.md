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

生成は原文6000文字、編集依頼500文字、応答8000文字、リクエスト32KiB、出力2048トークン。サーバー待機15秒、同時2件／サーバープロセス（VercelではFunctionインスタンスごと）、自動再試行なし。キー・モデル・文章・項目の変更や中止時は古い生成結果を反映しない。

## ローカル起動

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

`http://127.0.0.1:8787/accounting-of-AI/` に画面とAPIを同じサーバーから配信する。開発時は `pnpm ai:server` と `pnpm dev` を別ターミナルで起動し、`http://127.0.0.1:5173/accounting-of-AI/` を使う。Viteが `/api/ai` を8787番へ中継する。

`/api/ai/health` は `{"status":"requires_key","configured":false,"credentialMode":"per_request"}` を返す。キーを保存していない正常な状態を表す。

`pnpm ai:setup` は画面での設定方法を案内する。Windowsではビルド後に `start-gemini-local.ps1` からも起動できる。以前の `server/.env` からキーを読み込む処理は通常の起動経路では使わない。旧設定用の内部ヘルパーとテストは残しているが、新方式で実行する必要はない。

## Vercel本番

- 本番URL: https://accounting-of-ai.vercel.app/accounting-of-AI/
- Vercelチーム: `rintaro-chujos-projects`（中條のPro）
- プロジェクト: `accounting-of-ai`
- 管理画面: https://vercel.com/rintaro-chujos-projects/accounting-of-ai

画面は静的ファイル、`/api/ai/health` と `/api/ai/rewrite` はNode.js Functionsとして配信する。`pnpm build:vercel` がViteの出力を `dist/accounting-of-AI/` へ配置するため、既存のアプリ内URLを維持する。Functionの上限は30秒、Googleへの待機は15秒。同時2件の制限はインスタンスごとで、全体の回数・費用制限ではない。

Geminiキーの環境変数は登録しない。Vercelの自動環境変数から同一オリジンを許可する。独自ドメインを追加する場合のみ `PUBLIC_ORIGIN=https://実際のホスト名` を指定する。Authorizationヘッダーや本文をログに記録しない。

### 更新する

認証済みVercel CLIを使い、リポジトリ直下で実行する。

```sh
pnpm install --frozen-lockfile
pnpm build:vercel
vercel deploy --prod --project accounting-of-ai --scope rintaro-chujos-projects --yes
```

公開後は本番画面、設定画面、`/api/ai/health`、拡張ZIPを確認する。実キーでの生成確認は利用者が自分のキーを設定して行う。

### GitHub自動デプロイ

現状はCLI経由で公開している。リポジトリ接続はVercelから `Vercel App is not installed` が返り、未接続。リポジトリ側でVercel GitHub Appに `createdesigne/accounting-of-AI` へのアクセスを許可してから接続する。

```sh
vercel git connect https://github.com/createdesigne/accounting-of-AI.git --project accounting-of-ai --scope rintaro-chujos-projects --yes
```

接続後にProduction Branchとビルド対象を確認する。Proプランでのコミット作者の権限判定はVercelチームへの所属・GitHubアカウント連携にも依存する。接続が完了するまでは中條のpushでも自動デプロイは動かない。共有リポジトリに個人のVercelトークンを登録して迂回しない。

### 旧サイトと帳簿

ブラウザの帳簿はURLのオリジン単位で保存される。GitHub PagesからVercelへ移しても以前の帳簿は自動転送されない。旧サイト https://createdesigne.github.io/accounting-of-AI/ を残し、Chrome拡張v0.3.2では「旧サイト（以前の帳簿）」も選択できる。新しい既定の送信先はVercel本番。旧サイトにはVercel APIを接続していない。端末間同期・ユーザーログイン・サーバー側の帳簿保存は未実装。

## 他のデプロイ先

| 設置先 | この構成への適合 |
| --- | --- |
| Vercel Pro | 採用。画面の静的配信とNode.js Functionsを同じURLで提供 |
| Render Web Service | `render.yaml` でNodeサーバーから画面とAPIを同時配信。永続ディスク・DBは不要 |
| Railway | `pnpm build` 後に `pnpm start`。PORTとPUBLIC_ORIGINを設定 |
| GitHub Pages | 静的配信のみ。Gemini中継APIを別途置く必要がある |

RenderのBlueprintは無料プラン・自動デプロイ無効の初期設定。標準URLは `RENDER_EXTERNAL_URL` から使う。その他のNode環境では `PUBLIC_ORIGIN` と `PORT` を指定する。ホスティング代と利用者のGemini API代は別。

全員が自分のキーを持ち込む小規模な試用を対象とする。CORSは認証ではなく、公開APIの第三者からの直接アクセスを防ぐものではない。現状はサイズ・時間・インスタンス内同時実行数を制限しているが、利用者別の回数制限はない。

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

- Vercel Node.js Functions: https://vercel.com/docs/functions/runtimes/node-js
- Vercel Git連携と作者権限: https://vercel.com/docs/deployments/troubleshoot-project-collaboration

- Render Node: https://render.com/docs/deploy-node-express-app
- Render Blueprint: https://render.com/docs/blueprint-spec
- Render無料枠: https://render.com/docs/free
- Render料金: https://render.com/pricing
- Railway Node: https://railway.com/guides/express
- GitHub Pages: https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
- Geminiキー: https://ai.google.dev/gemini-api/docs/api-key
- Gemini Interactions: https://ai.google.dev/gemini-api/docs/interactions
