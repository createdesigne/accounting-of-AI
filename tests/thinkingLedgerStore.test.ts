import assert from "node:assert/strict";
import test from "node:test";
import { createAccountingPeriodState, withClosedAccountingPeriod } from "../src/accountingPeriods.ts";
import {
  addThinkingLedgerRecords,
  deleteThinkingLedgerRecord,
  updateThinkingLedgerRecord,
} from "../src/thinkingLedgerStore.ts";
import {
  TIME_ACCOUNTING_STORAGE_BASE_KEY,
  loadTimeAccountingStore,
  saveAccountingPeriodState,
} from "../src/timeAccountingStore.ts";

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

class SerialLocks {
  private tail: Promise<unknown> = Promise.resolve();
  request<T>(_name: string, _options: { mode: "exclusive" }, callback: () => Promise<T> | T) {
    const result = this.tail.then(callback, callback);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

const ledgerKey = "thinking-ledger-test";
const record = (receiptNo: string, issuedAt: string) => ({
  receiptNo,
  issuedAt,
  conversationDate: issuedAt,
  aiService: "ChatGPT",
  topic: "テスト",
});

const options = (storage: MemoryStorage, locks: SerialLocks) => ({
  storage,
  locks,
  storageKey: ledgerKey,
  periodStorageKey: TIME_ACCOUNTING_STORAGE_BASE_KEY,
});

test("思考仕訳は未締め月だけ追加・編集・削除できる", async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const original = record("thought-open", "2026/11/10 10:00");
  await addThinkingLedgerRecords([original], options(storage, locks));
  const updated = { ...original, topic: "更新" };
  const afterUpdate = await updateThinkingLedgerRecord(updated, options(storage, locks));
  assert.equal((afterUpdate[0] as typeof updated).topic, "更新");
  assert.deepEqual(await deleteThinkingLedgerRecord(original.receiptNo, options(storage, locks)), []);
});

test("締め済み思考仕訳の直接追加・編集・削除を拒否する", async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const existing = record("thought-closed", "2026/10/31 10:00");
  await addThinkingLedgerRecords([existing], options(storage, locks));
  const beforeClose = storage.getItem(ledgerKey);
  const closed = withClosedAccountingPeriod(
    createAccountingPeriodState("Asia/Tokyo"), "2026-10", "2026-11-01T00:00:00.000Z",
  );
  await saveAccountingPeriodState(closed, { storage, locks });

  await assert.rejects(() => addThinkingLedgerRecords([
    record("late-thought", "2026/10/30 10:00"),
  ], options(storage, locks)));
  await assert.rejects(() => updateThinkingLedgerRecord(
    { ...existing, topic: "変更不可" }, options(storage, locks),
  ));
  await assert.rejects(() => deleteThinkingLedgerRecord(existing.receiptNo, options(storage, locks)));
  assert.equal(storage.getItem(ledgerKey), beforeClose);
});

test("締め保存と別タブ追加を直列化し、保存失敗でも帳簿を部分更新しない", async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const closed = withClosedAccountingPeriod(
    createAccountingPeriodState("Asia/Tokyo"), "2026-10", "2026-11-01T00:00:00.000Z",
  );
  const results = await Promise.allSettled([
    saveAccountingPeriodState(closed, { storage, locks }),
    addThinkingLedgerRecords([record("racing-thought", "2026/10/31 10:00")], options(storage, locks)),
  ]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  assert.equal(storage.getItem(ledgerKey), null);
  assert.deepEqual(loadTimeAccountingStore(storage).periodState.closedPeriods.map((item) => item.periodKey), ["2026-10"]);

  const snapshot = storage.getItem(ledgerKey);
  storage.failNextSet = true;
  await assert.rejects(() => addThinkingLedgerRecords([
    record("save-failure", "2026/11/10 10:00"),
  ], options(storage, locks)));
  assert.equal(storage.getItem(ledgerKey), snapshot);
});
