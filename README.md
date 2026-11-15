# 私とAIの確定申告

AIとの会話を思考レシートにし、自分とAIの関係を帳簿・決算として振り返るReactアプリです。

本番: https://accounting-of-ai.vercel.app/accounting-of-AI/

旧公開版（以前の帳簿）: https://createdesigne.github.io/accounting-of-AI/

公開先が変わるとブラウザ内の帳簿は別になります。以前の帳簿は旧公開版に残ります。

## 全体の構造

```text
ChatGPT / Claude / Gemini の会話ページ
  → Chrome拡張（表示中の会話を取り込む）
  → Reactの画面（レシート候補を確認・修正）
  → レシートを発行 → 帳簿に保存 → 期間別に集計
                            └ 保存先は利用者のブラウザ内 localStorage

文章を整えるときだけ:
  利用者がAI設定に自分のキーを入力
  → 選んだ文章と編集依頼を送信
  → VercelのNode.js Function（中継API） → Google Gemini
  → 生成候補を確認 → 利用者が反映

週次会話を研究用に分析するときだけ:
  fullで保存した会話ごとに本人が外部送信へ明示同意
  → `/api/ai/analyze-weekly` → Google Gemini
  → 根拠付き構造化候補を確認 → 本人の修正値を別保存
```

画面は `src/App.tsx`、会話取り込みは `chrome-extension/`、キー設定は `src/AiSettings.tsx`、文章編集は `src/AiWritingPanel.tsx`、通信は `src/aiClient.ts` と `server/` が担当します。Viteは開発・ビルドに使い、公開時は生成された `dist/` を配信します。

会話からの最初の候補作成・集計は既存のブラウザ側ロジックです。Geminiの文章編集と週次構造化分析は別エンドポイントです。週次分析はAIASを参考にした研究独自の会話内行動分析で、AIAS公式評価や利用者の一般的な能力評価ではありません。分析候補は利用時間・仕訳・決算へ自動反映しません。Chrome拡張はキーを扱いません。

APIキーを環境変数へ入れる必要はありません。画面上部の歯車「AI設定」で入力します。設定だけではGoogleへ送信せず、文章編集の送信ボタン、または週次活動ごとの同意チェック後に分析ボタンを押したときだけ接続します。

## 動かす

Node.js 22以降とpnpm 9を使います。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

`http://127.0.0.1:8787/accounting-of-AI/` を開き、AI設定で自分のキーと利用可能なモデルを入力します。キーはブラウザのメモリにだけ置き、再読み込み・タブを閉じる操作で消えます。削除ボタンでも消せます。帳簿の保存内容は削除しません。

開発時は別々のターミナルで `pnpm ai:server` と `pnpm dev` を実行します。

[キー設定とデプロイの詳細](docs/ai-server-setup.md) / [Chrome拡張の使い方](chrome-extension/README.md)
