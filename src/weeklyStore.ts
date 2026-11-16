import {
  buildManualWeeklyRecord,
  buildExtensionWeeklyRecord,
  buildWeeklyTask,
  parseConversationContent,
  parseWeeklyRecord,
  type ManualWeeklyRecordInput,
  type ExtensionWeeklyRecordInput,
  type BuiltManualWeeklyRecord,
  type TaskV1,
  type WeeklyTaskInput,
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
  readonly code: "STORE_INVALID" | "LOCK_UNAVAILABLE" | "SAVE_FAILED" | "UNKNOWN_RECORD" | "UNKNOWN_TASK" | "TASK_IN_USE" | "USAGE_ALREADY_LINKED" | "DUPLICATE_CONFLICT";

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
    const current = loadWeeklyRecordStore(options.storage);
    if (current.records.some((record) => record.id === input.id)) {
      const store = await removeWeeklyRecord(input.id, options);
      return Object.freeze({
        persisted: false,
        inserted: false,
        deduplicated: false,
        record: null,
        store,
      });
    }
    return Object.freeze({
      persisted: false,
      inserted: false,
      deduplicated: false,
      record: null,
      store: loadWeeklyRecordStore(options.storage),
    });
  }
  const built = buildManualWeeklyRecord(input);
  return saveBuiltWeeklyRecord(built, options, false);
}

export async function saveExtensionWeeklyRecord(
  input: ExtensionWeeklyRecordInput,
  options: WeeklyStoreOptions = {},
): Promise<SaveManualWeeklyRecordResult> {
  const built = buildExtensionWeeklyRecord(input);
  return saveBuiltWeeklyRecord(built, options, true);
}

function saveBuiltWeeklyRecord(
  built: BuiltManualWeeklyRecord,
  options: WeeklyStoreOptions,
  immutableImport: boolean,
): Promise<SaveManualWeeklyRecordResult> {
  return withMutation<SaveManualWeeklyRecordResult>(options, (store, contents) => {
    const existingBySource = built.record.sourceEventId === null ? undefined : store.records.find(
      (record) => record.sourceEventId === built.record.sourceEventId,
    );
    if (existingBySource && existingBySource.id !== built.record.id) {
      const existingConversation = contents.conversations.find((item) => item.recordId === existingBySource.id) ?? null;
      if (!sameImportedContent(existingBySource, existingConversation, built)) {
        throw new WeeklyStoreError("DUPLICATE_CONFLICT", "同じ会話取込IDに異なる内容が指定されています。既存記録は変更していません。");
      }
      return {
        nextStore: store,
        nextContents: contents,
        result: Object.freeze({ persisted: true, inserted: false, deduplicated: true, record: existingBySource, store }),
      };
    }
    const linkedUsage = immutableImport ? store.records.find(
      (record) => record.id !== built.record.id
        && record.timeSource === "measured"
        && record.sessionId === built.record.sessionId,
    ) : undefined;
    if (linkedUsage) {
      throw new WeeklyStoreError("USAGE_ALREADY_LINKED", "選択した実測時間は別の週次活動に関連付け済みです。");
    }
    const existing = store.records.find((record) => record.id === built.record.id);
    if (immutableImport && existing) {
      const existingConversation = contents.conversations.find((item) => item.recordId === existing.id) ?? null;
      if (!sameImportedContent(existing, existingConversation, built)) {
        throw new WeeklyStoreError("DUPLICATE_CONFLICT", "取り込み済みの会話または時間と内容が一致しません。既存記録は変更していません。");
      }
      return {
        nextStore: store,
        nextContents: contents,
        result: Object.freeze({ persisted: true, inserted: false, deduplicated: true, record: existing, store }),
      };
    }
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

function sameImportedContent(
  existing: WeeklyRecordV1,
  existingConversation: WeeklyConversationContentV1 | null,
  built: BuiltManualWeeklyRecord,
) {
  const comparableRecord = (record: WeeklyRecordV1) => ({
    sourceEventId: record.sourceEventId,
    origin: record.origin,
    sessionId: record.sessionId,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    activeSeconds: record.activeSeconds,
    timeSource: record.timeSource,
    aiService: record.aiService,
    privacy: record.privacy,
    taskId: record.taskId,
    activityCategory: record.activityCategory,
    accountingDisposition: record.accountingDisposition,
    selfReflection: record.selfReflection,
    manualNotes: record.manualNotes,
  });
  const comparableConversation = (conversation: WeeklyConversationContentV1 | null) => conversation === null ? null : ({
    title: conversation.title,
    captureScope: conversation.captureScope,
    messages: conversation.messages,
    source: conversation.source,
  });
  return JSON.stringify(comparableRecord(existing)) === JSON.stringify(comparableRecord(built.record))
    && JSON.stringify(comparableConversation(existingConversation)) === JSON.stringify(comparableConversation(built.conversation));
}

export async function deleteWeeklyRecord(
  recordId: string,
  options: WeeklyStoreOptions = {},
): Promise<WeeklyRecordStoreV1> {
  return removeWeeklyRecord(recordId, options);
}

export async function saveWeeklyTask(
  input: WeeklyTaskInput,
  options: WeeklyStoreOptions = {},
): Promise<WeeklyRecordStoreV1> {
  const task = buildWeeklyTask(input);
  return withMutation(options, (store, contents) => {
    const existing = store.tasks.find((item) => item.id === task.id);
    if (existing && store.records.some((record) => record.taskId === task.id)
      && (existing.plannedAiasLevel !== task.plannedAiasLevel
        || existing.activityCategory !== task.activityCategory
        || existing.delegatedToAi !== task.delegatedToAi)) {
      throw new WeeklyStoreError("TASK_IN_USE", "活動開始後はAIAS Level・活動テーマ・AIの役割を変更できません。");
    }
    const tasks = existing
      ? store.tasks.map((item) => item.id === task.id ? task : item)
      : [...store.tasks, task];
    const nextStore = freezeRecordStore(store.records, tasks);
    return { nextStore, nextContents: contents, result: nextStore };
  });
}

export async function deleteWeeklyTask(
  taskId: string,
  options: WeeklyStoreOptions = {},
): Promise<WeeklyRecordStoreV1> {
  return withMutation(options, (store, contents) => {
    if (!store.tasks.some((task) => task.id === taskId)) {
      throw new WeeklyStoreError("UNKNOWN_TASK", "削除する課題設定が見つかりません。");
    }
    if (store.records.some((record) => record.taskId === taskId)) {
      throw new WeeklyStoreError("TASK_IN_USE", "活動記録に使われている課題設定は削除できません。");
    }
    const nextStore = freezeRecordStore(store.records, store.tasks.filter((task) => task.id !== taskId));
    return { nextStore, nextContents: contents, result: nextStore };
  });
}

async function removeWeeklyRecord(
  recordId: string,
  options: WeeklyStoreOptions,
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
    || !(value.plannedAiasLevel === null || [1, 2, 3, 4, 5].includes(value.plannedAiasLevel as number))
    || !isActivityCategory(value.activityCategory)) {
    return invalidStore("週次課題の内容が正しくありません。");
  }
  return Object.freeze({
    ...(value as unknown as TaskV1),
    activityCategory: (value.activityCategory ?? null) as TaskV1["activityCategory"],
  });
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isActivityCategory(value: unknown) {
  return value === undefined || value === null
    || ["相談", "壁打ち", "文章作成", "情報収集", "学習", "その他"].includes(value as string);
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
