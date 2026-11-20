import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteWeeklyRecord,
  deleteWeeklyTask,
  loadWeeklyConversationStore,
  loadWeeklyRecordStore,
  saveManualWeeklyRecord,
  saveWeeklyTask,
  WEEKLY_CONVERSATIONS_STORAGE_KEY,
  WEEKLY_RECORDS_STORAGE_KEY,
  WeeklyStoreError,
} from "../src/weeklyStore.ts";

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

function manual(id: string, seconds: number, sourceEventId: string | null = null) {
  return {
    id,
    sourceEventId,
    recordedAt: "2026-11-10T10:00:00+09:00",
    activeSeconds: seconds,
    aiService: "chatgpt" as const,
    privacy: "full" as const,
    activityCategory: "壁打ち" as const,
    accountingDisposition: "expense" as const,
    conversation: {
      id: `${id}:conversation`,
      messages: [{ role: "user" as const, text: "固定テスト入力" }],
    },
  };
}

test("save, reload, same-id update and delete use only the versioned weekly keys", async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  storage.setItem("watashi-to-ai-thought-receipts", "[{\"legacy\":true}]");
  storage.setItem("thinkingLedger", "[{\"legacyLedger\":true}]");
  const legacyReceipts = storage.getItem("watashi-to-ai-thought-receipts");
  const legacyLedger = storage.getItem("thinkingLedger");

  const inserted = await saveManualWeeklyRecord(manual("a", 720), { storage, locks });
  assert.equal(inserted.inserted, true);
  const updated = await saveManualWeeklyRecord(manual("a", 600), { storage, locks });
  assert.equal(updated.inserted, false);
  assert.equal(loadWeeklyRecordStore(storage).records.length, 1);
  assert.equal(loadWeeklyRecordStore(storage).records[0].activeSeconds, 600);
  assert.equal(loadWeeklyConversationStore(storage).conversations.length, 1);

  await deleteWeeklyRecord("a", { storage, locks });
  assert.equal(loadWeeklyRecordStore(storage).records.length, 0);
  assert.equal(loadWeeklyConversationStore(storage).conversations.length, 0);
  assert.equal(storage.getItem("watashi-to-ai-thought-receipts"), legacyReceipts);
  assert.equal(storage.getItem("thinkingLedger"), legacyLedger);
});

test("the same source event is idempotent even when a caller supplies another id", async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  await saveManualWeeklyRecord(manual("first", 720, "import-event-1"), { storage, locks });
  const duplicate = await saveManualWeeklyRecord(manual("second", 720, "import-event-1"), { storage, locks });
  assert.equal(duplicate.deduplicated, true);
  assert.equal(duplicate.record?.id, "first");
  assert.equal(loadWeeklyRecordStore(storage).records.length, 1);
  assert.equal(loadWeeklyConversationStore(storage).conversations.length, 1);
});

test("off persists neither time nor conversation and needs no lock", async () => {
  const storage = new MemoryStorage();
  const result = await saveManualWeeklyRecord({ ...manual("off", 10), privacy: "off" }, { storage, locks: null });
  assert.equal(result.persisted, false);
  assert.equal(storage.getItem(WEEKLY_RECORDS_STORAGE_KEY), null);
  assert.equal(storage.getItem(WEEKLY_CONVERSATIONS_STORAGE_KEY), null);
});

test("changing an existing record to off removes both time and content", async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  await saveManualWeeklyRecord(manual("off-existing", 60), { storage, locks });
  const result = await saveManualWeeklyRecord({ ...manual("off-existing", 60), privacy: "off" }, { storage, locks });
  assert.equal(result.persisted, false);
  assert.equal(result.store.records.length, 0);
  assert.equal(loadWeeklyConversationStore(storage).conversations.length, 0);
});

test("time-only removes previously saved content for the same record", async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  await saveManualWeeklyRecord(manual("privacy", 60), { storage, locks });
  await saveManualWeeklyRecord({ ...manual("privacy", 60), privacy: "time-only" }, { storage, locks });
  assert.equal(loadWeeklyRecordStore(storage).records[0].privacy, "time-only");
  assert.equal(loadWeeklyConversationStore(storage).conversations.length, 0);
});

test("a second-key save failure rolls both weekly keys back and retry succeeds once", async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  storage.failOnSetNumber = 2;
  await assert.rejects(
    () => saveManualWeeklyRecord(manual("retry", 60), { storage, locks }),
    (error) => error instanceof WeeklyStoreError && error.code === "SAVE_FAILED",
  );
  assert.equal(storage.getItem(WEEKLY_RECORDS_STORAGE_KEY), null);
  assert.equal(storage.getItem(WEEKLY_CONVERSATIONS_STORAGE_KEY), null);
  storage.failOnSetNumber = null;
  const retried = await saveManualWeeklyRecord(manual("retry", 60), { storage, locks });
  assert.equal(retried.inserted, true);
  assert.equal(loadWeeklyRecordStore(storage).records.length, 1);
});

test("invalid weekly data is reported and never silently overwritten", () => {
  const storage = new MemoryStorage();
  storage.setItem(WEEKLY_RECORDS_STORAGE_KEY, "{broken");
  assert.throws(
    () => loadWeeklyRecordStore(storage),
    (error) => error instanceof WeeklyStoreError && error.code === "STORE_INVALID",
  );
  assert.equal(storage.getItem(WEEKLY_RECORDS_STORAGE_KEY), "{broken");
});

test("tasks are saved, edited and protected while an activity refers to them", async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const task = {
    id: "task-a",
    title: "発表構成",
    goal: "論点を整理する",
    plannedAiasLevel: 3 as const,
    activityCategory: "壁打ち" as const,
    delegatedToAi: "比較案を出す",
    humanDecision: "採用案は本人が決める",
    createdAt: "2026-11-13T09:00:00+09:00",
  };
  let store = await saveWeeklyTask(task, { storage, locks });
  assert.equal(store.tasks[0].activityCategory, "壁打ち");
  store = await saveWeeklyTask({ ...task, title: "発表構成を確定" }, { storage, locks });
  assert.equal(store.tasks.length, 1);
  assert.equal(store.tasks[0].title, "発表構成を確定");

  await saveManualWeeklyRecord({ ...manual("linked", 120), taskId: task.id }, { storage, locks });
  await assert.rejects(
    () => saveWeeklyTask({ ...task, plannedAiasLevel: 1, delegatedToAi: "AIを使用しない" }, { storage, locks }),
    (error) => error instanceof WeeklyStoreError && error.code === "TASK_IN_USE",
  );
  await assert.rejects(
    () => deleteWeeklyTask(task.id, { storage, locks }),
    (error) => error instanceof WeeklyStoreError && error.code === "TASK_IN_USE",
  );
  await deleteWeeklyRecord("linked", { storage, locks });
  store = await deleteWeeklyTask(task.id, { storage, locks });
  assert.equal(store.tasks.length, 0);
});
