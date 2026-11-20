import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const screen = readFileSync(new URL("../src/weekly/WeeklyReflectionScreen.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../src/weekly/WeeklyWorkspaceScreen.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../src/weekly/WeeklyDashboardScreen.tsx", import.meta.url), "utf8");
const homeLogic = readFileSync(new URL("../src/weeklyHome.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/weekly/weeklyReflectionScreen.css", import.meta.url), "utf8");

test("dashboard and workspace expose the weekly reflection route", () => {
  assert.match(workspace, /WeeklyReflectionScreen/);
  assert.match(workspace, /本人の振り返り/);
  assert.match(homeLogic, /今週の振り返りを開く/);
  assert.match(dashboard, /onOpenReflection\(anchor\)/);
});

test("reflection UI focuses on personal writing and keeps all four research fields", () => {
  for (const text of [
    "今週の大きな発見・学び", "AIの提案に対して自分が判断・修正したこと",
    "今週のAIとの関わり方についての振り返り", "来週の小さな挑戦",
    "前週に設定した小さな挑戦", "代表的な活動を選ぶ", "思考レシートと関連付け",
    "前の週", "今週", "次の週", "選ばなくても保存できます",
    "課題で設定したAIの役割", "本人が判断する点",
  ]) assert.ok(screen.includes(text), `missing reflection label: ${text}`);
  assert.match(screen, /最大3件/);
  assert.match(screen, /利用者の能力評価ではありません/);
  assert.match(screen, /本人の入力はAI分析と別に保存し、分析結果で上書きしません/);
  assert.match(screen, /resolveWeeklyAnalysisState/);
  assert.match(screen, /一部未評価.*分析失敗/s);
  assert.doesNotMatch(screen, /思考レシート \{record\.links\.thoughtReceiptId\}/);
  assert.match(screen, /formatActivityDate\(record\.recordedAt\)/);
  assert.match(css, /max-width: 390px/);
  assert.match(css, /weekly-reflection-fields[\s\S]*grid-template-columns: 1fr/);
});

test("optional research context is collapsed and the save action is the only primary action", () => {
  assert.match(screen, /previousReflection\?\.nextWeekChallenge &&/);
  assert.match(screen, /<details className="weekly-reflection-panel weekly-reflection-disclosure">/);
  assert.match(screen, /dashboard\.tasks\.length > 0 &&/);
  assert.match(screen, /研究用の補助情報を見る/);
  assert.match(screen, /AIとの関わり方も振り返る（任意）/);
  assert.equal(screen.match(/className="primary"/g)?.length, 1);
  assert.match(screen, /weekly-reflection-record-link/);
  assert.doesNotMatch(screen, /className="secondary"/);
});

test("saved and unsaved reflection states are derived without changing the storage contract", () => {
  for (const text of ["保存済み", "未保存", "未保存の変更あり"]) assert.match(screen, new RegExp(text));
  assert.match(screen, /draftMatchesReflection\(draft, savedReflection\)/);
  assert.doesNotMatch(screen, /schemaVersion:\s*2|WEEKLY_REFLECTIONS_STORAGE_KEY\s*=/);
});

test("reflection layout uses the shared blue hierarchy and a 360px disclosure layout", () => {
  assert.match(css, /background:\s*linear-gradient\(135deg, #1e3a8a, #1d4ed8\)/);
  assert.match(css, /max-width:\s*390px/);
  assert.match(css, /weekly-reflection-disclosure > summary[\s\S]*flex-wrap:\s*wrap/);
  assert.match(css, /weekly-reflection-actions \.primary[\s\S]*width:\s*min\(100%, 640px\)/);
});

test("next week is preparation-only and the week after next is blocked", () => {
  assert.match(screen, /翌週の準備表示/);
  assert.match(screen, /今週に設定した「来週の小さな挑戦」を事前に確認できます/);
  assert.match(screen, /disabled=\{!navigation\.canMoveNext\}/);
  assert.match(screen, /disabled=\{navigation\.isFutureWeek\}/);
  assert.match(screen, /disabled=\{saving \|\| navigation\.isFutureWeek\}/);
  assert.match(screen, /翌週開始後に保存できます/);
  assert.match(screen, /if \(navigation\.isFutureWeek\) \{\s*setError\("翌週の準備表示では振り返りを保存できません/);
});

test("reflection UI has no external AI generation or scoring implementation", () => {
  assert.doesNotMatch(screen, /fetch\(|XMLHttpRequest|api[_-]?key|google-generative|generativelanguage|generateContent/i);
});
