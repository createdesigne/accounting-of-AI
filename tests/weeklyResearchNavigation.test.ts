import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const settings = readFileSync(new URL("../src/weekly/WeeklySettingsScreen.tsx", import.meta.url), "utf8");
const diagnostics = readFileSync(new URL("../src/weekly/GeminiConnectionDiagnostics.tsx", import.meta.url), "utf8");
const aiSettings = readFileSync(new URL("../src/AiSettings.tsx", import.meta.url), "utf8");

test("research mode bottom navigation has exactly the five requested destinations", () => {
  const tabsBlock = app.match(/const tabs: Array<\{ key: TabKey; icon: ReactNode \}> = \[([\s\S]*?)\];/)?.[1] ?? "";
  assert.equal((tabsBlock.match(/key:/g) ?? []).length, 5);
  for (const key of ["home", "weekly", "journal", "tax", "settings"]) assert.match(tabsBlock, new RegExp(`key: "${key}"`));
  for (const label of ['home: "ホーム"', 'weekly: "記録"', 'journal: "仕訳"', 'tax: "決算"', 'settings: "設定"']) assert.match(app, new RegExp(label));
  assert.doesNotMatch(tabsBlock, /receipts|analysis/);
});

test("monthly and annual legacy screens stay in source but are hidden in research mode", () => {
  assert.match(app, /RESEARCH_WEEKLY_MODE = true/);
  assert.match(app, /!RESEARCH_WEEKLY_MODE && activeTab === "tax"/);
  assert.match(app, /ThoughtSettlementScreen/);
  assert.match(app, /PeriodLedgerScreen/);
});

test("settings groups API, privacy and research export, with desktop and mobile layouts", () => {
  assert.match(settings, /API設定/);
  assert.match(settings, /プライバシー設定/);
  assert.match(settings, /WeeklyResearchExportScreen/);
  assert.match(settings, /GeminiConnectionDiagnostics/);
  assert.match(aiSettings, /Interactions API/);
  assert.match(aiSettings, /GenerateContent API/);
  assert.match(aiSettings, /自動切り替えしません/);
  for (const label of ["通常文章生成", "最小JSON構造化出力", "研究用構造化分析（架空会話）"]) assert.match(diagnostics, new RegExp(label));
  assert.match(diagnostics, /明示的に再試行/);
  assert.doesNotMatch(diagnostics, /localStorage|sessionStorage|document\.cookie/);
  assert.match(styles, /phone-frame\.research-frame/);
  assert.match(styles, /@media \(min-width: 900px\)/);
});

test("research home offers a manual measured-time fallback without bypassing confirmation", () => {
  assert.match(app, /実測記録の手動連携/);
  assert.match(app, /parseManualTimeRecordTransfer/);
  assert.match(app, /内容を確認する/);
  assert.match(app, /会計に取り込む/);
  assert.match(app, /existing ID|既存ID/);
});

test("unconfirmed measured time is restored separately and cleared only after accounting import", () => {
  assert.match(app, /loadPendingTimeRecordPreview/);
  assert.match(app, /savePendingTimeRecordPreview/);
  assert.match(app, /clearPendingTimeRecordPreview/);
  assert.match(app, /received-unconfirmed|TIME_RECORD_PENDING_PREVIEW/);
});
