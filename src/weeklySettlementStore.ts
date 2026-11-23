import { dateKey, periodBounds } from "./ledgerPeriods.ts";
import {
  buildWeeklyJournalEntries,
  buildWeeklySettlement,
  type WeeklyJournalEntry,
  type WeeklySettlementV1,
} from "./weeklyAccounting.ts";
import type { TaskV1, WeeklyRecordV1 } from "./weeklyData.ts";

export const WEEKLY_SETTLEMENTS_STORAGE_KEY = "watashi-to-ai-weekly-settlements:v1";
export const WEEKLY_SETTLEMENTS_LOCK = "watashi-to-ai-weekly-settlements-mutation";

export type WeeklySettlementRevisionV1 = Readonly<{
  schemaVersion: 1;
  id: string;
  weekKey: string;
  confirmedAt: string;
  fingerprint: string;
  settlement: WeeklySettlementV1;
  journalEntries: readonly WeeklyJournalEntry[];
}>;

export type WeeklySettlementHistoryV1 = Readonly<{
  weekKey: string;
  revisions: readonly WeeklySettlementRevisionV1[];
}>;

export type WeeklySettlementStoreV1 = Readonly<{
  schemaVersion: 1;
  weeks: readonly WeeklySettlementHistoryV1[];
}>;

export type WeeklySettlementPreview = Readonly<{
  weekKey: string;
  settlement: WeeklySettlementV1;
  journalEntries: readonly WeeklyJournalEntry[];
  fingerprint: string;
  confirmationStatus: "unconfirmed" | "confirmed" | "needs-reconfirmation";
  revisions: readonly WeeklySettlementRevisionV1[];
  latestRevision: WeeklySettlementRevisionV1 | null;
}>;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type LockManagerLike = {
  request<T>(name: string, options: { mode: "exclusive" }, callback: () => Promise<T> | T): Promise<T>;
};

export type WeeklySettlementStoreOptions = Readonly<{
  storage?: StorageLike;
  locks?: LockManagerLike | null;
  now?: () => Date;
}>;

export type ConfirmWeeklySettlementResult = Readonly<{
  inserted: boolean;
  revision: WeeklySettlementRevisionV1;
  store: WeeklySettlementStoreV1;
}>;

export class WeeklySettlementStoreError extends Error {
  readonly code: "STORE_INVALID" | "LOCK_UNAVAILABLE" | "SAVE_FAILED" | "UNBALANCED_SETTLEMENT";

  constructor(code: WeeklySettlementStoreError["code"], message: string) {
    super(message);
    this.name = "WeeklySettlementStoreError";
    this.code = code;
  }
}

export function loadWeeklySettlementStore(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): WeeklySettlementStoreV1 {
  const raw = storage.getItem(WEEKLY_SETTLEMENTS_STORAGE_KEY);
  if (raw === null) return emptySettlementStore();
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return invalidStore(); }
  if (!isObject(value) || value.schemaVersion !== 1 || !Array.isArray(value.weeks)) return invalidStore();
  const seenWeeks = new Set<string>();
  const weeks = value.weeks.map((candidate) => {
    if (!isObject(candidate) || !isWeekKey(candidate.weekKey) || !Array.isArray(candidate.revisions)
      || seenWeeks.has(candidate.weekKey)) return invalidStore();
    seenWeeks.add(candidate.weekKey);
    const seenRevisions = new Set<string>();
    const revisions = candidate.revisions.map((revision) => {
      if (!isObject(revision) || revision.schemaVersion !== 1 || typeof revision.id !== "string"
        || !revision.id || revision.weekKey !== candidate.weekKey || typeof revision.fingerprint !== "string"
        || !revision.fingerprint || typeof revision.confirmedAt !== "string"
        || Number.isNaN(new Date(revision.confirmedAt).getTime()) || seenRevisions.has(revision.id)
        || !isStoredSettlement(revision.settlement) || !Array.isArray(revision.journalEntries)) return invalidStore();
      seenRevisions.add(revision.id);
      return Object.freeze(revision as unknown as WeeklySettlementRevisionV1);
    });
    return Object.freeze({ weekKey: candidate.weekKey, revisions: Object.freeze(revisions) });
  });
  return Object.freeze({ schemaVersion: 1, weeks: Object.freeze(weeks) });
}

export function previewWeeklySettlement(
  records: readonly WeeklyRecordV1[],
  tasks: readonly TaskV1[],
  anchor: Date,
  historyStore: WeeklySettlementStoreV1 = emptySettlementStore(),
): WeeklySettlementPreview {
  const weekKey = dateKey(periodBounds(anchor, "weekly").start);
  const settlement = buildWeeklySettlement(records, anchor, tasks);
  const journalEntries = buildWeeklyJournalEntries(records, anchor, tasks);
  const fingerprint = fingerprintSettlement(settlement, journalEntries);
  const revisions = historyStore.weeks.find((week) => week.weekKey === weekKey)?.revisions ?? Object.freeze([]);
  const latestRevision = revisions.length > 0 ? revisions[revisions.length - 1] : null;
  const confirmationStatus = latestRevision === null
    ? "unconfirmed"
    : latestRevision.fingerprint === fingerprint ? "confirmed" : "needs-reconfirmation";
  return Object.freeze({
    weekKey,
    settlement,
    journalEntries,
    fingerprint,
    confirmationStatus,
    revisions,
    latestRevision,
  });
}

export async function confirmWeeklySettlement(
  records: readonly WeeklyRecordV1[],
  tasks: readonly TaskV1[],
  anchor: Date,
  options: WeeklySettlementStoreOptions = {},
): Promise<ConfirmWeeklySettlementResult> {
  const storage = options.storage ?? window.localStorage;
  const locks = options.locks === null
    ? undefined
    : options.locks ?? globalThis.navigator?.locks as unknown as LockManagerLike | undefined;
  if (!locks?.request) {
    throw new WeeklySettlementStoreError("LOCK_UNAVAILABLE", "安全な排他制御を利用できないため週次決算を確定できません。");
  }
  return locks.request(WEEKLY_SETTLEMENTS_LOCK, { mode: "exclusive" }, () => {
    const current = loadWeeklySettlementStore(storage);
    const preview = previewWeeklySettlement(records, tasks, anchor, current);
    if (!preview.settlement.trialBalance.isBalanced || !preview.settlement.balanceSheet.isBalanced) {
      throw new WeeklySettlementStoreError("UNBALANCED_SETTLEMENT", "貸借が一致しないため週次決算を確定できません。");
    }
    if (preview.latestRevision?.fingerprint === preview.fingerprint) {
      return Object.freeze({ inserted: false, revision: preview.latestRevision, store: current });
    }
    const confirmedAt = (options.now?.() ?? new Date()).toISOString();
    const revisionNumber = preview.revisions.length + 1;
    const revision = Object.freeze({
      schemaVersion: 1 as const,
      id: `${preview.weekKey}:revision:${revisionNumber}`,
      weekKey: preview.weekKey,
      confirmedAt,
      fingerprint: preview.fingerprint,
      settlement: Object.freeze({ ...preview.settlement, status: "confirmed" as const }),
      journalEntries: Object.freeze([...preview.journalEntries]),
    });
    const nextWeeks = current.weeks.some((week) => week.weekKey === preview.weekKey)
      ? current.weeks.map((week) => week.weekKey === preview.weekKey
        ? Object.freeze({ ...week, revisions: Object.freeze([...week.revisions, revision]) })
        : week)
      : [...current.weeks, Object.freeze({ weekKey: preview.weekKey, revisions: Object.freeze([revision]) })];
    const nextStore = Object.freeze({ schemaVersion: 1 as const, weeks: Object.freeze(nextWeeks) });
    saveSettlementStore(storage, nextStore);
    return Object.freeze({ inserted: true, revision, store: nextStore });
  });
}

function fingerprintSettlement(
  settlement: WeeklySettlementV1,
  journalEntries: readonly WeeklyJournalEntry[],
) {
  const source = JSON.stringify({
    weekStart: settlement.weekStart,
    weekEndExclusive: settlement.weekEndExclusive,
    recordIds: [...settlement.recordIds].sort(),
    totals: settlement.totals,
    entries: [...journalEntries].sort((left, right) => left.id.localeCompare(right.id)).map((entry) => ({
      id: entry.id,
      recordId: entry.recordId,
      kind: entry.kind,
      timeSource: entry.timeSource,
      lines: entry.lines,
    })),
  });
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function saveSettlementStore(
  storage: StorageLike,
  next: WeeklySettlementStoreV1,
) {
  const previousRaw = storage.getItem(WEEKLY_SETTLEMENTS_STORAGE_KEY);
  const serialized = JSON.stringify(next);
  try {
    storage.setItem(WEEKLY_SETTLEMENTS_STORAGE_KEY, serialized);
    if (storage.getItem(WEEKLY_SETTLEMENTS_STORAGE_KEY) !== serialized) throw new Error("Verification failed.");
  } catch {
    try {
      if (previousRaw === null) storage.removeItem(WEEKLY_SETTLEMENTS_STORAGE_KEY);
      else storage.setItem(WEEKLY_SETTLEMENTS_STORAGE_KEY, previousRaw);
    } catch { /* Preserve the original save error. */ }
    throw new WeeklySettlementStoreError("SAVE_FAILED", "週次決算を保存できませんでした。再試行してください。");
  }
}

function isStoredSettlement(value: unknown): value is WeeklySettlementV1 {
  return isObject(value) && value.schemaVersion === 1 && value.status === "confirmed"
    && typeof value.id === "string" && typeof value.weekStart === "string"
    && typeof value.weekEndExclusive === "string" && Array.isArray(value.recordIds)
    && Array.isArray(value.journalEntryIds) && isObject(value.totals)
    && isObject(value.trialBalance) && value.trialBalance.isBalanced === true
    && isObject(value.balanceSheet) && value.balanceSheet.isBalanced === true
    && isObject(value.profitAndLoss);
}

function isWeekKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

function emptySettlementStore(): WeeklySettlementStoreV1 {
  return Object.freeze({ schemaVersion: 1, weeks: Object.freeze([]) });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidStore(): never {
  throw new WeeklySettlementStoreError("STORE_INVALID", "週次決算の保存形式が正しくありません。既存データは上書きしていません。");
}
