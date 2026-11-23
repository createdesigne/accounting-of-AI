import { dateKey, periodBounds } from "./ledgerPeriods.ts";
import type {
  AccountingDisposition,
  TaskV1,
  WeeklyRecordV1,
  WeeklyTimeSource,
} from "./weeklyData.ts";
import { WEEKLY_EXPENSE_ACCOUNT_NAMES, type WeeklyExpenseAccount } from "./weeklyAccountingTypes.ts";

export const WEEKLY_ACCOUNTS = {
  aiClearing: "AI仮受品",
  timeContribution: "時間拠出",
  consultationExpense: "相談活動費",
  thoughtExplorationExpense: "思考探究費",
  deliverableExpense: "成果物利用費",
  researchExpense: "情報収集費",
  learningExpense: "学習活動費",
  otherExpense: "その他AI利用費",
  deliverableAsset: "成果物資産",
  workInProgress: "仕掛成果物",
  accumulatedTimeLoss: "累積時間損失",
} as const;

export const WEEKLY_EXPENSE_ACCOUNTS = WEEKLY_EXPENSE_ACCOUNT_NAMES;
export type { WeeklyExpenseAccount };

export type WeeklyAccount = typeof WEEKLY_ACCOUNTS[keyof typeof WEEKLY_ACCOUNTS];
export type WeeklyJournalLine = Readonly<{
  side: "debit" | "credit";
  account: WeeklyAccount;
  seconds: number;
}>;
export type WeeklyJournalEntry = Readonly<{
  id: string;
  recordId: string;
  weekKey: string;
  kind: "usage-recognition" | "classification";
  timeSource: WeeklyTimeSource;
  lines: readonly [WeeklyJournalLine, WeeklyJournalLine];
}>;

export type WeeklyStatementLine = Readonly<{
  account: WeeklyAccount;
  seconds: number;
}>;

export type WeeklyAllocation = Readonly<{
  recordId: string;
  weekKey: string;
  weekStart: Date;
  weekEndExclusive: Date;
  seconds: number;
}>;

export type WeeklySettlementV1 = Readonly<{
  schemaVersion: 1;
  id: string;
  weekStart: string;
  weekEndExclusive: string;
  status: "unconfirmed" | "confirmed";
  recordIds: readonly string[];
  journalEntryIds: readonly string[];
  totals: Readonly<{
    recordSeconds: number;
    expenseSeconds: number;
    assetSeconds: number;
    workInProgressSeconds: number;
    unclassifiedSeconds: number;
    recordCount: number;
  }>;
  trialBalance: Readonly<{
    debitSeconds: number;
    creditSeconds: number;
    isBalanced: boolean;
  }>;
  /**
   * Time-accounting presentation, not a corporate financial statement.
   * The expense is closed to a debit-side accumulated time loss so the
   * balance-sheet-like view remains balanced.
   */
  statement: Readonly<{
    assetAndClearingSeconds: number;
    accumulatedTimeLossSeconds: number;
    contributedTimeSeconds: number;
    expenseSeconds: number;
    isBalanced: boolean;
  }>;
  balanceSheet: Readonly<{
    debit: readonly WeeklyStatementLine[];
    credit: readonly WeeklyStatementLine[];
    debitSeconds: number;
    creditSeconds: number;
    isBalanced: boolean;
  }>;
  profitAndLoss: Readonly<{
    expenses: readonly WeeklyStatementLine[];
    totalExpenseSeconds: number;
  }>;
  analysis: Readonly<{
    notConnectedCount: number;
    notEvaluatedCount: number;
  }>;
}>;

export function weekBoundsForTimestamp(value: string | Date) {
  const timestamp = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new Error("A valid timestamp is required.");
  return periodBounds(timestamp, "weekly");
}

/**
 * Allocates integer active seconds across local Monday-starting weeks.
 * When the measured wall-clock interval and active seconds differ, seconds
 * are distributed proportionally and the largest remainders receive the
 * remaining whole seconds. The total is therefore always exact.
 */
export function allocateRecordToWeeks(record: WeeklyRecordV1): readonly WeeklyAllocation[] {
  const fallback = new Date(record.recordedAt);
  const start = record.startedAt ? new Date(record.startedAt) : fallback;
  const end = record.endedAt ? new Date(record.endedAt) : null;
  if (!end || end.getTime() <= start.getTime() || record.activeSeconds === 0) {
    const bounds = weekBoundsForTimestamp(start);
    return Object.freeze([freezeAllocation(record.id, bounds.start, bounds.end, record.activeSeconds)]);
  }

  const spans: Array<{ start: Date; end: Date; milliseconds: number }> = [];
  let cursor = new Date(start);
  while (cursor < end) {
    const bounds = weekBoundsForTimestamp(cursor);
    const segmentEnd = new Date(Math.min(bounds.end.getTime(), end.getTime()));
    spans.push({ start: bounds.start, end: bounds.end, milliseconds: segmentEnd.getTime() - cursor.getTime() });
    cursor = segmentEnd;
  }
  const totalMilliseconds = end.getTime() - start.getTime();
  const raw = spans.map((span, index) => {
    const exact = record.activeSeconds * span.milliseconds / totalMilliseconds;
    return { index, floor: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let remaining = record.activeSeconds - raw.reduce((sum, item) => sum + item.floor, 0);
  [...raw].sort((a, b) => b.remainder - a.remainder || a.index - b.index).forEach((item) => {
    if (remaining > 0) {
      raw[item.index].floor += 1;
      remaining -= 1;
    }
  });
  return Object.freeze(spans.map((span, index) => freezeAllocation(
    record.id,
    span.start,
    span.end,
    raw[index].floor,
  )));
}

export function buildWeeklySettlement(
  records: readonly WeeklyRecordV1[],
  anchor: Date,
  tasks: readonly TaskV1[] = [],
): WeeklySettlementV1 {
  const bounds = periodBounds(anchor, "weekly");
  const weekKey = dateKey(bounds.start);
  const allocations = weeklyRecordAllocations(records, tasks, weekKey);
  const entries = allocations.flatMap(({ record, allocation }) =>
    buildJournalEntries(record, allocation.seconds, allocation.weekKey));
  const totals = {
    recordSeconds: sum(allocations.map(({ allocation }) => allocation.seconds)),
    expenseSeconds: dispositionSeconds(allocations, "expense"),
    assetSeconds: dispositionSeconds(allocations, "asset"),
    workInProgressSeconds: dispositionSeconds(allocations, "work-in-progress"),
    unclassifiedSeconds: dispositionSeconds(allocations, "unclassified"),
    recordCount: allocations.length,
  };
  const debitSeconds = sum(entries.flatMap((entry) => entry.lines)
    .filter((line) => line.side === "debit").map((line) => line.seconds));
  const creditSeconds = sum(entries.flatMap((entry) => entry.lines)
    .filter((line) => line.side === "credit").map((line) => line.seconds));
  const assetAndClearingSeconds = totals.assetSeconds + totals.workInProgressSeconds + totals.unclassifiedSeconds;
  const accumulatedTimeLossSeconds = totals.expenseSeconds;
  const statementDebit = assetAndClearingSeconds + accumulatedTimeLossSeconds;
  const statementCredit = totals.recordSeconds;
  const balanceSheetDebit = Object.freeze([
    Object.freeze({ account: WEEKLY_ACCOUNTS.aiClearing, seconds: totals.unclassifiedSeconds }),
    Object.freeze({ account: WEEKLY_ACCOUNTS.deliverableAsset, seconds: totals.assetSeconds }),
    Object.freeze({ account: WEEKLY_ACCOUNTS.workInProgress, seconds: totals.workInProgressSeconds }),
    Object.freeze({ account: WEEKLY_ACCOUNTS.accumulatedTimeLoss, seconds: totals.expenseSeconds }),
  ]);
  const balanceSheetCredit = Object.freeze([
    Object.freeze({ account: WEEKLY_ACCOUNTS.timeContribution, seconds: totals.recordSeconds }),
  ]);
  const expenses = Object.freeze(WEEKLY_EXPENSE_ACCOUNTS.map((account) => Object.freeze({
    account,
    seconds: sum(entries.filter((entry) => entry.kind === "classification")
      .flatMap((entry) => entry.lines)
      .filter((line) => line.side === "debit" && line.account === account)
      .map((line) => line.seconds)),
  })));
  const uniqueRecordIds = [...new Set(allocations.map(({ record }) => record.id))];
  return Object.freeze({
    schemaVersion: 1,
    id: `weekly-settlement:${weekKey}`,
    weekStart: bounds.start.toISOString(),
    weekEndExclusive: bounds.end.toISOString(),
    status: "unconfirmed",
    recordIds: Object.freeze(uniqueRecordIds),
    journalEntryIds: Object.freeze(entries.map((entry) => entry.id)),
    totals: Object.freeze(totals),
    trialBalance: Object.freeze({ debitSeconds, creditSeconds, isBalanced: debitSeconds === creditSeconds }),
    statement: Object.freeze({
      assetAndClearingSeconds,
      accumulatedTimeLossSeconds,
      contributedTimeSeconds: totals.recordSeconds,
      expenseSeconds: totals.expenseSeconds,
      isBalanced: statementDebit === statementCredit,
    }),
    balanceSheet: Object.freeze({
      debit: balanceSheetDebit,
      credit: balanceSheetCredit,
      debitSeconds: statementDebit,
      creditSeconds: statementCredit,
      isBalanced: statementDebit === statementCredit,
    }),
    profitAndLoss: Object.freeze({ expenses, totalExpenseSeconds: totals.expenseSeconds }),
    analysis: Object.freeze({
      notConnectedCount: allocations.filter(({ record }) => record.analysisStatus === "not-connected").length,
      notEvaluatedCount: allocations.filter(({ record }) => record.analysis.initiative === null
        || record.analysis.reasoning === null || record.analysis.criticalJudgment === null).length,
    }),
  });
}

export function buildJournalEntries(
  record: WeeklyRecordV1,
  seconds = record.activeSeconds,
  weekKey = dateKey(weekBoundsForTimestamp(record.startedAt ?? record.recordedAt).start),
): readonly WeeklyJournalEntry[] {
  requireSeconds(seconds);
  if (record.analysisStatus === "not-applicable" || seconds === 0) return Object.freeze([]);
  const recognition = freezeEntry({
    id: `${record.id}:${weekKey}:recognition`,
    recordId: record.id,
    weekKey,
    kind: "usage-recognition",
    timeSource: record.timeSource,
    lines: [
      { side: "debit", account: WEEKLY_ACCOUNTS.aiClearing, seconds },
      { side: "credit", account: WEEKLY_ACCOUNTS.timeContribution, seconds },
    ],
  });
  if (record.accountingDisposition === "unclassified") return Object.freeze([recognition]);
  const debitAccount = confirmedAccountForWeeklyRecord(record);
  const classification = freezeEntry({
    id: `${record.id}:${weekKey}:classification`,
    recordId: record.id,
    weekKey,
    kind: "classification",
    timeSource: record.timeSource,
    lines: [
      { side: "debit", account: debitAccount, seconds },
      { side: "credit", account: WEEKLY_ACCOUNTS.aiClearing, seconds },
    ],
  });
  return Object.freeze([recognition, classification]);
}

export function buildWeeklyJournalEntries(
  records: readonly WeeklyRecordV1[],
  anchor: Date,
  tasks: readonly TaskV1[] = [],
): readonly WeeklyJournalEntry[] {
  const weekKey = dateKey(periodBounds(anchor, "weekly").start);
  return Object.freeze(weeklyRecordAllocations(records, tasks, weekKey).flatMap(({ record, allocation }) => (
    buildJournalEntries(record, allocation.seconds, allocation.weekKey)
  )));
}

export function isBalancedWeeklyEntry(entry: WeeklyJournalEntry): boolean {
  return sum(entry.lines.filter((line) => line.side === "debit").map((line) => line.seconds))
    === sum(entry.lines.filter((line) => line.side === "credit").map((line) => line.seconds));
}

export function confirmedAccountForWeeklyRecord(record: WeeklyRecordV1): WeeklyAccount {
  if (record.accountingDisposition === "unclassified") return WEEKLY_ACCOUNTS.aiClearing;
  if (record.accountingDisposition === "asset") return WEEKLY_ACCOUNTS.deliverableAsset;
  if (record.accountingDisposition === "work-in-progress") return WEEKLY_ACCOUNTS.workInProgress;
  if (record.accountingAccount) return record.accountingAccount;
  const accounts = {
    "相談": WEEKLY_ACCOUNTS.consultationExpense,
    "壁打ち": WEEKLY_ACCOUNTS.thoughtExplorationExpense,
    "文章作成": WEEKLY_ACCOUNTS.deliverableExpense,
    "情報収集": WEEKLY_ACCOUNTS.researchExpense,
    "学習": WEEKLY_ACCOUNTS.learningExpense,
    "その他": WEEKLY_ACCOUNTS.otherExpense,
  } as const;
  if (record.activityCategory === null) throw new Error("An expense record requires an activity category.");
  return accounts[record.activityCategory];
}

function dispositionSeconds(
  allocations: readonly { record: WeeklyRecordV1; allocation: WeeklyAllocation }[],
  disposition: AccountingDisposition,
) {
  return sum(allocations.filter(({ record }) => record.accountingDisposition === disposition)
    .map(({ allocation }) => allocation.seconds));
}

function weeklyRecordAllocations(
  records: readonly WeeklyRecordV1[],
  tasks: readonly TaskV1[],
  weekKey: string,
) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  return deduplicateRecords(records)
    .filter((record) => record.analysisStatus !== "not-applicable"
      && (record.taskId === null || taskById.get(record.taskId)?.plannedAiasLevel !== 1))
    .flatMap((record) => allocateRecordToWeeks(record)
      .filter((allocation) => allocation.weekKey === weekKey && allocation.seconds > 0)
      .map((allocation) => ({ record, allocation })));
}

function deduplicateRecords(records: readonly WeeklyRecordV1[]) {
  const recordIds = new Set<string>();
  const sourceEventIds = new Set<string>();
  return records.filter((record) => {
    if (recordIds.has(record.id)) return false;
    if (record.sourceEventId !== null && sourceEventIds.has(record.sourceEventId)) return false;
    recordIds.add(record.id);
    if (record.sourceEventId !== null) sourceEventIds.add(record.sourceEventId);
    return true;
  });
}

function freezeAllocation(recordId: string, start: Date, end: Date, seconds: number): WeeklyAllocation {
  return Object.freeze({ recordId, weekKey: dateKey(start), weekStart: new Date(start), weekEndExclusive: new Date(end), seconds });
}

function freezeEntry(entry: Omit<WeeklyJournalEntry, "lines"> & { lines: [WeeklyJournalLine, WeeklyJournalLine] }): WeeklyJournalEntry {
  return Object.freeze({ ...entry, lines: Object.freeze(entry.lines.map((line) => Object.freeze(line))) as unknown as readonly [WeeklyJournalLine, WeeklyJournalLine] });
}

function requireSeconds(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("seconds must be a non-negative integer.");
}

function sum(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0);
}
