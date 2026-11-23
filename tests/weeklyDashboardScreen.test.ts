import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const screen = readFileSync(new URL("../src/weekly/WeeklyDashboardScreen.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../src/weekly/WeeklyWorkspaceScreen.tsx", import.meta.url), "utf8");
const homeLogic = readFileSync(new URL("../src/weeklyHome.ts", import.meta.url), "utf8");

test("weekly workspace keeps the five research areas and their detailed screens separated", () => {
  assert.match(workspace, /WeeklyDashboardScreen/);
  assert.match(workspace, /WeeklyManualScreen/);
  assert.match(workspace, /WeeklySettlementScreen/);
  assert.match(workspace, /WeeklyReflectionScreen/);
  assert.match(workspace, /WeeklyJournalScreen/);
  assert.match(workspace, /WeeklySettingsScreen/);
  assert.doesNotMatch(workspace, /通常の記録は5つの確認/);
  assert.match(workspace, /保存済み活動を見る/);
  assert.match(workspace, /連携方法・補助メニュー/);
  assert.match(workspace, /決算・B\/S・P\/L/);
  assert.match(workspace, /本人の振り返り/);
});

test("home focuses on one next action without week navigation or detailed aggregation", () => {
  for (const text of ["今週のAI利用状況", "次にすること", "記録済み利用時間", "記録した会話"]) {
    assert.ok(screen.includes(text), `missing dashboard label: ${text}`);
  }
  for (const text of [
    "今日の記録を始めましょう", "会話を記録する", "未完了の記録があります", "続きから再開する", "今週を振り返る",
  ]) assert.ok(homeLogic.includes(text), `missing home action label: ${text}`);
  assert.match(screen, /selectWeeklyHomeAction/);
  assert.doesNotMatch(screen, /前の週|次の週|今週の内訳を見る|weekly-week-navigation|weekly-home-details/);
  assert.equal((screen.match(/className="primary-action"/g) ?? []).length, 1);
  assert.match(workspace, /onOpenSavedRecords=\{\(\) => openRecords\(true\)\}/);
  assert.match(workspace, /recordTools/);
  assert.match(screen, /selectUnlinkedMeasuredTimeCandidates/);
});

test("dashboard contains no external analysis calls or fabricated fixtures", () => {
  assert.doesNotMatch(screen, /fetch\(|XMLHttpRequest|api[_-]?key|google-generative|generativelanguage/i);
  assert.doesNotMatch(screen, /sample|fixture|ダミー/i);
});
