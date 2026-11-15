import {
  assertAccountingDateIsOpen,
  type AccountingPeriodState,
} from "./accountingPeriods.ts";
import { dateKey, ledgerDate } from "./ledgerPeriods.ts";
import {
  ACCOUNTING_BOOK_MUTATION_LOCK,
  loadSharedAccountingPeriodState,
  TIME_ACCOUNTING_STORAGE_BASE_KEY,
} from "./timeAccountingStore.ts";

export type ThinkingLedgerRecord = Readonly<{
  receiptNo: string;
  issuedAt: string;
  conversationDate: string;
  accountingPostedOn?: string;
}>;

type StorageLike = Pick<Storage, "getItem" | "setItem">;
type LockManagerLike = {
  request<T>(
    name: string,
    options: { mode: "exclusive" },
    callback: () => Promise<T> | T,
  ): Promise<T>;
};

export type ThinkingLedgerMutationOptions<T extends ThinkingLedgerRecord> = {
  storage?: StorageLike;
  locks?: LockManagerLike | null;
  storageKey: string;
  periodStorageKey?: string;
  parseRecord?: (value: unknown) => T | null;
};

export class ThinkingLedgerMutationError extends Error {
  readonly code: "INVALID_RECORD" | "UNKNOWN_RECORD" | "LOCK_UNAVAILABLE" | "SAVE_FAILED";

  constructor(code: ThinkingLedgerMutationError["code"], message: string) {
    super(message);
    this.name = "ThinkingLedgerMutationError";
    this.code = code;
  }
}

export function thinkingLedgerAccountingDate(record: ThinkingLedgerRecord): string {
  if (record.accountingPostedOn !== undefined) {
    assertIsoCalendarDate(record.accountingPostedOn);
    return record.accountingPostedOn;
  }
  const sourceDate = ledgerDate(record);
  if (!sourceDate) throw new ThinkingLedgerMutationError("INVALID_RECORD", "思考仕訳の日付が正しくありません。");
  return dateKey(sourceDate);
}

export function assertThinkingLedgerRecordIsOpen(
  record: ThinkingLedgerRecord,
  periodState: AccountingPeriodState,
): void {
  assertAccountingDateIsOpen(periodState, thinkingLedgerAccountingDate(record));
}

export async function addThinkingLedgerRecords<T extends ThinkingLedgerRecord>(
  records: readonly T[],
  options: ThinkingLedgerMutationOptions<T>,
): Promise<readonly T[]> {
  return mutateThinkingLedger(options, (current, periodState) => {
    const known = new Set(current.map((record) => record.receiptNo));
    const additions: T[] = [];
    for (const record of records) {
      requireRecord(record);
      if (known.has(record.receiptNo)) continue;
      assertThinkingLedgerRecordIsOpen(record, periodState);
      known.add(record.receiptNo);
      additions.push(record);
    }
    return [...additions, ...current];
  });
}

export async function updateThinkingLedgerRecord<T extends ThinkingLedgerRecord>(
  replacement: T,
  options: ThinkingLedgerMutationOptions<T>,
): Promise<readonly T[]> {
  requireRecord(replacement);
  return mutateThinkingLedger(options, (current, periodState) => {
    const existing = current.find((record) => record.receiptNo === replacement.receiptNo);
    if (!existing) throw new ThinkingLedgerMutationError("UNKNOWN_RECORD", "記録が見つかりません。再読み込みしてください。");
    assertThinkingLedgerRecordIsOpen(existing, periodState);
    const nextRecord = existing.accountingPostedOn === undefined
      ? replacement
      : { ...replacement, accountingPostedOn: existing.accountingPostedOn };
    assertThinkingLedgerRecordIsOpen(nextRecord, periodState);
    return current.map((record) => record.receiptNo === replacement.receiptNo ? nextRecord : record);
  });
}

export async function deleteThinkingLedgerRecord<T extends ThinkingLedgerRecord>(
  receiptNo: string,
  options: ThinkingLedgerMutationOptions<T>,
): Promise<readonly T[]> {
  return mutateThinkingLedger(options, (current, periodState) => {
    const existing = current.find((record) => record.receiptNo === receiptNo);
    if (!existing) throw new ThinkingLedgerMutationError("UNKNOWN_RECORD", "削除する記録が見つかりません。再読み込みしてください。");
    assertThinkingLedgerRecordIsOpen(existing, periodState);
    return current.filter((record) => record.receiptNo !== receiptNo);
  });
}

export async function clearThinkingLedgerRecords<T extends ThinkingLedgerRecord>(
  options: ThinkingLedgerMutationOptions<T>,
): Promise<readonly T[]> {
  return mutateThinkingLedger(options, (current, periodState) => {
    current.forEach((record) => assertThinkingLedgerRecordIsOpen(record, periodState));
    return [];
  });
}

async function mutateThinkingLedger<T extends ThinkingLedgerRecord>(
  options: ThinkingLedgerMutationOptions<T>,
  mutation: (current: readonly T[], periodState: AccountingPeriodState) => readonly T[],
): Promise<readonly T[]> {
  const storage = options.storage ?? window.localStorage;
  const locks = options.locks === null
    ? undefined
    : options.locks ?? globalThis.navigator?.locks as unknown as LockManagerLike | undefined;
  if (!locks?.request) {
    throw new ThinkingLedgerMutationError("LOCK_UNAVAILABLE", "安全な排他制御を利用できないため、思考仕訳を変更できません。");
  }
  return locks.request(ACCOUNTING_BOOK_MUTATION_LOCK, { mode: "exclusive" }, async () => {
    const periodState = loadSharedAccountingPeriodState(
      storage,
      options.periodStorageKey ?? TIME_ACCOUNTING_STORAGE_BASE_KEY,
    );
    const current = loadRecords(storage, options.storageKey, options.parseRecord);
    const next = [...mutation(current, periodState)];
    validateCollection(next);
    const serialized = JSON.stringify(next);
    try {
      storage.setItem(options.storageKey, serialized);
    } catch {
      throw new ThinkingLedgerMutationError("SAVE_FAILED", "思考仕訳を保存できませんでした。");
    }
    const verified = loadRecords(storage, options.storageKey, options.parseRecord);
    if (JSON.stringify(verified) !== serialized) {
      throw new ThinkingLedgerMutationError("SAVE_FAILED", "思考仕訳の保存を確認できませんでした。");
    }
    return Object.freeze(verified);
  });
}

function loadRecords<T extends ThinkingLedgerRecord>(
  storage: Pick<Storage, "getItem">,
  storageKey: string,
  parseRecord?: (value: unknown) => T | null,
): T[] {
  const raw = storage.getItem(storageKey);
  if (raw === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ThinkingLedgerMutationError("INVALID_RECORD", "思考仕訳を読み込めませんでした。");
  }
  if (!Array.isArray(value)) throw new ThinkingLedgerMutationError("INVALID_RECORD", "思考仕訳の保存形式が正しくありません。");
  const records = value.map((item) => parseRecord ? parseRecord(item) : defaultParseRecord(item) as T | null);
  if (records.some((record) => record === null)) {
    throw new ThinkingLedgerMutationError("INVALID_RECORD", "思考仕訳の保存形式が正しくありません。");
  }
  const normalized = records as T[];
  validateCollection(normalized);
  return normalized;
}

function defaultParseRecord(value: unknown): ThinkingLedgerRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.receiptNo !== "string" || typeof record.issuedAt !== "string"
    || typeof record.conversationDate !== "string"
    || (record.accountingPostedOn !== undefined && typeof record.accountingPostedOn !== "string")) return null;
  return record as ThinkingLedgerRecord;
}

function requireRecord(record: ThinkingLedgerRecord) {
  if (!record || typeof record.receiptNo !== "string" || !record.receiptNo.trim()) {
    throw new ThinkingLedgerMutationError("INVALID_RECORD", "思考仕訳の記録IDが正しくありません。");
  }
  thinkingLedgerAccountingDate(record);
}

function validateCollection(records: readonly ThinkingLedgerRecord[]) {
  records.forEach(requireRecord);
  if (new Set(records.map((record) => record.receiptNo)).size !== records.length) {
    throw new ThinkingLedgerMutationError("INVALID_RECORD", "同じ思考仕訳が重複しています。");
  }
}

function assertIsoCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new ThinkingLedgerMutationError("INVALID_RECORD", "思考仕訳の計上日が正しくありません。");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1
    || date.getUTCDate() !== Number(match[3])) {
    throw new ThinkingLedgerMutationError("INVALID_RECORD", "思考仕訳の計上日が正しくありません。");
  }
}
