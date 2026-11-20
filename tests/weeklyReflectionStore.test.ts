import assert from "node:assert/strict";
import test from "node:test";
import {
  getWeeklyReflectionNavigation,
  loadWeeklyReflectionStore,
  previousWeekReflection,
  reflectionForWeek,
  saveWeeklyReflection,
  WEEKLY_REFLECTIONS_STORAGE_KEY,
  WeeklyReflectionStoreError,
} from "../src/weeklyReflectionStore.ts";

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

function localDate(year: number, month: number, day: number) {
  return new Date(year, month, day, 12);
}

function input(anchor: Date, challenge: string, selectedCount = 2) {
  return {
    anchor,
    discoveryLearning: "大きな発見",
    humanJudgment: "提案を比較して自分で修正した",
    relationshipReflection: "AIに任せる範囲を限定した",
    nextWeekChallenge: challenge,
    selectedActivities: Array.from({ length: selectedCount }, (_, index) => ({
      recordId: `record-${index + 1}`,
      thoughtReceiptId: `record-${index + 1}:receipt`,
    })),
  };
}

test("a reflection and up to three thought receipt links persist after reload", async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const anchor = localDate(2026, 10, 12);
  await saveWeeklyReflection(input(anchor, "来週は検証を先にする", 3), {
    storage, locks, now: () => new Date("2026-11-13T10:00:00Z"),
  });
  const loaded = loadWeeklyReflectionStore(storage);
  const reflection = reflectionForWeek(loaded, anchor);
  assert.equal(reflection?.discoveryLearning, "大きな発見");
  assert.equal(reflection?.humanJudgment, "提案を比較して自分で修正した");
  assert.equal(reflection?.selectedActivities.length, 3);
  assert.equal(reflection?.selectedActivities[0].thoughtReceiptId, "record-1:receipt");
});

test("editing a past week replaces that week only and the next week sees its challenge", async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const firstWeek = localDate(2026, 10, 12);
  const nextWeek = localDate(2026, 10, 19);
  await saveWeeklyReflection(input(firstWeek, "最初の挑戦"), { storage, locks });
  await saveWeeklyReflection(input(nextWeek, "次の挑戦", 0), { storage, locks });
  await saveWeeklyReflection({ ...input(firstWeek, "更新した挑戦", 1), discoveryLearning: "更新した発見" }, { storage, locks });
  const loaded = loadWeeklyReflectionStore(storage);
  assert.equal(loaded.reflections.length, 2);
  assert.equal(reflectionForWeek(loaded, firstWeek)?.discoveryLearning, "更新した発見");
  assert.equal(previousWeekReflection(loaded, nextWeek)?.nextWeekChallenge, "更新した挑戦");
});

test("a week with zero activities can save a reflection", async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const result = await saveWeeklyReflection(input(localDate(2026, 10, 12), "活動がなくても振り返る", 0), { storage, locks });
  assert.equal(result.reflection.selectedActivities.length, 0);
  assert.equal(result.reflection.nextWeekChallenge, "活動がなくても振り返る");
});

test("more than three representative activities and duplicate links are rejected", async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  await assert.rejects(
    saveWeeklyReflection(input(localDate(2026, 10, 12), "挑戦", 4), { storage, locks }),
    (error: unknown) => error instanceof WeeklyReflectionStoreError && error.code === "INPUT_INVALID",
  );
  const duplicate = input(localDate(2026, 10, 12), "挑戦", 2);
  await assert.rejects(
    saveWeeklyReflection({ ...duplicate, selectedActivities: [duplicate.selectedActivities[0], duplicate.selectedActivities[0]] }, { storage, locks }),
    (error: unknown) => error instanceof WeeklyReflectionStoreError && error.code === "INPUT_INVALID",
  );
});

test("Monday starts another reflection week across month and year boundaries", async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  await saveWeeklyReflection(input(localDate(2027, 0, 3), "日曜の挑戦", 0), { storage, locks });
  await saveWeeklyReflection(input(localDate(2027, 0, 4), "月曜の挑戦", 0), { storage, locks });
  const loaded = loadWeeklyReflectionStore(storage);
  assert.equal(loaded.reflections.length, 2);
  assert.notEqual(loaded.reflections[0].weekKey, loaded.reflections[1].weekKey);
});

test("reflection navigation allows next week but never the week after next", () => {
  const now = localDate(2026, 10, 13);
  const current = getWeeklyReflectionNavigation(localDate(2026, 10, 9), now);
  assert.deepEqual(current, {
    isCurrentWeek: true,
    isFutureWeek: false,
    isNextWeek: false,
    canMoveNext: true,
  });
  const next = getWeeklyReflectionNavigation(localDate(2026, 10, 16), now);
  assert.deepEqual(next, {
    isCurrentWeek: false,
    isFutureWeek: true,
    isNextWeek: true,
    canMoveNext: false,
  });
  const past = getWeeklyReflectionNavigation(localDate(2026, 10, 2), now);
  assert.equal(past.isFutureWeek, false);
  assert.equal(past.canMoveNext, true);
});

test("next-week navigation works across a year boundary", () => {
  const now = localDate(2026, 11, 31);
  const next = getWeeklyReflectionNavigation(localDate(2027, 0, 4), now);
  assert.equal(next.isNextWeek, true);
  assert.equal(next.isFutureWeek, true);
  assert.equal(next.canMoveNext, false);
});

test("save failure restores the reflection key and never changes records or settlement", async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  storage.setItem("watashi-to-ai-weekly-records:v1", "records-snapshot");
  storage.setItem("watashi-to-ai-weekly-settlements:v1", "settlement-snapshot");
  const failureAt = storage.setCount + 1;
  storage.failOnSetNumber = failureAt;
  await assert.rejects(
    saveWeeklyReflection(input(localDate(2026, 10, 12), "挑戦", 0), { storage, locks }),
    (error: unknown) => error instanceof WeeklyReflectionStoreError && error.code === "SAVE_FAILED",
  );
  assert.equal(storage.getItem(WEEKLY_REFLECTIONS_STORAGE_KEY), null);
  assert.equal(storage.getItem("watashi-to-ai-weekly-records:v1"), "records-snapshot");
  assert.equal(storage.getItem("watashi-to-ai-weekly-settlements:v1"), "settlement-snapshot");
});

test("invalid reflection data is rejected and not overwritten", async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  storage.setItem(WEEKLY_REFLECTIONS_STORAGE_KEY, "{\"schemaVersion\":1,\"reflections\":\"broken\"}");
  const snapshot = storage.getItem(WEEKLY_REFLECTIONS_STORAGE_KEY);
  assert.throws(
    () => loadWeeklyReflectionStore(storage),
    (error: unknown) => error instanceof WeeklyReflectionStoreError && error.code === "STORE_INVALID",
  );
  await assert.rejects(
    saveWeeklyReflection(input(localDate(2026, 10, 12), "挑戦", 0), { storage, locks }),
    (error: unknown) => error instanceof WeeklyReflectionStoreError && error.code === "STORE_INVALID",
  );
  assert.equal(storage.getItem(WEEKLY_REFLECTIONS_STORAGE_KEY), snapshot);
});
