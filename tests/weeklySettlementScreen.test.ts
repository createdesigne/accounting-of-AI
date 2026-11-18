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

test("settlement UI exposes preview, confirmation, statements, journals and revision history", () => {
  for (const text of [
    "週次決算プレビュー", "プレビューを確認して確定する", "週次B/S", "週次P/L",
    "週次仕訳一覧", "確定履歴", "AI仮受品", "未確定残高", "要再確定",
    "活動テーマ別グラフ", "この週の振り返り", "費用は、思考の悪さやAI依存度ではありません",
  ]) assert.ok(screen.includes(text), `missing settlement label: ${text}`);
  assert.match(screen, /手入力/);
  assert.match(screen, /自動計測/);
  assert.match(screen, /企業会計の財務諸表ではなく/);
  assert.match(screen, /weekly-disclosure/);
  assert.doesNotMatch(screen, /記録ID:/);
  assert.match(css, /max-width: 390px/);
  assert.match(css, /weekly-disclosure/);
});

test("settlement UI contains no Gemini or external API implementation", () => {
  assert.doesNotMatch(screen, /fetch\(|XMLHttpRequest|api[_-]?key|google-generative|generativelanguage|prompt/i);
});
