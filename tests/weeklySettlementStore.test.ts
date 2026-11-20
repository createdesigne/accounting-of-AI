import assert from "node:assert/strict";
import test from "node:test";
import { buildManualWeeklyRecord } from "../src/weeklyData.ts";
import {
  confirmWeeklySettlement,
  loadWeeklySettlementStore,
  previewWeeklySettlement,
  WEEKLY_SETTLEMENTS_STORAGE_KEY,
  WeeklySettlementStoreError,
} from "../src/weeklySettlementStore.ts";

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

const anchor = new Date(2026, 10, 12);

function wallball(
  seconds: number,
  disposition: "expense" | "asset" | "work-in-progress" | "unclassified" = "expense",
  id = "wallball-720",
) {
  return buildManualWeeklyRecord({
    id,
    recordedAt: new Date(2026, 10, 10, 12).toISOString(),
    activeSeconds: seconds,
    aiService: "chatgpt",
    privacy: "time-only",
    activityCategory: "壁打ち",
    accountingDisposition: disposition,
  }).record;
}

test("720 seconds preview posts clearing, contribution and thought exploration expense", () => {
  const preview = previewWeeklySettlement([wallball(720)], [], anchor);
  assert.equal(preview.confirmationStatus, "unconfirmed");
  assert.equal(preview.journalEntries.length, 2);
  assert.deepEqual(preview.journalEntries[0].lines, [
    { side: "debit", account: "AI仮受品", seconds: 720 },
    { side: "credit", account: "時間拠出", seconds: 720 },
  ]);
  assert.deepEqual(preview.journalEntries[1].lines, [
    { side: "debit", account: "思考探究費", seconds: 720 },
    { side: "credit", account: "AI仮受品", seconds: 720 },
  ]);
  assert.equal(preview.settlement.balanceSheet.debitSeconds, 720);
  assert.equal(preview.settlement.balanceSheet.creditSeconds, 720);
  assert.equal(preview.settlement.profitAndLoss.totalExpenseSeconds, 720);
  assert.equal(preview.settlement.trialBalance.isBalanced, true);
});

test("48 seconds remains one 48-second activity when recognition and classification are both displayed", () => {
  const preview = previewWeeklySettlement([wallball(48)], [], anchor);
  assert.equal(preview.journalEntries.length, 2);
  assert.equal(preview.settlement.totals.recordSeconds, 48);
  assert.equal(preview.settlement.totals.expenseSeconds, 48);
  assert.equal(preview.settlement.profitAndLoss.totalExpenseSeconds, 48);
  assert.equal(preview.journalEntries[0].lines[0].seconds, 48);
  assert.equal(preview.journalEntries[1].lines[0].seconds, 48);
  assert.equal(preview.settlement.trialBalance.isBalanced, true);
});

test("empty and mixed-classification previews keep each second in exactly one classification", () => {
  const empty = previewWeeklySettlement([], [], anchor);
  assert.deepEqual(empty.settlement.totals, {
    recordCount: 0,
    recordSeconds: 0,
    expenseSeconds: 0,
    assetSeconds: 0,
    workInProgressSeconds: 0,
    unclassifiedSeconds: 0,
  });

  const mixed = previewWeeklySettlement([
    wallball(10, "expense", "expense-10"),
    wallball(20, "asset", "asset-20"),
    wallball(30, "work-in-progress", "wip-30"),
    wallball(40, "unclassified", "unclassified-40"),
  ], [], anchor);
  assert.equal(mixed.settlement.totals.recordSeconds, 100);
  assert.equal(mixed.settlement.totals.expenseSeconds, 10);
  assert.equal(mixed.settlement.totals.assetSeconds, 20);
  assert.equal(mixed.settlement.totals.workInProgressSeconds, 30);
  assert.equal(mixed.settlement.totals.unclassifiedSeconds, 40);
  assert.equal(
    mixed.settlement.totals.expenseSeconds
      + mixed.settlement.totals.assetSeconds
      + mixed.settlement.totals.workInProgressSeconds
      + mixed.settlement.totals.unclassifiedSeconds,
    mixed.settlement.totals.recordSeconds,
  );
  assert.equal(mixed.settlement.trialBalance.isBalanced, true);
  assert.equal(mixed.settlement.balanceSheet.isBalanced, true);
});

test("confirmation is idempotent and an edit or deletion creates an auditable revision", async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const first = await confirmWeeklySettlement([wallball(720)], [], anchor, {
    storage, locks, now: () => new Date("2026-11-15T10:00:00Z"),
  });
  assert.equal(first.inserted, true);
  assert.equal(first.revision.settlement.totals.recordSeconds, 720);

  const repeated = await confirmWeeklySettlement([wallball(720)], [], anchor, { storage, locks });
  assert.equal(repeated.inserted, false);
  assert.equal(loadWeeklySettlementStore(storage).weeks[0].revisions.length, 1);
  assert.equal(previewWeeklySettlement([wallball(720)], [], anchor, repeated.store).confirmationStatus, "confirmed");

  const editedPreview = previewWeeklySettlement([wallball(600)], [], anchor, repeated.store);
  assert.equal(editedPreview.confirmationStatus, "needs-reconfirmation");
  const edited = await confirmWeeklySettlement([wallball(600)], [], anchor, {
    storage, locks, now: () => new Date("2026-11-15T11:00:00Z"),
  });
  assert.equal(edited.revision.settlement.totals.recordSeconds, 600);
  assert.equal(edited.store.weeks[0].revisions.length, 2);
  assert.equal(edited.store.weeks[0].revisions[0].settlement.totals.recordSeconds, 720);

  const deletedPreview = previewWeeklySettlement([], [], anchor, edited.store);
  assert.equal(deletedPreview.confirmationStatus, "needs-reconfirmation");
  const deleted = await confirmWeeklySettlement([], [], anchor, {
    storage, locks, now: () => new Date("2026-11-15T12:00:00Z"),
  });
  assert.equal(deleted.revision.settlement.totals.recordSeconds, 0);
  assert.equal(deleted.store.weeks[0].revisions.length, 3);
  assert.equal(deleted.revision.settlement.trialBalance.isBalanced, true);
});

test("unclassified records remain in AI clearing and are not expensed", () => {
  const preview = previewWeeklySettlement([wallball(720, "unclassified")], [], anchor);
  assert.equal(preview.journalEntries.length, 1);
  assert.equal(preview.settlement.totals.unclassifiedSeconds, 720);
  assert.equal(preview.settlement.totals.expenseSeconds, 0);
  assert.equal(preview.settlement.balanceSheet.debit.find((line) => line.account === "AI仮受品")?.seconds, 720);
});

test("a settlement save failure restores the previous store and does not touch legacy data", async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  storage.setItem("watashi-to-ai-thought-receipts", "legacy-receipts");
  storage.setItem("thinkingLedger", "legacy-ledger");
  const beforeFailure = storage.setCount;
  storage.failOnSetNumber = beforeFailure + 1;
  await assert.rejects(
    confirmWeeklySettlement([wallball(720)], [], anchor, { storage, locks }),
    (error: unknown) => error instanceof WeeklySettlementStoreError && error.code === "SAVE_FAILED",
  );
  assert.equal(storage.getItem(WEEKLY_SETTLEMENTS_STORAGE_KEY), null);
  assert.equal(storage.getItem("watashi-to-ai-thought-receipts"), "legacy-receipts");
  assert.equal(storage.getItem("thinkingLedger"), "legacy-ledger");
});

test("invalid settlement history is rejected and never overwritten", async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  storage.setItem(WEEKLY_SETTLEMENTS_STORAGE_KEY, "{\"schemaVersion\":1,\"weeks\":\"broken\"}");
  const snapshot = storage.getItem(WEEKLY_SETTLEMENTS_STORAGE_KEY);
  assert.throws(
    () => loadWeeklySettlementStore(storage),
    (error: unknown) => error instanceof WeeklySettlementStoreError && error.code === "STORE_INVALID",
  );
  await assert.rejects(
    confirmWeeklySettlement([wallball(720)], [], anchor, { storage, locks }),
    (error: unknown) => error instanceof WeeklySettlementStoreError && error.code === "STORE_INVALID",
  );
  assert.equal(storage.getItem(WEEKLY_SETTLEMENTS_STORAGE_KEY), snapshot);
});
