import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateRecordToWeeks,
  buildJournalEntries,
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
  category: "壁打ち" | "文章作成" | null,
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
  assert.equal(settlement.analysis.notConnectedCount, 2);
  assert.equal(settlement.analysis.notEvaluatedCount, 2);
  assert.ok([expense, asset].flatMap((item) => buildJournalEntries(item)).every(isBalancedWeeklyEntry));
  assert.equal(new Set(settlement.journalEntryIds).size, settlement.journalEntryIds.length);
});

test("month and year boundaries do not change Monday-based selection", () => {
  const yearEnd = record("year-end", 30, "unclassified", null, localTimestamp(2026, 11, 31, 23, 59, 59));
  const newYear = record("new-year", 45, "unclassified", null, localTimestamp(2027, 0, 1, 0, 0, 0));
  const settlement = buildWeeklySettlement([yearEnd, newYear], new Date(2026, 11, 31));
  assert.equal(settlement.totals.recordSeconds, 75);
  assert.equal(settlement.totals.recordCount, 2);
});
