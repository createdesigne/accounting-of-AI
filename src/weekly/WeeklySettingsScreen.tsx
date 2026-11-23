import { useState } from "react";
import { AiSettingsButton, useAiSettings } from "../AiSettings.tsx";
import { WeeklyResearchExportScreen } from "./WeeklyResearchExportScreen.tsx";
import { GeminiConnectionDiagnostics } from "./GeminiConnectionDiagnostics.tsx";
import "./weeklySettingsScreen.css";

type SettingsView = "menu" | "gemini" | "privacy" | "export";

export function WeeklySettingsScreen({ onOpenRecords }: { onOpenRecords: () => void }) {
  const [view, setView] = useState<SettingsView>("menu");
  const { credentials } = useAiSettings();

  if (view === "gemini") return <div className="weekly-settings-screen stack">
    <SettingsBack onBack={() => setView("menu")} />
    <section className="weekly-intro-card">
      <p className="eyebrow light">Geminiとの接続</p>
      <h2>AI分析を使う準備</h2>
      <p>APIキーはこの画面を開いている間だけ使用します。設定しただけでは会話を送信しません。</p>
    </section>
    <section className="weekly-panel weekly-settings-api" aria-labelledby="weekly-settings-api-heading">
      <div className="weekly-settings-status-row"><div><p className="eyebrow">接続準備</p><h3 id="weekly-settings-api-heading">Gemini APIキー</h3></div><strong className={credentials.apiKey ? "configured" : "unconfigured"}>{credentials.apiKey ? "設定済み" : "未設定"}</strong></div>
      <p>キーはブラウザの保存領域、帳簿、研究データ、Chrome拡張機能には保存しません。再読み込みやタブを閉じた後は、再入力が必要です。</p>
      <p>会話本文をGeminiへ送るときは、活動ごとに実行直前の明示同意を求めます。</p>
      <AiSettingsButton label="Gemini APIを設定" />
      <details className="weekly-settings-technical">
        <summary>詳細設定・技術診断</summary>
        <div><p>InteractionsとGenerateContentを同じ架空入力で比較し、通常生成・最小JSON・研究用構造化分析を個別に確認できます。診断はAPI利用を伴います。</p><GeminiConnectionDiagnostics /></div>
      </details>
    </section>
  </div>;

  if (view === "privacy") return <div className="weekly-settings-screen stack">
    <SettingsBack onBack={() => setView("menu")} />
    <section className="weekly-intro-card">
      <p className="eyebrow light">保存とプライバシー</p>
      <h2>活動ごとに保存範囲を選ぶ</h2>
      <p>保存範囲とGeminiへの外部送信は別の選択です。本人の同意なしに会話本文を外部送信しません。</p>
    </section>
    <section className="weekly-panel" aria-labelledby="weekly-settings-privacy-heading">
      <div className="weekly-section-heading"><span>1</span><div><p className="eyebrow">端末内への保存</p><h3 id="weekly-settings-privacy-heading">3つの保存範囲</h3></div></div>
      <div className="weekly-privacy-options">
        <article><strong>会話と時間を保存</strong><p>時間、本人入力、取得した会話を端末内に保存します。Geminiへの送信には追加の同意が必要です。</p></article>
        <article><strong>時間のみ保存</strong><p>時間と分類だけを保存します。会話本文を保存・外部送信しません。</p></article>
        <article><strong>保存しない</strong><p>その活動を保存しません。既存記録の編集時に選ぶと対象記録を削除します。</p></article>
      </div>
      <div className="weekly-settings-consent-note"><strong>外部送信は別途確認します</strong><p>「会話と時間を保存」を選んでも自動送信しません。Gemini分析を実行する直前に、会話本文を送る同意を確認します。</p></div>
      <button className="primary-action weekly-settings-records" type="button" onClick={onOpenRecords}>保存済み活動の保存範囲を確認</button>
    </section>
  </div>;

  if (view === "export") return <div className="weekly-settings-screen stack">
    <SettingsBack onBack={() => setView("menu")} />
    <section aria-label="研究データ出力設定">
      <WeeklyResearchExportScreen />
    </section>
  </div>;

  return <div className="weekly-settings-screen stack">
    <section className="weekly-intro-card weekly-settings-home-hero">
      <p className="eyebrow light">研究モードの設定</p>
      <h2>設定</h2>
      <p>確認したい項目を1つ選んでください。</p>
    </section>
    <nav className="weekly-settings-menu" aria-label="設定項目">
      <button type="button" onClick={() => setView("gemini")}><span><small>AI分析の準備</small><strong>Geminiとの接続</strong><p>APIキーの設定と接続診断</p></span><b>{credentials.apiKey ? "設定済み" : "未設定"}</b></button>
      <button type="button" onClick={() => setView("privacy")}><span><small>活動ごとに選択</small><strong>保存とプライバシー</strong><p>会話・時間の保存範囲と外部送信</p></span><b>確認する</b></button>
      <button type="button" onClick={() => setView("export")}><span><small>本人の明示操作</small><strong>研究データの出力</strong><p>JSON・CSVの対象と内容を確認</p></span><b>開く</b></button>
    </nav>
  </div>;
}

function SettingsBack({ onBack }: { onBack: () => void }) {
  return <button className="weekly-settings-back" type="button" onClick={onBack}>← 設定トップへ戻る</button>;
}
