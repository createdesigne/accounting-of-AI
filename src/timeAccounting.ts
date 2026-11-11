/**
 * Time-based double-entry bookkeeping.
 *
 * Seconds are the canonical unit. A caller should use one stable sourceEventId
 * for one real AI-use event; that key prevents the same time being recognized
 * twice.
 */

export const TIME_ACCOUNTS = {
  aiClearing: "AI仮受品",
  timeContribution: "時間拠出",
  thoughtExplorationExpense: "思考探究費",
} as const;

export type TimeAccount = typeof TIME_ACCOUNTS[keyof typeof TIME_ACCOUNTS];
export type JournalSide = "debit" | "credit";
export type TimeJournalEntryKind = "ai-usage" | "month-end-adjustment" | "usage-reversal" | "usage-reregistration" | "usage-correction";

export type TimeJournalLine = Readonly<{
  side: JournalSide;
  account: TimeAccount;
  seconds: number;
  measurement: "actual-input";
}>;

export type TimeJournalEntry = Readonly<{
  id: string;
  kind: TimeJournalEntryKind;
  postedOn: string;
  sourceEventId: string;
  /** Present only on a reversal and points to the preceding active entry. */
  reversesEntryId?: string;
  /** Present only on a re-registration and points to the preceding reversal. */
  restoresEntryId?: string;
  /** Present only on a partial correction and points to the preceding active entry. */
  correctsEntryId?: string;
  effectiveSecondsBefore?: number;
  effectiveSecondsAfter?: number;
  correctionReason?: string;
  lines: readonly [TimeJournalLine, TimeJournalLine];
}>;

export type AiTimeMeasurement = Readonly<{
  sourceEventId: string;
  occurredOn: string;
  actualInputSeconds: number;
  /** A memo measurement only. It is never copied to a journal line or P/L. */
  estimatedSavedSeconds: number;
  usageEntryId: string;
  monthEndAdjustmentEntryId?: string;
  reversalEntryId?: string;
  /** Ordered append-only reversal, re-registration and partial-correction entry ids. */
  correctionEntryIds?: readonly string[];
  effectiveInputSeconds?: number;
  isActive?: boolean;
}>;

export type TimeAccountingLedger = Readonly<{
  version: 2;
  unit: "second";
  measurements: readonly AiTimeMeasurement[];
  entries: readonly TimeJournalEntry[];
}>;

export type RecordAiUsageInput = Readonly<{
  entryId: string;
  sourceEventId: string;
  occurredOn: string;
  actualInputSeconds: number;
  estimatedSavedSeconds?: number;
}>;

export type RecordMonthEndAdjustmentInput = Readonly<{
  entryId: string;
  sourceEventId: string;
  postedOn: string;
}>;

export type ReverseAiUsageInput = Readonly<{
  entryId: string;
  sourceEventId: string;
  postedOn: string;
}>;

export type ReregisterAiUsageInput = Readonly<{
  entryId: string;
  sourceEventId: string;
  postedOn: string;
}>;

export type CorrectAiUsageInput = Readonly<{
  entryId: string;
  sourceEventId: string;
  postedOn: string;
  correctedInputSeconds: number;
  reason?: string;
}>;

export type TimeAccountingErrorCode =
  | "INVALID_IDENTIFIER"
  | "INVALID_DATE"
  | "INVALID_ACTUAL_SECONDS"
  | "INVALID_ESTIMATED_SECONDS"
  | "INVALID_LEDGER"
  | "DUPLICATE_ENTRY_ID"
  | "DUPLICATE_SOURCE_EVENT"
  | "UNKNOWN_SOURCE_EVENT"
  | "ALREADY_ADJUSTED"
  | "ADJUSTMENT_BEFORE_USAGE"
  | "ALREADY_REVERSED"
  | "REVERSAL_BEFORE_USAGE"
  | "REVERSAL_IN_CLOSED_PERIOD"
  | "ALREADY_REGISTERED"
  | "REREGISTRATION_BEFORE_REVERSAL"
  | "INACTIVE_SOURCE_EVENT"
  | "NO_CORRECTION_CHANGE"
  | "CORRECTION_BEFORE_ENTRY";

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

/**
 * Converts the legacy whole-minute version exactly once. Passing a version 2
 * ledger validates and copies its seconds without multiplying them again.
 */
export function migrateTimeAccountingLedger(value: unknown): TimeAccountingLedger {
  if (!isObject(value)) invalidLedger("Ledger must be an object.");
  if (value.version === 1 && value.unit === "minute") return normalizeLedger(value, true);
  if (value.version === 2 && value.unit === "second") return normalizeLedger(value, false);
  return invalidLedger("Ledger version and unit are not supported.");
}

/** Records: debit AI clearing / credit time contribution. */
export function recordAiUsage(
  ledger: TimeAccountingLedger,
  input: RecordAiUsageInput,
): TimeAccountingLedger {
  requireIdentifier(input.entryId, "entryId");
  requireIdentifier(input.sourceEventId, "sourceEventId");
  requireCalendarDate(input.occurredOn, "occurredOn");
  requireSeconds(input.actualInputSeconds, "actualInputSeconds", false);
  const estimatedSavedSeconds = input.estimatedSavedSeconds ?? 0;
  requireSeconds(estimatedSavedSeconds, "estimatedSavedSeconds", true);
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
    actualInputSeconds: input.actualInputSeconds,
    estimatedSavedSeconds,
    usageEntryId: input.entryId,
  });
  const entry = createEntry(
    input.entryId,
    "ai-usage",
    input.occurredOn,
    input.sourceEventId,
    TIME_ACCOUNTS.aiClearing,
    TIME_ACCOUNTS.timeContribution,
    input.actualInputSeconds,
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
  if (!isTimeMeasurementActive(measurement)) {
    throw new TimeAccountingError(
      "ALREADY_REVERSED",
      `A reversed AI-use event cannot be adjusted: ${input.sourceEventId}`,
    );
  }
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
    effectiveSeconds(measurement),
  );

  return freezeLedger(measurements, [...ledger.entries, entry]);
}

/** Records the exact opposite of the original usage without deleting it. */
export function reverseAiUsage(
  ledger: TimeAccountingLedger,
  input: ReverseAiUsageInput,
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
  const correctionEntryIds = measurementCorrections(measurement);
  if (!isTimeMeasurementActive(measurement)) {
    throw new TimeAccountingError(
      "ALREADY_REVERSED",
      `AI-use event is already reversed: ${input.sourceEventId}`,
    );
  }
  if (input.postedOn < measurement.occurredOn) {
    throw new TimeAccountingError(
      "REVERSAL_BEFORE_USAGE",
      "A reversal cannot be posted before the AI-use event.",
    );
  }
  if (measurement.monthEndAdjustmentEntryId !== undefined) {
    const adjustment = ledger.entries.find(
      ({ id }) => id === measurement.monthEndAdjustmentEntryId,
    );
    if (!adjustment || input.postedOn <= adjustment.postedOn) {
      throw new TimeAccountingError(
        "REVERSAL_IN_CLOSED_PERIOD",
        "A closed-period usage must be reversed in a later open period.",
      );
    }
  }

  const usage = ledger.entries.find(({ id }) => id === measurement.usageEntryId);
  if (!usage || usage.kind !== "ai-usage") {
    return invalidLedger("Measurement usage entry is missing or inconsistent.");
  }
  const activeEntryId = correctionEntryIds[correctionEntryIds.length - 1] ?? measurement.usageEntryId;
  const activeEntry = ledger.entries.find(({ id }) => id === activeEntryId);
  const seconds = effectiveSeconds(measurement);
  if (!activeEntry || !["ai-usage", "usage-reregistration", "usage-correction"].includes(activeEntry.kind)) {
    return invalidLedger("Measurement usage entry is missing or inconsistent.");
  }
  if (input.postedOn < activeEntry.postedOn) {
    throw new TimeAccountingError(
      "REVERSAL_BEFORE_USAGE",
      "A reversal cannot be posted before the active registration entry.",
    );
  }

  const reversedMeasurement: AiTimeMeasurement = Object.freeze({
    ...measurement,
    reversalEntryId: measurement.reversalEntryId ?? input.entryId,
    correctionEntryIds: Object.freeze([...correctionEntryIds, input.entryId]),
    effectiveInputSeconds: seconds,
    isActive: false,
  });
  const measurements = [...ledger.measurements];
  measurements[measurementIndex] = reversedMeasurement;
  const entry = createEntry(
    input.entryId,
    "usage-reversal",
    input.postedOn,
    input.sourceEventId,
    TIME_ACCOUNTS.timeContribution,
    TIME_ACCOUNTS.aiClearing,
    seconds,
    activeEntryId,
  );
  return freezeLedger(measurements, [...ledger.entries, entry]);
}

/** Re-registers a reversed usage with the original seconds, without rewriting history. */
export function reregisterAiUsage(
  ledger: TimeAccountingLedger,
  input: ReregisterAiUsageInput,
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
  const correctionEntryIds = measurementCorrections(measurement);
  if (isTimeMeasurementActive(measurement)) {
    throw new TimeAccountingError(
      "ALREADY_REGISTERED",
      `AI-use event is already active: ${input.sourceEventId}`,
    );
  }
  const reversalEntryId = correctionEntryIds[correctionEntryIds.length - 1];
  const reversal = ledger.entries.find(({ id }) => id === reversalEntryId);
  if (!reversal || reversal.kind !== "usage-reversal") {
    return invalidLedger("Measurement reversal entry is missing or inconsistent.");
  }
  if (input.postedOn < reversal.postedOn) {
    throw new TimeAccountingError(
      "REREGISTRATION_BEFORE_REVERSAL",
      "A re-registration cannot be posted before its reversal.",
    );
  }
  if (measurement.monthEndAdjustmentEntryId !== undefined) {
    const adjustment = ledger.entries.find(({ id }) => id === measurement.monthEndAdjustmentEntryId);
    if (!adjustment || input.postedOn <= adjustment.postedOn) {
      throw new TimeAccountingError(
        "REVERSAL_IN_CLOSED_PERIOD",
        "A closed-period usage must be re-registered in a later open period.",
      );
    }
  }

  const restoredMeasurement: AiTimeMeasurement = Object.freeze({
    ...measurement,
    correctionEntryIds: Object.freeze([...correctionEntryIds, input.entryId]),
    effectiveInputSeconds: effectiveSeconds(measurement),
    isActive: true,
  });
  const measurements = [...ledger.measurements];
  measurements[measurementIndex] = restoredMeasurement;
  const entry = createEntry(
    input.entryId,
    "usage-reregistration",
    input.postedOn,
    input.sourceEventId,
    TIME_ACCOUNTS.aiClearing,
    TIME_ACCOUNTS.timeContribution,
    effectiveSeconds(measurement),
    undefined,
    reversal.id,
  );
  return freezeLedger(measurements, [...ledger.entries, entry]);
}

/** Appends only the difference between the current and corrected seconds. */
export function correctAiUsage(
  ledger: TimeAccountingLedger,
  input: CorrectAiUsageInput,
): TimeAccountingLedger {
  requireIdentifier(input.entryId, "entryId");
  requireIdentifier(input.sourceEventId, "sourceEventId");
  requireCalendarDate(input.postedOn, "postedOn");
  requireSeconds(input.correctedInputSeconds, "correctedInputSeconds", true);
  requireUniqueEntryId(ledger, input.entryId);
  if (input.reason !== undefined && (typeof input.reason !== "string" || input.reason.length > 500)) {
    throw new TimeAccountingError("INVALID_IDENTIFIER", "reason must be at most 500 characters.");
  }

  const measurementIndex = ledger.measurements.findIndex(
    ({ sourceEventId }) => sourceEventId === input.sourceEventId,
  );
  if (measurementIndex < 0) {
    throw new TimeAccountingError("UNKNOWN_SOURCE_EVENT", `AI-use event is not recorded: ${input.sourceEventId}`);
  }
  const measurement = ledger.measurements[measurementIndex];
  if (!isTimeMeasurementActive(measurement)) {
    throw new TimeAccountingError("INACTIVE_SOURCE_EVENT", "A reversed AI-use event cannot be corrected.");
  }
  const before = effectiveSeconds(measurement);
  if (before === input.correctedInputSeconds) {
    throw new TimeAccountingError("NO_CORRECTION_CHANGE", "The corrected seconds are unchanged.");
  }
  const correctionEntryIds = measurementCorrections(measurement);
  const relatedEntryId = correctionEntryIds[correctionEntryIds.length - 1] ?? measurement.usageEntryId;
  const relatedEntry = ledger.entries.find(({ id }) => id === relatedEntryId);
  if (!relatedEntry) return invalidLedger("Measurement correction chain is missing.");
  if (input.postedOn < relatedEntry.postedOn) {
    throw new TimeAccountingError("CORRECTION_BEFORE_ENTRY", "A correction cannot precede the active entry.");
  }
  if (measurement.monthEndAdjustmentEntryId !== undefined) {
    const adjustment = ledger.entries.find(({ id }) => id === measurement.monthEndAdjustmentEntryId);
    if (!adjustment || input.postedOn <= adjustment.postedOn) {
      throw new TimeAccountingError("REVERSAL_IN_CLOSED_PERIOD", "A closed-period usage must be corrected in a later open period.");
    }
  }

  const after = input.correctedInputSeconds;
  const delta = after - before;
  const correctedMeasurement: AiTimeMeasurement = Object.freeze({
    ...measurement,
    correctionEntryIds: Object.freeze([...correctionEntryIds, input.entryId]),
    effectiveInputSeconds: after,
    isActive: true,
  });
  const measurements = [...ledger.measurements];
  measurements[measurementIndex] = correctedMeasurement;
  const entry = createEntry(
    input.entryId,
    "usage-correction",
    input.postedOn,
    input.sourceEventId,
    delta > 0 ? TIME_ACCOUNTS.aiClearing : TIME_ACCOUNTS.timeContribution,
    delta > 0 ? TIME_ACCOUNTS.timeContribution : TIME_ACCOUNTS.aiClearing,
    Math.abs(delta),
    undefined,
    undefined,
    relatedEntryId,
    before,
    after,
    input.reason?.trim() || undefined,
  );
  return freezeLedger(measurements, [...ledger.entries, entry]);
}

export function isTimeMeasurementActive(measurement: AiTimeMeasurement) {
  if (measurement.isActive !== undefined) return measurement.isActive;
  return measurementCorrections(measurement).length % 2 === 0;
}

export function effectiveTimeMeasurementSeconds(measurement: AiTimeMeasurement) {
  return effectiveSeconds(measurement);
}

export function journalTotals(entry: TimeJournalEntry) {
  let debitSeconds = 0;
  let creditSeconds = 0;
  for (const line of entry.lines) {
    if (line.side === "debit") debitSeconds += line.seconds;
    else creditSeconds += line.seconds;
  }
  return { debitSeconds, creditSeconds };
}

export function isBalancedJournalEntry(entry: TimeJournalEntry): boolean {
  const { debitSeconds, creditSeconds } = journalTotals(entry);
  return debitSeconds === creditSeconds;
}

/** Returns the debit balance. A negative result is a credit balance. */
export function accountBalanceSeconds(
  ledger: TimeAccountingLedger,
  account: TimeAccount,
): number {
  return ledger.entries.reduce((balance, entry) => (
    balance + entry.lines.reduce((entryBalance, line) => {
      if (line.account !== account) return entryBalance;
      return entryBalance + (line.side === "debit" ? line.seconds : -line.seconds);
    }, 0)
  ), 0);
}

/** Estimated savings are deliberately absent from this P/L result. */
export function calculateTimeProfitAndLoss(ledger: TimeAccountingLedger) {
  return Object.freeze({
    thoughtExplorationExpenseSeconds: accountBalanceSeconds(
      ledger,
      TIME_ACCOUNTS.thoughtExplorationExpense,
    ),
  });
}

/** Keeps measured actual input and non-accounting estimates visibly separate. */
export function summarizeTimeMeasurements(ledger: TimeAccountingLedger) {
  return Object.freeze(ledger.measurements.reduce((summary, measurement) => ({
    actualInputSeconds: summary.actualInputSeconds + measurement.actualInputSeconds,
    estimatedSavedSeconds: summary.estimatedSavedSeconds + measurement.estimatedSavedSeconds,
  }), { actualInputSeconds: 0, estimatedSavedSeconds: 0 }));
}

function createEntry(
  id: string,
  kind: TimeJournalEntryKind,
  postedOn: string,
  sourceEventId: string,
  debitAccount: TimeAccount,
  creditAccount: TimeAccount,
  seconds: number,
  reversesEntryId?: string,
  restoresEntryId?: string,
  correctsEntryId?: string,
  effectiveSecondsBefore?: number,
  effectiveSecondsAfter?: number,
  correctionReason?: string,
): TimeJournalEntry {
  const debit: TimeJournalLine = Object.freeze({
    side: "debit",
    account: debitAccount,
    seconds,
    measurement: "actual-input",
  });
  const credit: TimeJournalLine = Object.freeze({
    side: "credit",
    account: creditAccount,
    seconds,
    measurement: "actual-input",
  });
  const lines = Object.freeze([debit, credit]) as readonly [TimeJournalLine, TimeJournalLine];
  return Object.freeze({
    id,
    kind,
    postedOn,
    sourceEventId,
    ...(reversesEntryId === undefined ? {} : { reversesEntryId }),
    ...(restoresEntryId === undefined ? {} : { restoresEntryId }),
    ...(correctsEntryId === undefined ? {} : { correctsEntryId }),
    ...(effectiveSecondsBefore === undefined ? {} : { effectiveSecondsBefore }),
    ...(effectiveSecondsAfter === undefined ? {} : { effectiveSecondsAfter }),
    ...(correctionReason === undefined ? {} : { correctionReason }),
    lines,
  });
}

function freezeLedger(
  measurements: readonly AiTimeMeasurement[],
  entries: readonly TimeJournalEntry[],
): TimeAccountingLedger {
  return Object.freeze({
    version: 2 as const,
    unit: "second" as const,
    measurements: Object.freeze([...measurements]),
    entries: Object.freeze([...entries]),
  });
}

function normalizeLedger(raw: Record<string, unknown>, fromMinutes: boolean): TimeAccountingLedger {
  if (!Array.isArray(raw.measurements) || !Array.isArray(raw.entries)) {
    return invalidLedger("Ledger measurements and entries must be arrays.");
  }
  const amountKey = fromMinutes ? "minutes" : "seconds";
  const actualKey = fromMinutes ? "actualInputMinutes" : "actualInputSeconds";
  const estimatedKey = fromMinutes ? "estimatedSavedMinutes" : "estimatedSavedSeconds";

  const measurements = raw.measurements.map((item): AiTimeMeasurement => {
    if (!isObject(item)) return invalidLedger("Measurement must be an object.");
    const sourceEventId = ledgerIdentifier(item.sourceEventId, "sourceEventId");
    const occurredOn = ledgerDate(item.occurredOn, "occurredOn");
    const actualInputSeconds = ledgerAmount(item[actualKey], actualKey, false, fromMinutes);
    const estimatedSavedSeconds = ledgerAmount(item[estimatedKey], estimatedKey, true, fromMinutes);
    const usageEntryId = ledgerIdentifier(item.usageEntryId, "usageEntryId");
    const monthEndAdjustmentEntryId = item.monthEndAdjustmentEntryId === undefined
      ? undefined
      : ledgerIdentifier(item.monthEndAdjustmentEntryId, "monthEndAdjustmentEntryId");
    const reversalEntryId = item.reversalEntryId === undefined
      ? undefined
      : ledgerIdentifier(item.reversalEntryId, "reversalEntryId");
    const correctionEntryIds = item.correctionEntryIds === undefined
      ? reversalEntryId === undefined ? [] : [reversalEntryId]
      : Array.isArray(item.correctionEntryIds)
        ? item.correctionEntryIds.map((id) => ledgerIdentifier(id, "correctionEntryId"))
        : invalidLedger("correctionEntryIds must be an array.");
    if (new Set(correctionEntryIds).size !== correctionEntryIds.length) {
      return invalidLedger("Measurement correction entry ids are inconsistent.");
    }
    const effectiveInputSeconds = item.effectiveInputSeconds === undefined
      ? undefined
      : ledgerAmount(item.effectiveInputSeconds, "effectiveInputSeconds", true, false);
    const isActive = item.isActive === undefined
      ? undefined
      : typeof item.isActive === "boolean" ? item.isActive : invalidLedger("isActive must be boolean.");
    return Object.freeze({
      sourceEventId,
      occurredOn,
      actualInputSeconds,
      estimatedSavedSeconds,
      usageEntryId,
      ...(monthEndAdjustmentEntryId === undefined ? {} : { monthEndAdjustmentEntryId }),
      ...(reversalEntryId === undefined ? {} : { reversalEntryId }),
      ...(correctionEntryIds.length === 0 ? {} : { correctionEntryIds: Object.freeze(correctionEntryIds) }),
      ...(effectiveInputSeconds === undefined ? {} : { effectiveInputSeconds }),
      ...(isActive === undefined ? {} : { isActive }),
    });
  });

  const entries = raw.entries.map((item): TimeJournalEntry => {
    if (!isObject(item) || !Array.isArray(item.lines) || item.lines.length !== 2) {
      return invalidLedger("Journal entry must contain exactly two lines.");
    }
    const id = ledgerIdentifier(item.id, "entry id");
    const kind = item.kind === "ai-usage" || item.kind === "month-end-adjustment"
      || item.kind === "usage-reversal" || item.kind === "usage-reregistration" || item.kind === "usage-correction"
      ? item.kind
      : invalidLedger("Journal entry kind is invalid.");
    const postedOn = ledgerDate(item.postedOn, "postedOn");
    const sourceEventId = ledgerIdentifier(item.sourceEventId, "sourceEventId");
    const reversesEntryId = item.reversesEntryId === undefined
      ? undefined
      : ledgerIdentifier(item.reversesEntryId, "reversesEntryId");
    const restoresEntryId = item.restoresEntryId === undefined
      ? undefined
      : ledgerIdentifier(item.restoresEntryId, "restoresEntryId");
    const correctsEntryId = item.correctsEntryId === undefined
      ? undefined
      : ledgerIdentifier(item.correctsEntryId, "correctsEntryId");
    const effectiveSecondsBefore = item.effectiveSecondsBefore === undefined
      ? undefined
      : ledgerAmount(item.effectiveSecondsBefore, "effectiveSecondsBefore", true, false);
    const effectiveSecondsAfter = item.effectiveSecondsAfter === undefined
      ? undefined
      : ledgerAmount(item.effectiveSecondsAfter, "effectiveSecondsAfter", true, false);
    const correctionReason = item.correctionReason === undefined
      ? undefined
      : typeof item.correctionReason === "string" && item.correctionReason.length <= 500
        ? item.correctionReason
        : invalidLedger("correctionReason is invalid.");
    if ((kind === "usage-reversal") !== (reversesEntryId !== undefined)
      || (kind === "usage-reregistration") !== (restoresEntryId !== undefined)
      || (kind === "usage-correction") !== (correctsEntryId !== undefined)
      || (kind === "usage-correction") !== (effectiveSecondsBefore !== undefined && effectiveSecondsAfter !== undefined)
      || [reversesEntryId, restoresEntryId, correctsEntryId].filter((value) => value !== undefined).length > 1) {
      return invalidLedger("Journal entry relation is invalid.");
    }
    const lines = item.lines.map((line): TimeJournalLine => {
      if (!isObject(line)) return invalidLedger("Journal line must be an object.");
      const side = line.side === "debit" || line.side === "credit"
        ? line.side
        : invalidLedger("Journal side is invalid.");
      const account = Object.values(TIME_ACCOUNTS).includes(line.account as TimeAccount)
        ? line.account as TimeAccount
        : invalidLedger("Time account is invalid.");
      if (line.measurement !== "actual-input") return invalidLedger("Measurement type is invalid.");
      const seconds = ledgerAmount(line[amountKey], amountKey, kind !== "ai-usage", fromMinutes);
      return Object.freeze({ side, account, seconds, measurement: "actual-input" as const });
    }) as [TimeJournalLine, TimeJournalLine];
    const entry: TimeJournalEntry = Object.freeze({
      id,
      kind,
      postedOn,
      sourceEventId,
      ...(reversesEntryId === undefined ? {} : { reversesEntryId }),
      ...(restoresEntryId === undefined ? {} : { restoresEntryId }),
      ...(correctsEntryId === undefined ? {} : { correctsEntryId }),
      ...(effectiveSecondsBefore === undefined ? {} : { effectiveSecondsBefore }),
      ...(effectiveSecondsAfter === undefined ? {} : { effectiveSecondsAfter }),
      ...(correctionReason === undefined ? {} : { correctionReason }),
      lines: Object.freeze(lines) as readonly [TimeJournalLine, TimeJournalLine],
    });
    if (new Set(lines.map(({ side }) => side)).size !== 2 || !isBalancedJournalEntry(entry)) {
      return invalidLedger("Journal entry is not balanced.");
    }
    return entry;
  });

  validateLedgerLinks(measurements, entries);
  return freezeLedger(measurements, entries);
}

function validateLedgerLinks(
  measurements: readonly AiTimeMeasurement[],
  entries: readonly TimeJournalEntry[],
) {
  if (new Set(measurements.map(({ sourceEventId }) => sourceEventId)).size !== measurements.length) {
    invalidLedger("Measurement sourceEventId values must be unique.");
  }
  if (new Set(entries.map(({ id }) => id)).size !== entries.length) {
    invalidLedger("Journal entry ids must be unique.");
  }
  const entriesById = new Map(entries.map(entry => [entry.id, entry]));
  const measurementsBySource = new Map(measurements.map(item => [item.sourceEventId, item]));
  for (const measurement of measurements) {
    const usage = entriesById.get(measurement.usageEntryId);
    if (!usage || usage.kind !== "ai-usage" || usage.sourceEventId !== measurement.sourceEventId
      || usage.lines[0].seconds !== measurement.actualInputSeconds) {
      invalidLedger("Measurement usage entry is missing or inconsistent.");
    }
    if (measurement.monthEndAdjustmentEntryId !== undefined) {
      const adjustment = entriesById.get(measurement.monthEndAdjustmentEntryId);
      if (!adjustment || adjustment.kind !== "month-end-adjustment"
        || adjustment.sourceEventId !== measurement.sourceEventId
        || adjustment.lines[0].seconds < 0
        || adjustment.lines.find((line) => line.side === "debit")?.account !== TIME_ACCOUNTS.thoughtExplorationExpense
        || adjustment.lines.find((line) => line.side === "credit")?.account !== TIME_ACCOUNTS.aiClearing) {
        invalidLedger("Measurement adjustment entry is missing or inconsistent.");
      }
    }
    const correctionEntryIds = measurementCorrections(measurement);
    const firstReversalId = correctionEntryIds.find((id) => entriesById.get(id)?.kind === "usage-reversal");
    if (measurement.reversalEntryId !== undefined && firstReversalId !== measurement.reversalEntryId) {
      invalidLedger("Measurement legacy reversal link is inconsistent.");
    }
    let relatedEntry = usage;
    let previousPostedOn = usage.postedOn;
    let active = true;
    let currentSeconds = measurement.actualInputSeconds;
    for (const correctionId of correctionEntryIds) {
      const correction = entriesById.get(correctionId);
      const debit = correction?.lines.find((line) => line.side === "debit");
      const credit = correction?.lines.find((line) => line.side === "credit");
      if (!correction || !debit || !credit || correction.sourceEventId !== measurement.sourceEventId
        || correction.postedOn < previousPostedOn) {
        invalidLedger("Measurement correction entry chain is missing or inconsistent.");
      }
      if (correction.kind === "usage-reversal") {
        if (!active || correction.reversesEntryId !== relatedEntry.id
          || debit.account !== TIME_ACCOUNTS.timeContribution || credit.account !== TIME_ACCOUNTS.aiClearing
          || debit.seconds !== currentSeconds) {
          invalidLedger("Measurement reversal is missing or inconsistent.");
        }
        active = false;
      } else if (correction.kind === "usage-reregistration") {
        if (active || correction.restoresEntryId !== relatedEntry.id
          || debit.account !== TIME_ACCOUNTS.aiClearing || credit.account !== TIME_ACCOUNTS.timeContribution
          || debit.seconds !== currentSeconds) {
          invalidLedger("Measurement re-registration is missing or inconsistent.");
        }
        active = true;
      } else if (correction.kind === "usage-correction") {
        const before = correction.effectiveSecondsBefore;
        const after = correction.effectiveSecondsAfter;
        const delta = before === undefined || after === undefined ? 0 : after - before;
        if (!active || correction.correctsEntryId !== relatedEntry.id || before !== currentSeconds
          || after === undefined || after < 0 || delta === 0 || debit.seconds !== Math.abs(delta)
          || debit.account !== (delta > 0 ? TIME_ACCOUNTS.aiClearing : TIME_ACCOUNTS.timeContribution)
          || credit.account !== (delta > 0 ? TIME_ACCOUNTS.timeContribution : TIME_ACCOUNTS.aiClearing)) {
          invalidLedger("Measurement partial correction is missing or inconsistent.");
        }
        currentSeconds = after;
      } else {
        invalidLedger("Measurement correction kind is invalid.");
      }
      relatedEntry = correction;
      previousPostedOn = correction.postedOn;
    }
    if ((measurement.effectiveInputSeconds !== undefined && measurement.effectiveInputSeconds !== currentSeconds)
      || (measurement.isActive !== undefined && measurement.isActive !== active)) {
      invalidLedger("Measurement effective state is inconsistent.");
    }
  }
  if (entries.some(entry => !measurementsBySource.has(entry.sourceEventId))) {
    invalidLedger("Journal entry has no matching measurement.");
  }
  if (entries.some((entry) => (entry.kind === "usage-reversal" || entry.kind === "usage-reregistration" || entry.kind === "usage-correction")
    && !measurementCorrections(measurementsBySource.get(entry.sourceEventId)).includes(entry.id))) {
    invalidLedger("Correction entry is not linked from its measurement.");
  }
}

function measurementCorrections(measurement: AiTimeMeasurement | undefined): readonly string[] {
  if (!measurement) return [];
  if (measurement.correctionEntryIds !== undefined) return measurement.correctionEntryIds;
  return measurement.reversalEntryId === undefined ? [] : [measurement.reversalEntryId];
}

function effectiveSeconds(measurement: AiTimeMeasurement) {
  return measurement.effectiveInputSeconds ?? measurement.actualInputSeconds;
}

function ledgerAmount(value: unknown, name: string, allowZero: boolean, fromMinutes: boolean) {
  if (!Number.isSafeInteger(value) || (allowZero ? Number(value) < 0 : Number(value) <= 0)) {
    return invalidLedger(`${name} must be a safe whole number.`);
  }
  if (!fromMinutes) return value as number;
  const seconds = Number(value) * 60;
  if (!Number.isSafeInteger(seconds)) return invalidLedger(`${name} is too large to convert safely.`);
  return seconds;
}

function ledgerIdentifier(value: unknown, name: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return invalidLedger(`${name} must not be empty.`);
  }
  return value;
}

function ledgerDate(value: unknown, name: string) {
  if (typeof value !== "string" || !isCalendarDate(value)) {
    return invalidLedger(`${name} must be a valid date.`);
  }
  return value;
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

function requireSeconds(value: number, name: string, allowZero: boolean) {
  if (!Number.isSafeInteger(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new TimeAccountingError(
      name === "estimatedSavedSeconds" ? "INVALID_ESTIMATED_SECONDS" : "INVALID_ACTUAL_SECONDS",
      `${name} must be ${allowZero ? "a non-negative" : "a positive"} whole number of seconds.`,
    );
  }
}

function requireCalendarDate(value: string, name: string) {
  if (!isCalendarDate(value)) {
    throw new TimeAccountingError("INVALID_DATE", `${name} must be a valid YYYY-MM-DD date.`);
  }
}

function isCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function invalidLedger(message: string): never {
  throw new TimeAccountingError("INVALID_LEDGER", message);
}
