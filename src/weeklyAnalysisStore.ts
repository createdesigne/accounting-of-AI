import {
  assertWeeklyAnalysisResponseLinks,
  fingerprintConversation,
} from "./integrations/weeklyAnalysisAdapter.ts";
import {
  parseWeeklyAnalysisRequestV1,
  parseWeeklyAnalysisResponseV1,
  type WeeklyAnalysisRequestV1,
  type WeeklyAnalysisResponseV1,
} from "./integrations/weeklyAnalysisContract.ts";
import type { WeeklyConversationContentV1, WeeklyRecordV1 } from "./weeklyData.ts";
import {
  loadWeeklyConversationStore,
  loadWeeklyRecordStore,
} from "./weeklyStore.ts";

export const WEEKLY_ANALYSES_STORAGE_KEY = "watashi-to-ai-weekly-analyses:v1";
export const WEEKLY_ANALYSES_LOCK = "watashi-to-ai-weekly-analyses-mutation";

export type WeeklyAnalysisEntryV1 = Readonly<{
  schemaVersion: 1;
  requestId: string;
  recordId: string;
  conversationId: string;
  thoughtReceiptId: string;
  conversationFingerprint: string;
  requestedAt: string;
  analysisStatus: "pending" | "complete" | "failed";
  response: WeeklyAnalysisResponseV1 | null;
}>;

export type WeeklyAnalysisStoreV1 = Readonly<{
  schemaVersion: 1;
  entries: readonly WeeklyAnalysisEntryV1[];
}>;

export type WeeklyAnalysisDisplayState = Readonly<{
  analysisStatus: "not-connected" | "pending" | "complete" | "failed" | "not-applicable";
  response: WeeklyAnalysisResponseV1 | null;
}>;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type LockManagerLike = {
  request<T>(name: string, options: { mode: "exclusive" }, callback: () => Promise<T> | T): Promise<T>;
};

export type WeeklyAnalysisStoreOptions = Readonly<{
  storage?: StorageLike;
  locks?: LockManagerLike | null;
}>;

export type WeeklyAnalysisMutationResult = Readonly<{
  inserted: boolean;
  deduplicated: boolean;
  entry: WeeklyAnalysisEntryV1;
  store: WeeklyAnalysisStoreV1;
}>;

export class WeeklyAnalysisStoreError extends Error {
  readonly code:
    | "STORE_INVALID"
    | "LOCK_UNAVAILABLE"
    | "SAVE_FAILED"
    | "LINK_MISMATCH"
    | "UNKNOWN_REQUEST"
    | "DUPLICATE_CONFLICT";

  constructor(code: WeeklyAnalysisStoreError["code"], message: string) {
    super(message);
    this.name = "WeeklyAnalysisStoreError";
    this.code = code;
  }
}

export function loadWeeklyAnalysisStore(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): WeeklyAnalysisStoreV1 {
  const raw = storage.getItem(WEEKLY_ANALYSES_STORAGE_KEY);
  if (raw === null) return emptyStore();
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return invalidStore("週次分析結果を読み込めませんでした。"); }
  if (!isObject(value) || value.schemaVersion !== 1 || !Array.isArray(value.entries)) {
    return invalidStore("週次分析結果の保存形式が正しくありません。");
  }
  const entries = value.entries.map(parseEntry);
  if (new Set(entries.map((entry) => entry.requestId)).size !== entries.length) {
    return invalidStore("週次分析リクエストIDが重複しています。");
  }
  const analysisIds = entries.flatMap((entry) => entry.response ? [entry.response.analysisId] : []);
  if (new Set(analysisIds).size !== analysisIds.length) {
    return invalidStore("週次分析結果IDが重複しています。");
  }
  return freezeStore(entries);
}

/** Saves only request metadata. Conversation messages are not duplicated in this store. */
export async function queueWeeklyAnalysisRequest(
  input: unknown,
  options: WeeklyAnalysisStoreOptions = {},
): Promise<WeeklyAnalysisMutationResult> {
  const request = parseWeeklyAnalysisRequestV1(input);
  return withMutation<WeeklyAnalysisMutationResult>(options, (store, storage) => {
    assertRequestMatchesCurrentData(request, storage);
    const existing = store.entries.find((entry) => entry.requestId === request.requestId);
    if (existing) {
      if (!sameRequestMetadata(existing, request)) {
        throw new WeeklyAnalysisStoreError("DUPLICATE_CONFLICT", "同じリクエストIDに異なる内容は保存できません。");
      }
      return {
        nextStore: store,
        result: Object.freeze({ inserted: false, deduplicated: true, entry: existing, store }),
      };
    }
    const entry = freezeEntry({
      schemaVersion: 1,
      requestId: request.requestId,
      recordId: request.recordId,
      conversationId: request.conversationId,
      thoughtReceiptId: request.thoughtReceiptId,
      conversationFingerprint: request.conversationFingerprint,
      requestedAt: request.requestedAt,
      analysisStatus: "pending",
      response: null,
    });
    const nextStore = freezeStore([...store.entries, entry]);
    return {
      nextStore,
      result: Object.freeze({ inserted: true, deduplicated: false, entry, store: nextStore }),
    };
  });
}

/** Accepts already-received JSON. It never invokes Gemini or any other external service. */
export async function acceptWeeklyAnalysisResponse(
  input: unknown,
  options: WeeklyAnalysisStoreOptions = {},
): Promise<WeeklyAnalysisMutationResult> {
  const response = parseWeeklyAnalysisResponseV1(input);
  return withMutation<WeeklyAnalysisMutationResult>(options, (store, storage) => {
    const current = store.entries.find((entry) => entry.requestId === response.requestId);
    if (!current) {
      throw new WeeklyAnalysisStoreError("UNKNOWN_REQUEST", "対応する分析待ちリクエストがありません。");
    }
    if (!responseMatchesEntry(response, current)) {
      throw new WeeklyAnalysisStoreError("LINK_MISMATCH", "分析結果の関連IDまたは会話版が一致しません。");
    }
    const duplicateAnalysis = store.entries.find(
      (entry) => entry.response?.analysisId === response.analysisId && entry.requestId !== response.requestId,
    );
    if (duplicateAnalysis) {
      throw new WeeklyAnalysisStoreError("DUPLICATE_CONFLICT", "同じ分析結果IDを別の活動へ保存できません。");
    }
    if (current.response) {
      if (JSON.stringify(current.response) !== JSON.stringify(response)) {
        throw new WeeklyAnalysisStoreError("DUPLICATE_CONFLICT", "確定済みの分析結果を同じリクエストIDで上書きできません。");
      }
      return {
        nextStore: store,
        result: Object.freeze({ inserted: false, deduplicated: true, entry: current, store }),
      };
    }
    const recordStore = loadWeeklyRecordStore(storage);
    const conversationStore = loadWeeklyConversationStore(storage);
    const record = recordStore.records.find((item) => item.id === response.recordId);
    const conversation = conversationStore.conversations.find((item) => item.id === response.conversationId);
    if (!record || !conversation || record.analysisStatus === "not-applicable") {
      throw new WeeklyAnalysisStoreError("LINK_MISMATCH", "分析対象の活動記録または会話が見つかりません。");
    }
    assertWeeklyAnalysisResponseLinks(response, record, conversation);
    const entry = freezeEntry({
      ...current,
      analysisStatus: response.analysisStatus,
      response,
    });
    const nextStore = freezeStore(store.entries.map((item) => item.requestId === response.requestId ? entry : item));
    return {
      nextStore,
      result: Object.freeze({ inserted: true, deduplicated: false, entry, store: nextStore }),
    };
  });
}

export function resolveWeeklyAnalysisState(
  record: WeeklyRecordV1,
  store: WeeklyAnalysisStoreV1,
  conversation: WeeklyConversationContentV1 | null,
): WeeklyAnalysisDisplayState {
  if (record.analysisStatus === "not-applicable") {
    return Object.freeze({ analysisStatus: "not-applicable", response: null });
  }
  const latest = store.entries
    .filter((entry) => entry.recordId === record.id)
    .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt))[0];
  if (!latest) return Object.freeze({ analysisStatus: "not-connected", response: null });
  if (!conversation || latest.conversationId !== conversation.id
    || latest.conversationFingerprint !== fingerprintConversation(conversation)) {
    return Object.freeze({ analysisStatus: "not-connected", response: null });
  }
  return Object.freeze({ analysisStatus: latest.analysisStatus, response: latest.response });
}

async function withMutation<T>(
  options: WeeklyAnalysisStoreOptions,
  mutation: (
    store: WeeklyAnalysisStoreV1,
    storage: StorageLike,
  ) => { nextStore: WeeklyAnalysisStoreV1; result: T },
): Promise<T> {
  const storage = options.storage ?? window.localStorage;
  const locks = options.locks === null
    ? undefined
    : options.locks ?? globalThis.navigator?.locks as unknown as LockManagerLike | undefined;
  if (!locks?.request) {
    throw new WeeklyAnalysisStoreError("LOCK_UNAVAILABLE", "安全な排他制御を利用できないため分析結果を保存できません。");
  }
  return locks.request(WEEKLY_ANALYSES_LOCK, { mode: "exclusive" }, async () => {
    const current = loadWeeklyAnalysisStore(storage);
    const { nextStore, result } = mutation(current, storage);
    if (nextStore === current) return result;
    saveStore(storage, nextStore);
    return result;
  });
}

function assertRequestMatchesCurrentData(request: WeeklyAnalysisRequestV1, storage: StorageLike) {
  const recordStore = loadWeeklyRecordStore(storage);
  const conversationStore = loadWeeklyConversationStore(storage);
  const record = recordStore.records.find((item) => item.id === request.recordId);
  const conversation = conversationStore.conversations.find((item) => item.id === request.conversationId);
  const task = request.taskContext.taskId
    ? recordStore.tasks.find((item) => item.id === request.taskContext.taskId)
    : null;
  if (!record || !conversation || record.privacy !== "full" || record.analysisStatus === "not-applicable"
    || record.links.conversationId !== conversation.id || conversation.recordId !== record.id
    || record.links.thoughtReceiptId !== request.thoughtReceiptId
    || request.conversationFingerprint !== fingerprintConversation(conversation)
    || record.taskId !== request.taskContext.taskId
    || record.activityCategory !== request.taskContext.activityCategory
    || (record.taskId !== null && (!task || task.plannedAiasLevel !== request.taskContext.plannedAiasLevel
      || task.delegatedToAi !== request.taskContext.expectedAiRole))
    || task?.plannedAiasLevel === 1) {
    throw new WeeklyAnalysisStoreError("LINK_MISMATCH", "分析リクエストが現在の活動記録と一致しません。");
  }
  if (request.messages.length !== conversation.messages.length
    || request.messages.some((message, index) => message.role !== conversation.messages[index]?.role
      || message.text !== conversation.messages[index]?.text)) {
    throw new WeeklyAnalysisStoreError("LINK_MISMATCH", "分析リクエストの会話内容が保存内容と一致しません。");
  }
}

function parseEntry(value: unknown): WeeklyAnalysisEntryV1 {
  if (!isObject(value) || value.schemaVersion !== 1
    || typeof value.requestId !== "string" || !value.requestId
    || typeof value.recordId !== "string" || !value.recordId
    || typeof value.conversationId !== "string" || !value.conversationId
    || typeof value.thoughtReceiptId !== "string" || !value.thoughtReceiptId
    || typeof value.conversationFingerprint !== "string" || !value.conversationFingerprint
    || typeof value.requestedAt !== "string" || Number.isNaN(new Date(value.requestedAt).getTime())
    || !["pending", "complete", "failed"].includes(value.analysisStatus as string)) {
    return invalidStore("週次分析結果の内容が正しくありません。");
  }
  let response: WeeklyAnalysisResponseV1 | null = null;
  if (value.response !== null) {
    try { response = parseWeeklyAnalysisResponseV1(value.response); } catch {
      return invalidStore("週次分析結果の内容が正しくありません。");
    }
  }
  if ((value.analysisStatus === "pending") !== (response === null)
    || (response && (response.analysisStatus !== value.analysisStatus
      || !responseMatchesEntry(response, value as unknown as WeeklyAnalysisEntryV1)))) {
    return invalidStore("週次分析結果の状態が一致しません。");
  }
  return freezeEntry({
    schemaVersion: 1,
    requestId: value.requestId,
    recordId: value.recordId,
    conversationId: value.conversationId,
    thoughtReceiptId: value.thoughtReceiptId,
    conversationFingerprint: value.conversationFingerprint,
    requestedAt: new Date(value.requestedAt).toISOString(),
    analysisStatus: value.analysisStatus as WeeklyAnalysisEntryV1["analysisStatus"],
    response,
  });
}

function responseMatchesEntry(response: WeeklyAnalysisResponseV1, entry: WeeklyAnalysisEntryV1) {
  return response.requestId === entry.requestId
    && response.recordId === entry.recordId
    && response.conversationId === entry.conversationId
    && response.thoughtReceiptId === entry.thoughtReceiptId
    && response.conversationFingerprint === entry.conversationFingerprint;
}

function sameRequestMetadata(entry: WeeklyAnalysisEntryV1, request: WeeklyAnalysisRequestV1) {
  return entry.requestId === request.requestId
    && entry.recordId === request.recordId
    && entry.conversationId === request.conversationId
    && entry.thoughtReceiptId === request.thoughtReceiptId
    && entry.conversationFingerprint === request.conversationFingerprint
    && entry.requestedAt === request.requestedAt;
}

function saveStore(storage: StorageLike, store: WeeklyAnalysisStoreV1) {
  const previous = storage.getItem(WEEKLY_ANALYSES_STORAGE_KEY);
  const serialized = JSON.stringify(store);
  try {
    storage.setItem(WEEKLY_ANALYSES_STORAGE_KEY, serialized);
    if (storage.getItem(WEEKLY_ANALYSES_STORAGE_KEY) !== serialized) throw new Error("Verification failed.");
  } catch {
    try {
      if (previous === null) storage.removeItem(WEEKLY_ANALYSES_STORAGE_KEY);
      else storage.setItem(WEEKLY_ANALYSES_STORAGE_KEY, previous);
    } catch { /* Preserve the original save error. */ }
    throw new WeeklyAnalysisStoreError("SAVE_FAILED", "週次分析結果を保存できませんでした。");
  }
}

function freezeEntry(entry: WeeklyAnalysisEntryV1): WeeklyAnalysisEntryV1 {
  return Object.freeze({ ...entry });
}

function freezeStore(entries: readonly WeeklyAnalysisEntryV1[]): WeeklyAnalysisStoreV1 {
  return Object.freeze({ schemaVersion: 1, entries: Object.freeze([...entries]) });
}

function emptyStore(): WeeklyAnalysisStoreV1 {
  return freezeStore([]);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidStore(message: string): never {
  throw new WeeklyAnalysisStoreError("STORE_INVALID", message);
}
