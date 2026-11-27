import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const settings = readFileSync(new URL("../src/weekly/WeeklySettingsScreen.tsx", import.meta.url), "utf8");
const settingsCss = readFileSync(new URL("../src/weekly/weeklySettingsScreen.css", import.meta.url), "utf8");
const diagnostics = readFileSync(new URL("../src/weekly/GeminiConnectionDiagnostics.tsx", import.meta.url), "utf8");
const aiSettings = readFileSync(new URL("../src/AiSettings.tsx", import.meta.url), "utf8");
const recordFlow = readFileSync(new URL("../src/weekly/WeeklyExtensionImportScreen.tsx", import.meta.url), "utf8");

test("research mode bottom navigation has exactly four primary destinations", () => {
  const tabsBlock = app.match(/const tabs: Array<\{ key: TabKey; icon: ReactNode \}> = \[([\s\S]*?)\];/)?.[1] ?? "";
  assert.equal((tabsBlock.match(/key:/g) ?? []).length, 4);
  for (const key of ["home", "weekly", "journal", "tax"]) assert.match(tabsBlock, new RegExp(`key: "${key}"`));
  for (const label of ['home: "ホーム"', 'weekly: "記録"', 'journal: "仕訳"', 'tax: "決算"']) assert.match(app, new RegExp(label));
  assert.doesNotMatch(tabsBlock, /settings|receipts|analysis/);
  assert.match(styles, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
});

test("research mode opens settings from the header and returns to the prior screen", () => {
  const header = app.match(/function Header[\s\S]*?function ToastMessage/)?.[0] ?? "";
  assert.match(header, /researchMode \? <button[\s\S]*aria-label="設定を開く"[\s\S]*onClick=\{onOpenSettings\}[\s\S]*<Settings size=\{20\}/);
  assert.match(header, /AiSettingsButton[\s\S]*aria-label="決算を開く"/);
  assert.match(app, /settingsReturnTabRef/);
  assert.match(app, /function openResearchSettings\(\)/);
  assert.match(app, /function closeResearchSettings\(\)/);
  assert.match(app, /onCloseSettings=\{closeResearchSettings\}/);
  assert.match(settings, /元の画面に戻る/);
});

test("monthly and annual legacy screens stay in source but are hidden in research mode", () => {
  assert.match(app, /RESEARCH_WEEKLY_MODE = true/);
  assert.match(app, /!RESEARCH_WEEKLY_MODE && activeTab === "tax"/);
  assert.match(app, /ThoughtSettlementScreen/);
  assert.match(app, /PeriodLedgerScreen/);
});

test("settings groups API, privacy and research export, with desktop and mobile layouts", () => {
  for (const label of ["Geminiとの接続", "保存とプライバシー", "研究データの出力"]) assert.match(settings, new RegExp(label));
  assert.match(settings, /type SettingsView = "menu" \| "gemini" \| "privacy" \| "export"/);
  assert.match(settings, /詳細設定・技術診断/);
  assert.match(settings, /APIキー.*設定済み.*未設定/s);
  assert.match(settings, /WeeklyResearchExportScreen/);
  assert.match(settings, /GeminiConnectionDiagnostics/);
  assert.match(aiSettings, /Interactions API/);
  assert.match(aiSettings, /GenerateContent API/);
  assert.match(aiSettings, /自動切り替えしません/);
  for (const label of ["通常文章生成", "最小JSON構造化出力", "研究用構造化分析（架空会話）"]) assert.match(diagnostics, new RegExp(label));
  assert.match(diagnostics, /明示的に再試行/);
  assert.doesNotMatch(diagnostics, /localStorage|sessionStorage|document\.cookie/);
  assert.match(settingsCss, /weekly-settings-menu/);
  assert.match(settingsCss, /@media \(max-width: 390px\)/);
  assert.match(styles, /phone-frame\.research-frame/);
  assert.match(styles, /@media \(min-width: 900px\)/);
});

test("settings keeps ephemeral credentials and explicit privacy choices", () => {
  assert.match(settings, /ブラウザの保存領域、帳簿、研究データ、Chrome拡張機能には保存しません/);
  assert.match(settings, /会話と時間を保存/);
  assert.match(settings, /時間のみ保存/);
  assert.match(settings, /保存しない/);
  assert.match(settings, /Gemini分析を実行する直前/);
  assert.doesNotMatch(settings, /localStorage|sessionStorage|document\.cookie/);
});

test("record flow exposes privacy-safe INVALID_OUTPUT diagnostics", () => {
  for (const field of ["diagnosticStage", "validationField", "validationRule", "providerHttpStatus"]) assert.match(recordFlow, new RegExp(field));
  assert.match(recordFlow, /失敗した段階/);
  assert.match(recordFlow, /検証フィールド/);
  assert.match(recordFlow, /違反条件/);
  assert.match(recordFlow, /APIキーや会話本文は表示しません/);
  assert.doesNotMatch(recordFlow, /rawResponse|responseText/);
});

test("research records offer a manual measured-time fallback without putting it on home", () => {
  assert.match(app, /実測記録の手動連携/);
  assert.match(app, /parseManualTimeRecordTransfer/);
  assert.match(app, /内容を確認する/);
  assert.match(app, /会計に取り込む/);
  assert.match(app, /existing ID|既存ID/);
  assert.match(app, /recordTools=\{timeRecordTransferTools\}/);
  assert.doesNotMatch(app, /activeTab === "home" && \(\s*<details className="extension-import-card manual-time-transfer"/);
});

test("unconfirmed measured time is restored separately and cleared only after accounting import", () => {
  assert.match(app, /loadPendingTimeRecordPreview/);
  assert.match(app, /savePendingTimeRecordPreview/);
  assert.match(app, /clearPendingTimeRecordPreview/);
  assert.match(app, /received-unconfirmed|TIME_RECORD_PENDING_PREVIEW/);
});
