import {
  accountingPeriodForDate,
  isAccountingPeriodClosed,
  lastDateOfAccountingPeriod,
  type AccountingPeriodState,
} from "./accountingPeriods.ts";
import {
  TIME_ACCOUNTS,
  isBalancedJournalEntry,
  migrateTimeAccountingLedger,
  recordMonthEndAdjustment,
  type TimeAccountingLedger,
  type TimeJournalEntry,
} from "./timeAccounting.ts";

export type MonthEndValidationIssue = Readonly<{
  code: string;
  message: string;
  recordId?: string;
}>;

export type MonthEndTransferPreview = Readonly<{
  entryId: string;
  sourceEventId: string;
  postedOn: string;
  seconds: number;
  debitAccount: typeof TIME_ACCOUNTS.thoughtExplorationExpense;
  creditAccount: typeof TIME_ACCOUNTS.aiClearing;
}>;

export type MonthEndClosePreview = Readonly<{
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  alreadyClosed: boolean;
  timeJournalEntryCount: number;
  thoughtJournalEntryCount: number;
  timeDebitSeconds: number;
  timeCreditSeconds: number;
  thoughtDebitUnits: number;
  thoughtCreditUnits: number;
  unresolvedAiClearingSeconds: number;
  unprocessedTimeRecordCount: number;
  unprocessedCount: number;
  existingTransferEntryCount: number;
  plannedTransfers: readonly MonthEndTransferPreview[];
  validationIssues: readonly MonthEndValidationIssue[];
  canClose: boolean;
  projectedLedger: TimeAccountingLedger;
}>;

export type BuildMonthEndClosePreviewInput = Readonly<{
  periodKey: string;
  ledger: TimeAccountingLedger;
  periodState: AccountingPeriodState;
  thoughtJournalData: unknown;
  confirmedThoughtExplorationSourceEventIds?: readonly string[];
}>;

/**
 * Pure close preview. Unconfirmed AI-clearing balances are deliberately left
 * untouched. Only explicitly confirmed source events produce a transfer plan.
 */
export function buildMonthEndClosePreview(
  input: BuildMonthEndClosePreviewInput,
): MonthEndClosePreview {
  const periodStart = `${input.periodKey}-01`;
  // Strictly validate the period without exposing accountingPeriods internals.
  accountingPeriodForDate(periodStart);
  const periodEnd = lastDateOfAccountingPeriod(input.periodKey);
  const alreadyClosed = isAccountingPeriodClosed(input.periodState, input.periodKey);
  const issues: MonthEndValidationIssue[] = [];
  let ledger: TimeAccountingLedger;
  try {
    ledger = migrateTimeAccountingLedger(input.ledger);
  } catch {
    ledger = input.ledger;
    issues.push(issue("INVALID_TIME_LEDGER", "時間仕訳の保存形式が正しくありません。"));
  }

  const entries = Array.isArray(ledger.entries) ? ledger.entries : [];
  const periodEntries = entries.filter((entry) => entry.postedOn >= periodStart && entry.postedOn <= periodEnd);
  for (const entry of periodEntries) {
    if (!isBalancedJournalEntry(entry)) {
      issues.push(issue("UNBALANCED_TIME_ENTRY", "時間仕訳の借方と貸方が一致しません。", entry.id));
    }
  }
  const duplicateEntryIds = duplicates(entries.map((entry) => entry.id));
  duplicateEntryIds.forEach((id) => issues.push(issue("DUPLICATE_TIME_ENTRY", "時間仕訳IDが重複しています。", id)));
  const duplicateSources = duplicates(ledger.measurements.map((measurement) => measurement.sourceEventId));
  duplicateSources.forEach((id) => issues.push(issue("DUPLICATE_SOURCE_EVENT", "時間記録IDが重複しています。", id)));

  const thought = analyzeThoughtJournals(input.thoughtJournalData, input.periodKey);
  issues.push(...thought.issues);

  const confirmed = alreadyClosed ? [] : input.confirmedThoughtExplorationSourceEventIds ?? [];
  duplicates(confirmed).forEach((id) => {
    issues.push(issue("DUPLICATE_TRANSFER_REQUEST", "同じ振替対象が重複指定されています。", id));
  });
  let projectedLedger = ledger;
  const plannedTransfers: MonthEndTransferPreview[] = [];
  for (const sourceEventId of new Set(confirmed)) {
    const measurement = projectedLedger.measurements.find((item) => item.sourceEventId === sourceEventId);
    if (!measurement) {
      issues.push(issue("UNKNOWN_TRANSFER_SOURCE", "振替対象の時間記録が見つかりません。", sourceEventId));
      continue;
    }
    const stateAtClose = measurementStateAt(projectedLedger, measurement, periodEnd);
    if (stateAtClose.adjusted) continue;
    const usageEntry = projectedLedger.entries.find((entry) => entry.id === measurement.usageEntryId);
    const hasFutureAction = (measurement.correctionEntryIds ?? (measurement.reversalEntryId ? [measurement.reversalEntryId] : []))
      .some((entryId) => {
        const entry = projectedLedger.entries.find((candidate) => candidate.id === entryId);
        return Boolean(entry && entry.postedOn > periodEnd);
      });
    const adjustmentEntry = measurement.monthEndAdjustmentEntryId === undefined
      ? undefined
      : projectedLedger.entries.find((entry) => entry.id === measurement.monthEndAdjustmentEntryId);
    if (!usageEntry || usageEntry.postedOn > periodEnd || !stateAtClose.active
      || hasFutureAction || Boolean(adjustmentEntry && adjustmentEntry.postedOn > periodEnd)) {
      issues.push(issue("INELIGIBLE_TRANSFER_SOURCE", "対象月末に振り替えられない時間記録です。", sourceEventId));
      continue;
    }
    const seconds = stateAtClose.seconds;
    if (seconds === 0) continue;
    const entryId = monthEndTransferEntryId(input.periodKey, sourceEventId);
    try {
      projectedLedger = recordMonthEndAdjustment(projectedLedger, {
        entryId,
        sourceEventId,
        postedOn: periodEnd,
      });
      plannedTransfers.push(Object.freeze({
        entryId,
        sourceEventId,
        postedOn: periodEnd,
        seconds,
        debitAccount: TIME_ACCOUNTS.thoughtExplorationExpense,
        creditAccount: TIME_ACCOUNTS.aiClearing,
      }));
    } catch {
      issues.push(issue("INVALID_TRANSFER", "月末振替仕訳を生成できません。", sourceEventId));
    }
  }

  const timeTotals = totals(periodEntries);
  const asOfClose = projectedLedger.entries.filter((entry) => entry.postedOn <= periodEnd);
  const unresolvedAiClearingSeconds = accountBalance(asOfClose, TIME_ACCOUNTS.aiClearing);
  if (unresolvedAiClearingSeconds < 0) {
    issues.push(issue("NEGATIVE_AI_CLEARING_BALANCE", "AI仮受品の残高が貸方超過になっています。"));
  }
  const sourceIds = new Set(asOfClose.map((entry) => entry.sourceEventId));
  const unprocessedTimeRecordCount = [...sourceIds].filter((sourceEventId) => (
    accountBalance(asOfClose.filter((entry) => entry.sourceEventId === sourceEventId), TIME_ACCOUNTS.aiClearing) > 0
  )).length;
  return Object.freeze({
    periodKey: input.periodKey,
    periodStart,
    periodEnd,
    alreadyClosed,
    timeJournalEntryCount: periodEntries.length,
    thoughtJournalEntryCount: thought.count,
    timeDebitSeconds: timeTotals.debit,
    timeCreditSeconds: timeTotals.credit,
    thoughtDebitUnits: thought.debit,
    thoughtCreditUnits: thought.credit,
    unresolvedAiClearingSeconds,
    unprocessedTimeRecordCount,
    unprocessedCount: unprocessedTimeRecordCount,
    existingTransferEntryCount: periodEntries.filter((entry) => entry.kind === "month-end-adjustment").length,
    plannedTransfers: Object.freeze(plannedTransfers),
    validationIssues: Object.freeze(issues),
    canClose: !alreadyClosed && issues.length === 0,
    projectedLedger,
  });
}

export function monthEndTransferEntryId(periodKey: string, sourceEventId: string) {
  return `month-end:${periodKey}:${sourceEventId}`;
}

function analyzeThoughtJournals(value: unknown, periodKey: string) {
  const issues: MonthEndValidationIssue[] = [];
  if (!Array.isArray(value)) {
    return { count: 0, debit: 0, credit: 0, issues: [issue("INVALID_THOUGHT_STORE", "思考仕訳の保存形式が正しくありません。")] };
  }
  const ids: string[] = [];
  let count = 0;
  let debit = 0;
  let credit = 0;
  for (const candidate of value) {
    if (!isObject(candidate) || typeof candidate.id !== "string" || !candidate.id.trim()
      || typeof candidate.date !== "string") {
      issues.push(issue("INVALID_THOUGHT_RECORD", "思考仕訳の記録IDまたは日付が正しくありません。"));
      continue;
    }
    ids.push(candidate.id);
    let recordPeriod: string;
    try {
      recordPeriod = accountingPeriodForDate(candidate.date);
    } catch {
      issues.push(issue("INVALID_THOUGHT_RECORD", "思考仕訳の日付が正しくありません。", candidate.id));
      continue;
    }
    if (recordPeriod !== periodKey || candidate.journal === undefined) continue;
    count += 1;
    const journal = parseThoughtJournal(candidate.journal);
    if (!journal) {
      issues.push(issue("INVALID_THOUGHT_JOURNAL", "思考仕訳の金額または形式が正しくありません。", candidate.id));
      continue;
    }
    const recordDebit = journal.thoughtAsset + journal.thoughtExpense;
    const recordCredit = journal.aiBorrowing + journal.selfCapital;
    debit += recordDebit;
    credit += recordCredit;
    if (recordDebit !== recordCredit) {
      issues.push(issue("UNBALANCED_THOUGHT_ENTRY", "思考仕訳の借方と貸方が一致しません。", candidate.id));
    }
  }
  duplicates(ids).forEach((id) => issues.push(issue("DUPLICATE_THOUGHT_ENTRY", "思考仕訳IDが重複しています。", id)));
  return { count, debit, credit, issues };
}

function parseThoughtJournal(value: unknown) {
  if (!isObject(value)) return null;
  const amount = (key: string) => {
    const unit = value[key];
    return isObject(unit) && Number.isSafeInteger(unit.amount) && Number(unit.amount) > 0 && Number(unit.amount) <= 5
      ? Number(unit.amount)
      : null;
  };
  const aiBorrowing = amount("aiBorrowing");
  const selfCapital = amount("selfCapital");
  const thoughtAsset = amount("thoughtAsset");
  const thoughtExpense = amount("thoughtExpense");
  if ([aiBorrowing, selfCapital, thoughtAsset, thoughtExpense].some((item) => item === null)) return null;
  return { aiBorrowing: aiBorrowing!, selfCapital: selfCapital!, thoughtAsset: thoughtAsset!, thoughtExpense: thoughtExpense! };
}

function totals(entries: readonly TimeJournalEntry[]) {
  let debit = 0;
  let credit = 0;
  for (const entry of entries) {
    for (const line of entry.lines) {
      if (line.side === "debit") debit += line.seconds;
      else credit += line.seconds;
    }
  }
  return { debit, credit };
}

function measurementStateAt(
  ledger: TimeAccountingLedger,
  measurement: TimeAccountingLedger["measurements"][number],
  periodEnd: string,
) {
  const usageEntry = ledger.entries.find((entry) => entry.id === measurement.usageEntryId);
  if (!usageEntry || usageEntry.postedOn > periodEnd) {
    return { exists: false, active: false, seconds: 0, adjusted: false };
  }
  let active = true;
  let seconds = measurement.actualInputSeconds;
  const correctionIds = measurement.correctionEntryIds
    ?? (measurement.reversalEntryId === undefined ? [] : [measurement.reversalEntryId]);
  for (const entryId of correctionIds) {
    const entry = ledger.entries.find((candidate) => candidate.id === entryId);
    if (!entry || entry.postedOn > periodEnd) continue;
    if (entry.kind === "usage-reversal") active = false;
    if (entry.kind === "usage-reregistration") active = true;
    if (entry.kind === "usage-correction" && entry.effectiveSecondsAfter !== undefined) {
      seconds = entry.effectiveSecondsAfter;
    }
  }
  const adjustment = measurement.monthEndAdjustmentEntryId === undefined
    ? undefined
    : ledger.entries.find((entry) => entry.id === measurement.monthEndAdjustmentEntryId);
  return { exists: true, active, seconds, adjusted: Boolean(adjustment && adjustment.postedOn <= periodEnd) };
}

function accountBalance(entries: readonly TimeJournalEntry[], account: string) {
  return entries.reduce((balance, entry) => balance + entry.lines.reduce((subtotal, line) => (
    line.account === account ? subtotal + (line.side === "debit" ? line.seconds : -line.seconds) : subtotal
  ), 0), 0);
}

function duplicates(values: readonly string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  values.forEach((value) => seen.has(value) ? duplicates.add(value) : seen.add(value));
  return [...duplicates];
}

function issue(code: string, message: string, recordId?: string): MonthEndValidationIssue {
  return Object.freeze({ code, message, ...(recordId === undefined ? {} : { recordId }) });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
