import {
  createTimeAccountingLedger,
  migrateTimeAccountingLedger,
  recordAiUsage,
  correctAiUsage,
  effectiveTimeMeasurementSeconds,
  reregisterAiUsage,
  reverseAiUsage,
  isTimeMeasurementActive,
  TimeAccountingError,
  type TimeAccountingLedger,
} from "./timeAccounting.ts";
import {
  parseTimeRecordPreview,
  timeRecordFingerprint,
  type TimeRecordPreview,
} from "./timeRecordTransfer.ts";
import {
  createAccountingPeriodState,
  normalizeAccountingPeriodState,
  resolveOpenAccountingDate,
  withClosedAccountingPeriod,
  type AccountingPeriodState,
} from "./accountingPeriods.ts";

export const TIME_ACCOUNTING_STORAGE_BASE_KEY = "watashi-to-ai-time-accounting-ledger";
/** Shared mutation lock for future thought-journal and current time-journal writes. */
export const ACCOUNTING_BOOK_MUTATION_LOCK = "watashi-to-ai-time-accounting-import";
/** @deprecated Use ACCOUNTING_BOOK_MUTATION_LOCK for new shared accounting operations. */
export const TIME_ACCOUNTING_IMPORT_LOCK = ACCOUNTING_BOOK_MUTATION_LOCK;

export type ImportedTimeRecord = Readonly<{
  recordId: string;
  fingerprint: string;
  sourceEventId: string;
  entryId: string;
  importedAt: string;
  reversalEntryId?: string;
  cancelledAt?: string;
  actions?: readonly TimeRecordAccountingAction[];
}>;

export type TimeRecordAccountingAction = Readonly<{
  kind: "cancellation" | "reregistration" | "correction";
  entryId: string;
  actedAt: string;
  beforeSeconds?: number;
  afterSeconds?: number;
  deltaSeconds?: number;
  reason?: string;
}>;

export type TimeAccountingStore = Readonly<{
  storeVersion: 2;
  ledger: TimeAccountingLedger;
  importedRecords: readonly ImportedTimeRecord[];
  /** Shared by time journals and, in a later stage, thought-journal mutations. */
  periodState: AccountingPeriodState;
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

export type TimeReregistrationResult = Readonly<{
  recordId: string;
  reregistrationEntryId: string;
  reregistered: boolean;
  alreadyRegistered: boolean;
  store: TimeAccountingStore;
}>;

export type TimeCorrectionResult = Readonly<{
  recordId: string;
  correctionEntryId: string | null;
  corrected: boolean;
  unchanged: boolean;
  effectiveSeconds: number;
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

export type SaveAccountingPeriodStateResult = Readonly<{
  store: TimeAccountingStore;
}>;

export class TimeAccountingImportError extends Error {
  readonly code:
    | "INVALID_RECORD"
    | "CONTENT_MISMATCH"
    | "LOCK_UNAVAILABLE"
    | "STORE_INVALID"
    | "SAVE_FAILED"
    | "UNKNOWN_RECORD"
    | "INACTIVE_RECORD"
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

export async function reregisterImportedTimeRecord(
  recordId: string,
  options: TimeAccountingImportOptions = {},
): Promise<TimeReregistrationResult> {
  if (typeof recordId !== "string" || recordId.trim().length === 0) {
    throw new TimeAccountingImportError("INVALID_RECORD", "再登録する記録IDが正しくありません。");
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
      "安全な排他制御を利用できないため、再登録を開始できません。",
    );
  }
  return locks.request(TIME_ACCOUNTING_IMPORT_LOCK, { mode: "exclusive" }, async () => (
    reregisterUnderLock(recordId, storage, storageKey, now)
  ));
}

export async function correctImportedTimeRecord(
  recordId: string,
  correctedSeconds: number,
  reason = "",
  options: TimeAccountingImportOptions = {},
): Promise<TimeCorrectionResult> {
  if (typeof recordId !== "string" || recordId.trim().length === 0
    || !Number.isSafeInteger(correctedSeconds) || correctedSeconds < 0
    || typeof reason !== "string" || reason.length > 500) {
    throw new TimeAccountingImportError("INVALID_RECORD", "訂正内容が正しくありません。");
  }
  const storage = options.storage ?? window.localStorage;
  const locks = options.locks === null
    ? undefined
    : options.locks ?? globalThis.navigator?.locks as unknown as LockManagerLike | undefined;
  const storageKey = options.storageKey ?? TIME_ACCOUNTING_STORAGE_BASE_KEY;
  const now = options.now ?? Date.now;
  if (!locks?.request) {
    throw new TimeAccountingImportError("LOCK_UNAVAILABLE", "安全な排他制御を利用できないため、訂正を開始できません。");
  }
  return locks.request(TIME_ACCOUNTING_IMPORT_LOCK, { mode: "exclusive" }, async () => (
    correctUnderLock(recordId, correctedSeconds, reason, storage, storageKey, now)
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
  if (raw === null) return createStore(createTimeAccountingLedger(), [], createAccountingPeriodState());
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new TimeAccountingImportError("STORE_INVALID", "時間会計データを読み込めませんでした。");
  }
  try {
    if (isObject(value) && (value.storeVersion === 1 || value.storeVersion === 2)) {
      if (!Array.isArray(value.importedRecords)) throw new Error("importedRecords");
      const importedRecords = value.importedRecords.map(parseImportedRecord);
      const ids = new Set(importedRecords.map((record) => record.recordId));
      if (ids.size !== importedRecords.length) throw new Error("duplicate imported record");
      const ledger = migrateTimeAccountingLedger(value.ledger);
      validateImportedRecordLinks(ledger, importedRecords);
      const periodState = value.storeVersion === 2
        ? normalizeAccountingPeriodState(value.periodState)
        : createAccountingPeriodState();
      return createStore(ledger, importedRecords, periodState);
    }
    // Before this store envelope existed, a minute- or second-ledger may have
    // been saved directly. The accounting migration owns that conversion.
    return createStore(migrateTimeAccountingLedger(value), [], createAccountingPeriodState());
  } catch (error) {
    if (error instanceof TimeAccountingImportError) throw error;
    throw new TimeAccountingImportError("STORE_INVALID", "時間会計データが壊れているため取り込めません。");
  }
}

export function loadSharedAccountingPeriodState(
  storage: Pick<Storage, "getItem"> = window.localStorage,
  storageKey = TIME_ACCOUNTING_STORAGE_BASE_KEY,
) {
  return loadTimeAccountingStore(storage, storageKey).periodState;
}

/**
 * Persists only the shared period state inside the same envelope as the time
 * ledger. No closing journal is created and no user-facing close action calls
 * this function in the first implementation stage.
 */
export async function saveAccountingPeriodState(
  periodState: AccountingPeriodState,
  options: TimeAccountingImportOptions = {},
): Promise<SaveAccountingPeriodStateResult> {
  const normalized = normalizeAccountingPeriodState(periodState);
  const storage = options.storage ?? window.localStorage;
  const locks = options.locks === null
    ? undefined
    : options.locks ?? globalThis.navigator?.locks as unknown as LockManagerLike | undefined;
  const storageKey = options.storageKey ?? TIME_ACCOUNTING_STORAGE_BASE_KEY;
  if (!locks?.request) {
    throw new TimeAccountingImportError(
      "LOCK_UNAVAILABLE",
      "安全な排他制御を利用できないため、月末締め状態を保存できません。",
    );
  }
  return locks.request(TIME_ACCOUNTING_IMPORT_LOCK, { mode: "exclusive" }, async () => {
    const current = loadTimeAccountingStore(storage, storageKey);
    if (current.periodState.closedPeriods.length > 0
      && current.periodState.accountingTimeZone !== normalized.accountingTimeZone) {
      throw new TimeAccountingImportError(
        "INVALID_RECORD",
        "締め済み月があるため、会計タイムゾーンを変更できません。",
      );
    }
    let merged = current.periodState.closedPeriods.length === 0
      ? createAccountingPeriodState(normalized.accountingTimeZone)
      : current.periodState;
    for (const closed of normalized.closedPeriods) {
      merged = withClosedAccountingPeriod(merged, closed.periodKey, closed.closedAt);
    }
    const next = createStore(current.ledger, current.importedRecords, merged);
    try {
      storage.setItem(storageKey, JSON.stringify(next));
    } catch {
      throw new TimeAccountingImportError("SAVE_FAILED", "月末締め状態を保存できませんでした。");
    }
    const verified = loadTimeAccountingStore(storage, storageKey);
    if (JSON.stringify(verified.periodState) !== JSON.stringify(merged)) {
      throw new TimeAccountingImportError("SAVE_FAILED", "月末締め状態の保存を確認できませんでした。");
    }
    return Object.freeze({ store: verified });
  });
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
      const actions = actionsForMeasurement(ledger, existingMeasurement);
      const firstCancellation = actions.find((action) => action.kind === "cancellation");
      const metadata = Object.freeze({
        recordId: record.recordId,
        fingerprint,
        sourceEventId,
        entryId: existingMeasurement.usageEntryId,
        importedAt,
        ...(actions.length === 0 ? {} : { actions }),
        ...(firstCancellation === undefined ? {} : {
          reversalEntryId: firstCancellation.entryId,
          cancelledAt: firstCancellation.actedAt,
        }),
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
      postedOn: resolveOpenAccountingDate(current.periodState, record.localDate),
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

  const next = createStore(ledger, importedRecords, current.periodState);
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

function actionsForMeasurement(
  ledger: TimeAccountingLedger,
  measurement: TimeAccountingLedger["measurements"][number],
): readonly TimeRecordAccountingAction[] {
  const correctionEntryIds = measurement.correctionEntryIds
    ?? (measurement.reversalEntryId === undefined ? [] : [measurement.reversalEntryId]);
  return Object.freeze(correctionEntryIds.map((entryId) => {
    const entry = ledger.entries.find((item) => item.id === entryId);
    if (!entry) throw new TimeAccountingImportError("STORE_INVALID", "時間仕訳の操作履歴が壊れています。");
    if (entry.kind === "usage-correction") {
      return Object.freeze({
        kind: "correction" as const,
        entryId,
        actedAt: `${entry.postedOn}T00:00:00.000Z`,
        beforeSeconds: entry.effectiveSecondsBefore,
        afterSeconds: entry.effectiveSecondsAfter,
        deltaSeconds: (entry.effectiveSecondsAfter ?? 0) - (entry.effectiveSecondsBefore ?? 0),
        ...(entry.correctionReason === undefined ? {} : { reason: entry.correctionReason }),
      });
    }
    return Object.freeze({
      kind: entry.kind === "usage-reversal" ? "cancellation" as const : "reregistration" as const,
      entryId,
      actedAt: `${entry.postedOn}T00:00:00.000Z`,
    });
  }));
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
  const existingActions = imported.actions ?? [];
  if (!isTimeMeasurementActive(measurement)) {
    const existingReversalEntryId = measurement.correctionEntryIds?.[measurement.correctionEntryIds.length - 1]
      ?? measurement.reversalEntryId;
    if (!existingReversalEntryId) {
      throw new TimeAccountingImportError("STORE_INVALID", "取消仕訳の関連情報が壊れています。");
    }
    return Object.freeze({
      recordId,
      reversalEntryId: existingReversalEntryId,
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
  const postedOn = resolveOpenAccountingDate(current.periodState, localDate(cancelledDate));
  const cancellationCount = existingActions.filter((action) => action.kind === "cancellation").length;
  const reversalEntryId = reversalEntryIdForTimeRecord(recordId, cancellationCount + 1);
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
    reversalEntryId: imported.reversalEntryId ?? reversalEntryId,
    cancelledAt: imported.cancelledAt ?? cancelledAt,
    actions: Object.freeze([...existingActions, Object.freeze({
      kind: "cancellation" as const,
      entryId: reversalEntryId,
      actedAt: cancelledAt,
    })]),
  });
  const next = createStore(ledger, importedRecords, current.periodState);
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
  const savedAction = saved?.actions?.[saved.actions.length - 1];
  const savedCorrectionId = savedMeasurement?.correctionEntryIds?.[savedMeasurement.correctionEntryIds.length - 1]
    ?? savedMeasurement?.reversalEntryId;
  if (savedAction?.kind !== "cancellation" || savedAction.entryId !== reversalEntryId
    || savedAction.actedAt !== cancelledAt || savedCorrectionId !== reversalEntryId) {
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

async function reregisterUnderLock(
  recordId: string,
  storage: StorageLike,
  storageKey: string,
  now: () => number,
): Promise<TimeReregistrationResult> {
  const current = loadTimeAccountingStore(storage, storageKey);
  const importedIndex = current.importedRecords.findIndex((record) => record.recordId === recordId);
  if (importedIndex < 0) {
    throw new TimeAccountingImportError("UNKNOWN_RECORD", "再登録する利用時間の記録が見つかりません。");
  }
  const imported = current.importedRecords[importedIndex];
  const measurement = current.ledger.measurements.find(
    (item) => item.sourceEventId === imported.sourceEventId,
  );
  if (!measurement || measurement.usageEntryId !== imported.entryId) {
    throw new TimeAccountingImportError("STORE_INVALID", "再登録する時間仕訳の関連情報が壊れています。");
  }
  const existingActions = imported.actions ?? [];
  if (isTimeMeasurementActive(measurement)) {
    const latestReregistration = [...existingActions].reverse().find(
      (action) => action.kind === "reregistration",
    );
    return Object.freeze({
      recordId,
      reregistrationEntryId: latestReregistration?.entryId ?? imported.entryId,
      reregistered: false,
      alreadyRegistered: true,
      store: current,
    });
  }

  const actedAtValue = now();
  const actedDate = new Date(actedAtValue);
  if (!Number.isFinite(actedDate.getTime())) {
    throw new TimeAccountingImportError("INVALID_RECORD", "再登録日時が正しくありません。");
  }
  const actedAt = actedDate.toISOString();
  const postedOn = resolveOpenAccountingDate(current.periodState, localDate(actedDate));
  const reregistrationCount = existingActions.filter(
    (action) => action.kind === "reregistration",
  ).length;
  const reregistrationEntryId = reregistrationEntryIdForTimeRecord(recordId, reregistrationCount + 1);
  let ledger: TimeAccountingLedger;
  try {
    ledger = reregisterAiUsage(current.ledger, {
      entryId: reregistrationEntryId,
      sourceEventId: imported.sourceEventId,
      postedOn,
    });
  } catch (error) {
    if (error instanceof TimeAccountingError && error.code === "REVERSAL_IN_CLOSED_PERIOD") {
      throw new TimeAccountingImportError(
        "CLOSED_PERIOD",
        "締め済みの利用記録は、締め日より後の未締め期間で再登録してください。",
      );
    }
    throw error;
  }

  const importedRecords = [...current.importedRecords];
  importedRecords[importedIndex] = Object.freeze({
    ...imported,
    actions: Object.freeze([...existingActions, Object.freeze({
      kind: "reregistration" as const,
      entryId: reregistrationEntryId,
      actedAt,
    })]),
  });
  const next = createStore(ledger, importedRecords, current.periodState);
  try {
    storage.setItem(storageKey, JSON.stringify(next));
  } catch {
    throw new TimeAccountingImportError("SAVE_FAILED", "再登録仕訳を保存できませんでした。");
  }
  const verified = loadTimeAccountingStore(storage, storageKey);
  const saved = verified.importedRecords.find((record) => record.recordId === recordId);
  const savedMeasurement = verified.ledger.measurements.find(
    (item) => item.sourceEventId === imported.sourceEventId,
  );
  const savedAction = saved?.actions?.[saved.actions.length - 1];
  const savedCorrectionId = savedMeasurement?.correctionEntryIds?.[savedMeasurement.correctionEntryIds.length - 1];
  if (savedAction?.kind !== "reregistration" || savedAction.entryId !== reregistrationEntryId
    || savedAction.actedAt !== actedAt || savedCorrectionId !== reregistrationEntryId) {
    throw new TimeAccountingImportError("SAVE_FAILED", "再登録仕訳の保存を確認できませんでした。");
  }
  return Object.freeze({
    recordId,
    reregistrationEntryId,
    reregistered: true,
    alreadyRegistered: false,
    store: verified,
  });
}

async function correctUnderLock(
  recordId: string,
  correctedSeconds: number,
  reason: string,
  storage: StorageLike,
  storageKey: string,
  now: () => number,
): Promise<TimeCorrectionResult> {
  const current = loadTimeAccountingStore(storage, storageKey);
  const importedIndex = current.importedRecords.findIndex((record) => record.recordId === recordId);
  if (importedIndex < 0) {
    throw new TimeAccountingImportError("UNKNOWN_RECORD", "訂正する利用時間の記録が見つかりません。");
  }
  const imported = current.importedRecords[importedIndex];
  const measurement = current.ledger.measurements.find((item) => item.sourceEventId === imported.sourceEventId);
  if (!measurement || measurement.usageEntryId !== imported.entryId) {
    throw new TimeAccountingImportError("STORE_INVALID", "訂正する時間仕訳の関連情報が壊れています。");
  }
  if (!isTimeMeasurementActive(measurement)) {
    throw new TimeAccountingImportError("INACTIVE_RECORD", "取消済みの利用時間は訂正できません。先に再登録してください。");
  }
  const beforeSeconds = effectiveTimeMeasurementSeconds(measurement);
  if (beforeSeconds === correctedSeconds) {
    return Object.freeze({
      recordId,
      correctionEntryId: null,
      corrected: false,
      unchanged: true,
      effectiveSeconds: beforeSeconds,
      store: current,
    });
  }

  const actedAtValue = now();
  const actedDate = new Date(actedAtValue);
  if (!Number.isFinite(actedDate.getTime())) {
    throw new TimeAccountingImportError("INVALID_RECORD", "訂正日時が正しくありません。");
  }
  const actedAt = actedDate.toISOString();
  const postedOn = resolveOpenAccountingDate(current.periodState, localDate(actedDate));
  const existingActions = imported.actions ?? [];
  const correctionCount = existingActions.filter((action) => action.kind === "correction").length;
  const correctionEntryId = correctionEntryIdForTimeRecord(recordId, correctionCount + 1);
  let ledger: TimeAccountingLedger;
  try {
    ledger = correctAiUsage(current.ledger, {
      entryId: correctionEntryId,
      sourceEventId: imported.sourceEventId,
      postedOn,
      correctedInputSeconds: correctedSeconds,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    });
  } catch (error) {
    if (error instanceof TimeAccountingError && error.code === "REVERSAL_IN_CLOSED_PERIOD") {
      throw new TimeAccountingImportError("CLOSED_PERIOD", "締め済みの利用記録は、締め日より後の未締め期間で訂正してください。");
    }
    throw error;
  }
  const action = Object.freeze({
    kind: "correction" as const,
    entryId: correctionEntryId,
    actedAt,
    beforeSeconds,
    afterSeconds: correctedSeconds,
    deltaSeconds: correctedSeconds - beforeSeconds,
    ...(reason.trim() ? { reason: reason.trim() } : {}),
  });
  const importedRecords = [...current.importedRecords];
  importedRecords[importedIndex] = Object.freeze({
    ...imported,
    actions: Object.freeze([...existingActions, action]),
  });
  const next = createStore(ledger, importedRecords, current.periodState);
  try {
    storage.setItem(storageKey, JSON.stringify(next));
  } catch {
    throw new TimeAccountingImportError("SAVE_FAILED", "訂正仕訳を保存できませんでした。");
  }
  const verified = loadTimeAccountingStore(storage, storageKey);
  const saved = verified.importedRecords.find((record) => record.recordId === recordId);
  const savedMeasurement = verified.ledger.measurements.find((item) => item.sourceEventId === imported.sourceEventId);
  const savedAction = saved?.actions?.[saved.actions.length - 1];
  const savedCorrectionId = savedMeasurement?.correctionEntryIds?.[savedMeasurement.correctionEntryIds.length - 1];
  if (savedAction?.kind !== "correction" || savedAction.entryId !== correctionEntryId
    || savedAction.actedAt !== actedAt || savedCorrectionId !== correctionEntryId || !savedMeasurement
    || effectiveTimeMeasurementSeconds(savedMeasurement) !== correctedSeconds) {
    throw new TimeAccountingImportError("SAVE_FAILED", "訂正仕訳の保存を確認できませんでした。");
  }
  return Object.freeze({
    recordId,
    correctionEntryId,
    corrected: true,
    unchanged: false,
    effectiveSeconds: correctedSeconds,
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
  const actions = value.actions === undefined
    ? reversalEntryId === undefined ? [] : [{
      kind: "cancellation" as const,
      entryId: reversalEntryId,
      actedAt: cancelledAt!,
    }]
    : Array.isArray(value.actions)
      ? value.actions.map(parseAccountingAction)
      : (() => { throw new Error("invalid accounting actions"); })();
  let active = true;
  for (const action of actions) {
    if ((action.kind === "cancellation" && !active)
      || (action.kind === "reregistration" && active)
      || (action.kind === "correction" && !active)) {
      throw new Error("accounting action sequence is inconsistent");
    }
    if (action.kind === "cancellation") active = false;
    if (action.kind === "reregistration") active = true;
  }
  if (new Set(actions.map((action) => action.entryId)).size !== actions.length
    || (reversalEntryId !== undefined
      && actions.find((action) => action.kind === "cancellation")?.entryId !== reversalEntryId)) {
    throw new Error("accounting action history is inconsistent");
  }
  return Object.freeze({
    recordId: value.recordId,
    fingerprint: value.fingerprint,
    sourceEventId: value.sourceEventId,
    entryId: value.entryId,
    importedAt: value.importedAt,
    ...(reversalEntryId === undefined ? {} : { reversalEntryId, cancelledAt }),
    ...(actions.length === 0 ? {} : { actions: Object.freeze(actions) }),
  });
}

function parseAccountingAction(value: unknown): TimeRecordAccountingAction {
  if (!isObject(value) || (value.kind !== "cancellation" && value.kind !== "reregistration" && value.kind !== "correction")
    || typeof value.entryId !== "string" || !value.entryId
    || typeof value.actedAt !== "string" || !Number.isFinite(Date.parse(value.actedAt))) {
    throw new Error("invalid accounting action");
  }
  if (value.kind === "correction") {
    if (!Number.isSafeInteger(value.beforeSeconds) || Number(value.beforeSeconds) < 0
      || !Number.isSafeInteger(value.afterSeconds) || Number(value.afterSeconds) < 0
      || !Number.isSafeInteger(value.deltaSeconds) || Number(value.deltaSeconds) === 0
      || Number(value.deltaSeconds) !== Number(value.afterSeconds) - Number(value.beforeSeconds)
      || (value.reason !== undefined && (typeof value.reason !== "string" || value.reason.length > 500))) {
      throw new Error("invalid correction action");
    }
    return Object.freeze({
      kind: "correction",
      entryId: value.entryId,
      actedAt: value.actedAt,
      beforeSeconds: Number(value.beforeSeconds),
      afterSeconds: Number(value.afterSeconds),
      deltaSeconds: Number(value.deltaSeconds),
      ...(value.reason === undefined ? {} : { reason: value.reason }),
    });
  }
  return Object.freeze({ kind: value.kind, entryId: value.entryId, actedAt: value.actedAt });
}

function createStore(
  ledger: TimeAccountingLedger,
  importedRecords: readonly ImportedTimeRecord[],
  periodState: AccountingPeriodState,
): TimeAccountingStore {
  return Object.freeze({
    storeVersion: 2 as const,
    ledger,
    importedRecords: Object.freeze([...importedRecords]),
    periodState,
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
    const actions = imported.actions ?? [];
    const correctionEntryIds = measurement.correctionEntryIds
      ?? (measurement.reversalEntryId === undefined ? [] : [measurement.reversalEntryId]);
    if (actions.length !== correctionEntryIds.length
      || actions.some((action, index) => action.entryId !== correctionEntryIds[index])) {
      throw new Error("imported record action links are invalid");
    }
    for (const action of actions) {
      const entry = ledger.entries.find((item) => item.id === action.entryId);
      const expectedKind = action.kind === "cancellation"
        ? "usage-reversal"
        : action.kind === "reregistration" ? "usage-reregistration" : "usage-correction";
      if (!entry || entry.kind !== expectedKind) throw new Error("imported record action kind is invalid");
      if (action.kind === "correction"
        && (action.beforeSeconds !== entry.effectiveSecondsBefore
          || action.afterSeconds !== entry.effectiveSecondsAfter
          || action.deltaSeconds !== Number(entry.effectiveSecondsAfter) - Number(entry.effectiveSecondsBefore)
          || (action.reason ?? undefined) !== (entry.correctionReason ?? undefined))) {
        throw new Error("imported record correction metadata is invalid");
      }
    }
  }
}

export function reversalEntryIdForTimeRecord(recordId: string, occurrence = 1) {
  return occurrence === 1
    ? `ai-usage-reversal:${recordId}`
    : `ai-usage-reversal:${recordId}:${occurrence}`;
}

export function reregistrationEntryIdForTimeRecord(recordId: string, occurrence = 1) {
  return occurrence === 1
    ? `ai-usage-reregistration:${recordId}`
    : `ai-usage-reregistration:${recordId}:${occurrence}`;
}

export function correctionEntryIdForTimeRecord(recordId: string, occurrence = 1) {
  return occurrence === 1
    ? `ai-usage-correction:${recordId}`
    : `ai-usage-correction:${recordId}:${occurrence}`;
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
