import assert from "node:assert/strict";
import test from "node:test";
import { buildManualWeeklyRecord, parseWeeklyRecord, WeeklyDataValidationError } from "../src/weeklyData.ts";

function input(overrides: Record<string, unknown> = {}) {
  return {
    id: "manual-a",
    recordedAt: "2026-11-10T10:00:00+09:00",
    activeSeconds: 720,
    aiService: "chatgpt" as const,
    privacy: "full" as const,
    activityCategory: "壁打ち" as const,
    accountingDisposition: "expense" as const,
    conversation: {
      id: "conversation-a",
      title: "固定テスト会話（実分析ではない）",
      captureScope: "partial" as const,
      messages: [{ role: "user" as const, text: "テスト入力" }],
    },
    ...overrides,
  };
}

test("manual data links conversation, usage, receipt and an explicitly unconnected analysis", () => {
  const built = buildManualWeeklyRecord(input());
  assert.equal(built.record.origin, "user-input");
  assert.equal(built.record.timeSource, "manual");
  assert.equal(built.record.links.conversationId, "conversation-a");
  assert.equal(built.record.links.usageId, "manual-a:usage");
  assert.equal(built.record.links.thoughtReceiptId, "manual-a:receipt");
  assert.equal(built.record.activityCategorySource, "user-input");
  assert.equal(built.record.analysisStatus, "not-connected");
  assert.equal(built.record.analysis.initiative, null);
  assert.equal(built.record.analysis.reasoning, null);
  assert.equal(built.record.analysis.criticalJudgment, null);
  assert.equal(built.conversation?.recordId, built.record.id);
});

test("time-only drops conversation content and keeps time", () => {
  const built = buildManualWeeklyRecord(input({ privacy: "time-only" }));
  assert.equal(built.record.activeSeconds, 720);
  assert.equal(built.record.links.conversationId, null);
  assert.equal(built.conversation, null);
});

test("seconds must be non-negative integers and expense needs a category", () => {
  for (const activeSeconds of [-1, 0.5, Number.NaN]) {
    assert.throws(
      () => buildManualWeeklyRecord(input({ activeSeconds })),
      WeeklyDataValidationError,
    );
  }
  assert.throws(
    () => buildManualWeeklyRecord(input({ activityCategory: null })),
    /requires an activity category/,
  );
  assert.equal(buildManualWeeklyRecord(input({ activeSeconds: 0 })).record.activeSeconds, 0);
});

test("off is rejected by the persistent record builder", () => {
  assert.throws(
    () => buildManualWeeklyRecord(input({ privacy: "off" })),
    /must not be built for persistent storage/,
  );
});

test("persisted analysis accepts null but rejects an invalid score", () => {
  const valid = buildManualWeeklyRecord(input()).record;
  assert.equal(parseWeeklyRecord(valid).analysis.initiative, null);
  assert.throws(
    () => parseWeeklyRecord({ ...valid, analysis: { ...valid.analysis, initiative: 10 } }),
    /analysis is invalid/,
  );
});
