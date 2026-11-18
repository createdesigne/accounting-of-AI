import assert from "node:assert/strict";
import test from "node:test";
import { buildResearchExportBundle, serializeResearchJson } from "../src/researchExport.ts";
import { buildExtensionWeeklyRecord } from "../src/weeklyData.ts";
import {
  loadWeeklyAccountingRevisionStore,
  updateWeeklyRecordAccounting,
  WEEKLY_ACCOUNTING_REVISIONS_STORAGE_KEY,
  WeeklyAccountingClassificationError,
} from "../src/weeklyAccountingClassificationStore.ts";
import { loadWeeklyConversationStore, loadWeeklyRecordStore, WEEKLY_CONVERSATIONS_STORAGE_KEY, WEEKLY_RECORDS_STORAGE_KEY } from "../src/weeklyStore.ts";
import { confirmWeeklySettlement, previewWeeklySettlement } from "../src/weeklySettlementStore.ts";

class MemoryStorage {
  readonly values = new Map<string, string>();
  failOnSetNumber: number | null = null;
  setCount = 0;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    this.setCount += 1;
    if (this.failOnSetNumber === this.setCount) throw new Error("quota");
    this.values.set(key, value);
  }
  removeItem(key: string) { this.values.delete(key); }
}

class SerialLocks {
  private tail = Promise.resolve();
  request<T>(_name: string, _options: { mode: "exclusive" }, callback: () => Promise<T> | T): Promise<T> {
    const next = this.tail.then(callback, callback);
    this.tail = next.then(() => undefined, () => undefined);
    return next;
  }
}

function measured(id: string, date: string, seconds: number) {
  const startedAt = `${date}T10:00:00+09:00`;
  const endedAt = new Date(new Date(startedAt).getTime() + seconds * 1_000).toISOString();
  return buildExtensionWeeklyRecord({
    id,
    sourceEventId: `conversation:${id}`,
    measurementRecordId: `measurement:${id}`,
    usageId: `usage:${id}`,
    recordedAt: startedAt,
    startedAt,
    endedAt,
    activeSeconds: seconds,
    aiService: "chatgpt",
    privacy: "full",
    activityCategory: "壁打ち",
    accountingDisposition: "unclassified",
    manualNotes: { ownThoughts: `本人メモ:${id}` },
    conversation: {
      id: `conversation-content:${id}`,
      title: `会話:${id}`,
      captureScope: "full",
      messages: [{ role: "user", text: `本文:${id}` }, { role: "assistant", text: "回答" }],
    },
  });
}

function fixture() {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const oldActivity = measured("activity-2026-11-16", "2026-11-16", 28);
  const targetActivity = measured("activity-2026-11-17", "2026-11-17", 109);
  storage.setItem(WEEKLY_RECORDS_STORAGE_KEY, JSON.stringify({
    schemaVersion: 1,
    records: [oldActivity.record, targetActivity.record],
    tasks: [],
  }));
  storage.setItem(WEEKLY_CONVERSATIONS_STORAGE_KEY, JSON.stringify({
    schemaVersion: 1,
    conversations: [oldActivity.conversation, targetActivity.conversation],
  }));
  storage.setItem("watashi-to-ai-weekly-analyses:v1", "analysis-data-must-stay-unchanged");
  return { storage, locks, targetActivity };
}

test("person-confirmed accounting updates only the 109-second activity and recalculates the 137-second week", async () => {
  const { storage, locks, targetActivity } = fixture();
  const beforeStore = loadWeeklyRecordStore(storage);
  const targetBefore = beforeStore.records.find((record) => record.id === targetActivity.record.id)!;
  const conversationSnapshot = storage.getItem(WEEKLY_CONVERSATIONS_STORAGE_KEY);
  const analysisSnapshot = storage.getItem("watashi-to-ai-weekly-analyses:v1");
  const anchor = new Date("2026-11-17T12:00:00+09:00");

  const confirmed = await confirmWeeklySettlement(beforeStore.records, beforeStore.tasks, anchor, {
    storage, locks, now: () => new Date("2026-11-17T15:00:00+09:00"),
  });
  assert.equal(confirmed.revision.settlement.totals.unclassifiedSeconds, 137);

  const updated = await updateWeeklyRecordAccounting(
    targetBefore.id,
    "expense",
    "思考探究費",
    { storage, locks, now: () => new Date("2026-11-18T09:00:00+09:00") },
  );
  assert.equal(updated.changed, true);
  assert.equal(updated.recordStore.records.length, 2);

  const reloaded = loadWeeklyRecordStore(storage);
  const oldRecord = reloaded.records.find((record) => record.id === "activity-2026-11-16")!;
  const target = reloaded.records.find((record) => record.id === "activity-2026-11-17")!;
  assert.equal(oldRecord.activeSeconds, 28);
  assert.equal(oldRecord.accountingDisposition, "unclassified");
  assert.equal(target.activeSeconds, 109);
  assert.equal(target.timeSource, "measured");
  assert.equal(target.sessionId, targetBefore.sessionId);
  assert.equal(target.accountingDisposition, "expense");
  assert.equal(target.accountingAccount, "思考探究費");
  assert.deepEqual(target.analysis, targetBefore.analysis);
  assert.deepEqual(target.manualNotes, targetBefore.manualNotes);
  assert.equal(storage.getItem(WEEKLY_CONVERSATIONS_STORAGE_KEY), conversationSnapshot);
  assert.equal(storage.getItem("watashi-to-ai-weekly-analyses:v1"), analysisSnapshot);

  const preview = previewWeeklySettlement(reloaded.records, reloaded.tasks, anchor, confirmed.store);
  assert.equal(preview.confirmationStatus, "needs-reconfirmation");
  assert.deepEqual(preview.settlement.totals, {
    recordSeconds: 137,
    expenseSeconds: 109,
    assetSeconds: 0,
    workInProgressSeconds: 0,
    unclassifiedSeconds: 28,
    recordCount: 2,
  });
  assert.equal(preview.settlement.profitAndLoss.expenses.find((line) => line.account === "思考探究費")?.seconds, 109);
  assert.equal(preview.settlement.trialBalance.isBalanced, true);
  assert.equal(preview.settlement.balanceSheet.isBalanced, true);
  assert.equal(preview.settlement.balanceSheet.debitSeconds, 137);
  assert.equal(preview.settlement.balanceSheet.creditSeconds, 137);

  const revisions = loadWeeklyAccountingRevisionStore(storage);
  assert.equal(revisions.revisions.length, 1);
  assert.deepEqual(revisions.revisions[0].before, { disposition: "unclassified", account: null });
  assert.deepEqual(revisions.revisions[0].after, { disposition: "expense", account: "思考探究費" });
  assert.equal(revisions.revisions[0].changedAt, "2026-11-18T00:00:00.000Z");

  const reconfirmed = await confirmWeeklySettlement(reloaded.records, reloaded.tasks, anchor, {
    storage, locks, now: () => new Date("2026-11-18T09:30:00+09:00"),
  });
  assert.equal(reconfirmed.revision.id, "2026-11-16:revision:2");
  const researchBundle = buildResearchExportBundle({
    records: reloaded,
    conversations: loadWeeklyConversationStore(storage),
    analyses: Object.freeze({ schemaVersion: 1, entries: Object.freeze([]) }),
    reviews: Object.freeze({ schemaVersion: 1, reviews: Object.freeze([]) }),
    accountingRevisions: revisions,
    reflections: Object.freeze({ schemaVersion: 1, reflections: Object.freeze([]) }),
    settlements: reconfirmed.store,
  }, {
    scope: { kind: "week", anchor },
    includeSensitiveText: false,
    exportedAt: "2026-11-18T01:00:00.000Z",
  });
  const oldExport = researchBundle.activities.find((activity) => activity.activityId === "activity-2026-11-16")!;
  const targetExport = researchBundle.activities.find((activity) => activity.activityId === "activity-2026-11-17")!;
  assert.deepEqual(oldExport.accountingRevisionHistory, []);
  assert.deepEqual(targetExport.accountingRevisionHistory, [{
    revisionId: `${target.id}:accounting-revision:1`,
    changedAt: "2026-11-18T00:00:00.000Z",
    changedBy: "person",
    before: { accountingDisposition: "unclassified", accountingAccount: null },
    after: { accountingDisposition: "expense", accountingAccount: "思考探究費" },
  }]);
  assert.equal(researchBundle.activities.reduce((sum, activity) => sum + activity.scopeAllocatedSeconds, 0), 137);
  assert.equal(researchBundle.weeklyStatements[0].confirmationStatus, "confirmed");
  assert.equal(researchBundle.weeklyStatements[0].latestRevisionId, "2026-11-16:revision:2");
  assert.deepEqual(researchBundle.weeklyStatements[0].totals, {
    recordSeconds: 137, expenseSeconds: 109, assetSeconds: 0,
    workInProgressSeconds: 0, unclassifiedSeconds: 28, recordCount: 2,
  });
  assert.equal(researchBundle.weeklyStatements[0].trialBalance.isBalanced, true);
  assert.equal(researchBundle.weeklyStatements[0].balanceSheet.isBalanced, true);
  assert.equal(researchBundle.weeklyStatements[0].profitAndLoss.totalExpenseSeconds, 109);
  assert.doesNotMatch(serializeResearchJson(researchBundle), /本文:activity|会話:activity/);

  const repeated = await updateWeeklyRecordAccounting(target.id, "expense", "思考探究費", { storage, locks });
  assert.equal(repeated.changed, false);
  assert.equal(repeated.revision, null);
  assert.equal(loadWeeklyAccountingRevisionStore(storage).revisions.length, 1);
  assert.equal(loadWeeklyRecordStore(storage).records.reduce((sum, record) => sum + record.activeSeconds, 0), 137);

  const reclassified = await updateWeeklyRecordAccounting(target.id, "asset", null, {
    storage, locks, now: () => new Date("2026-11-18T10:00:00+09:00"),
  });
  assert.equal(reclassified.changed, true);
  const afterReclassification = loadWeeklyAccountingRevisionStore(storage);
  assert.equal(afterReclassification.revisions.length, 2);
  assert.deepEqual(afterReclassification.revisions[1].before, { disposition: "expense", account: "思考探究費" });
  assert.deepEqual(afterReclassification.revisions[1].after, { disposition: "asset", account: null });
  assert.equal(loadWeeklyRecordStore(storage).records.reduce((sum, record) => sum + record.activeSeconds, 0), 137);
});

test("invalid accounting or a failed history save leaves the activity and history unchanged", async () => {
  const { storage, locks, targetActivity } = fixture();
  const beforeRecords = storage.getItem(WEEKLY_RECORDS_STORAGE_KEY);
  await assert.rejects(
    updateWeeklyRecordAccounting(targetActivity.record.id, "asset", "思考探究費", { storage, locks }),
    /Only an expense record may have an expense account/,
  );
  assert.equal(storage.getItem(WEEKLY_RECORDS_STORAGE_KEY), beforeRecords);

  const beforeFailure = storage.setCount;
  storage.failOnSetNumber = beforeFailure + 2;
  await assert.rejects(
    updateWeeklyRecordAccounting(targetActivity.record.id, "expense", "思考探究費", { storage, locks }),
    (error: unknown) => error instanceof WeeklyAccountingClassificationError && error.code === "SAVE_FAILED",
  );
  assert.equal(storage.getItem(WEEKLY_RECORDS_STORAGE_KEY), beforeRecords);
  assert.equal(storage.getItem(WEEKLY_ACCOUNTING_REVISIONS_STORAGE_KEY), null);
});
