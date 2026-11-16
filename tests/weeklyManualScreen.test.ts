import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const screen = readFileSync(new URL("../src/weekly/WeeklyManualScreen.tsx", import.meta.url), "utf8");
const analysisPanel = readFileSync(new URL("../src/weekly/WeeklyAnalysisPanel.tsx", import.meta.url), "utf8");
const analysisClient = readFileSync(new URL("../src/weeklyAnalysisClient.ts", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/weekly/weeklyManualScreen.css", import.meta.url), "utf8");

test("the research mode uses the weekly workspace while retaining legacy code behind a display guard", () => {
  assert.match(app, /WeeklyWorkspaceScreen, type WeeklyPrimaryView/);
  assert.match(app, /RESEARCH_WEEKLY_MODE && \(\s*<WeeklyWorkspaceScreen/);
  assert.match(app, /!RESEARCH_WEEKLY_MODE && activeTab === "tax"/);
  assert.match(app, /weekly: "記録"/);
});

test("the manual screen exposes required advance task and activity fields", () => {
  for (const label of [
    "課題名", "活動目的", "期待するAIの役割", "活動テーマ",
    "活動日時", "利用時間（秒）", "AIとのやり取りの概要",
    "自分が考えたこと・判断したこと", "発見・学び",
  ]) assert.ok(screen.includes(label), `missing field label: ${label}`);
  assert.match(screen, /Level 1の課題です。AI利用時間は0秒/);
  assert.match(screen, /AI分析：保存後に任意で実行/);
  assert.match(screen, /未評価（null）/);
  assert.match(analysisPanel, /テスト用分析（実際のGemini分析ではありません）/);
  assert.match(analysisPanel, /本人の確認・修正内容をAI分析とは別に保存/);
  assert.match(analysisPanel, /分析根拠となる会話箇所/);
  assert.match(analysisPanel, /研究指標と評価根拠/);
  assert.match(screen, /AIAS Levelの名称・説明・具体例/);
});

test("the analysis UI requires explicit consent, reuses in-memory AI settings, and keeps the transport separated", () => {
  assert.doesNotMatch(screen, /fetch\(|XMLHttpRequest|api[_-]?key|google-generative|generativelanguage/i);
  assert.match(analysisPanel, /会話本文を、設定中のGeminiモデルへ今回だけ送信することに同意/);
  assert.match(analysisPanel, /useAiSettings/);
  assert.match(analysisPanel, /createWeeklyAnalysisClient/);
  assert.match(analysisClient, /\/analyze-weekly/);
  assert.match(analysisClient, /credentials: "omit"/);
  assert.doesNotMatch(analysisClient, /localStorage|sessionStorage|document\.cookie/);
  assert.match(styles, /@media \(max-width: 370px\)/);
  assert.match(styles, /\.weekly-form-grid[\s\S]*grid-template-columns: repeat\(2/);
});

test("analysis candidates are advisory and never call accounting or settlement mutations", () => {
  assert.match(analysisPanel, /仕訳、週次決算には自動反映しません/);
  assert.doesNotMatch(analysisPanel, /saveManualWeeklyRecord|confirmWeeklySettlement|saveWeeklySettlement|activeSeconds\s*=/);
  assert.match(analysisPanel, /WEEKLY_ANALYSIS_RUBRIC_VERSION/);
});
