import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const screen = readFileSync(new URL("../src/weekly/WeeklyJournalScreen.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../src/weekly/WeeklyWorkspaceScreen.tsx", import.meta.url), "utf8");
const manual = readFileSync(new URL("../src/weekly/WeeklyManualScreen.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/weekly/weeklySettlementScreen.css", import.meta.url), "utf8");

test("journal screen explains recorded time and unclassified temporary entries before the list", () => {
  const overview = screen.indexOf("記録時間と仕訳の状態");
  const list = screen.indexOf("週次仕訳一覧");
  assert.ok(overview >= 0 && overview < list);
  for (const label of ["記録済み利用時間", "仮仕訳・分類待ち", "会計区分の考え方を見る", "この活動の会計区分を決める"]) {
    assert.ok(screen.includes(label), `missing journal guidance: ${label}`);
  }
  assert.match(screen, /費用は、思考の悪さやAI依存を意味しません/);
  assert.match(screen, /二重計上ではありません/);
  assert.match(screen, /今週の仕訳はまだありません/);
  assert.match(screen, /recordCount === 0[\s\S]*firstUnclassifiedRecord/);
  assert.match(screen, /journalEntries\.length > 0 && <section/);
});

test("journal keeps debit and credit accounts while adding beginner descriptions", () => {
  assert.match(screen, /<small>借方<\/small>/);
  assert.match(screen, /<small>貸方<\/small>/);
  assert.match(screen, /AI仮受品.*分類前の時間/s);
  assert.match(screen, /時間拠出.*本人がAI利用に提供した時間/s);
  assert.match(screen, /借方と貸方に同じ秒数を記録し、時間の動きをつり合わせます/);
  assert.doesNotMatch(screen, /accountDescription/);
  assert.match(screen, /entry\.lines\[0\]\.seconds/);
  assert.match(screen, /entry\.lines\[1\]\.seconds/);
  assert.doesNotMatch(screen, /saveWeekly|updateWeekly|confirmWeekly|fetch\(/);
});

test("unclassified action opens only the selected activity accounting screen", () => {
  assert.match(screen, /onOpenRecordAccounting\(firstUnclassifiedRecord\.id\)/);
  assert.match(workspace, /setSelectedRecordScreen\("accounting"\)/);
  assert.match(workspace, /initialScreen=\{selectedRecordScreen\}/);
  assert.match(manual, /initialScreen = "detail"/);
  assert.match(manual, /setScreen\(initialScreen\)/);
});

test("journal layout retains side-by-side debit and credit at desktop and 360px", () => {
  assert.match(styles, /\.weekly-journal-screen \.weekly-journal-lines[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 390px\)[\s\S]*\.weekly-journal-screen \.weekly-journal-lines[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.weekly-journal-classification-waiting/);
  assert.match(styles, /\.weekly-accounting-guide/);
});
