import { TIME_ACCOUNTS, type TimeAccountingLedger } from "./timeAccounting.ts";

export type TimeJournalRow = Readonly<{
  id: string;
  sourceEventId: string;
  usedOn: string;
  serviceName: string;
  durationSeconds: number;
  debitAccount: typeof TIME_ACCOUNTS.aiClearing;
  creditAccount: typeof TIME_ACCOUNTS.timeContribution;
}>;

export type TimeAccountingView = Readonly<{
  currentMonth: string;
  currentMonthSeconds: number;
  currentMonthRecordCount: number;
  rows: readonly TimeJournalRow[];
}>;

/**
 * Builds display-only values from the dedicated time ledger. The ledger is not
 * rewritten here, so old saved data and accounting data remain untouched.
 */
export function buildTimeAccountingView(
  ledger: TimeAccountingLedger | null,
  today = new Date(),
): TimeAccountingView {
  const currentMonth = localMonthKey(today);
  if (!ledger) return freezeView(currentMonth, 0, 0, []);

  const usageEntries = new Map(
    ledger.entries
      .filter((entry) => entry.kind === "ai-usage")
      .map((entry) => [entry.id, entry]),
  );
  const rows = ledger.measurements.flatMap((measurement): TimeJournalRow[] => {
    const entry = usageEntries.get(measurement.usageEntryId);
    if (!entry) return [];
    const debit = entry.lines.find((line) => line.side === "debit");
    const credit = entry.lines.find((line) => line.side === "credit");
    if (debit?.account !== TIME_ACCOUNTS.aiClearing
      || credit?.account !== TIME_ACCOUNTS.timeContribution) return [];
    return [Object.freeze({
      id: entry.id,
      sourceEventId: measurement.sourceEventId,
      usedOn: measurement.occurredOn,
      serviceName: measurement.sourceEventId.startsWith("chrome-time:") ? "ChatGPT" : "AI",
      durationSeconds: measurement.actualInputSeconds,
      debitAccount: debit.account,
      creditAccount: credit.account,
    })];
  }).sort((left, right) => (
    right.usedOn.localeCompare(left.usedOn) || left.id.localeCompare(right.id)
  ));
  const currentRows = rows.filter((row) => row.usedOn.startsWith(`${currentMonth}-`));
  return freezeView(
    currentMonth,
    currentRows.reduce((sum, row) => sum + row.durationSeconds, 0),
    currentRows.length,
    rows,
  );
}

function localMonthKey(value: Date) {
  if (!Number.isFinite(value.getTime())) throw new Error("集計日が正しくありません。");
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

function freezeView(
  currentMonth: string,
  currentMonthSeconds: number,
  currentMonthRecordCount: number,
  rows: readonly TimeJournalRow[],
): TimeAccountingView {
  return Object.freeze({
    currentMonth,
    currentMonthSeconds,
    currentMonthRecordCount,
    rows: Object.freeze([...rows]),
  });
}
