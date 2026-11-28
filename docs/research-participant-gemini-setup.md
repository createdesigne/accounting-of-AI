# 研究参加者向けGemini接続の設定

この機能は、参加者へ研究者のGemini APIキーを配布せず、参加者ごとのアクセスコードで週次構造化分析だけを利用できるようにするものです。従来の「自分のGemini APIキーを使う」方式も維持します。

## 安全上の前提

- 研究用Gemini APIキーはVercelのサーバー側Environment Variablesだけに設定します。`VITE_`で始まる変数、Chrome拡張機能、ソースコードには設定しません。
- 参加者コードの平文はVercelへ保存せず、SHA-256ハッシュだけを設定します。コードは20文字以上の暗号学的乱数を参加者ごとに別々に発行します。
- コードはアプリのメモリ内だけに保持され、再読み込みで消えます。帳簿、研究JSON、localStorageには保存されません。
- 参加者方式は `/api/ai/analyze-weekly` 専用です。文章編集や技術診断には利用できません。
- 会話本文は、活動ごとの明示同意後だけ送信されます。
- 利用上限の外部ストレージが未設定・不正・障害中の場合、参加者方式は安全側に停止します。インメモリの上限へはフォールバックしません。

## 1. Upstash RedisをVercelへ追加する

Vercel Marketplaceから対象プロジェクトのPreview環境へUpstash Redisを追加します。統合で次のサーバー側変数が作成されることを確認します。

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Production環境へは、研究用Previewでの確認と共同管理者の承認が終わるまで設定しません。値を画面共有、Issue、PR、ログへ貼り付けないでください。

## 2. 参加者コードを発行する

参加者ごとにPowerShellでコードを生成します。表示されたコードは本人へ安全な別経路で一度だけ渡します。

```powershell
$bytes = New-Object byte[] 24
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$code = [Convert]::ToBase64String($bytes).Replace('+','-').Replace('/','_').TrimEnd('=')
$hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($code))).ToLowerInvariant()
"参加者へ渡すコード: $code"
"Vercelへ登録するSHA-256: $hash"
```

コードと参加者の対応表は、GitHub外の研究管理領域で保管します。参加者名や学籍番号をVercelのIDに使わず、`participant-01`のような研究用仮名IDを使います。

## 3. Vercel PreviewのEnvironment Variables

PR #12のPreview環境に、次をサーバー側Environment Variablesとして設定します。値を変更した後はPreviewを再デプロイします。

| 変数 | 設定例・意味 |
|---|---|
| `RESEARCH_GEMINI_API_KEY` | 研究者が管理するGemini APIキー。Previewのサーバー側だけに設定 |
| `RESEARCH_PARTICIPANT_CODES_SHA256` | `{"participant-01":"64桁のSHA-256","participant-02":"64桁のSHA-256"}` |
| `RESEARCH_GEMINI_MODEL` | 研究で固定するモデル（例：`gemini-3.1-flash-lite`） |
| `RESEARCH_GEMINI_API_METHOD` | `generate-content` または `interactions`。省略時は`generate-content` |
| `RESEARCH_PARTICIPANT_LIMIT` | 参加者1人あたりの研究期間中の受理回数 |
| `RESEARCH_GLOBAL_LIMIT` | 研究全体の研究期間中の受理回数 |
| `RESEARCH_QUOTA_NAMESPACE` | 研究期間を識別する値（例：`study-2026-12`）。新しい研究でだけ変更 |
| `RESEARCH_IDEMPOTENCY_TTL_SECONDS` | 同一requestIdの重複課金を防ぐ期間。省略時2,592,000秒（30日） |

`UPSTASH_REDIS_REST_URL`と`UPSTASH_REDIS_REST_TOKEN`も含め、必要な変数が1つでも欠ける・形式が不正な場合、参加者方式は`研究参加者向け接続を利用できません`として停止します。

利用上限は、Geminiへ送信することをサーバーが受理した回数です。Gemini側の一時障害を含め、受理後の失敗でも原則として1回に数えます。同じ`requestId`かつ同じ検証済み本文のネットワーク再送はRedis側で重複加算しません。同じIDで本文を変えた要求は別要求として加算されるため、ID再利用で上限を回避できません。503に対する既存の回数制限付き再試行は、同じ1分析リクエスト内で行われます。

## 4. 研究者・参加者の操作

1. 研究者はPreviewへ認証して参加者へURLと個別コードを案内します。
2. 参加者は「設定」→「Geminiとの接続」→「研究参加者として利用する」を選び、個別コードを入力します。
3. 導入前3日間は分析を実行せず、記録と会計だけを利用します。
4. 分析期間は活動のGemini分析画面で、会話本文を今回送ることへ明示同意してから実行します。
5. 無効コード・上限超過・Redis障害・Gemini障害でも、本人入力、活動、仕訳、決算は保持されます。

## 5. 公開前の確認

- Previewで正規コード、無効コード、参加者上限、研究全体上限を確認する。
- Upstashを一時的に未設定にした別Previewで、安全側に停止することを確認する。
- Vercel Function LogsとUpstashのキーにAPIキー、アクセスコード、会話本文が出ていないことを確認する。
- 研究用JSONに認証情報が含まれないことを確認する。
- Gemini APIの課金上限・アラートもGoogle側で設定する。アプリ内上限だけを唯一の費用対策にしない。

外部サービスの作成、秘密値の投入、実API疎通はリポジトリの実装だけでは完了しません。Vercel管理者と研究者が上記を設定し、Previewで実機確認する必要があります。
