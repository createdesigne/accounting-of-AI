import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const screen = readFileSync(new URL("../src/weekly/WeeklySettlementScreen.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../src/weekly/WeeklyWorkspaceScreen.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/weekly/weeklySettlementScreen.css", import.meta.url), "utf8");

test("weekly workspace exposes the separated settlement screen", () => {
  assert.match(workspace, /WeeklySettlementScreen/);
  assert.match(workspace, /決算・B\/S・P\/L/);
});

test("settlement UI focuses on the weekly total, classification, balance and confirmation", () => {
  for (const text of [
    "週次決算を確認する", "今週の決算内容", "決算内容を確認する", "週次B/S", "週次P/L",
    "確定履歴", "未分類", "要再確定", "活動テーマ別の内訳",
    "会計区分が未分類の活動があります", "未分類のまま決算を確定することもできます",
  ]) assert.ok(screen.includes(text), `missing settlement label: ${text}`);
  assert.match(screen, /企業会計の財務諸表ではなく/);
  assert.match(screen, /weekly-disclosure/);
  assert.doesNotMatch(screen, /記録ID:/);
  assert.doesNotMatch(screen, /この週の振り返り|週次仕訳一覧/);
  assert.match(css, /max-width: 390px/);
  assert.match(css, /weekly-disclosure/);
});

test("settlement confirmation requires a separate final review action", () => {
  for (const text of [
    "確定前の最終確認", "確定する内容", "この内容で決算を確定する", "戻る",
    "未分類のまま確定します", "AI仮受品の未確定残高として残ります",
  ]) assert.ok(screen.includes(text), `missing confirmation review label: ${text}`);
  assert.match(screen, /setReviewing\(true\)/);
  assert.equal(screen.match(/onClick=\{confirmPreview\}/g)?.length, 1);
  assert.match(screen, /setReviewing\(false\)/);
});

test("unclassified activity opens that record accounting screen without changing settlement data", () => {
  assert.match(screen, /onOpenRecordAccounting\(firstUnclassifiedRecord\.id\)/);
  assert.match(workspace, /<WeeklySettlementScreen onOpenRecordAccounting=\{openRecordAccounting\}/);
  assert.doesNotMatch(screen, /saveManualWeeklyRecord|updateWeeklyRecordAccounting|setItem\(/);
});

test("desktop and 360px layouts keep the primary decision and compact details readable", () => {
  assert.match(css, /\.weekly-closing-unclassified\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/s);
  assert.match(css, /\.weekly-closing-screen \.weekly-settlement-summary-grid\s*\{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(css, /\.weekly-closing-unclassified\s*\{\s*grid-template-columns:\s*1fr/s);
});

test("settlement UI contains no Gemini or external API implementation", () => {
  assert.doesNotMatch(screen, /fetch\(|XMLHttpRequest|api[_-]?key|google-generative|generativelanguage|prompt/i);
});
