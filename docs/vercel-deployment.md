# Vercelへの移転

移転先の希望URL: **https://accounting-of-ai.vercel.app/accounting-of-AI/**

画面はVite、APIはVercelのNode.js Functionsで動かします。既存のGemini SDK・Interactions API・入力チェックを共有し、ブラウザにはキーを渡しません。GitHub Pages用のビルドと旧サイトは残します。

## ご本人に必要な操作

1. https://vercel.com/signup でアカウントを作成し、GitHubでログインします。
2. Add New → Projectで `createdesigne/accounting-of-AI` をImportします。GitHubの許可は対象リポジトリに限定してください。Root Directoryはリポジトリ直下（`./`）です。
3. プロジェクト名を **accounting-of-ai** にします。希望ドメインが利用可能か、ここで確認してください。他の所有者が利用している場合、そのURLをこちらから上書きできません。
4. 今回の設定を含む **feat/vercel-deployment** ブランチをデプロイ対象にしてください。Importがmainを選んだ場合、その初回公開には今回のAPI設定が入りません。Project Settings → GitでProduction Branchを `feat/vercel-deployment` に設定し、Deployments → Create Deploymentで同ブランチを指定します。mainへのマージはまだ必要ありません。
5. Environment Variablesで以下を登録します。GeminiのキーはVercelの入力欄にだけ貼り付け、チャット・GitHub・`VITE_`で始まる変数には入れないでください。この開発環境のシークレットはVercelへ自動コピーされません。

| 名前 | 設定内容 | 公開範囲 |
| --- | --- | --- |
| `GEMINI_API_KEY` | 学校から配布されたキー | サーバーのみ |
| `AI_ENABLED` | `true`（停止する場合は`false`） | サーバーのみ |
| `GEMINI_MODEL` | 現在接続に成功しているモデルID。省略時は既存の `gemini-3.5-flash-lite` | サーバーのみ |

EnvironmentはまずProductionを選びます。Previewでも実APIを試す場合に限りPreviewにも登録してください。変数の表示順は関係ありません。追加・変更後は**再デプロイ**が必要です。`VITE_AI_SERVER_URL`はビルドスクリプトが `/api/ai` に設定するため手入力不要です。

6. Node.jsは22.x、Package Managerはpnpm 9.15.9です。リポジトリの設定を優先し、Install Commandは `pnpm install --frozen-lockfile`、Build Commandは `pnpm build:vercel`、Output Directoryは `dist` を使ってください。ローカルの `.env` をアップロードする必要はありません。
7. 公開後、希望URLと `/api/ai/health` を開きます。後者の `configured: true` は設定の存在確認であり、Googleへの接続成功ではありません。レシート → サンプル会話を読み込む → Gemini文章パネル → 送信、と進み、生成文の表示で実接続を確認します。送信する文章だけがGoogleへ送られます。

## 帳簿と拡張機能

- 帳簿はlocalStorageにあり、ドメインが変わると別の保存先になります。**旧サイトの帳簿は自動移行されません。**旧サイトを消したり、ブラウザの保存データを消したりしないでください。帳簿全体の安全な移行UIは今回追加していません。
- 拡張機能0.3.2では「Vercelサイト」を送信先に追加しました。VercelサイトのZIPをダウンロードして展開し、Chromeの拡張機能を更新してから選択してください。既存の送信先・抽出方法は維持しています。移転確認まではGitHub Pagesが既定です。
- GitHub Pagesの自動公開は停止していません。Vercelでの確認が終わってから旧サイトの扱いを決めてください。

## 公開範囲と利用量

既存アプリには利用者認証がありません。Originの照合と入力・同時実行制限はありますが、Originは認証ではなく、同時実行制限もFunctionのインスタンス内だけです。一般公開してキーを共有する前に、VercelのDeployment Protection等で学校の利用対象に制限し、Google側の割当・利用量とVercel側の利用量を確認してください。プランによって保護できる環境が異なります。キーを隠すことだけでは第三者によるAPI消費を防げません。

## この変更で行う確認

```bash
pnpm install --frozen-lockfile
TZ=Asia/Tokyo node --experimental-strip-types --test tests/*.test.ts
pnpm build:vercel
python3 scripts/package-extension.py --check
```

ローカルでVercel用ハンドラーと本物のGoogle SDKをテスト用HTTP応答に接続し、ブラウザからの送信・生成文の確認・反映・エラーを確認できます。Vercel上のビルド・ルーティング・実キー接続は、アカウント作成とデプロイ後に別途確認してください。

実装参考（Vercel公式）:
- https://vercel.com/docs/functions/runtimes/node-js
- https://vercel.com/docs/project-configuration
- https://github.com/vercel/vercel/blob/main/packages/node/src/serverless-functions/helpers.ts
