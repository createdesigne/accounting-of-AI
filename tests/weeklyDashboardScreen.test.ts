import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const screen = readFileSync(new URL("../src/weekly/WeeklyDashboardScreen.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../src/weekly/WeeklyWorkspaceScreen.tsx", import.meta.url), "utf8");

test("weekly workspace keeps dashboard, manual records, settlement and reflection in separated components", () => {
  assert.match(workspace, /WeeklyDashboardScreen/);
  assert.match(workspace, /WeeklyManualScreen/);
  assert.match(workspace, /WeeklySettlementScreen/);
  assert.match(workspace, /WeeklyReflectionScreen/);
  assert.match(workspace, /週次ダッシュボード/);
  assert.match(workspace, /課題設定・手入力/);
  assert.match(workspace, /週次仕訳・決算/);
  assert.match(workspace, /今週の振り返り/);
});

test("dashboard exposes week navigation and required factual sections", () => {
  for (const text of [
    "今週のAI実利用時間", "前の週", "今週", "次の週", "時間の記録元", "利用時間と件数",
    "未分類・未処理", "登録済みのAIAS課題", "週次活動履歴", "未接続・未評価",
  ]) assert.ok(screen.includes(text), `missing dashboard label: ${text}`);
  assert.match(screen, /手入力は「実測」と表示しません/);
  assert.match(screen, /能力評価や成長スコアではありません/);
  assert.match(screen, /この週の記録はありません。0件/);
});

test("dashboard contains no external analysis calls or fabricated fixtures", () => {
  assert.doesNotMatch(screen, /fetch\(|XMLHttpRequest|api[_-]?key|google-generative|generativelanguage/i);
  assert.doesNotMatch(screen, /sample|fixture|ダミー/i);
});
