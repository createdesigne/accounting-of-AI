# 週次思考分析 API 接続仕様（研究用実装 v2）

この文書は、週次アプリから独立した `/api/ai/analyze-weekly` の境界を定めます。既存の `/api/ai/rewrite` は変更せず、同じ画面内メモリのBYOK設定をリクエスト単位で利用します。APIキーは保存・ログ出力しません。

クライアント契約の正本は `src/integrations/weeklyAnalysisContract.ts`、サーバー境界は `server/weekly-analysis-contract.mjs`、評価基準は [`weekly-analysis-rubric.md`](./weekly-analysis-rubric.md) です。

## 1. エンドポイント案

- `POST /api/ai/analyze-weekly`
- `POST /api/ai/test-structured`（固定の架空入力による最小JSON Schema診断。研究結果として保存しない）
- `Content-Type: application/json`
- 成功・分析失敗とも、本文は下記の構造化JSONだけを返す
- 生のGemini応答、SDK例外、APIキー、プロンプトはクライアントへ返さない
- 同じ `requestId` / `analysisId` の保存は冪等に扱い、異なる結果による上書きを拒否する

## 2. 認証と同意

認証は既存文章編集と同じ利用者持ち込み方式です。`Authorization: Bearer ...`、`X-Gemini-Model`、`X-Gemini-Api-Method: interactions | generate-content` をリクエスト単位で中継し、キーを端末ストレージ・サーバーファイル・URLへ保存しません。API方式は利用者が明示選択し、503等でも別方式へ自動切替しません。Preview保護、利用回数上限、運用ログの保持期間はデプロイ前に要確認です。

週次アプリ側は次の条件をすべて満たす場合だけリクエスト値を生成します。

- 本人が外部AIへの送信に明示同意している
- 保存範囲が `full`
- 対応する会話本文が端末内に存在する
- AIAS Level 1ではない
- 活動ID、会話ID、思考レシートIDがすべて一致する

`full` は端末保存の許可であり、外部送信同意の代わりにはなりません。`time-only` は本文を保持しないため送信不可、`off` は活動自体を永続化しないため送信対象になりません。

## 3. 入力形式

```json
{
  "schemaVersion": 1,
  "requestId": "request-1",
  "recordId": "record-1",
  "conversationId": "conversation-1",
  "thoughtReceiptId": "record-1:receipt",
  "conversationFingerprint": "fnv1a32:00000000",
  "requestedAt": "2026-11-10T02:00:00.000Z",
  "consent": {
    "externalAnalysisAllowed": true,
    "privacy": "full",
    "captureScope": "full",
    "consentedAt": "2026-11-10T01:59:00.000Z"
  },
  "taskContext": {
    "taskId": "task-1",
    "plannedAiasLevel": 3,
    "activityCategory": "壁打ち",
    "expectedAiRole": "論点を整理する"
  },
  "messages": [
    { "role": "user", "text": "案Aと案Bを比較してください。" },
    { "role": "assistant", "text": "二つの案の違いを整理します。" }
  ]
}
```

`plannedAiasLevel` は課題開始前に本人が設定したAIの関与範囲です。能力値や分析スコアへ変換しません。本人の手入力メモ、利用秒数、仕訳、週次決算、週次振り返りは送信形式に含めません。

`conversationFingerprint` は編集後の古い結果を誤反映しないための版識別子であり、認証や改ざん防止用の暗号学的署名ではありません。APIは入力値を応答へそのまま返します。

### 実装済みの入力上限

- リクエスト本文は最大96KiB
- 最大200メッセージ、1メッセージ最大12,000文字、本文合計最大60,000文字
- `captureScope: partial | unknown` は、画面に保存範囲を示したうえで分析可能。ただし不足情報を推測しない
- system/unknownメッセージは役割を保持して送るが、命令ではなく分析対象データとして扱う
- 同意は活動ごとの実行直前チェックとし、永続保存や別の分析への流用をしない

## 4. 出力形式

Geminiへ要求する構造化出力は、下記のうち `analysis` の候補部分だけです。Geminiは活動ID、会話ID、思考レシートID、分析ID、分析日時、使用モデル、評価基準バージョンを生成しません。サーバーが受信後に元リクエストとの一致を検証し、これらのアプリ所有メタデータを付与します。

共通候補の `evidence` は `target`、`messageIndex`、`quote` の3項目です。指標別根拠はこれらに `observedFeature` と `source: observed_behavior | self_report` を加えます。サーバーは発言位置と引用を元会話で検証し、`conversationId`、`utteranceId`、`speaker` を付与します。モデルが生成したIDや話者は信頼しません。

```json
{
  "schemaVersion": 1,
  "analysisId": "analysis-1",
  "requestId": "request-1",
  "recordId": "record-1",
  "conversationId": "conversation-1",
  "thoughtReceiptId": "record-1:receipt",
  "conversationFingerprint": "fnv1a32:00000000",
  "origin": "gemini-api",
  "analysisStatus": "complete",
  "receivedAt": "2026-11-10T02:00:05.000Z",
  "model": "gemini-3.5-flash-lite",
  "apiMethod": "generate-content",
  "rubricVersion": "research-thinking-rubric-v2",
  "analyzedAt": "2026-11-10T02:00:05.000Z",
  "analysis": {
    "activityCategory": null,
    "accountCandidate": null,
    "accountingDispositionCandidate": null,
    "aiRole": null,
    "collaborationBehaviors": [],
    "initiative": 75,
    "reasoning": null,
    "independence": null,
    "metricAssessments": {
      "initiative": {
        "score": 75,
        "status": "confirmed",
        "reason": "本人が新しい比較軸を提示した",
        "rubricLevel": 75,
        "evidence": [{
          "conversationId": "conversation-1",
          "messageIndex": 0,
          "utteranceId": "conversation-1:message:0",
          "speaker": "user",
          "quote": "案Aと案Bを比較してください。",
          "observedFeature": "本人が比較という検討方法を指定した",
          "source": "observed_behavior"
        }],
        "unconfirmed": [],
        "evidenceSufficiency": "high"
      },
      "reasoning": { "score": null, "status": "hold", "reason": "前後文脈が不足", "rubricLevel": null, "evidence": [], "unconfirmed": ["前後の理由"], "evidenceSufficiency": "low" },
      "independence": {
        "score": null, "status": "hold", "reason": "判断過程を確認できない", "rubricLevel": null, "evidence": [], "unconfirmed": ["最終判断"], "evidenceSufficiency": "low",
        "deliberation": { "score": null, "status": "hold", "reason": "検討過程が不足", "rubricLevel": null, "evidence": [], "unconfirmed": ["比較基準"], "evidenceSufficiency": "low" },
        "finalDecision": { "score": null, "status": "hold", "reason": "最終判断が不足", "rubricLevel": null, "evidence": [], "unconfirmed": ["最終選択"], "evidenceSufficiency": "low" }
      }
    },
    "taskComplexity": { "level": "medium", "reason": "複数要素の比較", "considerationFactors": "複数案", "uncertainty": "一部あり", "reasoningProcess": "比較と判断" },
    "subjectiveDifficulty": { "level": "not_provided", "source": "self_report", "note": null },
    "thinkingChange": null,
    "discovery": null,
    "evidence": [
      {
        "target": "activity-category",
        "conversationId": "conversation-1",
        "messageIndex": 0,
        "quote": "案Aと案Bを比較してください。"
      }
    ]
  },
  "unresolvedFields": [],
  "error": null
}
```

研究独自の3指標（自発性・論理性・独立性）は `0 | 25 | 50 | 75 | 100 | null` です。各指標は `confirmed | provisional | hold | not_applicable` を別管理します。`null` は0点と異なり、0にも「考えなかった」ことを示す直接根拠が必要です。短文・1文字回答は前後文脈を使い、文脈不足なら `hold` とします。確定基準全文は [`weekly-analysis-rubric-v2.md`](./weekly-analysis-rubric-v2.md) です。

分析根拠は会話ID、0始まりのメッセージ位置、実際に存在する短い引用を返します。各非null値（協働行動は空でない配列）には、その項目専用の `evidence.target` が必要です。たとえば `accountCandidate` には `account-candidate` が対応します。

構造・型・列挙値が正しい候補を受信した後、サーバーは項目ごとに根拠を検証します。根拠が欠ける項目だけを `null`（協働行動は空配列）へ置き換え、対応しない根拠を破棄し、他の検証済み項目を保持します。この場合は `analysisStatus: "partial"` とし、次のように安全な理由だけを記録します。値・引用・会話本文は理由欄へ含めません。

```json
{
  "analysisStatus": "partial",
  "analysis": {
    "accountCandidate": null
  },
  "unresolvedFields": [
    {
      "field": "analysis.accountCandidate",
      "reason": "missing-evidence"
    }
  ],
  "error": null
}
```

`reason` は `missing-evidence`（対応根拠なし）または `invalid-evidence`（発言位置・引用不一致）です。部分成功は不正な値を保存する仕組みではなく、構造自体が不正な場合は従来どおり分析全体を `failed` とします。

固定テストJSONは `origin: "test-fixture"`、実API結果は `origin: "gemini-api"` とします。週次画面はテスト用結果を「実際のGemini分析ではありません」と表示します。

## 5. エラー形式

分析処理を開始でき、構造化した失敗結果を返せる場合は以下の形を使用します。

```json
{
  "schemaVersion": 1,
  "analysisId": "analysis-failure-1",
  "requestId": "request-1",
  "recordId": "record-1",
  "conversationId": "conversation-1",
  "thoughtReceiptId": "record-1:receipt",
  "conversationFingerprint": "fnv1a32:00000000",
  "origin": "gemini-api",
  "analysisStatus": "failed",
  "receivedAt": "2026-11-10T02:00:05.000Z",
  "model": "gemini-3.5-flash-lite",
  "apiMethod": "generate-content",
  "rubricVersion": "research-thinking-rubric-v2",
  "analyzedAt": "2026-11-10T02:00:05.000Z",
  "analysis": null,
  "unresolvedFields": [],
  "error": { "code": "TIMEOUT", "retryable": true }
}
```

許可するコードは `INVALID_INPUT`、`NOT_AUTHENTICATED`、`NOT_AUTHORIZED`、`TOO_LARGE`、`RATE_LIMITED`、`MODEL_UNAVAILABLE`、`CONTENT_BLOCKED`、`INVALID_OUTPUT`、`TIMEOUT`、`PROVIDER_ERROR` です。

入力・認証・CORS・サイズ違反はHTTPエラーと有限コードを返します。有効な分析リクエストを開始した後のGemini失敗は、上記の関連ID付き失敗JSONとして返します。ブラウザ到達前の通信失敗はクライアントで同じ失敗形式へ正規化して分離保存します。自動再試行は行わず、本人が再実行します。生のプロバイダーエラーは返しません。

`/api/ai/analyze-weekly` は明示選択された方式だけを使用します。Interactions APIではトップレベル `response_format` に `type: "text"`、`mime_type: "application/json"`、JSON Schemaを設定します。GenerateContent APIでは `config.responseMimeType: "application/json"` と `config.responseJsonSchema` に同一Schemaを設定します。どちらも受信後に同じアプリ契約で必須項目、型、列挙値、null、根拠の存在、会話ID・発言位置・引用の完全一致を検証します。

設定画面の比較診断は、同じモデル・同じ固定入力で①通常文章生成、②最小JSON Schema、③架空会話による研究分析をInteractionsとGenerateContentへ別々に送信します。診断結果は帳簿・週次活動・分析ストアへ保存しません。各比較は2回のAPI利用であり、本人の明示操作時だけ実行します。

`INVALID_OUTPUT` の失敗応答は、任意の `error.diagnosticStage` として `provider-response`、`output-truncated`、`interaction-envelope`、`json-parse`、`schema-validation`、`evidence-validation` のいずれかを含められます。これは失敗段階のみで、APIキー、会話本文、生のGemini応答、プロンプトは含みません。旧形式の `error` は引き続き読み込み可能です。

GeminiがHTTPエラーを返した場合は、`providerHttpStatus`、`providerErrorCode`、`timedOut`、`providerApiVersion`、`providerSdkVersion` を診断用に付与できます。`providerErrorCode` はGoogle応答の機械判定用コードだけを最大64文字に正規化した値です。エラーメッセージ、応答本文、詳細メタデータは保存・返送・表示しません。

構造化出力SchemaはGemini生成項目だけに限定します。null許容値は公式のJSON Schemaサブセットに合わせて `type: ["string", "null"]` または `type: ["integer", "null"]` とし、列挙にはnullを明示します。Gemini側のSchema複雑度上限を避けるため、ネスト配列の件数上限やアプリ所有メタデータは送信Schemaに重複指定せず、受信後検証（協働行動20件、根拠100件、文字数、ID、発言位置、引用一致）で必ず拒否します。

`INVALID_OUTPUT` が受信後検証で発生した場合、`error.validationField` に安全なフィールドパス（例: `analysis.reasoning`）、`error.validationRule` に違反条件（`required`、`type`、`enum`、`integer`、`non-empty`、`max-length`、`max-items`、`evidence-required`、`message-index-range`、`conversation-id-match`、`quote-match`）を返せます。違反した実値、生の応答、会話本文は診断情報へ含めません。

## 6. 保存と関連付け

- 分析リクエストの本文は分析ストアへ複製しない
- 分析結果は `watashi-to-ai-weekly-analyses:v1` に保存する
- 使用モデル、明示選択したAPI方式、評価基準バージョン、分析日時を分析結果と研究出力に保存する
- 旧v1本人確認は `watashi-to-ai-weekly-analysis-reviews:v1` に保持する
- v2の補足・異議・除外・再評価は `watashi-to-ai-weekly-analysis-review-history:v2` に追記保存する
- 本人入力を含む週次記録ストアとは分離する
- 3つの関連IDと会話版が一致しない結果は拒否する
- 同一 `requestId` / `analysisId` は重複保存しない
- 完了済み結果を同じリクエストIDで上書きしない
- 不正結果・分析失敗・一部未評価でも活動、会計、決算、振り返りを変更しない
- 活動テーマのAI判定は本人が入力したテーマを自動上書きしない
- v1の `criticalJudgment` は旧ルーブリック値として保持し、v2の `independence` へ変換しない

表示上の状態は、結果なし=`not-connected`、受付済み=`pending`、全項目検証済み=`complete`、一部根拠不足=`partial`、分析全体の失敗=`failed`、Level 1=`not-applicable` とします。研究用JSON/CSVには状態と `unresolvedFields`（CSV列 `analysis_unresolved_fields`）を分けて出力します。本人は一部未評価の候補も確認・修正できますが、AI候補と本人値は別保存され、本人の分類・会計処理は継続できます。

## 7. 担当範囲

| 週次アプリ担当 | Gemini担当 |
| --- | --- |
| 同意・保存範囲の判定 | API利用者の認証と利用制限 |
| リクエスト型とID生成 | Gemini SDK・モデル・プロンプト |
| 応答の構造・ID・根拠検証 | 構造化JSON生成とプロバイダーエラー変換 |
| 本人入力とAI結果の分離保存 | APIキーとVercel環境変数 |
| 状態表示、重複防止、固定fixture | タイムアウト・レート制限・監視 |

統合前に、認証方式、デプロイ元コミット、Preview用環境変数、入出力上限、HTTPエラー、ログ・保持期間、冪等性のサーバー側保証を双方で確定します。
