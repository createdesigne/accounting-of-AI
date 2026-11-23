import assert from "node:assert/strict";
import test from "node:test";
import { createAccountingPeriodState, isAccountingPeriodClosed } from "../src/accountingPeriods.ts";
import { buildMonthEndClosePreview } from "../src/monthEndClosing.ts";
import {
  TIME_ACCOUNTS,
  correctAiUsage,
  createTimeAccountingLedger,
  isBalancedJournalEntry,
  recordAiUsage,
} from "../src/timeAccounting.ts";
import {
  TIME_ACCOUNTING_STORAGE_BASE_KEY,
  TimeAccountingImportError,
  closeAccountingPeriod,
  importTimeRecords,
  loadTimeAccountingStore,
  previewAccountingPeriodClose,
} from "../src/timeAccountingStore.ts";
import type { TimeRecordPreview } from "../src/timeRecordTransfer.ts";

class MemoryStorage {
  values = new Map<string, string>();
  failNextSet = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.failNextSet) {
      this.failNextSet = false;
      throw new Error("simulated storage failure");
    }
    this.values.set(key, value);
  }
}

class LostVerificationStorage extends MemoryStorage {
  hideNextSetFromOneRead = false;
  private staleRead: { key: string; value: string | null } | null = null;

  override getItem(key: string) {
    if (this.staleRead?.key === key) {
      const value = this.staleRead.value;
      this.staleRead = null;
      return value;
    }
    return super.getItem(key);
  }

  override setItem(key: string, value: string) {
    const previous = super.getItem(key);
    super.setItem(key, value);
    if (this.hideNextSetFromOneRead) {
      this.hideNextSetFromOneRead = false;
      this.staleRead = { key, value: previous };
    }
  }
}

class SerialLocks {
  private tail: Promise<unknown> = Promise.resolve();
  request<T>(_name: string, _options: { mode: "exclusive" }, callback: () => Promise<T> | T) {
    const result = this.tail.then(callback, callback);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

const thoughtKey = "thought-journal-close-test";
const timeRecord = (recordId: string, localDate: string, durationSeconds = 61): TimeRecordPreview => ({
  recordId,
  sessionId: recordId.split(":day:")[0],
  provider: "ChatGPT",
  localDate,
  timeZone: "Asia/Tokyo",
  startedAt: Date.parse(`${localDate}T10:00:00+09:00`),
  endedAt: Date.parse(`${localDate}T10:00:00+09:00`) + durationSeconds * 1000,
  durationSeconds,
});

const balancedThought = (id: string, date: string) => ({
  id,
  date,
  journal: {
    aiBorrowing: { amount: 4 },
    selfCapital: { amount: 3 },
    thoughtAsset: { amount: 5 },
    thoughtExpense: { amount: 2 },
  },
});

test("月末締め前に時間・思考仕訳の貸借、件数、残高、未処理件数を集計する", () => {
  const ledger = recordAiUsage(createTimeAccountingLedger(), {
    entryId: "usage-preview",
    sourceEventId: "source-preview",
    occurredOn: "2026-11-10",
    actualInputSeconds: 61,
  });
  const preview = buildMonthEndClosePreview({
    periodKey: "2026-11",
    ledger,
    periodState: createAccountingPeriodState("Asia/Tokyo"),
    thoughtJournalData: [balancedThought("thought-preview", "2026-11-12")],
  });
  assert.equal(preview.periodStart, "2026-11-01");
  assert.equal(preview.periodEnd, "2026-11-30");
  assert.equal(preview.timeJournalEntryCount, 1);
  assert.equal(preview.thoughtJournalEntryCount, 1);
  assert.equal(preview.timeDebitSeconds, 61);
  assert.equal(preview.timeCreditSeconds, 61);
  assert.equal(preview.thoughtDebitUnits, 7);
  assert.equal(preview.thoughtCreditUnits, 7);
  assert.equal(preview.unresolvedAiClearingSeconds, 61);
  assert.equal(preview.unprocessedCount, 1);
  assert.deepEqual(preview.plannedTransfers, []);
  assert.equal(preview.canClose, true);
});

test("用途確認済みだけ月末振替を生成し、未確認のAI仮受品は保持する", () => {
  let ledger = recordAiUsage(createTimeAccountingLedger(), {
    entryId: "usage-confirmed", sourceEventId: "source-confirmed",
    occurredOn: "2026-12-30", actualInputSeconds: 60,
  });
  ledger = recordAiUsage(ledger, {
    entryId: "usage-pending", sourceEventId: "source-pending",
    occurredOn: "2026-12-31", actualInputSeconds: 61,
  });
  const preview = buildMonthEndClosePreview({
    periodKey: "2026-12",
    ledger,
    periodState: createAccountingPeriodState("Asia/Tokyo"),
    thoughtJournalData: [],
    confirmedThoughtExplorationSourceEventIds: ["source-confirmed"],
  });
  assert.equal(preview.periodEnd, "2026-12-31");
  assert.equal(preview.plannedTransfers.length, 1);
  assert.deepEqual(preview.plannedTransfers[0], {
    entryId: "month-end:2026-12:source-confirmed",
    sourceEventId: "source-confirmed",
    postedOn: "2026-12-31",
    seconds: 60,
    debitAccount: TIME_ACCOUNTS.thoughtExplorationExpense,
    creditAccount: TIME_ACCOUNTS.aiClearing,
  });
  assert.equal(preview.unresolvedAiClearingSeconds, 61);
  assert.equal(preview.unprocessedCount, 1);
  assert.equal(preview.projectedLedger.entries.length, 3);
  assert.ok(preview.projectedLedger.entries.every(isBalancedJournalEntry));
});

test("対象月より後の訂正を過去月の振替へ遡及させない", () => {
  let ledger = recordAiUsage(createTimeAccountingLedger(), {
    entryId: "usage-future-correction", sourceEventId: "source-future-correction",
    occurredOn: "2026-11-30", actualInputSeconds: 61,
  });
  ledger = correctAiUsage(ledger, {
    entryId: "future-correction", sourceEventId: "source-future-correction",
    postedOn: "2026-12-01", correctedInputSeconds: 45,
  });
  const preview = buildMonthEndClosePreview({
    periodKey: "2026-11",
    ledger,
    periodState: createAccountingPeriodState("Asia/Tokyo"),
    thoughtJournalData: [],
    confirmedThoughtExplorationSourceEventIds: ["source-future-correction"],
  });
  assert.equal(preview.plannedTransfers.length, 0);
  assert.ok(preview.validationIssues.some((item) => item.code === "INELIGIBLE_TRANSFER_SOURCE"));
  assert.equal(preview.canClose, false);
});

test("不正・不一致・重複を事前検証で検出する", () => {
  const invalidLedger = {
    version: 2,
    unit: "second",
    measurements: [
      { sourceEventId: "duplicate", occurredOn: "2026-11-01", actualInputSeconds: 61, estimatedSavedSeconds: 0, usageEntryId: "bad-entry" },
      { sourceEventId: "duplicate", occurredOn: "2026-11-02", actualInputSeconds: 61, estimatedSavedSeconds: 0, usageEntryId: "bad-entry" },
    ],
    entries: [{
      id: "bad-entry", kind: "ai-usage", postedOn: "2026-11-01", sourceEventId: "duplicate",
      lines: [
        { side: "debit", account: "AI仮受品", seconds: 61, measurement: "actual-input" },
        { side: "credit", account: "時間拠出", seconds: 60, measurement: "actual-input" },
      ],
    }],
  } as any;
  const preview = buildMonthEndClosePreview({
    periodKey: "2026-11",
    ledger: invalidLedger,
    periodState: createAccountingPeriodState("UTC"),
    thoughtJournalData: [{
      ...balancedThought("bad-thought", "2026-11-10"),
      journal: { ...balancedThought("x", "2026-11-10").journal, thoughtExpense: { amount: 1 } },
    }],
  });
  assert.equal(preview.canClose, false);
  assert.ok(preview.validationIssues.some((item) => item.code === "INVALID_TIME_LEDGER"));
  assert.ok(preview.validationIssues.some((item) => item.code === "UNBALANCED_TIME_ENTRY"));
  assert.ok(preview.validationIssues.some((item) => item.code === "DUPLICATE_SOURCE_EVENT"));
  assert.ok(preview.validationIssues.some((item) => item.code === "UNBALANCED_THOUGHT_ENTRY"));
});

test("締め状態と明示済み振替を一括保存し、同月の再実行と同時実行で重複しない", async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const record = timeRecord("close-once:day:2026-11-10", "2026-11-10");
  await importTimeRecords([record], { storage, locks });
  const sourceEventId = `chrome-time:${record.recordId}`;
  const options = {
    storage, locks, thoughtJournalStorageKey: thoughtKey,
    confirmedThoughtExplorationSourceEventIds: [sourceEventId],
    now: () => Date.parse("2026-12-01T00:00:00Z"),
  };
  const results = await Promise.all([
    closeAccountingPeriod("2026-11", options),
    closeAccountingPeriod("2026-11", options),
  ]);
  assert.deepEqual(results.map((item) => item.closed).sort(), [false, true]);
  const restored = loadTimeAccountingStore(storage);
  assert.equal(isAccountingPeriodClosed(restored.periodState, "2026-11"), true);
  assert.equal(restored.ledger.entries.filter((entry) => entry.kind === "month-end-adjustment").length, 1);
  const repeated = await closeAccountingPeriod("2026-11", options);
  assert.equal(repeated.closed, false);
  assert.equal(repeated.alreadyClosed, true);
  assert.equal(repeated.store.ledger.entries.length, 2);
});

test("保存失敗では振替も締め状態も残さず、再試行で一度だけ完了する", async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const record = timeRecord("close-retry:day:2026-11-10", "2026-11-10", 59);
  await importTimeRecords([record], { storage, locks });
  const snapshot = storage.getItem(TIME_ACCOUNTING_STORAGE_BASE_KEY);
  storage.failNextSet = true;
  const options = {
    storage, locks, thoughtJournalStorageKey: thoughtKey,
    confirmedThoughtExplorationSourceEventIds: [`chrome-time:${record.recordId}`],
  };
  await assert.rejects(
    () => closeAccountingPeriod("2026-11", options),
    (error) => error instanceof TimeAccountingImportError && error.code === "SAVE_FAILED",
  );
  assert.equal(storage.getItem(TIME_ACCOUNTING_STORAGE_BASE_KEY), snapshot);
  const unchanged = loadTimeAccountingStore(storage);
  assert.equal(unchanged.ledger.entries.length, 1);
  assert.equal(isAccountingPeriodClosed(unchanged.periodState, "2026-11"), false);

  const retried = await closeAccountingPeriod("2026-11", options);
  assert.equal(retried.closed, true);
  assert.equal(retried.store.ledger.entries.length, 2);
});

test("保存後の確認応答を失っても、再試行で重複せず完了を確認できる", async () => {
  const storage = new LostVerificationStorage();
  const locks = new SerialLocks();
  const record = timeRecord("close-lost-response:day:2026-11-10", "2026-11-10", 60);
  await importTimeRecords([record], { storage, locks });
  storage.hideNextSetFromOneRead = true;
  const options = {
    storage, locks, thoughtJournalStorageKey: thoughtKey,
    confirmedThoughtExplorationSourceEventIds: [`chrome-time:${record.recordId}`],
  };
  await assert.rejects(
    () => closeAccountingPeriod("2026-11", options),
    (error) => error instanceof TimeAccountingImportError && error.code === "SAVE_FAILED",
  );
  const retry = await closeAccountingPeriod("2026-11", options);
  assert.equal(retry.closed, false);
  assert.equal(retry.alreadyClosed, true);
  assert.equal(retry.store.ledger.entries.filter((entry) => entry.kind === "month-end-adjustment").length, 1);
});

test("不均衡な思考仕訳は保存を変更せず締めを拒否する", async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  storage.setItem(thoughtKey, JSON.stringify([{
    ...balancedThought("unbalanced-stored", "2026-11-10"),
    journal: { ...balancedThought("x", "2026-11-10").journal, thoughtExpense: { amount: 1 } },
  }]));
  const preview = await previewAccountingPeriodClose("2026-11", {
    storage, locks, thoughtJournalStorageKey: thoughtKey,
  });
  assert.equal(preview.canClose, false);
  const snapshot = storage.getItem(TIME_ACCOUNTING_STORAGE_BASE_KEY);
  await assert.rejects(
    () => closeAccountingPeriod("2026-11", { storage, locks, thoughtJournalStorageKey: thoughtKey }),
    (error) => error instanceof TimeAccountingImportError && error.code === "CLOSE_VALIDATION_FAILED",
  );
  assert.equal(storage.getItem(TIME_ACCOUNTING_STORAGE_BASE_KEY), snapshot);
});
