# 週次思考分析 API 接続仕様（研究用実装 v1）

この文書は、週次アプリから独立した `/api/ai/analyze-weekly` の境界を定めます。既存の `/api/ai/rewrite` は変更せず、同じ画面内メモリのBYOK設定をリクエスト単位で利用します。APIキーは保存・ログ出力しません。

クライアント契約の正本は `src/integrations/weeklyAnalysisContract.ts`、サーバー境界は `server/weekly-analysis-contract.mjs`、評価基準は [`weekly-analysis-rubric.md`](./weekly-analysis-rubric.md) です。

## 1. エンドポイント案

- `POST /api/ai/analyze-weekly`
- `Content-Type: application/json`
- 成功・分析失敗とも、本文は下記の構造化JSONだけを返す
- 生のGemini応答、SDK例外、APIキー、プロンプトはクライアントへ返さない
- 同じ `requestId` / `analysisId` の保存は冪等に扱い、異なる結果による上書きを拒否する

## 2. 認証と同意

認証は既存文章編集と同じ利用者持ち込み方式です。`Authorization: Bearer ...` と `X-Gemini-Model` をリクエスト単位で中継し、キーを端末ストレージ・サーバーファイル・URLへ保存しません。Preview保護、利用回数上限、運用ログの保持期間はデプロイ前に要確認です。

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
  "rubricVersion": "research-thinking-rubric-v1",
  "analyzedAt": "2026-11-10T02:00:05.000Z",
  "analysis": {
    "activityCategory": null,
    "accountCandidate": null,
    "accountingDispositionCandidate": null,
    "aiRole": null,
    "collaborationBehaviors": [],
    "initiative": null,
    "reasoning": null,
    "criticalJudgment": 100,
    "thinkingChange": null,
    "discovery": null,
    "evidence": [
      {
        "target": "critical-judgment",
        "conversationId": "conversation-1",
        "messageIndex": 0,
        "quote": "案Aと案Bを比較してください。"
      }
    ]
  },
  "error": null
}
```

研究独自の3指標は `0 | 25 | 50 | 75 | 100 | null` です。`null` は評価不能・根拠不足であり、0点とは異なります。0にも会話根拠が必要です。AIAS公式の能力評価ではありません。

分析根拠は会話ID、0始まりのメッセージ位置、実際に存在する短い引用を返します。週次アプリは引用が指定メッセージ内に存在しなければ結果を拒否します。

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
  "rubricVersion": "research-thinking-rubric-v1",
  "analyzedAt": "2026-11-10T02:00:05.000Z",
  "analysis": null,
  "error": { "code": "TIMEOUT", "retryable": true }
}
```

許可するコードは `INVALID_INPUT`、`NOT_AUTHENTICATED`、`NOT_AUTHORIZED`、`TOO_LARGE`、`RATE_LIMITED`、`MODEL_UNAVAILABLE`、`CONTENT_BLOCKED`、`INVALID_OUTPUT`、`TIMEOUT`、`PROVIDER_ERROR` です。

入力・認証・CORS・サイズ違反はHTTPエラーと有限コードを返します。有効な分析リクエストを開始した後のGemini失敗は、上記の関連ID付き失敗JSONとして返します。ブラウザ到達前の通信失敗はクライアントで同じ失敗形式へ正規化して分離保存します。自動再試行は行わず、本人が再実行します。生のプロバイダーエラーは返しません。

## 6. 保存と関連付け

- 分析リクエストの本文は分析ストアへ複製しない
- 分析結果は `watashi-to-ai-weekly-analyses:v1` に保存する
- 本人の確認・修正値は `watashi-to-ai-weekly-analysis-reviews:v1` に別保存する
- 本人入力を含む週次記録ストアとは分離する
- 3つの関連IDと会話版が一致しない結果は拒否する
- 同一 `requestId` / `analysisId` は重複保存しない
- 完了済み結果を同じリクエストIDで上書きしない
- 不正結果・分析失敗でも活動、会計、決算、振り返りを変更しない
- 活動テーマのAI判定は本人が入力したテーマを自動上書きしない

表示上の状態は、結果なし=`not-connected`、受付済み=`pending`、正常結果=`complete`、失敗結果=`failed`、Level 1=`not-applicable` とします。

## 7. 担当範囲

| 週次アプリ担当 | Gemini担当 |
| --- | --- |
| 同意・保存範囲の判定 | API利用者の認証と利用制限 |
| リクエスト型とID生成 | Gemini SDK・モデル・プロンプト |
| 応答の構造・ID・根拠検証 | 構造化JSON生成とプロバイダーエラー変換 |
| 本人入力とAI結果の分離保存 | APIキーとVercel環境変数 |
| 状態表示、重複防止、固定fixture | タイムアウト・レート制限・監視 |

統合前に、認証方式、デプロイ元コミット、Preview用環境変数、入出力上限、HTTPエラー、ログ・保持期間、冪等性のサーバー側保証を双方で確定します。
