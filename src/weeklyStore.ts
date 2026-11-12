import {
  buildManualWeeklyRecord,
  parseConversationContent,
  parseWeeklyRecord,
  type ManualWeeklyRecordInput,
  type TaskV1,
  type WeeklyConversationContentV1,
  type WeeklyRecordV1,
} from "./weeklyData.ts";

export const WEEKLY_RECORDS_STORAGE_KEY = "watashi-to-ai-weekly-records:v1";
export const WEEKLY_CONVERSATIONS_STORAGE_KEY = "watashi-to-ai-weekly-conversations:v1";
export const WEEKLY_RECORDS_LOCK = "watashi-to-ai-weekly-records-mutation";

export type WeeklyRecordStoreV1 = Readonly<{
  schemaVersion: 1;
  records: readonly WeeklyRecordV1[];
  tasks: readonly TaskV1[];
}>;

export type WeeklyConversationStoreV1 = Readonly<{
  schemaVersion: 1;
  conversations: readonly WeeklyConversationContentV1[];
}>;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type LockManagerLike = {
  request<T>(name: string, options: { mode: "exclusive" }, callback: () => Promise<T> | T): Promise<T>;
};

export type WeeklyStoreOptions = Readonly<{
  storage?: StorageLike;
  locks?: LockManagerLike | null;
}>;

export type SaveManualWeeklyRecordResult = Readonly<{
  persisted: boolean;
  inserted: boolean;
  deduplicated: boolean;
  record: WeeklyRecordV1 | null;
  store: WeeklyRecordStoreV1;
}>;

export class WeeklyStoreError extends Error {
  readonly code: "STORE_INVALID" | "LOCK_UNAVAILABLE" | "SAVE_FAILED" | "UNKNOWN_RECORD";

  constructor(code: WeeklyStoreError["code"], message: string) {
    super(message);
    this.name = "WeeklyStoreError";
    this.code = code;
  }
}

export function loadWeeklyRecordStore(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): WeeklyRecordStoreV1 {
  const raw = storage.getItem(WEEKLY_RECORDS_STORAGE_KEY);
  if (raw === null) return emptyRecordStore();
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return invalidStore("週次記録を読み込めませんでした。"); }
  if (!isObject(value) || value.schemaVersion !== 1 || !Array.isArray(value.records) || !Array.isArray(value.tasks)) {
    return invalidStore("週次記録の保存形式が正しくありません。");
  }
  let records: WeeklyRecordV1[];
  try { records = value.records.map(parseWeeklyRecord); } catch { return invalidStore("週次記録の内容が正しくありません。"); }
  if (new Set(records.map((record) => record.id)).size !== records.length) invalidStore("週次記録IDが重複しています。");
  const sourceIds = records.map((record) => record.sourceEventId).filter((id): id is string => id !== null);
  if (new Set(sourceIds).size !== sourceIds.length) invalidStore("週次取込IDが重複しています。");
  const tasks = value.tasks.map(parseTask);
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) invalidStore("週次課題IDが重複しています。");
  return freezeRecordStore(records, tasks);
}

export function loadWeeklyConversationStore(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): WeeklyConversationStoreV1 {
  const raw = storage.getItem(WEEKLY_CONVERSATIONS_STORAGE_KEY);
  if (raw === null) return emptyConversationStore();
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return invalidStore("週次会話を読み込めませんでした。"); }
  if (!isObject(value) || value.schemaVersion !== 1 || !Array.isArray(value.conversations)) {
    return invalidStore("週次会話の保存形式が正しくありません。");
  }
  let conversations: WeeklyConversationContentV1[];
  try { conversations = value.conversations.map(parseConversationContent); } catch { return invalidStore("週次会話の内容が正しくありません。"); }
  if (new Set(conversations.map((item) => item.id)).size !== conversations.length
    || new Set(conversations.map((item) => item.recordId)).size !== conversations.length) {
    invalidStore("週次会話が重複しています。");
  }
  return Object.freeze({ schemaVersion: 1, conversations: Object.freeze(conversations) });
}

export async function saveManualWeeklyRecord(
  input: ManualWeeklyRecordInput,
  options: WeeklyStoreOptions = {},
): Promise<SaveManualWeeklyRecordResult> {
  if (input.privacy === "off") {
    return Object.freeze({
      persisted: false,
      inserted: false,
      deduplicated: false,
      record: null,
      store: loadWeeklyRecordStore(options.storage),
    });
  }
  const built = buildManualWeeklyRecord(input);
  return withMutation<SaveManualWeeklyRecordResult>(options, (store, contents) => {
    const duplicateSource = built.record.sourceEventId === null ? undefined : store.records.find(
      (record) => record.sourceEventId === built.record.sourceEventId && record.id !== built.record.id,
    );
    if (duplicateSource) {
      return {
        nextStore: store,
        nextContents: contents,
        result: Object.freeze({ persisted: true, inserted: false, deduplicated: true, record: duplicateSource, store }),
      };
    }
    const existing = store.records.find((record) => record.id === built.record.id);
    const records = existing
      ? store.records.map((record) => record.id === built.record.id ? built.record : record)
      : [...store.records, built.record];
    const conversations = contents.conversations.filter((item) => item.recordId !== built.record.id);
    if (built.conversation) conversations.push(built.conversation);
    const nextStore = freezeRecordStore(records, store.tasks);
    const nextContents = Object.freeze({ schemaVersion: 1 as const, conversations: Object.freeze(conversations) });
    return {
      nextStore,
      nextContents,
      result: Object.freeze({
        persisted: true,
        inserted: !existing,
        deduplicated: false,
        record: built.record,
        store: nextStore,
      }),
    };
  });
}

export async function deleteWeeklyRecord(
  recordId: string,
  options: WeeklyStoreOptions = {},
): Promise<WeeklyRecordStoreV1> {
  return withMutation(options, (store, contents) => {
    if (!store.records.some((record) => record.id === recordId)) {
      throw new WeeklyStoreError("UNKNOWN_RECORD", "削除する週次記録が見つかりません。");
    }
    const nextStore = freezeRecordStore(store.records.filter((record) => record.id !== recordId), store.tasks);
    const nextContents = Object.freeze({
      schemaVersion: 1 as const,
      conversations: Object.freeze(contents.conversations.filter((item) => item.recordId !== recordId)),
    });
    return { nextStore, nextContents, result: nextStore };
  });
}

async function withMutation<T>(
  options: WeeklyStoreOptions,
  mutation: (
    store: WeeklyRecordStoreV1,
    contents: WeeklyConversationStoreV1,
  ) => { nextStore: WeeklyRecordStoreV1; nextContents: WeeklyConversationStoreV1; result: T },
): Promise<T> {
  const storage = options.storage ?? window.localStorage;
  const locks = options.locks === null
    ? undefined
    : options.locks ?? globalThis.navigator?.locks as unknown as LockManagerLike | undefined;
  if (!locks?.request) throw new WeeklyStoreError("LOCK_UNAVAILABLE", "安全な排他制御を利用できないため保存できません。");
  return locks.request(WEEKLY_RECORDS_LOCK, { mode: "exclusive" }, async () => {
    const current = loadWeeklyRecordStore(storage);
    const currentContents = loadWeeklyConversationStore(storage);
    const { nextStore, nextContents, result } = mutation(current, currentContents);
    if (nextStore === current && nextContents === currentContents) return result;
    saveBoth(storage, nextStore, nextContents);
    return result;
  });
}

function saveBoth(storage: StorageLike, store: WeeklyRecordStoreV1, contents: WeeklyConversationStoreV1) {
  const previousStore = storage.getItem(WEEKLY_RECORDS_STORAGE_KEY);
  const previousContents = storage.getItem(WEEKLY_CONVERSATIONS_STORAGE_KEY);
  const serializedStore = JSON.stringify(store);
  const serializedContents = JSON.stringify(contents);
  try {
    storage.setItem(WEEKLY_RECORDS_STORAGE_KEY, serializedStore);
    storage.setItem(WEEKLY_CONVERSATIONS_STORAGE_KEY, serializedContents);
    if (storage.getItem(WEEKLY_RECORDS_STORAGE_KEY) !== serializedStore
      || storage.getItem(WEEKLY_CONVERSATIONS_STORAGE_KEY) !== serializedContents) throw new Error("Verification failed.");
  } catch {
    restore(storage, WEEKLY_RECORDS_STORAGE_KEY, previousStore);
    restore(storage, WEEKLY_CONVERSATIONS_STORAGE_KEY, previousContents);
    throw new WeeklyStoreError("SAVE_FAILED", "週次記録を保存できませんでした。再試行してください。");
  }
}

function restore(storage: StorageLike, key: string, value: string | null) {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch { /* Preserve the original save error. */ }
}

function parseTask(value: unknown): TaskV1 {
  if (!isObject(value) || value.schemaVersion !== 1 || typeof value.id !== "string" || !value.id.trim()
    || typeof value.title !== "string" || typeof value.createdAt !== "string"
    || Number.isNaN(new Date(value.createdAt).getTime())
    || !nullableString(value.goal) || !nullableString(value.delegatedToAi) || !nullableString(value.humanDecision)
    || !(value.plannedAiasLevel === null || [1, 2, 3, 4, 5].includes(value.plannedAiasLevel as number))) {
    return invalidStore("週次課題の内容が正しくありません。");
  }
  return Object.freeze(value as unknown as TaskV1);
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function emptyRecordStore(): WeeklyRecordStoreV1 {
  return freezeRecordStore([], []);
}

function emptyConversationStore(): WeeklyConversationStoreV1 {
  return Object.freeze({ schemaVersion: 1, conversations: Object.freeze([]) });
}

function freezeRecordStore(records: readonly WeeklyRecordV1[], tasks: readonly TaskV1[]): WeeklyRecordStoreV1 {
  return Object.freeze({ schemaVersion: 1, records: Object.freeze([...records]), tasks: Object.freeze([...tasks]) });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidStore(message: string): never {
  throw new WeeklyStoreError("STORE_INVALID", message);
}
