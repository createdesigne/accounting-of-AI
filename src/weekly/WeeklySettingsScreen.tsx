import { AiSettingsButton } from "../AiSettings.tsx";
import { WeeklyResearchExportScreen } from "./WeeklyResearchExportScreen.tsx";
import "./weeklySettingsScreen.css";

export function WeeklySettingsScreen({ onOpenRecords }: { onOpenRecords: () => void }) {
  return <div className="weekly-settings-screen stack">
    <section className="weekly-intro-card">
      <p className="eyebrow light">研究モードの設定</p>
      <h2>接続・出力・プライバシー</h2>
      <p>APIキーと研究データは自動送信しません。分析と出力は、本人が対象を確認して操作した場合だけ実行します。</p>
    </section>

    <section className="weekly-panel weekly-settings-api" aria-labelledby="weekly-settings-api-heading">
      <div className="weekly-section-heading"><span>1</span><div><p className="eyebrow">Gemini</p><h3 id="weekly-settings-api-heading">API設定</h3></div></div>
      <p>APIキーは開いている画面のメモリだけに保持し、帳簿・研究データ・拡張機能には保存しません。</p>
      <AiSettingsButton label="Gemini APIを設定" />
    </section>

    <section className="weekly-panel" aria-labelledby="weekly-settings-privacy-heading">
      <div className="weekly-section-heading"><span>2</span><div><p className="eyebrow">保存と外部送信</p><h3 id="weekly-settings-privacy-heading">プライバシー設定の考え方</h3></div></div>
      <div className="weekly-privacy-options">
        <article><strong>full</strong><p>時間と本人入力・会話を端末内に保存します。Geminiへ送るには、活動ごとの追加同意が必要です。</p></article>
        <article><strong>time-only</strong><p>時間と分類だけを保存します。会話本文を保存・外部送信しません。</p></article>
        <article><strong>off</strong><p>その活動を保存しません。既存記録の編集時に選ぶと対象記録を削除します。</p></article>
      </div>
      <p className="weekly-muted">保存範囲は活動ごとに選びます。設定だけでGeminiへ会話が送られることはありません。</p>
      <button className="secondary-action weekly-settings-records" type="button" onClick={onOpenRecords}>活動ごとの保存範囲を確認</button>
    </section>

    <section aria-label="研究データ出力設定">
      <WeeklyResearchExportScreen />
    </section>
  </div>;
}
