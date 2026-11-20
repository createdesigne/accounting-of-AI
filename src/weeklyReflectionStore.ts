import { dateKey, periodBounds, shiftPeriod } from "./ledgerPeriods.ts";

export const WEEKLY_REFLECTIONS_STORAGE_KEY = "watashi-to-ai-weekly-reflections:v1";
export const WEEKLY_REFLECTIONS_LOCK = "watashi-to-ai-weekly-reflections-mutation";

export type WeeklyReflectionActivityRefV1 = Readonly<{
  recordId: string;
  thoughtReceiptId: string;
}>;

export type WeeklyReflectionV1 = Readonly<{
  schemaVersion: 1;
  weekKey: string;
  weekStart: string;
  weekEndExclusive: string;
  discoveryLearning: string;
  humanJudgment: string;
  relationshipReflection: string;
  nextWeekChallenge: string;
  selectedActivities: readonly WeeklyReflectionActivityRefV1[];
  updatedAt: string;
}>;

export type WeeklyReflectionStoreV1 = Readonly<{
  schemaVersion: 1;
  reflections: readonly WeeklyReflectionV1[];
}>;

export type SaveWeeklyReflectionInput = Readonly<{
  anchor: Date;
  discoveryLearning: string;
  humanJudgment: string;
  relationshipReflection: string;
  nextWeekChallenge: string;
  selectedActivities: readonly WeeklyReflectionActivityRefV1[];
}>;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type LockManagerLike = {
  request<T>(name: string, options: { mode: "exclusive" }, callback: () => Promise<T> | T): Promise<T>;
};

export type WeeklyReflectionStoreOptions = Readonly<{
  storage?: StorageLike;
  locks?: LockManagerLike | null;
  now?: () => Date;
}>;

export type WeeklyReflectionNavigation = Readonly<{
  isCurrentWeek: boolean;
  isFutureWeek: boolean;
  isNextWeek: boolean;
  canMoveNext: boolean;
}>;

export class WeeklyReflectionStoreError extends Error {
  readonly code: "STORE_INVALID" | "INPUT_INVALID" | "LOCK_UNAVAILABLE" | "SAVE_FAILED";

  constructor(code: WeeklyReflectionStoreError["code"], message: string) {
    super(message);
    this.name = "WeeklyReflectionStoreError";
    this.code = code;
  }
}

export function loadWeeklyReflectionStore(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): WeeklyReflectionStoreV1 {
  const raw = storage.getItem(WEEKLY_REFLECTIONS_STORAGE_KEY);
  if (raw === null) return emptyWeeklyReflectionStore();
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return invalidStore(); }
  if (!isObject(value) || value.schemaVersion !== 1 || !Array.isArray(value.reflections)) return invalidStore();
  const seenWeeks = new Set<string>();
  const reflections = value.reflections.map((candidate) => {
    const reflection = parseReflection(candidate);
    if (seenWeeks.has(reflection.weekKey)) return invalidStore();
    seenWeeks.add(reflection.weekKey);
    return reflection;
  });
  return freezeStore(reflections);
}

export function reflectionForWeek(
  store: WeeklyReflectionStoreV1,
  anchor: Date,
): WeeklyReflectionV1 | null {
  const weekKey = dateKey(periodBounds(anchor, "weekly").start);
  return store.reflections.find((reflection) => reflection.weekKey === weekKey) ?? null;
}

export function previousWeekReflection(
  store: WeeklyReflectionStoreV1,
  anchor: Date,
): WeeklyReflectionV1 | null {
  return reflectionForWeek(store, shiftPeriod(anchor, "weekly", -1));
}

export function getWeeklyReflectionNavigation(
  anchor: Date,
  now = new Date(),
): WeeklyReflectionNavigation {
  if (Number.isNaN(anchor.getTime()) || Number.isNaN(now.getTime())) return invalidInput("対象週が正しくありません。");
  const selectedStart = periodBounds(anchor, "weekly").start;
  const currentStart = periodBounds(now, "weekly").start;
  const nextStart = periodBounds(shiftPeriod(now, "weekly", 1), "weekly").start;
  const selectedTime = selectedStart.getTime();
  const currentTime = currentStart.getTime();
  const nextTime = nextStart.getTime();
  return Object.freeze({
    isCurrentWeek: selectedTime === currentTime,
    isFutureWeek: selectedTime > currentTime,
    isNextWeek: selectedTime === nextTime,
    canMoveNext: selectedTime < nextTime,
  });
}

export async function saveWeeklyReflection(
  input: SaveWeeklyReflectionInput,
  options: WeeklyReflectionStoreOptions = {},
): Promise<Readonly<{ reflection: WeeklyReflectionV1; store: WeeklyReflectionStoreV1 }>> {
  const normalized = normalizeInput(input, options.now?.() ?? new Date());
  const storage = options.storage ?? window.localStorage;
  const locks = options.locks === null
    ? undefined
    : options.locks ?? globalThis.navigator?.locks as unknown as LockManagerLike | undefined;
  if (!locks?.request) {
    throw new WeeklyReflectionStoreError("LOCK_UNAVAILABLE", "安全な排他制御を利用できないため振り返りを保存できません。");
  }
  return locks.request(WEEKLY_REFLECTIONS_LOCK, { mode: "exclusive" }, () => {
    const current = loadWeeklyReflectionStore(storage);
    const reflections = current.reflections.some((item) => item.weekKey === normalized.weekKey)
      ? current.reflections.map((item) => item.weekKey === normalized.weekKey ? normalized : item)
      : [...current.reflections, normalized];
    const next = freezeStore(reflections);
    saveStore(storage, next);
    return Object.freeze({ reflection: normalized, store: next });
  });
}

function normalizeInput(input: SaveWeeklyReflectionInput, now: Date): WeeklyReflectionV1 {
  if (!(input.anchor instanceof Date) || Number.isNaN(input.anchor.getTime())) return invalidInput("対象週が正しくありません。");
  if (Number.isNaN(now.getTime())) return invalidInput("更新日時が正しくありません。");
  const bounds = periodBounds(input.anchor, "weekly");
  const selectedActivities = parseActivityRefs(input.selectedActivities, "代表活動");
  return Object.freeze({
    schemaVersion: 1,
    weekKey: dateKey(bounds.start),
    weekStart: bounds.start.toISOString(),
    weekEndExclusive: bounds.end.toISOString(),
    discoveryLearning: normalizeText(input.discoveryLearning, "発見・学び"),
    humanJudgment: normalizeText(input.humanJudgment, "本人の判断・修正"),
    relationshipReflection: normalizeText(input.relationshipReflection, "AIとの関わり方"),
    nextWeekChallenge: normalizeText(input.nextWeekChallenge, "来週の挑戦"),
    selectedActivities,
    updatedAt: now.toISOString(),
  });
}

function parseReflection(value: unknown): WeeklyReflectionV1 {
  if (!isObject(value) || value.schemaVersion !== 1 || !isWeekKey(value.weekKey)
    || typeof value.weekStart !== "string" || Number.isNaN(new Date(value.weekStart).getTime())
    || typeof value.weekEndExclusive !== "string" || Number.isNaN(new Date(value.weekEndExclusive).getTime())
    || typeof value.updatedAt !== "string" || Number.isNaN(new Date(value.updatedAt).getTime())) return invalidStore();
  const start = parseLocalDateKey(value.weekKey);
  const bounds = periodBounds(start, "weekly");
  if (dateKey(bounds.start) !== value.weekKey
    || new Date(value.weekStart).getTime() !== bounds.start.getTime()
    || new Date(value.weekEndExclusive).getTime() !== bounds.end.getTime()) return invalidStore();
  let selectedActivities: readonly WeeklyReflectionActivityRefV1[];
  try { selectedActivities = parseActivityRefs(value.selectedActivities, "代表活動"); } catch { return invalidStore(); }
  return Object.freeze({
    schemaVersion: 1,
    weekKey: value.weekKey,
    weekStart: value.weekStart,
    weekEndExclusive: value.weekEndExclusive,
    discoveryLearning: storedText(value.discoveryLearning),
    humanJudgment: storedText(value.humanJudgment),
    relationshipReflection: storedText(value.relationshipReflection),
    nextWeekChallenge: storedText(value.nextWeekChallenge),
    selectedActivities,
    updatedAt: value.updatedAt,
  });
}

function parseActivityRefs(value: unknown, field: string): readonly WeeklyReflectionActivityRefV1[] {
  if (!Array.isArray(value) || value.length > 3) return invalidInput(`${field}は最大3件です。`);
  const seen = new Set<string>();
  const seenReceipts = new Set<string>();
  const refs = value.map((candidate) => {
    if (!isObject(candidate) || !validIdentifier(candidate.recordId) || !validIdentifier(candidate.thoughtReceiptId)
      || seen.has(candidate.recordId) || seenReceipts.has(candidate.thoughtReceiptId)) {
      return invalidInput(`${field}の関連付けが正しくありません。`);
    }
    seen.add(candidate.recordId);
    seenReceipts.add(candidate.thoughtReceiptId);
    return Object.freeze({ recordId: candidate.recordId, thoughtReceiptId: candidate.thoughtReceiptId });
  });
  return Object.freeze(refs);
}

function normalizeText(value: unknown, field: string) {
  if (typeof value !== "string" || value.length > 10000) return invalidInput(`${field}は10000文字以内で入力してください。`);
  return value.trim();
}

function storedText(value: unknown) {
  if (typeof value !== "string" || value.length > 10000) return invalidStore();
  return value;
}

function saveStore(storage: StorageLike, store: WeeklyReflectionStoreV1) {
  const previous = storage.getItem(WEEKLY_REFLECTIONS_STORAGE_KEY);
  const serialized = JSON.stringify(store);
  try {
    storage.setItem(WEEKLY_REFLECTIONS_STORAGE_KEY, serialized);
    if (storage.getItem(WEEKLY_REFLECTIONS_STORAGE_KEY) !== serialized) throw new Error("Verification failed.");
  } catch {
    try {
      if (previous === null) storage.removeItem(WEEKLY_REFLECTIONS_STORAGE_KEY);
      else storage.setItem(WEEKLY_REFLECTIONS_STORAGE_KEY, previous);
    } catch { /* Preserve the original save error. */ }
    throw new WeeklyReflectionStoreError("SAVE_FAILED", "振り返りを保存できませんでした。再試行してください。");
  }
}

function freezeStore(reflections: readonly WeeklyReflectionV1[]): WeeklyReflectionStoreV1 {
  return Object.freeze({ schemaVersion: 1, reflections: Object.freeze([...reflections]) });
}

function emptyWeeklyReflectionStore(): WeeklyReflectionStoreV1 {
  return freezeStore([]);
}

function parseLocalDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function isWeekKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(parseLocalDateKey(value).getTime());
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 200;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidInput(message: string): never {
  throw new WeeklyReflectionStoreError("INPUT_INVALID", message);
}

function invalidStore(): never {
  throw new WeeklyReflectionStoreError("STORE_INVALID", "振り返りの保存形式が正しくありません。既存データは上書きしていません。");
}
