import assert from "node:assert/strict";
import test from "node:test";
import { buildWeeklyDashboardData } from "../src/weeklyDashboard.ts";
import { buildManualWeeklyRecord, buildWeeklyTask, type WeeklyRecordV1 } from "../src/weeklyData.ts";

function localTimestamp(year: number, month: number, day: number, hour = 12, minute = 0) {
  return new Date(year, month, day, hour, minute).toISOString();
}

function record(
  id: string,
  seconds: number,
  recordedAt: string,
  category: "壁打ち" | "文章作成" | null = "壁打ち",
  taskId: string | null = null,
) {
  return buildManualWeeklyRecord({
    id,
    recordedAt,
    activeSeconds: seconds,
    aiService: "chatgpt",
    privacy: "time-only",
    taskId,
    activityCategory: category,
    accountingDisposition: category === null ? "unclassified" : "expense",
  }).record;
}

test("an empty week reports real zero values without sample data", () => {
  const dashboard = buildWeeklyDashboardData([], [], new Date(2026, 10, 12));
  assert.equal(dashboard.totalSeconds, 0);
  assert.equal(dashboard.recordCount, 0);
  assert.equal(dashboard.categories.length, 0);
  assert.equal(dashboard.tasks.length, 0);
  assert.equal(dashboard.unclassifiedCount, 0);
  assert.equal(dashboard.notConnectedCount, 0);
});

test("weekly totals group categories and keep manual and measured time separate", () => {
  const task = buildWeeklyTask({
    id: "task-a",
    title: "発表構成",
    goal: "論点を整理する",
    plannedAiasLevel: 3,
    activityCategory: "壁打ち",
    delegatedToAi: "比較案を出す",
    humanDecision: null,
    createdAt: localTimestamp(2026, 10, 9, 9),
  });
  const manual = record("manual", 720, localTimestamp(2026, 10, 10), "壁打ち", task.id);
  const measured = {
    ...record("measured", 1080, localTimestamp(2026, 10, 11), "文章作成"),
    origin: "extension-import",
    timeSource: "measured",
  } as WeeklyRecordV1;
  const dashboard = buildWeeklyDashboardData([manual, measured], [task], new Date(2026, 10, 12));
  assert.equal(dashboard.totalSeconds, 1800);
  assert.equal(dashboard.recordCount, 2);
  assert.deepEqual(dashboard.categories.map((row) => [row.category, row.seconds, row.count]), [
    ["壁打ち", 720, 1],
    ["文章作成", 1080, 1],
  ]);
  assert.deepEqual(dashboard.sources.map((row) => [row.source, row.seconds, row.count]), [
    ["manual", 720, 1],
    ["measured", 1080, 1],
    ["adjusted", 0, 0],
    ["unknown", 0, 0],
  ]);
  assert.equal(dashboard.tasks[0].id, task.id);
  assert.equal(dashboard.notConnectedCount, 2);
  assert.equal(dashboard.notEvaluatedCount, 2);
});

test("Monday midnight partitions adjacent weeks and week switching finds each record once", () => {
  const sunday = record("sunday", 60, localTimestamp(2026, 10, 8, 23, 59));
  const monday = record("monday", 90, localTimestamp(2026, 10, 9, 0, 0));
  const previous = buildWeeklyDashboardData([sunday, monday], [], new Date(2026, 10, 8));
  const current = buildWeeklyDashboardData([sunday, monday], [], new Date(2026, 10, 9));
  assert.deepEqual(previous.records.map((row) => row.record.id), ["sunday"]);
  assert.deepEqual(current.records.map((row) => row.record.id), ["monday"]);
  assert.equal(previous.totalSeconds + current.totalSeconds, 150);
});

test("duplicate IDs and source events never increase weekly totals", () => {
  const first = { ...record("first", 120, localTimestamp(2026, 10, 10)), sourceEventId: "event-1" } as WeeklyRecordV1;
  const duplicateSource = { ...record("second", 120, localTimestamp(2026, 10, 10)), sourceEventId: "event-1" } as WeeklyRecordV1;
  const dashboard = buildWeeklyDashboardData([first, first, duplicateSource], [], new Date(2026, 10, 10));
  assert.equal(dashboard.recordCount, 1);
  assert.equal(dashboard.totalSeconds, 120);
});

test("editing and deleting are reflected by rebuilding from the current store", () => {
  const original = record("editable", 720, localTimestamp(2026, 10, 10));
  const edited = { ...original, activeSeconds: 600 } as WeeklyRecordV1;
  assert.equal(buildWeeklyDashboardData([original], [], new Date(2026, 10, 10)).totalSeconds, 720);
  assert.equal(buildWeeklyDashboardData([edited], [], new Date(2026, 10, 10)).totalSeconds, 600);
  assert.equal(buildWeeklyDashboardData([], [], new Date(2026, 10, 10)).totalSeconds, 0);
});

test("a Level 1 no-AI activity is shown but is not treated as unprocessed analysis", () => {
  const noAi = buildManualWeeklyRecord({
    id: "no-ai",
    recordedAt: localTimestamp(2026, 10, 10),
    activeSeconds: 0,
    aiService: "other",
    privacy: "time-only",
    activityCategory: "文章作成",
    accountingDisposition: "unclassified",
    analysisApplicable: false,
  }).record;
  const dashboard = buildWeeklyDashboardData([noAi], [], new Date(2026, 10, 10));
  assert.equal(dashboard.recordCount, 1);
  assert.equal(dashboard.totalSeconds, 0);
  assert.equal(dashboard.unclassifiedCount, 0);
  assert.equal(dashboard.notEvaluatedCount, 0);
  assert.equal(dashboard.notApplicableCount, 1);
});
