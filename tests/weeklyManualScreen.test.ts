import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const screen = readFileSync(new URL("../src/weekly/WeeklyManualScreen.tsx", import.meta.url), "utf8");
const analysisPanel = readFileSync(new URL("../src/weekly/WeeklyAnalysisPanel.tsx", import.meta.url), "utf8");
const analysisClient = readFileSync(new URL("../src/weeklyAnalysisClient.ts", import.meta.url), "utf8");
const extensionImport = readFileSync(new URL("../src/weekly/WeeklyExtensionImportScreen.tsx", import.meta.url), "utf8");
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
  assert.match(screen, /評価前（点数なし）/);
  assert.match(analysisPanel, /テスト用分析（実際のGemini分析ではありません）/);
  assert.match(analysisPanel, /本人の確認・修正内容をAI分析とは別に保存/);
  assert.match(analysisPanel, /分析根拠となる会話箇所/);
  assert.match(analysisPanel, /研究指標と評価根拠/);
  assert.match(screen, /AIAS Levelの名称・説明・具体例/);
  for (const label of ["確定（根拠十分）", "暫定", "評価保留", "評価対象外"]) {
    assert.ok(analysisPanel.includes(label), `missing localized analysis status: ${label}`);
  }
  assert.match(analysisPanel, /評価方法を見る/);
  assert.doesNotMatch(analysisPanel, /診断・技術情報/);
  assert.doesNotMatch(analysisPanel, /根拠：\{speakerLabel\(item\.speaker\)\}・\{item\.utteranceId\}/);
});

test("the analysis UI requires explicit consent, reuses in-memory AI settings, and keeps the transport separated", () => {
  assert.doesNotMatch(screen, /fetch\(|XMLHttpRequest|api[_-]?key|google-generative|generativelanguage/i);
  assert.match(analysisPanel, /会話本文をGeminiへ今回だけ送信することに同意/);
  assert.match(analysisPanel, /useAiSettings/);
  assert.match(analysisPanel, /createWeeklyAnalysisClient/);
  assert.match(analysisClient, /\/analyze-weekly/);
  assert.match(analysisClient, /credentials: AI_FETCH_CREDENTIALS/);
  assert.match(analysisClient, /redirect: AI_FETCH_REDIRECT/);
  assert.doesNotMatch(analysisClient, /localStorage|sessionStorage|document\.cookie/);
  assert.match(styles, /@media \(max-width: 370px\)/);
  assert.match(styles, /\.weekly-form-grid[\s\S]*grid-template-columns: repeat\(2/);
});

test("analysis candidates are advisory and never call accounting or settlement mutations", () => {
  assert.match(analysisPanel, /仕訳、週次決算には自動反映しません/);
  assert.doesNotMatch(analysisPanel, /saveManualWeeklyRecord|confirmWeeklySettlement|saveWeeklySettlement|activeSeconds\s*=/);
  assert.match(analysisPanel, /WEEKLY_ANALYSIS_RUBRIC_VERSION/);
});

test("saved activities expose person-confirmed accounting without auto-applying Gemini candidates", () => {
  const source = readFileSync(new URL("../src/weekly/WeeklyManualScreen.tsx", import.meta.url), "utf8");
  const editor = readFileSync(new URL("../src/weekly/WeeklyAccountingClassificationEditor.tsx", import.meta.url), "utf8");
  const accounts = readFileSync(new URL("../src/weeklyAccountingTypes.ts", import.meta.url), "utf8");
  assert.match(source, /WeeklyAccountingClassificationEditor/);
  assert.match(editor, /会計区分を編集・確定/);
  assert.match(editor, /Gemini候補（参考・自動確定しません）/);
  for (const label of ["費用", "成果物資産", "仕掛成果物", "未分類"]) {
    assert.ok(editor.includes(label), `missing accounting option: ${label}`);
  }
  assert.match(accounts, /思考探究費/);
  assert.doesNotMatch(editor, /accountingDispositionCandidate\s*\?\?\s*record\.accountingDisposition/);
});

test("analysis and accounting screens use beginner-facing states and selection cards", () => {
  const editor = readFileSync(new URL("../src/weekly/WeeklyAccountingClassificationEditor.tsx", import.meta.url), "utf8");
  assert.match(analysisPanel, /まだ分析していません/);
  assert.match(analysisPanel, /問い・仮説・アイデア/);
  assert.match(analysisPanel, /理由や条件を整理/);
  assert.match(analysisPanel, /方向性や最終判断/);
  assert.match(analysisPanel, /評価方法を見る/);
  assert.match(analysisPanel, /AiSettingsButton label="AI設定を開く"/);
  assert.match(analysisPanel, /未評価（点数なし）/);
  assert.match(analysisPanel, /本人の事前記録を見る/);
  assert.match(analysisPanel, /!credentials\.apiKey \? <div className="weekly-analysis-settings-needed"/);
  assert.match(analysisPanel, /AiSettingsButton label="AI設定を開く"/);
  assert.match(analysisPanel, /disabled=\{busy \|\| pending \|\| !consented\}/);
  assert.match(analysisPanel, /Geminiで分析する/);
  assert.match(analysisPanel, /時間のみ保存/);
  assert.doesNotMatch(analysisPanel, /Geminiで構造化分析/);
  assert.doesNotMatch(analysisPanel, /まだ点数を付けていません/);
  assert.doesNotMatch(analysisPanel, /思考レシートID：/);
  assert.match(analysisPanel, /"not-connected": "まだ分析していません"/);
  assert.match(analysisPanel, /failed: "分析を完了できませんでした"/);
  assert.match(analysisPanel, /value === null \? "未評価（点数なし）" : `\$\{value\}点`/);
  assert.match(analysisPanel, /metric-\$\{assessment\.status\}/);
  assert.match(analysisPanel, /本人による補足・異議・除外・再評価/);
  assert.match(editor, /type="radio"/);
  assert.doesNotMatch(editor, /<select value=\{disposition\}/);
  for (const text of ["その活動で使い切った時間", "今後も利用する", "まだ制作途中", "後で本人が分類"]) {
    assert.ok(editor.includes(text), `missing accounting explanation: ${text}`);
  }
  assert.match(editor, /hasAiCandidate &&/);
  assert.match(editor, /未分類のまま保存/);
  assert.match(editor, /この区分で保存/);
  assert.match(styles, /\.weekly-accounting-options/);
  assert.match(styles, /\.weekly-analysis-guide/);
});

test("saved extension conversations hide the new-import form and separate used measurements", () => {
  assert.match(extensionImport, /existing \? <ExistingConversation/);
  assert.match(extensionImport, /保存済み活動を確認する/);
  assert.match(extensionImport, /未使用/);
  assert.match(extensionImport, /使用済み/);
  assert.match(extensionImport, /Chrome拡張機能との連携方法/);
  assert.doesNotMatch(extensionImport, /existing\.links\.thoughtReceiptId/);
});

test("an exact measurement session excludes unrelated past time from the selectable candidates", () => {
  assert.match(extensionImport, /selectConversationMeasuredTimeCandidates\(measurements, rawConversation\?\.measurementSessionId\)/);
  assert.match(extensionImport, /同じ計測セッションだけ/);
  assert.match(extensionImport, /他の未使用時間\$\{unrelatedUnusedCount\}件は誤紐付け防止のため候補から除外/);
  assert.match(extensionImport, /この会話には計測セッション情報がありません。対応を推測せず/);
});

test("saved activities use separate list, detail, analysis, accounting, and auxiliary screens", () => {
  for (const screenName of ["list", "detail", "analysis", "accounting", "auxiliary", "tasks", "manual-entry"]) {
    assert.ok(screen.includes(`\"${screenName}\"`), `missing saved activity screen: ${screenName}`);
  }
  assert.match(screen, /保存した活動/);
  assert.match(screen, /活動詳細/);
  assert.match(screen, /Gemini分析/);
  assert.match(screen, /会計区分の確認・編集/);
  assert.match(screen, /補助メニュー/);
  assert.match(screen, /本人の事前振り返り/);
  assert.match(screen, /保存済み会話の一部を見る/);
  assert.match(screen, /この活動を削除/);
  assert.match(screen, /window\.confirm\("この活動記録を削除しますか？/);
  assert.match(styles, /@media \(max-width: 640px\)/);
  assert.match(styles, /\.weekly-activity-list-item/);
  assert.match(styles, /\.weekly-detail-main-actions/);
});

test("saved activity cards prefer the captured conversation title and use compact statuses", () => {
  const titleHelper = screen.match(/function activityDisplayTitle[\s\S]*?function analysisStatusLabel/)?.[0] ?? "";
  assert.match(titleHelper, /conversation\?\.title\?\.trim\(\)/);
  assert.ok(titleHelper.indexOf("conversationTitle") < titleHelper.indexOf("taskTitle"));
  assert.match(screen, /weekly-activity-statuses/);
  assert.match(screen, /weekly-activity-detail-link/);
  assert.match(screen, /詳細を見る/);
  assert.match(screen, /weekly-activity-summary/);
  assert.match(screen, /weekly-conversation-meta/);
  assert.match(screen, /weekly-reflection-entries/);
  assert.doesNotMatch(screen, /weekly-activity-facts/);
  assert.match(styles, /repeat\(auto-fit, minmax\(min\(100%, 420px\), 1fr\)\)/);
});

test("the completion action opens the just-saved activity detail without exposing an internal id", () => {
  const workspace = readFileSync(new URL("../src/weekly/WeeklyWorkspaceScreen.tsx", import.meta.url), "utf8");
  assert.match(extensionImport, /setCompleted\(\{ recordId:/);
  assert.match(extensionImport, /保存した活動の詳細を見る/);
  assert.match(extensionImport, /onOpenRecords\(completed\.recordId\)/);
  assert.match(extensionImport, /onOpenRecords\(recordId\)/);
  assert.match(workspace, /setSelectedRecordId\(recordId \?\? null\)/);
  assert.match(workspace, /initialRecordId=\{selectedRecordId\}/);
  assert.doesNotMatch(screen, />活動ID</);
});
