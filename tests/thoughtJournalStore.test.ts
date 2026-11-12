import assert from "node:assert/strict";
import test from "node:test";
import { closeAccountingPeriod, loadTimeAccountingStore } from "../src/timeAccountingStore.ts";
import { saveThoughtJournalRecord } from "../src/thoughtJournalStore.ts";

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

const thoughtKey = "thought-journal-mutation-test";
const balancedJournal = {
  aiBorrowing: { amount: 4 }, selfCapital: { amount: 3 },
  thoughtAsset: { amount: 5 }, thoughtExpense: { amount: 2 },
};
const record = (id: string, date: string, topic = "元") => ({ id, date, topic, journal: balancedJournal });
const options = (storage: MemoryStorage, locks: SerialLocks) => ({
  storage, locks, storageKey: thoughtKey,
});

test("実際の思考仕訳保存も共通締め状態を参照し、締め済み月の追加・変更を拒否する", async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  await saveThoughtJournalRecord(record("thought-oct", "2026-10-31"), options(storage, locks));
  await closeAccountingPeriod("2026-10", { storage, locks, thoughtJournalStorageKey: thoughtKey });
  await assert.rejects(() => saveThoughtJournalRecord(
    record("thought-oct", "2026-10-31", "変更"), options(storage, locks),
  ));
  await assert.rejects(() => saveThoughtJournalRecord(
    record("thought-late", "2026-10-30"), options(storage, locks),
  ));
  const saved = JSON.parse(storage.getItem(thoughtKey)!);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].topic, "元");
});

test("月末締めと別タブの思考仕訳追加を直列化する", async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const results = await Promise.allSettled([
    closeAccountingPeriod("2026-12", { storage, locks, thoughtJournalStorageKey: thoughtKey }),
    saveThoughtJournalRecord(record("thought-race", "2026-12-31"), options(storage, locks)),
  ]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  assert.equal(storage.getItem(thoughtKey), null);
  assert.equal(loadTimeAccountingStore(storage).periodState.closedPeriods[0].periodKey, "2026-12");
});

test("思考仕訳の保存失敗で既存データを部分更新しない", async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  await saveThoughtJournalRecord(record("thought-existing", "2027-01-01"), options(storage, locks));
  const snapshot = storage.getItem(thoughtKey);
  storage.failNextSet = true;
  await assert.rejects(() => saveThoughtJournalRecord(
    record("thought-new", "2027-01-02"), options(storage, locks),
  ));
  assert.equal(storage.getItem(thoughtKey), snapshot);
});
