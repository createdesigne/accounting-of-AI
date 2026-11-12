/** Shared accounting-period state for both thought and time journals. */

export type AccountingPeriodKey = `${number}-${string}`;

export type ClosedAccountingPeriod = Readonly<{
  periodKey: AccountingPeriodKey;
  closedAt: string;
}>;

export type AccountingPeriodState = Readonly<{
  version: 1;
  accountingTimeZone: string;
  closedPeriods: readonly ClosedAccountingPeriod[];
}>;

export class AccountingPeriodClosedError extends Error {
  readonly code = "ACCOUNTING_PERIOD_CLOSED";
  readonly periodKey: AccountingPeriodKey;

  constructor(periodKey: AccountingPeriodKey) {
    super(`${periodKey} は締め済みのため、仕訳を変更できません。`);
    this.name = "AccountingPeriodClosedError";
    this.periodKey = periodKey;
  }
}

export function createAccountingPeriodState(
  accountingTimeZone = resolvedTimeZone(),
): AccountingPeriodState {
  requireTimeZone(accountingTimeZone);
  return freezeState(accountingTimeZone, []);
}

export function normalizeAccountingPeriodState(value: unknown): AccountingPeriodState {
  if (!isObject(value) || value.version !== 1
    || typeof value.accountingTimeZone !== "string"
    || !Array.isArray(value.closedPeriods)) {
    throw new Error("月末締め状態の形式が正しくありません。");
  }
  requireTimeZone(value.accountingTimeZone);
  const closedPeriods = value.closedPeriods.map((item): ClosedAccountingPeriod => {
    if (!isObject(item) || typeof item.periodKey !== "string" || !isAccountingPeriodKey(item.periodKey)
      || typeof item.closedAt !== "string" || !isIsoDateTime(item.closedAt)) {
      throw new Error("締め済み月の記録が正しくありません。");
    }
    return Object.freeze({ periodKey: item.periodKey, closedAt: item.closedAt });
  }).sort((left, right) => left.periodKey.localeCompare(right.periodKey));
  if (new Set(closedPeriods.map((item) => item.periodKey)).size !== closedPeriods.length) {
    throw new Error("同じ月の締め状態が重複しています。");
  }
  return freezeState(value.accountingTimeZone, closedPeriods);
}

/** Pure state transition only. It does not create a closing journal entry. */
export function withClosedAccountingPeriod(
  state: AccountingPeriodState,
  periodKey: string,
  closedAt: string,
): AccountingPeriodState {
  const normalized = normalizeAccountingPeriodState(state);
  requirePeriodKey(periodKey);
  if (!isIsoDateTime(closedAt)) throw new Error("締め日時が正しくありません。");
  if (isAccountingPeriodClosed(normalized, periodKey)) return normalized;
  return freezeState(normalized.accountingTimeZone, [
    ...normalized.closedPeriods,
    Object.freeze({ periodKey: periodKey as AccountingPeriodKey, closedAt }),
  ].sort((left, right) => left.periodKey.localeCompare(right.periodKey)));
}

export function isAccountingPeriodClosed(
  state: AccountingPeriodState,
  periodKey: string,
): boolean {
  requirePeriodKey(periodKey);
  return state.closedPeriods.some((item) => item.periodKey === periodKey);
}

/** Rejects a direct add, edit or delete whose accounting date is closed. */
export function assertAccountingDateIsOpen(
  state: AccountingPeriodState,
  accountingDate: string,
): void {
  const periodKey = accountingPeriodForDate(accountingDate);
  if (isAccountingPeriodClosed(state, periodKey)) {
    throw new AccountingPeriodClosedError(periodKey);
  }
}

/**
 * Keeps an open accounting date unchanged. A date in a closed month is moved
 * to the first day of the first later open month. The original event date must
 * be stored separately by the caller.
 */
export function resolveOpenAccountingDate(
  state: AccountingPeriodState,
  desiredAccountingDate: string,
): string {
  const desiredPeriod = accountingPeriodForDate(desiredAccountingDate);
  const openPeriod = nextOpenAccountingPeriod(state, desiredPeriod);
  return openPeriod === desiredPeriod ? desiredAccountingDate : `${openPeriod}-01`;
}

/** Returns the supplied month when it is open, otherwise the first later open month. */
export function nextOpenAccountingPeriod(
  state: AccountingPeriodState,
  fromPeriodKey: string,
): AccountingPeriodKey {
  requirePeriodKey(fromPeriodKey);
  let candidate = fromPeriodKey as AccountingPeriodKey;
  // The number of closed months is finite, so one more step must be open.
  for (let index = 0; index <= state.closedPeriods.length; index += 1) {
    if (!isAccountingPeriodClosed(state, candidate)) return candidate;
    candidate = nextAccountingPeriod(candidate);
  }
  throw new Error("次の未締め月を求められませんでした。");
}

export function nextAccountingPeriod(periodKey: string): AccountingPeriodKey {
  const { year, month } = parsePeriodKey(periodKey);
  return formatPeriodKey(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1);
}

export function accountingPeriodForDate(date: string): AccountingPeriodKey {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error("日付が正しくありません。");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const value = new Date(Date.UTC(year, month - 1, day));
  if (year < 1 || value.getUTCFullYear() !== year
    || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) {
    throw new Error("日付が正しくありません。");
  }
  return formatPeriodKey(year, month);
}

export function accountingPeriodAt(
  timestamp: number | Date,
  accountingTimeZone: string,
): AccountingPeriodKey {
  requireTimeZone(accountingTimeZone);
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error("日時が正しくありません。");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: accountingTimeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  return formatPeriodKey(year, month);
}

export function lastDateOfAccountingPeriod(periodKey: string) {
  const { year, month } = parsePeriodKey(periodKey);
  const date = new Date(Date.UTC(year, month, 0));
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function isDateInAccountingPeriod(date: string, periodKey: string) {
  requirePeriodKey(periodKey);
  return accountingPeriodForDate(date) === periodKey;
}

function freezeState(
  accountingTimeZone: string,
  closedPeriods: readonly ClosedAccountingPeriod[],
): AccountingPeriodState {
  return Object.freeze({
    version: 1 as const,
    accountingTimeZone,
    closedPeriods: Object.freeze([...closedPeriods]),
  });
}

function resolvedTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function requireTimeZone(value: string) {
  if (!value.trim()) throw new Error("会計タイムゾーンが正しくありません。");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
  } catch {
    throw new Error("会計タイムゾーンが正しくありません。");
  }
}

function requirePeriodKey(value: string): asserts value is AccountingPeriodKey {
  if (!isAccountingPeriodKey(value)) throw new Error("会計月が正しくありません。");
}

function isAccountingPeriodKey(value: string): value is AccountingPeriodKey {
  if (!/^(\d{4})-(0[1-9]|1[0-2])$/.test(value)) return false;
  return Number(value.slice(0, 4)) >= 1;
}

function parsePeriodKey(value: string) {
  requirePeriodKey(value);
  return { year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)) };
}

function formatPeriodKey(year: number, month: number): AccountingPeriodKey {
  if (!Number.isSafeInteger(year) || year < 1 || year > 9999
    || !Number.isSafeInteger(month) || month < 1 || month > 12) {
    throw new Error("会計月が正しくありません。");
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}` as AccountingPeriodKey;
}

function isIsoDateTime(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
