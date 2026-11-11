import { TIME_ACCOUNTS, type TimeAccount, type TimeAccountingLedger } from "./timeAccounting.ts";
import type { TimeAccountingStore } from "./timeAccountingStore.ts";

export type TimeJournalRow = Readonly<{
  id: string;
  sourceEventId: string;
  usedOn: string;
  postedOn: string;
  serviceName: string;
  durationSeconds: number;
  entryKind: "usage" | "reversal";
  status: "有効" | "取消済み" | "取消仕訳";
  relatedEntryId?: string;
  debitAccount: TimeAccount;
  creditAccount: TimeAccount;
}>;

export type TimeAccountingView = Readonly<{
  currentMonth: string;
  currentMonthSeconds: number;
  currentMonthRecordCount: number;
  rows: readonly TimeJournalRow[];
}>;

export type TimeImportHistoryRow = Readonly<{
  recordId: string;
  entryId: string;
  sourceEventId: string;
  usedOn: string;
  serviceName: string;
  durationSeconds: number;
  importedAt: string;
  status: "取り込み済み" | "取消済み";
  debitAccount: typeof TIME_ACCOUNTS.aiClearing;
  creditAccount: typeof TIME_ACCOUNTS.timeContribution;
  reversalEntryId?: string;
  reversalPostedOn?: string;
  cancelledAt?: string;
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
    const serviceName = measurement.sourceEventId.startsWith("chrome-time:") ? "ChatGPT" : "AI";
    const usageRow: TimeJournalRow = Object.freeze({
      id: entry.id,
      sourceEventId: measurement.sourceEventId,
      usedOn: measurement.occurredOn,
      postedOn: entry.postedOn,
      serviceName,
      durationSeconds: measurement.actualInputSeconds,
      entryKind: "usage",
      status: measurement.reversalEntryId === undefined ? "有効" : "取消済み",
      ...(measurement.reversalEntryId === undefined ? {} : { relatedEntryId: measurement.reversalEntryId }),
      debitAccount: debit.account,
      creditAccount: credit.account,
    });
    if (measurement.reversalEntryId === undefined) return [usageRow];
    const reversal = ledger.entries.find((item) => item.id === measurement.reversalEntryId);
    if (!reversal || reversal.kind !== "usage-reversal") return [usageRow];
    const reversalDebit = reversal.lines.find((line) => line.side === "debit");
    const reversalCredit = reversal.lines.find((line) => line.side === "credit");
    if (!reversalDebit || !reversalCredit) return [usageRow];
    return [usageRow, Object.freeze({
      id: reversal.id,
      sourceEventId: measurement.sourceEventId,
      usedOn: measurement.occurredOn,
      postedOn: reversal.postedOn,
      serviceName,
      durationSeconds: measurement.actualInputSeconds,
      entryKind: "reversal" as const,
      status: "取消仕訳" as const,
      relatedEntryId: measurement.usageEntryId,
      debitAccount: reversalDebit.account,
      creditAccount: reversalCredit.account,
    })];
  }).sort((left, right) => (
    right.postedOn.localeCompare(left.postedOn)
      || (left.entryKind === right.entryKind ? left.id.localeCompare(right.id) : left.entryKind === "reversal" ? -1 : 1)
  ));
  const currentMeasurements = ledger.measurements.filter(
    (measurement) => measurement.occurredOn.startsWith(`${currentMonth}-`),
  );
  return freezeView(
    currentMonth,
    currentMeasurements.reduce((sum, measurement) => sum + measurement.actualInputSeconds, 0),
    currentMeasurements.length,
    rows,
  );
}

/** Builds one read-only history row per imported record id. */
export function buildTimeImportHistory(
  store: TimeAccountingStore | null,
): readonly TimeImportHistoryRow[] {
  if (!store) return Object.freeze([]);
  const measurements = new Map(store.ledger.measurements.map((item) => [item.sourceEventId, item]));
  const entries = new Map(store.ledger.entries.map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  const rows: TimeImportHistoryRow[] = [];

  for (const imported of store.importedRecords) {
    if (seen.has(imported.recordId)) continue;
    const measurement = measurements.get(imported.sourceEventId);
    const entry = entries.get(imported.entryId);
    if (!measurement || !entry || entry.kind !== "ai-usage") continue;
    const debit = entry.lines.find((line) => line.side === "debit");
    const credit = entry.lines.find((line) => line.side === "credit");
    if (debit?.account !== TIME_ACCOUNTS.aiClearing
      || credit?.account !== TIME_ACCOUNTS.timeContribution) continue;
    seen.add(imported.recordId);
    const reversal = measurement.reversalEntryId === undefined
      ? undefined
      : entries.get(measurement.reversalEntryId);
    rows.push(Object.freeze({
      recordId: imported.recordId,
      entryId: imported.entryId,
      sourceEventId: imported.sourceEventId,
      usedOn: measurement.occurredOn,
      serviceName: serviceNameFromFingerprint(imported.fingerprint),
      durationSeconds: measurement.actualInputSeconds,
      importedAt: imported.importedAt,
      status: reversal?.kind === "usage-reversal" ? "取消済み" : "取り込み済み",
      debitAccount: debit.account,
      creditAccount: credit.account,
      ...(reversal?.kind === "usage-reversal" ? {
        reversalEntryId: reversal.id,
        reversalPostedOn: reversal.postedOn,
        ...(imported.cancelledAt === undefined ? {} : { cancelledAt: imported.cancelledAt }),
      } : {}),
    }));
  }

  rows.sort((left, right) => (
    right.importedAt.localeCompare(left.importedAt) || left.recordId.localeCompare(right.recordId)
  ));
  return Object.freeze(rows);
}

function serviceNameFromFingerprint(fingerprint: string) {
  try {
    const values: unknown = JSON.parse(fingerprint);
    if (Array.isArray(values) && typeof values[2] === "string" && values[2].length > 0) {
      return values[2];
    }
  } catch {
    // Older metadata may not contain the current fingerprint representation.
  }
  return "AI";
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
