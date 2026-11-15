import { assertAccountingDateIsOpen } from "./accountingPeriods.ts";
import {
  ACCOUNTING_BOOK_MUTATION_LOCK,
  loadSharedAccountingPeriodState,
  TIME_ACCOUNTING_STORAGE_BASE_KEY,
} from "./timeAccountingStore.ts";

export type ThoughtJournalRecord = Readonly<{
  id: string;
  date: string;
  journal?: unknown;
}>;

type StorageLike = Pick<Storage, "getItem" | "setItem">;
type LockManagerLike = {
  request<T>(
    name: string,
    options: { mode: "exclusive" },
    callback: () => Promise<T> | T,
  ): Promise<T>;
};

export type ThoughtJournalMutationOptions<T extends ThoughtJournalRecord> = {
  storage?: StorageLike;
  locks?: LockManagerLike | null;
  storageKey: string;
  periodStorageKey?: string;
  parseRecord?: (value: unknown) => T | null;
};

export class ThoughtJournalMutationError extends Error {
  readonly code: "INVALID_RECORD" | "LOCK_UNAVAILABLE" | "SAVE_FAILED";

  constructor(code: ThoughtJournalMutationError["code"], message: string) {
    super(message);
    this.name = "ThoughtJournalMutationError";
    this.code = code;
  }
}

/** Adds or replaces one thought journal while holding the shared close lock. */
export async function saveThoughtJournalRecord<T extends ThoughtJournalRecord>(
  record: T,
  options: ThoughtJournalMutationOptions<T>,
): Promise<readonly T[]> {
  requireRecord(record);
  const storage = options.storage ?? window.localStorage;
  const locks = options.locks === null
    ? undefined
    : options.locks ?? globalThis.navigator?.locks as unknown as LockManagerLike | undefined;
  if (!locks?.request) {
    throw new ThoughtJournalMutationError(
      "LOCK_UNAVAILABLE",
      "安全な排他制御を利用できないため、思考仕訳を保存できません。",
    );
  }
  return locks.request(ACCOUNTING_BOOK_MUTATION_LOCK, { mode: "exclusive" }, async () => {
    const periodState = loadSharedAccountingPeriodState(
      storage,
      options.periodStorageKey ?? TIME_ACCOUNTING_STORAGE_BASE_KEY,
    );
    const current = loadRecords(storage, options.storageKey, options.parseRecord);
    const existing = current.find((item) => item.id === record.id);
    if (existing) assertAccountingDateIsOpen(periodState, existing.date);
    assertAccountingDateIsOpen(periodState, record.date);
    const next = existing
      ? current.map((item) => item.id === record.id ? record : item)
      : [record, ...current];
    const serialized = JSON.stringify(next);
    try {
      storage.setItem(options.storageKey, serialized);
    } catch {
      throw new ThoughtJournalMutationError("SAVE_FAILED", "思考仕訳を保存できませんでした。");
    }
    const verified = loadRecords(storage, options.storageKey, options.parseRecord);
    if (JSON.stringify(verified) !== serialized) {
      throw new ThoughtJournalMutationError("SAVE_FAILED", "思考仕訳の保存を確認できませんでした。");
    }
    return Object.freeze(verified);
  });
}

function loadRecords<T extends ThoughtJournalRecord>(
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
    throw new ThoughtJournalMutationError("INVALID_RECORD", "思考仕訳を読み込めませんでした。");
  }
  if (!Array.isArray(value)) {
    throw new ThoughtJournalMutationError("INVALID_RECORD", "思考仕訳の保存形式が正しくありません。");
  }
  const records = value.map((item) => parseRecord ? parseRecord(item) : defaultParseRecord(item) as T | null);
  if (records.some((item) => item === null)) {
    throw new ThoughtJournalMutationError("INVALID_RECORD", "思考仕訳の保存形式が正しくありません。");
  }
  const normalized = records as T[];
  normalized.forEach(requireRecord);
  if (new Set(normalized.map((item) => item.id)).size !== normalized.length) {
    throw new ThoughtJournalMutationError("INVALID_RECORD", "同じ思考仕訳が重複しています。");
  }
  return normalized;
}

function defaultParseRecord(value: unknown): ThoughtJournalRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.date !== "string") return null;
  return record as ThoughtJournalRecord;
}

function requireRecord(record: ThoughtJournalRecord) {
  if (!record || typeof record.id !== "string" || !record.id.trim()
    || !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) {
    throw new ThoughtJournalMutationError("INVALID_RECORD", "思考仕訳の記録IDまたは日付が正しくありません。");
  }
  const [year, month, day] = record.date.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new ThoughtJournalMutationError("INVALID_RECORD", "思考仕訳の日付が正しくありません。");
  }
}
