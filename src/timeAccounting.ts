/**
 * Time-based double-entry bookkeeping.
 *
 * This module is intentionally independent from the application's receipts and
 * persistence. A caller should use one stable sourceEventId for one real AI-use
 * event; that key is what prevents the same time from being recognized twice.
 */

export const TIME_ACCOUNTS = {
  aiClearing: "AI仮受品",
  timeContribution: "時間拠出",
  thoughtExplorationExpense: "思考探究費",
} as const;

export type TimeAccount = typeof TIME_ACCOUNTS[keyof typeof TIME_ACCOUNTS];
export type JournalSide = "debit" | "credit";
export type TimeJournalEntryKind = "ai-usage" | "month-end-adjustment";

export type TimeJournalLine = Readonly<{
  side: JournalSide;
  account: TimeAccount;
  minutes: number;
  measurement: "actual-input";
}>;

export type TimeJournalEntry = Readonly<{
  id: string;
  kind: TimeJournalEntryKind;
  postedOn: string;
  sourceEventId: string;
  lines: readonly [TimeJournalLine, TimeJournalLine];
}>;

export type AiTimeMeasurement = Readonly<{
  sourceEventId: string;
  occurredOn: string;
  actualInputMinutes: number;
  /** A memo measurement only. It is never copied to a journal line or P/L. */
  estimatedSavedMinutes: number;
  usageEntryId: string;
  monthEndAdjustmentEntryId?: string;
}>;

export type TimeAccountingLedger = Readonly<{
  version: 1;
  unit: "minute";
  measurements: readonly AiTimeMeasurement[];
  entries: readonly TimeJournalEntry[];
}>;

export type RecordAiUsageInput = Readonly<{
  entryId: string;
  sourceEventId: string;
  occurredOn: string;
  actualInputMinutes: number;
  estimatedSavedMinutes?: number;
}>;

export type RecordMonthEndAdjustmentInput = Readonly<{
  entryId: string;
  sourceEventId: string;
  postedOn: string;
}>;

export type TimeAccountingErrorCode =
  | "INVALID_IDENTIFIER"
  | "INVALID_DATE"
  | "INVALID_ACTUAL_MINUTES"
  | "INVALID_ESTIMATED_MINUTES"
  | "DUPLICATE_ENTRY_ID"
  | "DUPLICATE_SOURCE_EVENT"
  | "UNKNOWN_SOURCE_EVENT"
  | "ALREADY_ADJUSTED"
  | "ADJUSTMENT_BEFORE_USAGE";

export class TimeAccountingError extends Error {
  readonly code: TimeAccountingErrorCode;

  constructor(code: TimeAccountingErrorCode, message: string) {
    super(message);
    this.name = "TimeAccountingError";
    this.code = code;
  }
}

export function createTimeAccountingLedger(): TimeAccountingLedger {
  return freezeLedger([], []);
}

/** Records: debit AI clearing / credit time contribution. */
export function recordAiUsage(
  ledger: TimeAccountingLedger,
  input: RecordAiUsageInput,
): TimeAccountingLedger {
  requireIdentifier(input.entryId, "entryId");
  requireIdentifier(input.sourceEventId, "sourceEventId");
  requireCalendarDate(input.occurredOn, "occurredOn");
  requireMinutes(input.actualInputMinutes, "actualInputMinutes", false);
  const estimatedSavedMinutes = input.estimatedSavedMinutes ?? 0;
  requireMinutes(estimatedSavedMinutes, "estimatedSavedMinutes", true);
  requireUniqueEntryId(ledger, input.entryId);

  if (ledger.measurements.some(({ sourceEventId }) => sourceEventId === input.sourceEventId)) {
    throw new TimeAccountingError(
      "DUPLICATE_SOURCE_EVENT",
      `AI-use event already recorded: ${input.sourceEventId}`,
    );
  }

  const measurement: AiTimeMeasurement = Object.freeze({
    sourceEventId: input.sourceEventId,
    occurredOn: input.occurredOn,
    actualInputMinutes: input.actualInputMinutes,
    estimatedSavedMinutes,
    usageEntryId: input.entryId,
  });
  const entry = createEntry(
    input.entryId,
    "ai-usage",
    input.occurredOn,
    input.sourceEventId,
    TIME_ACCOUNTS.aiClearing,
    TIME_ACCOUNTS.timeContribution,
    input.actualInputMinutes,
  );

  return freezeLedger([...ledger.measurements, measurement], [...ledger.entries, entry]);
}

/** Records: debit thought exploration expense / credit AI clearing. */
export function recordMonthEndAdjustment(
  ledger: TimeAccountingLedger,
  input: RecordMonthEndAdjustmentInput,
): TimeAccountingLedger {
  requireIdentifier(input.entryId, "entryId");
  requireIdentifier(input.sourceEventId, "sourceEventId");
  requireCalendarDate(input.postedOn, "postedOn");
  requireUniqueEntryId(ledger, input.entryId);

  const measurementIndex = ledger.measurements.findIndex(
    ({ sourceEventId }) => sourceEventId === input.sourceEventId,
  );
  if (measurementIndex < 0) {
    throw new TimeAccountingError(
      "UNKNOWN_SOURCE_EVENT",
      `AI-use event is not recorded: ${input.sourceEventId}`,
    );
  }
  const measurement = ledger.measurements[measurementIndex];
  if (measurement.monthEndAdjustmentEntryId !== undefined) {
    throw new TimeAccountingError(
      "ALREADY_ADJUSTED",
      `AI-use event already has a month-end adjustment: ${input.sourceEventId}`,
    );
  }
  if (input.postedOn < measurement.occurredOn) {
    throw new TimeAccountingError(
      "ADJUSTMENT_BEFORE_USAGE",
      "A month-end adjustment cannot be posted before the AI-use event.",
    );
  }

  const adjustedMeasurement: AiTimeMeasurement = Object.freeze({
    ...measurement,
    monthEndAdjustmentEntryId: input.entryId,
  });
  const measurements = [...ledger.measurements];
  measurements[measurementIndex] = adjustedMeasurement;
  const entry = createEntry(
    input.entryId,
    "month-end-adjustment",
    input.postedOn,
    input.sourceEventId,
    TIME_ACCOUNTS.thoughtExplorationExpense,
    TIME_ACCOUNTS.aiClearing,
    measurement.actualInputMinutes,
  );

  return freezeLedger(measurements, [...ledger.entries, entry]);
}

export function journalTotals(entry: TimeJournalEntry) {
  let debitMinutes = 0;
  let creditMinutes = 0;
  for (const line of entry.lines) {
    if (line.side === "debit") debitMinutes += line.minutes;
    else creditMinutes += line.minutes;
  }
  return { debitMinutes, creditMinutes };
}

export function isBalancedJournalEntry(entry: TimeJournalEntry): boolean {
  const { debitMinutes, creditMinutes } = journalTotals(entry);
  return debitMinutes === creditMinutes;
}

/**
 * Returns the debit balance for an account. A negative result is a credit
 * balance. All amounts come only from actual-input journal lines.
 */
export function accountBalanceMinutes(
  ledger: TimeAccountingLedger,
  account: TimeAccount,
): number {
  return ledger.entries.reduce((balance, entry) => (
    balance + entry.lines.reduce((entryBalance, line) => {
      if (line.account !== account) return entryBalance;
      return entryBalance + (line.side === "debit" ? line.minutes : -line.minutes);
    }, 0)
  ), 0);
}

/** Estimated savings are deliberately absent from this P/L result. */
export function calculateTimeProfitAndLoss(ledger: TimeAccountingLedger) {
  return Object.freeze({
    thoughtExplorationExpenseMinutes: accountBalanceMinutes(
      ledger,
      TIME_ACCOUNTS.thoughtExplorationExpense,
    ),
  });
}

/** Keeps measured actual input and non-accounting estimates visibly separate. */
export function summarizeTimeMeasurements(ledger: TimeAccountingLedger) {
  return Object.freeze(ledger.measurements.reduce((summary, measurement) => ({
    actualInputMinutes: summary.actualInputMinutes + measurement.actualInputMinutes,
    estimatedSavedMinutes: summary.estimatedSavedMinutes + measurement.estimatedSavedMinutes,
  }), { actualInputMinutes: 0, estimatedSavedMinutes: 0 }));
}

function createEntry(
  id: string,
  kind: TimeJournalEntryKind,
  postedOn: string,
  sourceEventId: string,
  debitAccount: TimeAccount,
  creditAccount: TimeAccount,
  minutes: number,
): TimeJournalEntry {
  const debit: TimeJournalLine = Object.freeze({
    side: "debit",
    account: debitAccount,
    minutes,
    measurement: "actual-input",
  });
  const credit: TimeJournalLine = Object.freeze({
    side: "credit",
    account: creditAccount,
    minutes,
    measurement: "actual-input",
  });
  const lines = Object.freeze([debit, credit]) as readonly [TimeJournalLine, TimeJournalLine];
  return Object.freeze({ id, kind, postedOn, sourceEventId, lines });
}

function freezeLedger(
  measurements: readonly AiTimeMeasurement[],
  entries: readonly TimeJournalEntry[],
): TimeAccountingLedger {
  return Object.freeze({
    version: 1 as const,
    unit: "minute" as const,
    measurements: Object.freeze([...measurements]),
    entries: Object.freeze([...entries]),
  });
}

function requireUniqueEntryId(ledger: TimeAccountingLedger, entryId: string) {
  if (ledger.entries.some(({ id }) => id === entryId)) {
    throw new TimeAccountingError("DUPLICATE_ENTRY_ID", `Journal entry already exists: ${entryId}`);
  }
}

function requireIdentifier(value: string, name: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TimeAccountingError("INVALID_IDENTIFIER", `${name} must not be empty.`);
  }
}

function requireMinutes(value: number, name: string, allowZero: boolean) {
  if (!Number.isSafeInteger(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new TimeAccountingError(
      name === "estimatedSavedMinutes" ? "INVALID_ESTIMATED_MINUTES" : "INVALID_ACTUAL_MINUTES",
      `${name} must be ${allowZero ? "a non-negative" : "a positive"} whole number of minutes.`,
    );
  }
}

function requireCalendarDate(value: string, name: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]) return;
  }
  throw new TimeAccountingError("INVALID_DATE", `${name} must be a valid YYYY-MM-DD date.`);
}
