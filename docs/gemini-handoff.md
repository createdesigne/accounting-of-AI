# Gemini共同開発者との接続メモ（仕様の合意用、API実装禁止）

本担当が実装するのは**週次アプリの受け皿**。共同開発者が実装するのは**Gemini API呼び出しと分析**。2人が同じファイルを同時編集しないため、契約を合意するまでは相方のAPI側ファイルに手を加えない。

Phase 6の詳細な送受信案、エラー形式、認証上の未合意事項は [`weekly-analysis-api-contract.md`](./weekly-analysis-api-contract.md) を参照する。既存の `/api/ai/rewrite` は変更せず、将来の `/api/ai/analyze-weekly` を別の境界として扱う。

## 境界

| 本担当 | Gemini担当 |
| --- | --- |
| 記録ID、時間、活動分類の本人確認、帳簿、週次UI | API接続、秘密鍵、モデル指定、プロンプト、分析ルール |
| 課題の事前AIAS設定（AIASを能力ランクとみなさない） | 許可された会話の分析、根拠抽出、エラー/タイムアウト |
| 結果を受け取って表示するUI・保存形式の提案 | 結果のJSONと契約に沿った返却 |
| 未接続/未評価の表示、本人の修正・削除 | 実分析・再分析の処理 |

## 合意する項目（確認リスト）

- [ ] `recordId` で会話と分析結果を紐付ける。
- [ ] 入力データには許可範囲とデータの一部取得の事実が含まれる。
- [ ] 出力 `schemaVersion` は1。`analysisStatus` は未接続/処理中/完了/失敗/対象外。
- [ ] `activityCategory` の選択肢6種と `null` を決める。分析分類は本人が編集でき、本人編集が勝手に上書きされない。
- [ ] 3指標は0/25/50/75/100/**null（評価不可）**。0とnullを混同しない。
- [ ] 各観察行動には会話の根拠をつける。証拠のない成長・発見は生成しない。
- [ ] `plannedAiasLevel` は課題を始める前に設定したもので、出力分析の「個人評価レベル」ではない。
- [ ] APIキーはサーバー側で保管。GitHub PagesとChrome拡張には置かない。
- [ ] 既存ローカルデータとテスト用ダミーを混ぜない。API未接続時も週次アプリは利用可能。
- [ ] 両者の作業ブランチ/担当ファイルを共有し、PRで相互確認してから統合する。

## 想定するデータの形（最終決定は2人で合意）

```ts
export type AnalysisStatus = 'not-connected' | 'pending' | 'complete' | 'failed' | 'not-applicable';
export type ThoughtAnalysisV1 = {
  schemaVersion: 1;
  recordId: string;
  activityCategory: '相談' | '壁打ち' | '文章作成' | '情報収集' | '学習' | 'その他' | null;
  observedBehaviors: Array<{
    kind: 'goal-setting' | 'comparison' | 'verification' | 'revision' | 'own-decision';
    evidence: string | null;
  }>;
  initiative: 0 | 25 | 50 | 75 | 100 | null;
  reasoning: 0 | 25 | 50 | 75 | 100 | null;
  criticalJudgment: 0 | 25 | 50 | 75 | 100 | null;
  thinkingChange: string | null;
  discovery: string | null;
  analysisStatus: AnalysisStatus;
};
```

**検証用フィクスチャ**は「固定のテストデータでありGeminiの実分析ではない」と明記。Gemini担当者が応答を生成する際に、この契約へ合わせる。相方の既存設計が異なる場合は擦り合わせ、黙って型を確定しない。
