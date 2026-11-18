import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const screen = readFileSync(new URL("../src/weekly/WeeklyDashboardScreen.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../src/weekly/WeeklyWorkspaceScreen.tsx", import.meta.url), "utf8");

test("weekly workspace keeps the five research areas and their detailed screens separated", () => {
  assert.match(workspace, /WeeklyDashboardScreen/);
  assert.match(workspace, /WeeklyManualScreen/);
  assert.match(workspace, /WeeklySettlementScreen/);
  assert.match(workspace, /WeeklyReflectionScreen/);
  assert.match(workspace, /WeeklyJournalScreen/);
  assert.match(workspace, /WeeklySettingsScreen/);
  assert.match(workspace, /日常利用は3ステップ/);
  assert.match(workspace, /保存済み記録・手入力/);
  assert.match(workspace, /決算・B\/S・P\/L/);
  assert.match(workspace, /本人の振り返り/);
});

test("dashboard exposes week navigation and required factual sections", () => {
  for (const text of [
    "今週のAI実利用時間", "前の週", "今週", "次の週", "時間の記録元", "利用時間と件数",
    "会計区分が未分類の活動", "活動に未紐付けの実測時間", "登録済みのAIAS課題", "週次活動履歴",
  ]) assert.ok(screen.includes(text), `missing dashboard label: ${text}`);
  assert.match(screen, /手入力は「実測」と表示しません/);
  assert.match(screen, /能力評価や成長スコアではありません/);
  assert.match(screen, /この週の記録はありません。0件/);
  assert.match(screen, /新しい会話・時間を取り込む/);
  assert.match(screen, /保存済み活動を確認/);
  assert.match(screen, /この週の振り返りを開く/);
  assert.match(workspace, /onOpenSavedRecords=\{\(\) => openRecords\(true\)\}/);
  for (const status of ["分析済み", "一部未評価", "未分析", "分析失敗"]) assert.match(screen, new RegExp(status));
  assert.match(screen, /selectUnlinkedMeasuredTimeCandidates/);
});

test("dashboard contains no external analysis calls or fabricated fixtures", () => {
  assert.doesNotMatch(screen, /fetch\(|XMLHttpRequest|api[_-]?key|google-generative|generativelanguage/i);
  assert.doesNotMatch(screen, /sample|fixture|ダミー/i);
});
