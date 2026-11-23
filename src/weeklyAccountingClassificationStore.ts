import type { AccountingDisposition, WeeklyRecordV1 } from "./weeklyData.ts";
import { withWeeklyRecordAccounting } from "./weeklyData.ts";
import type { WeeklyExpenseAccount } from "./weeklyAccountingTypes.ts";
import {
  loadWeeklyRecordStore,
  WEEKLY_RECORDS_LOCK,
  WEEKLY_RECORDS_STORAGE_KEY,
  type WeeklyRecordStoreV1,
} from "./weeklyStore.ts";

export const WEEKLY_ACCOUNTING_REVISIONS_STORAGE_KEY = "watashi-to-ai-weekly-accounting-revisions:v1";

export type WeeklyAccountingSelectionV1 = Readonly<{
  disposition: AccountingDisposition;
  account: WeeklyExpenseAccount | null;
}>;

export type WeeklyAccountingRevisionV1 = Readonly<{
  schemaVersion: 1;
  id: string;
  recordId: string;
  changedAt: string;
  before: WeeklyAccountingSelectionV1;
  after: WeeklyAccountingSelectionV1;
}>;

export type WeeklyAccountingRevisionStoreV1 = Readonly<{
  schemaVersion: 1;
  revisions: readonly WeeklyAccountingRevisionV1[];
}>;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type LockManagerLike = {
  request<T>(name: string, options: { mode: "exclusive" }, callback: () => Promise<T> | T): Promise<T>;
};

export type WeeklyAccountingUpdateOptions = Readonly<{
  storage?: StorageLike;
  locks?: LockManagerLike | null;
  now?: () => Date;
}>;

export type WeeklyAccountingUpdateResult = Readonly<{
  changed: boolean;
  record: WeeklyRecordV1;
  recordStore: WeeklyRecordStoreV1;
  revision: WeeklyAccountingRevisionV1 | null;
  revisionStore: WeeklyAccountingRevisionStoreV1;
}>;

export class WeeklyAccountingClassificationError extends Error {
  readonly code: "STORE_INVALID" | "LOCK_UNAVAILABLE" | "UNKNOWN_RECORD" | "SAVE_FAILED";

  constructor(code: WeeklyAccountingClassificationError["code"], message: string) {
    super(message);
    this.name = "WeeklyAccountingClassificationError";
    this.code = code;
  }
}

export function loadWeeklyAccountingRevisionStore(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): WeeklyAccountingRevisionStoreV1 {
  const raw = storage.getItem(WEEKLY_ACCOUNTING_REVISIONS_STORAGE_KEY);
  if (raw === null) return emptyStore();
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return invalidStore(); }
  if (!isObject(value) || value.schemaVersion !== 1 || !Array.isArray(value.revisions)) return invalidStore();
  const ids = new Set<string>();
  const revisions = value.revisions.map((candidate) => {
    if (!isObject(candidate) || candidate.schemaVersion !== 1 || typeof candidate.id !== "string" || !candidate.id
      || ids.has(candidate.id) || typeof candidate.recordId !== "string" || !candidate.recordId
      || typeof candidate.changedAt !== "string" || Number.isNaN(new Date(candidate.changedAt).getTime())
      || !isSelection(candidate.before) || !isSelection(candidate.after)) return invalidStore();
    ids.add(candidate.id);
    return Object.freeze({
      schemaVersion: 1 as const,
      id: candidate.id,
      recordId: candidate.recordId,
      changedAt: new Date(candidate.changedAt).toISOString(),
      before: freezeSelection(candidate.before),
      after: freezeSelection(candidate.after),
    });
  });
  return Object.freeze({ schemaVersion: 1, revisions: Object.freeze(revisions) });
}

export function accountingRevisionsForRecord(
  store: WeeklyAccountingRevisionStoreV1,
  recordId: string,
) {
  return Object.freeze(store.revisions.filter((revision) => revision.recordId === recordId));
}

export async function updateWeeklyRecordAccounting(
  recordId: string,
  disposition: AccountingDisposition,
  account: WeeklyExpenseAccount | null,
  options: WeeklyAccountingUpdateOptions = {},
): Promise<WeeklyAccountingUpdateResult> {
  const storage = options.storage ?? window.localStorage;
  const locks = options.locks === null
    ? undefined
    : options.locks ?? globalThis.navigator?.locks as unknown as LockManagerLike | undefined;
  if (!locks?.request) {
    throw new WeeklyAccountingClassificationError("LOCK_UNAVAILABLE", "安全な排他制御を利用できないため会計区分を保存できません。");
  }
  return locks.request(WEEKLY_RECORDS_LOCK, { mode: "exclusive" }, () => {
    const recordStore = loadWeeklyRecordStore(storage);
    const revisionStore = loadWeeklyAccountingRevisionStore(storage);
    const current = recordStore.records.find((record) => record.id === recordId);
    if (!current) throw new WeeklyAccountingClassificationError("UNKNOWN_RECORD", "保存済み活動が見つかりません。既存データは変更していません。");
    const updated = withWeeklyRecordAccounting(current, disposition, account);
    const before = selectionForRecord(current);
    const after = selectionForRecord(updated);
    if (sameSelection(before, after)) {
      return Object.freeze({ changed: false, record: current, recordStore, revision: null, revisionStore });
    }

    const changedAt = (options.now?.() ?? new Date()).toISOString();
    const revisionNumber = revisionStore.revisions.filter((item) => item.recordId === recordId).length + 1;
    const revision = Object.freeze({
      schemaVersion: 1 as const,
      id: `${recordId}:accounting-revision:${revisionNumber}`,
      recordId,
      changedAt,
      before,
      after,
    });
    const nextRecords = recordStore.records.map((record) => record.id === recordId ? updated : record);
    const nextRecordStore = Object.freeze({
      schemaVersion: 1 as const,
      records: Object.freeze(nextRecords),
      tasks: recordStore.tasks,
    });
    const nextRevisionStore = Object.freeze({
      schemaVersion: 1 as const,
      revisions: Object.freeze([...revisionStore.revisions, revision]),
    });
    saveBoth(storage, nextRecordStore, nextRevisionStore);
    return Object.freeze({
      changed: true,
      record: updated,
      recordStore: nextRecordStore,
      revision,
      revisionStore: nextRevisionStore,
    });
  });
}

function selectionForRecord(record: WeeklyRecordV1): WeeklyAccountingSelectionV1 {
  return freezeSelection({
    disposition: record.accountingDisposition,
    account: record.accountingDisposition === "expense" ? record.accountingAccount ?? null : null,
  });
}

function freezeSelection(value: WeeklyAccountingSelectionV1): WeeklyAccountingSelectionV1 {
  return Object.freeze({ disposition: value.disposition, account: value.account });
}

function sameSelection(left: WeeklyAccountingSelectionV1, right: WeeklyAccountingSelectionV1) {
  return left.disposition === right.disposition && left.account === right.account;
}

function isSelection(value: unknown): value is WeeklyAccountingSelectionV1 {
  if (!isObject(value) || !["expense", "asset", "work-in-progress", "unclassified"].includes(value.disposition as string)) return false;
  if (value.disposition === "expense") {
    return ["相談活動費", "思考探究費", "成果物利用費", "情報収集費", "学習活動費", "その他AI利用費"].includes(value.account as string);
  }
  return value.account === null;
}

function saveBoth(
  storage: StorageLike,
  recordStore: WeeklyRecordStoreV1,
  revisionStore: WeeklyAccountingRevisionStoreV1,
) {
  const previousRecords = storage.getItem(WEEKLY_RECORDS_STORAGE_KEY);
  const previousRevisions = storage.getItem(WEEKLY_ACCOUNTING_REVISIONS_STORAGE_KEY);
  const recordsRaw = JSON.stringify(recordStore);
  const revisionsRaw = JSON.stringify(revisionStore);
  try {
    storage.setItem(WEEKLY_RECORDS_STORAGE_KEY, recordsRaw);
    storage.setItem(WEEKLY_ACCOUNTING_REVISIONS_STORAGE_KEY, revisionsRaw);
    if (storage.getItem(WEEKLY_RECORDS_STORAGE_KEY) !== recordsRaw
      || storage.getItem(WEEKLY_ACCOUNTING_REVISIONS_STORAGE_KEY) !== revisionsRaw) throw new Error("Verification failed.");
  } catch {
    restore(storage, WEEKLY_RECORDS_STORAGE_KEY, previousRecords);
    restore(storage, WEEKLY_ACCOUNTING_REVISIONS_STORAGE_KEY, previousRevisions);
    throw new WeeklyAccountingClassificationError("SAVE_FAILED", "会計区分を保存できませんでした。既存データは変更していません。");
  }
}

function restore(storage: StorageLike, key: string, value: string | null) {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch { /* Preserve the original save failure. */ }
}

function emptyStore(): WeeklyAccountingRevisionStoreV1 {
  return Object.freeze({ schemaVersion: 1, revisions: Object.freeze([]) });
}

function invalidStore(): never {
  throw new WeeklyAccountingClassificationError("STORE_INVALID", "会計区分の変更履歴を読み込めません。既存データは上書きしていません。");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
