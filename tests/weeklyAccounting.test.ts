import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateRecordToWeeks,
  buildJournalEntries,
  buildWeeklyJournalEntries,
  buildWeeklySettlement,
  isBalancedWeeklyEntry,
  weekBoundsForTimestamp,
} from "../src/weeklyAccounting.ts";
import { buildManualWeeklyRecord } from "../src/weeklyData.ts";

function localTimestamp(year: number, month: number, day: number, hour = 0, minute = 0, second = 0) {
  return new Date(year, month, day, hour, minute, second).toISOString();
}

function record(
  id: string,
  activeSeconds: number,
  disposition: "expense" | "asset" | "work-in-progress" | "unclassified",
  category: "相談" | "壁打ち" | "文章作成" | "情報収集" | "学習" | "その他" | null,
  recordedAt = localTimestamp(2026, 10, 10, 12),
) {
  return buildManualWeeklyRecord({
    id,
    recordedAt,
    activeSeconds,
    aiService: "chatgpt",
    privacy: "time-only",
    activityCategory: category,
    accountingDisposition: disposition,
  }).record;
}

test("a local week starts Monday 00:00 and excludes the next Monday", () => {
  const monday = new Date(2026, 10, 9, 0, 0, 0);
  const sundayEnd = new Date(2026, 10, 15, 23, 59, 59);
  const nextMonday = new Date(2026, 10, 16, 0, 0, 0);
  assert.equal(weekBoundsForTimestamp(monday).start.getTime(), monday.getTime());
  assert.equal(weekBoundsForTimestamp(sundayEnd).start.getTime(), monday.getTime());
  assert.equal(weekBoundsForTimestamp(nextMonday).start.getTime(), nextMonday.getTime());
});

test("a cross-week interval preserves whole seconds exactly", () => {
  const start = localTimestamp(2026, 10, 15, 23, 59, 0);
  const end = localTimestamp(2026, 10, 16, 0, 1, 0);
  const crossing = buildManualWeeklyRecord({
    id: "crossing",
    recordedAt: start,
    startedAt: start,
    endedAt: end,
    activeSeconds: 121,
    aiService: "chatgpt",
    privacy: "time-only",
    activityCategory: null,
    accountingDisposition: "unclassified",
  }).record;
  const allocations = allocateRecordToWeeks(crossing);
  assert.deepEqual(allocations.map((item) => item.seconds), [61, 60]);
  assert.equal(allocations.reduce((sum, item) => sum + item.seconds, 0), 121);
  assert.notEqual(allocations[0].weekKey, allocations[1].weekKey);
});

test("two manual records produce exact weekly totals and balanced journals", () => {
  const expense = record("conversation-a", 720, "expense", "壁打ち");
  const asset = record("conversation-b", 1080, "asset", "文章作成");
  const settlement = buildWeeklySettlement([expense, asset], new Date(2026, 10, 12));
  assert.deepEqual(settlement.totals, {
    recordSeconds: 1800,
    expenseSeconds: 720,
    assetSeconds: 1080,
    workInProgressSeconds: 0,
    unclassifiedSeconds: 0,
    recordCount: 2,
  });
  assert.equal(settlement.trialBalance.isBalanced, true);
  assert.equal(settlement.statement.isBalanced, true);
  assert.equal(settlement.statement.accumulatedTimeLossSeconds, 720);
  assert.equal(settlement.balanceSheet.debitSeconds, 1800);
  assert.equal(settlement.balanceSheet.creditSeconds, 1800);
  assert.equal(settlement.profitAndLoss.totalExpenseSeconds, 720);
  assert.equal(settlement.profitAndLoss.expenses.find((line) => line.account === "思考探究費")?.seconds, 720);
  assert.equal(settlement.analysis.notConnectedCount, 2);
  assert.equal(settlement.analysis.notEvaluatedCount, 2);
  assert.ok([expense, asset].flatMap((item) => buildJournalEntries(item)).every(isBalancedWeeklyEntry));
  assert.equal(new Set(settlement.journalEntryIds).size, settlement.journalEntryIds.length);
});

test("Level 1 no-AI records do not create time journals", () => {
  const noAi = buildManualWeeklyRecord({
    id: "level-1",
    recordedAt: localTimestamp(2026, 10, 10, 12),
    activeSeconds: 720,
    aiService: "other",
    privacy: "time-only",
    activityCategory: "学習",
    accountingDisposition: "unclassified",
    analysisApplicable: false,
  }).record;
  const settlement = buildWeeklySettlement([noAi], new Date(2026, 10, 12));
  assert.equal(settlement.totals.recordSeconds, 0);
  assert.equal(settlement.totals.recordCount, 0);
  assert.deepEqual(buildJournalEntries(noAi), []);
});

test("duplicate record and source IDs are not counted twice", () => {
  const first = { ...record("first", 720, "expense", "壁打ち"), sourceEventId: "source-1" };
  const duplicateId = { ...first };
  const duplicateSource = { ...record("second", 720, "expense", "壁打ち"), sourceEventId: "source-1" };
  const settlement = buildWeeklySettlement([first, duplicateId, duplicateSource], new Date(2026, 10, 12));
  assert.equal(settlement.totals.recordSeconds, 720);
  assert.equal(settlement.totals.recordCount, 1);
});

test("all six user-selected expense categories map to their fixed accounts", () => {
  const cases = [
    ["相談", "相談活動費"],
    ["壁打ち", "思考探究費"],
    ["文章作成", "成果物利用費"],
    ["情報収集", "情報収集費"],
    ["学習", "学習活動費"],
    ["その他", "その他AI利用費"],
  ] as const;
  for (const [category, account] of cases) {
    const entries = buildJournalEntries(record(`expense-${category}`, 60, "expense", category));
    assert.equal(entries[1].lines[0].account, account);
  }
});

test("manual and measured time sources remain distinct in journals", () => {
  const manual = record("manual-source", 60, "expense", "壁打ち");
  const measured = { ...record("measured-source", 90, "expense", "壁打ち"), timeSource: "measured" as const };
  const entries = buildWeeklyJournalEntries([manual, measured], new Date(2026, 10, 12));
  assert.equal(entries.filter((entry) => entry.timeSource === "manual").length, 2);
  assert.equal(entries.filter((entry) => entry.timeSource === "measured").length, 2);
});

test("month and year boundaries do not change Monday-based selection", () => {
  const yearEnd = record("year-end", 30, "unclassified", null, localTimestamp(2026, 11, 31, 23, 59, 59));
  const newYear = record("new-year", 45, "unclassified", null, localTimestamp(2027, 0, 1, 0, 0, 0));
  const settlement = buildWeeklySettlement([yearEnd, newYear], new Date(2026, 11, 31));
  assert.equal(settlement.totals.recordSeconds, 75);
  assert.equal(settlement.totals.recordCount, 2);
});
