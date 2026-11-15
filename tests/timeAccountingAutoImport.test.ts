import assert from "node:assert/strict";
import test from "node:test";
import {
  TIME_AUTO_IMPORT_SETTINGS_BASE_KEY,
  loadAutomaticTimeImportEnabled,
  runAutomaticTimeImport,
  saveAutomaticTimeImportEnabled,
} from "../src/timeAccountingAutoImport.ts";
import { importTimeRecords, loadTimeAccountingStore } from "../src/timeAccountingStore.ts";
import type { TimeRecordPreview } from "../src/timeRecordTransfer.ts";

class MemoryStorage {
  values = new Map<string, string>();
  failNextSet = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.failNextSet) {
      this.failNextSet = false;
      throw new Error("simulated save failure");
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

const record: TimeRecordPreview = {
  recordId: "auto-session:day:2026-11-11",
  sessionId: "auto-session",
  provider: "ChatGPT",
  localDate: "2026-11-11",
  timeZone: "Asia/Tokyo",
  startedAt: Date.parse("2026-11-11T10:00:00+09:00"),
  endedAt: Date.parse("2026-11-11T10:01:01+09:00"),
  durationSeconds: 61,
};

test("自動取り込みは未設定・不正設定ではOFFで、利用者がON/OFFを保存できる", () => {
  const storage = new MemoryStorage();
  assert.equal(loadAutomaticTimeImportEnabled(storage), false);
  assert.equal(loadAutomaticTimeImportEnabled({ getItem: () => { throw new Error("blocked"); } }), false);
  storage.setItem(TIME_AUTO_IMPORT_SETTINGS_BASE_KEY, "invalid-json");
  assert.equal(loadAutomaticTimeImportEnabled(storage), false);

  saveAutomaticTimeImportEnabled(true, storage);
  assert.equal(loadAutomaticTimeImportEnabled(storage), true);
  saveAutomaticTimeImportEnabled(false, storage);
  assert.equal(loadAutomaticTimeImportEnabled(storage), false);
});

test("OFFでは拡張機能へ要求せず、ONでも対象0件なら保存も通知も行わない", async () => {
  let requested = 0;
  let imported = 0;
  let acknowledged = 0;
  const dependencies = {
    requestRecords: async () => { requested += 1; return [] as TimeRecordPreview[]; },
    importRecords: async () => { imported += 1; throw new Error("must not import"); },
    acknowledge: async () => { acknowledged += 1; },
  };

  assert.equal((await runAutomaticTimeImport({ enabled: false, ...dependencies })).status, "disabled");
  assert.equal(requested, 0);
  assert.equal((await runAutomaticTimeImport({ enabled: true, ...dependencies })).status, "empty");
  assert.deepEqual({ requested, imported, acknowledged }, { requested: 1, imported: 0, acknowledged: 0 });
});

test("保存失敗ではACKせず、次回起動相当の再試行で61秒を保存する", async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  let acknowledged = 0;
  const execute = () => runAutomaticTimeImport({
    enabled: true,
    requestRecords: async () => [record],
    importRecords: (records) => importTimeRecords(records, { storage, locks }),
    acknowledge: async () => { acknowledged += 1; },
  });

  storage.failNextSet = true;
  await assert.rejects(execute, /保存できません/);
  assert.equal(acknowledged, 0);
  assert.equal(storage.getItem("watashi-to-ai-time-accounting-ledger"), null);

  const retry = await execute();
  assert.equal(retry.status, "completed");
  assert.equal(retry.status === "completed" ? retry.result.importedSeconds : 0, 61);
  assert.equal(acknowledged, 1);
  assert.equal(loadTimeAccountingStore(storage).ledger.entries.length, 1);
});

test("ACK失敗・再送・複数タブの同時処理でも仕訳を二重計上しない", async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  let failAck = true;
  const execute = () => runAutomaticTimeImport({
    enabled: true,
    requestRecords: async () => [record],
    importRecords: (records) => importTimeRecords(records, { storage, locks }),
    acknowledge: async () => {
      if (failAck) throw new Error("simulated acknowledgement failure");
    },
  });

  await assert.rejects(execute, /acknowledgement failure/);
  failAck = false;
  const [firstRetry, secondRetry] = await Promise.all([execute(), execute()]);
  assert.equal(firstRetry.status, "completed");
  assert.equal(secondRetry.status, "completed");
  const store = loadTimeAccountingStore(storage);
  assert.equal(store.ledger.entries.length, 1);
  assert.equal(store.ledger.measurements[0].actualInputSeconds, 61);
});
