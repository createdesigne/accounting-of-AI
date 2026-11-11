import {
  createTimeAccountingLedger,
  migrateTimeAccountingLedger,
  recordAiUsage,
  reverseAiUsage,
  TimeAccountingError,
  type TimeAccountingLedger,
} from "./timeAccounting.ts";
import {
  parseTimeRecordPreview,
  timeRecordFingerprint,
  type TimeRecordPreview,
} from "./timeRecordTransfer.ts";

export const TIME_ACCOUNTING_STORAGE_BASE_KEY = "watashi-to-ai-time-accounting-ledger";
export const TIME_ACCOUNTING_IMPORT_LOCK = "watashi-to-ai-time-accounting-import";

export type ImportedTimeRecord = Readonly<{
  recordId: string;
  fingerprint: string;
  sourceEventId: string;
  entryId: string;
  importedAt: string;
  reversalEntryId?: string;
  cancelledAt?: string;
}>;

export type TimeAccountingStore = Readonly<{
  storeVersion: 1;
  ledger: TimeAccountingLedger;
  importedRecords: readonly ImportedTimeRecord[];
}>;

export type TimeImportResult = Readonly<{
  importedCount: number;
  skippedCount: number;
  importedSeconds: number;
  processedSeconds: number;
  records: readonly TimeRecordPreview[];
  store: TimeAccountingStore;
}>;

export type TimeCancellationResult = Readonly<{
  recordId: string;
  reversalEntryId: string;
  cancelled: boolean;
  alreadyCancelled: boolean;
  store: TimeAccountingStore;
}>;

type StorageLike = Pick<Storage, "getItem" | "setItem">;
type LockManagerLike = {
  request<T>(
    name: string,
    options: { mode: "exclusive" },
    callback: () => Promise<T> | T,
  ): Promise<T>;
};

export type TimeAccountingImportOptions = {
  storage?: StorageLike;
  locks?: LockManagerLike | null;
  storageKey?: string;
  now?: () => number;
};

export class TimeAccountingImportError extends Error {
  readonly code:
    | "INVALID_RECORD"
    | "CONTENT_MISMATCH"
    | "LOCK_UNAVAILABLE"
    | "STORE_INVALID"
    | "SAVE_FAILED"
    | "UNKNOWN_RECORD"
    | "CLOSED_PERIOD";

  constructor(
    code: TimeAccountingImportError["code"],
    message: string,
  ) {
    super(message);
    this.name = "TimeAccountingImportError";
    this.code = code;
  }
}

export async function cancelImportedTimeRecord(
  recordId: string,
  options: TimeAccountingImportOptions = {},
): Promise<TimeCancellationResult> {
  if (typeof recordId !== "string" || recordId.trim().length === 0) {
    throw new TimeAccountingImportError("INVALID_RECORD", "取り消す記録IDが正しくありません。");
  }
  const storage = options.storage ?? window.localStorage;
  const locks = options.locks === null
    ? undefined
    : options.locks ?? globalThis.navigator?.locks as unknown as LockManagerLike | undefined;
  const storageKey = options.storageKey ?? TIME_ACCOUNTING_STORAGE_BASE_KEY;
  const now = options.now ?? Date.now;
  if (!locks?.request) {
    throw new TimeAccountingImportError(
      "LOCK_UNAVAILABLE",
      "安全な排他制御を利用できないため、取り消しを開始できません。",
    );
  }
  return locks.request(TIME_ACCOUNTING_IMPORT_LOCK, { mode: "exclusive" }, async () => (
    cancelUnderLock(recordId, storage, storageKey, now)
  ));
}

export async function importTimeRecords(
  input: readonly TimeRecordPreview[],
  options: TimeAccountingImportOptions = {},
): Promise<TimeImportResult> {
  const records = prepareRecords(input);
  const storage = options.storage ?? window.localStorage;
  const locks = options.locks === null
    ? undefined
    : options.locks ?? globalThis.navigator?.locks as unknown as LockManagerLike | undefined;
  const storageKey = options.storageKey ?? TIME_ACCOUNTING_STORAGE_BASE_KEY;
  const now = options.now ?? Date.now;
  if (!locks?.request) {
    throw new TimeAccountingImportError(
      "LOCK_UNAVAILABLE",
      "安全な排他制御を利用できないため、会計への取り込みを開始できません。",
    );
  }
  return locks.request(TIME_ACCOUNTING_IMPORT_LOCK, { mode: "exclusive" }, async () => (
    importUnderLock(records, storage, storageKey, now)
  ));
}

export function loadTimeAccountingStore(
  storage: Pick<Storage, "getItem"> = window.localStorage,
  storageKey = TIME_ACCOUNTING_STORAGE_BASE_KEY,
): TimeAccountingStore {
  const raw = storage.getItem(storageKey);
  if (raw === null) return createStore(createTimeAccountingLedger(), []);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new TimeAccountingImportError("STORE_INVALID", "時間会計データを読み込めませんでした。");
  }
  try {
    if (isObject(value) && value.storeVersion === 1) {
      if (!Array.isArray(value.importedRecords)) throw new Error("importedRecords");
      const importedRecords = value.importedRecords.map(parseImportedRecord);
      const ids = new Set(importedRecords.map((record) => record.recordId));
      if (ids.size !== importedRecords.length) throw new Error("duplicate imported record");
      const ledger = migrateTimeAccountingLedger(value.ledger);
      validateImportedRecordLinks(ledger, importedRecords);
      return createStore(ledger, importedRecords);
    }
    // Before this store envelope existed, a minute- or second-ledger may have
    // been saved directly. The accounting migration owns that conversion.
    return createStore(migrateTimeAccountingLedger(value), []);
  } catch (error) {
    if (error instanceof TimeAccountingImportError) throw error;
    throw new TimeAccountingImportError("STORE_INVALID", "時間会計データが壊れているため取り込めません。");
  }
}

export function sourceEventIdForTimeRecord(recordId: string) {
  return `chrome-time:${recordId}`;
}

export function entryIdForTimeRecord(recordId: string) {
  return `ai-usage:${recordId}`;
}

async function importUnderLock(
  records: readonly TimeRecordPreview[],
  storage: StorageLike,
  storageKey: string,
  now: () => number,
): Promise<TimeImportResult> {
  const current = loadTimeAccountingStore(storage, storageKey);
  let ledger = current.ledger;
  const importedRecords = [...current.importedRecords];
  const importedById = new Map(importedRecords.map((record) => [record.recordId, record]));
  let importedCount = 0;
  let skippedCount = 0;
  let importedSeconds = 0;
  const importedAt = new Date(now()).toISOString();

  for (const record of records) {
    const fingerprint = timeRecordFingerprint(record);
    const sourceEventId = sourceEventIdForTimeRecord(record.recordId);
    const expectedEntryId = entryIdForTimeRecord(record.recordId);
    const imported = importedById.get(record.recordId);
    if (imported) {
      if (imported.fingerprint !== fingerprint) contentMismatch(record.recordId);
      const measurement = ledger.measurements.find((item) => item.sourceEventId === imported.sourceEventId);
      if (!measurement || measurement.occurredOn !== record.localDate
        || measurement.actualInputSeconds !== record.durationSeconds) contentMismatch(record.recordId);
      skippedCount += 1;
      continue;
    }

    const existingMeasurement = ledger.measurements.find((item) => item.sourceEventId === sourceEventId);
    if (existingMeasurement) {
      if (existingMeasurement.occurredOn !== record.localDate
        || existingMeasurement.actualInputSeconds !== record.durationSeconds) contentMismatch(record.recordId);
      const metadata = Object.freeze({
        recordId: record.recordId,
        fingerprint,
        sourceEventId,
        entryId: existingMeasurement.usageEntryId,
        importedAt,
      });
      importedRecords.push(metadata);
      importedById.set(record.recordId, metadata);
      skippedCount += 1;
      continue;
    }

    ledger = recordAiUsage(ledger, {
      entryId: expectedEntryId,
      sourceEventId,
      occurredOn: record.localDate,
      actualInputSeconds: record.durationSeconds,
    });
    const metadata = Object.freeze({
      recordId: record.recordId,
      fingerprint,
      sourceEventId,
      entryId: expectedEntryId,
      importedAt,
    });
    importedRecords.push(metadata);
    importedById.set(record.recordId, metadata);
    importedCount += 1;
    importedSeconds += record.durationSeconds;
  }

  const next = createStore(ledger, importedRecords);
  try {
    storage.setItem(storageKey, JSON.stringify(next));
  } catch {
    throw new TimeAccountingImportError("SAVE_FAILED", "時間会計データを保存できませんでした。");
  }
  const verified = loadTimeAccountingStore(storage, storageKey);
  for (const record of records) {
    const saved = verified.importedRecords.find((item) => item.recordId === record.recordId);
    const measurement = verified.ledger.measurements.find(
      (item) => item.sourceEventId === sourceEventIdForTimeRecord(record.recordId),
    );
    if (!saved || saved.fingerprint !== timeRecordFingerprint(record)
      || !measurement || measurement.occurredOn !== record.localDate
      || measurement.actualInputSeconds !== record.durationSeconds) {
      throw new TimeAccountingImportError("SAVE_FAILED", "時間会計データの保存を確認できませんでした。");
    }
  }
  return Object.freeze({
    importedCount,
    skippedCount,
    importedSeconds,
    processedSeconds: records.reduce((sum, record) => sum + record.durationSeconds, 0),
    records: Object.freeze([...records]),
    store: verified,
  });
}

async function cancelUnderLock(
  recordId: string,
  storage: StorageLike,
  storageKey: string,
  now: () => number,
): Promise<TimeCancellationResult> {
  const current = loadTimeAccountingStore(storage, storageKey);
  const importedIndex = current.importedRecords.findIndex((record) => record.recordId === recordId);
  if (importedIndex < 0) {
    throw new TimeAccountingImportError("UNKNOWN_RECORD", "取り消す利用時間の記録が見つかりません。");
  }
  const imported = current.importedRecords[importedIndex];
  const measurement = current.ledger.measurements.find(
    (item) => item.sourceEventId === imported.sourceEventId,
  );
  if (!measurement || measurement.usageEntryId !== imported.entryId) {
    throw new TimeAccountingImportError("STORE_INVALID", "取り消す時間仕訳の関連情報が壊れています。");
  }
  if (measurement.reversalEntryId !== undefined) {
    return Object.freeze({
      recordId,
      reversalEntryId: measurement.reversalEntryId,
      cancelled: false,
      alreadyCancelled: true,
      store: current,
    });
  }

  const cancelledAtValue = now();
  const cancelledDate = new Date(cancelledAtValue);
  if (!Number.isFinite(cancelledDate.getTime())) {
    throw new TimeAccountingImportError("INVALID_RECORD", "取消日時が正しくありません。");
  }
  const cancelledAt = cancelledDate.toISOString();
  const postedOn = localDate(cancelledDate);
  const reversalEntryId = reversalEntryIdForTimeRecord(recordId);
  let ledger: TimeAccountingLedger;
  try {
    ledger = reverseAiUsage(current.ledger, {
      entryId: reversalEntryId,
      sourceEventId: imported.sourceEventId,
      postedOn,
    });
  } catch (error) {
    if (error instanceof TimeAccountingError && error.code === "REVERSAL_IN_CLOSED_PERIOD") {
      throw new TimeAccountingImportError(
        "CLOSED_PERIOD",
        "締め済みの利用記録は、締め日より後の未締め期間で取り消してください。",
      );
    }
    throw error;
  }

  const importedRecords = [...current.importedRecords];
  importedRecords[importedIndex] = Object.freeze({
    ...imported,
    reversalEntryId,
    cancelledAt,
  });
  const next = createStore(ledger, importedRecords);
  try {
    storage.setItem(storageKey, JSON.stringify(next));
  } catch {
    throw new TimeAccountingImportError("SAVE_FAILED", "取消仕訳を保存できませんでした。");
  }
  const verified = loadTimeAccountingStore(storage, storageKey);
  const saved = verified.importedRecords.find((record) => record.recordId === recordId);
  const savedMeasurement = verified.ledger.measurements.find(
    (item) => item.sourceEventId === imported.sourceEventId,
  );
  if (saved?.reversalEntryId !== reversalEntryId || saved.cancelledAt !== cancelledAt
    || savedMeasurement?.reversalEntryId !== reversalEntryId) {
    throw new TimeAccountingImportError("SAVE_FAILED", "取消仕訳の保存を確認できませんでした。");
  }
  return Object.freeze({
    recordId,
    reversalEntryId,
    cancelled: true,
    alreadyCancelled: false,
    store: verified,
  });
}

function prepareRecords(input: readonly TimeRecordPreview[]) {
  if (!Array.isArray(input)) {
    throw new TimeAccountingImportError("INVALID_RECORD", "利用時間の記録形式が正しくありません。");
  }
  const byId = new Map<string, TimeRecordPreview>();
  for (const value of input) {
    const record = parseTimeRecordPreview(value);
    if (!record) throw new TimeAccountingImportError("INVALID_RECORD", "利用時間の記録形式が正しくありません。");
    const existing = byId.get(record.recordId);
    if (existing && timeRecordFingerprint(existing) !== timeRecordFingerprint(record)) {
      contentMismatch(record.recordId);
    }
    if (!existing) byId.set(record.recordId, record);
  }
  return [...byId.values()];
}

function parseImportedRecord(value: unknown): ImportedTimeRecord {
  if (!isObject(value) || typeof value.recordId !== "string" || !value.recordId
    || typeof value.fingerprint !== "string" || !value.fingerprint
    || typeof value.sourceEventId !== "string" || !value.sourceEventId
    || typeof value.entryId !== "string" || !value.entryId
    || typeof value.importedAt !== "string" || !Number.isFinite(Date.parse(value.importedAt))) {
    throw new Error("invalid imported record");
  }
  const reversalEntryId = value.reversalEntryId === undefined
    ? undefined
    : typeof value.reversalEntryId === "string" && value.reversalEntryId
      ? value.reversalEntryId
      : (() => { throw new Error("invalid reversal entry id"); })();
  const cancelledAt = value.cancelledAt === undefined
    ? undefined
    : typeof value.cancelledAt === "string" && Number.isFinite(Date.parse(value.cancelledAt))
      ? value.cancelledAt
      : (() => { throw new Error("invalid cancellation time"); })();
  if ((reversalEntryId === undefined) !== (cancelledAt === undefined)) {
    throw new Error("incomplete cancellation metadata");
  }
  return Object.freeze({
    recordId: value.recordId,
    fingerprint: value.fingerprint,
    sourceEventId: value.sourceEventId,
    entryId: value.entryId,
    importedAt: value.importedAt,
    ...(reversalEntryId === undefined ? {} : { reversalEntryId, cancelledAt }),
  });
}

function createStore(
  ledger: TimeAccountingLedger,
  importedRecords: readonly ImportedTimeRecord[],
): TimeAccountingStore {
  return Object.freeze({
    storeVersion: 1 as const,
    ledger,
    importedRecords: Object.freeze([...importedRecords]),
  });
}

function validateImportedRecordLinks(
  ledger: TimeAccountingLedger,
  importedRecords: readonly ImportedTimeRecord[],
) {
  for (const imported of importedRecords) {
    const measurement = ledger.measurements.find(
      (item) => item.sourceEventId === imported.sourceEventId,
    );
    if (!measurement || measurement.usageEntryId !== imported.entryId) {
      throw new Error("imported record link is invalid");
    }
    if (imported.reversalEntryId !== undefined) {
      const reversal = ledger.entries.find((entry) => entry.id === imported.reversalEntryId);
      if (measurement.reversalEntryId !== imported.reversalEntryId
        || !reversal || reversal.kind !== "usage-reversal"
        || reversal.reversesEntryId !== imported.entryId) {
        throw new Error("imported record reversal link is invalid");
      }
    }
  }
}

export function reversalEntryIdForTimeRecord(recordId: string) {
  return `ai-usage-reversal:${recordId}`;
}

function localDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function contentMismatch(recordId: string): never {
  throw new TimeAccountingImportError(
    "CONTENT_MISMATCH",
    `同じ記録IDに異なる内容が指定されています: ${recordId}`,
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
