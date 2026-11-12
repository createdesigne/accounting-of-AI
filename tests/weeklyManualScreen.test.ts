import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const screen = readFileSync(new URL("../src/weekly/WeeklyManualScreen.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/weekly/weeklyManualScreen.css", import.meta.url), "utf8");

test("the existing app adds only a separated weekly record screen entry point", () => {
  assert.match(app, /import \{ WeeklyManualScreen \} from "\.\/weekly\/WeeklyManualScreen"/);
  assert.match(app, /activeTab === "weekly" && <WeeklyManualScreen \/>/);
  assert.match(app, /weekly: "記録"/);
});

test("the manual screen exposes required advance task and activity fields", () => {
  for (const label of [
    "課題名", "活動目的", "期待するAIの役割", "活動テーマ",
    "活動日時", "利用時間（秒）", "AIとのやり取りの概要",
    "自分が考えたこと・判断したこと", "発見・学び",
  ]) assert.ok(screen.includes(label), `missing field label: ${label}`);
  assert.match(screen, /Level 1の課題です。AI利用時間は0秒/);
  assert.match(screen, /AI分析：未接続・未評価/);
  assert.match(screen, /未評価（null）/);
});

test("the weekly UI contains no external analysis call and has a narrow-width layout", () => {
  assert.doesNotMatch(screen, /fetch\(|XMLHttpRequest|api[_-]?key|google-generative|generativelanguage/i);
  assert.match(styles, /@media \(max-width: 370px\)/);
  assert.match(styles, /\.weekly-form-grid[\s\S]*grid-template-columns: repeat\(2/);
});
