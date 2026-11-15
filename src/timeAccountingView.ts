import { effectiveTimeMeasurementSeconds, isTimeMeasurementActive, TIME_ACCOUNTS, type TimeAccount, type TimeAccountingLedger } from "./timeAccounting.ts";
import type { TimeAccountingStore } from "./timeAccountingStore.ts";

export type TimeJournalRow = Readonly<{
  id: string;
  sourceEventId: string;
  usedOn: string;
  postedOn: string;
  serviceName: string;
  durationSeconds: number;
  effectiveSeconds?: number;
  entryKind: "usage" | "reversal" | "reregistration" | "correction";
  status: "有効" | "取消済み" | "再登録済み" | "訂正済み" | "取消仕訳" | "再登録仕訳" | "増額訂正" | "減額訂正";
  isActive: boolean;
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
  effectiveSeconds: number;
  importedAt: string;
  status: "取り込み済み" | "取消済み" | "再登録済み";
  debitAccount: typeof TIME_ACCOUNTS.aiClearing;
  creditAccount: typeof TIME_ACCOUNTS.timeContribution;
  reversalEntryId?: string;
  reversalPostedOn?: string;
  cancelledAt?: string;
  actions: readonly TimeImportHistoryAction[];
}>;

export type TimeImportHistoryAction = Readonly<{
  kind: "cancellation" | "reregistration" | "correction";
  entryId: string;
  relatedEntryId: string;
  actedAt: string;
  postedOn: string;
  debitAccount: TimeAccount;
  creditAccount: TimeAccount;
  beforeSeconds?: number;
  afterSeconds?: number;
  deltaSeconds?: number;
  reason?: string;
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
    const correctionEntryIds = measurement.correctionEntryIds
      ?? (measurement.reversalEntryId === undefined ? [] : [measurement.reversalEntryId]);
    const active = isTimeMeasurementActive(measurement);
    const effectiveSeconds = effectiveTimeMeasurementSeconds(measurement);
    const latestCorrection = [...correctionEntryIds].reverse()
      .map((id) => ledger.entries.find((item) => item.id === id))
      .find((item) => item?.kind === "usage-correction");
    const usageRow: TimeJournalRow = Object.freeze({
      id: entry.id,
      sourceEventId: measurement.sourceEventId,
      usedOn: measurement.occurredOn,
      postedOn: entry.postedOn,
      serviceName,
      durationSeconds: measurement.actualInputSeconds,
      effectiveSeconds,
      entryKind: "usage",
      status: !active ? "取消済み" : latestCorrection ? "訂正済み" : correctionEntryIds.length === 0 ? "有効" : "再登録済み",
      isActive: active,
      ...(correctionEntryIds.length === 0 ? {} : { relatedEntryId: correctionEntryIds[correctionEntryIds.length - 1] }),
      debitAccount: debit.account,
      creditAccount: credit.account,
    });
    const correctionRows = correctionEntryIds.flatMap((correctionId): TimeJournalRow[] => {
      const correction = ledger.entries.find((item) => item.id === correctionId);
      if (!correction || !["usage-reversal", "usage-reregistration", "usage-correction"].includes(correction.kind)) return [];
      const correctionDebit = correction.lines.find((line) => line.side === "debit");
      const correctionCredit = correction.lines.find((line) => line.side === "credit");
      if (!correctionDebit || !correctionCredit) return [];
      const isReversal = correction.kind === "usage-reversal";
      const isCorrection = correction.kind === "usage-correction";
      const delta = (correction.effectiveSecondsAfter ?? 0) - (correction.effectiveSecondsBefore ?? 0);
      return [Object.freeze({
        id: correction.id,
        sourceEventId: measurement.sourceEventId,
        usedOn: measurement.occurredOn,
        postedOn: correction.postedOn,
        serviceName,
        durationSeconds: isCorrection ? Math.abs(delta) : correctionDebit.seconds,
        ...(isCorrection ? { effectiveSeconds: correction.effectiveSecondsAfter } : {}),
        entryKind: isCorrection ? "correction" as const : isReversal ? "reversal" as const : "reregistration" as const,
        status: isCorrection ? (delta > 0 ? "増額訂正" as const : "減額訂正" as const) : isReversal ? "取消仕訳" as const : "再登録仕訳" as const,
        isActive: false,
        relatedEntryId: isCorrection ? correction.correctsEntryId : isReversal ? correction.reversesEntryId : correction.restoresEntryId,
        debitAccount: correctionDebit.account,
        creditAccount: correctionCredit.account,
      })];
    });
    return [usageRow, ...correctionRows];
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
    const actions = (imported.actions ?? []).flatMap((action): TimeImportHistoryAction[] => {
      const actionEntry = entries.get(action.entryId);
      if (!actionEntry || !["usage-reversal", "usage-reregistration", "usage-correction"].includes(actionEntry.kind)) return [];
      const actionDebit = actionEntry.lines.find((line) => line.side === "debit");
      const actionCredit = actionEntry.lines.find((line) => line.side === "credit");
      const relatedEntryId = actionEntry.kind === "usage-reversal"
        ? actionEntry.reversesEntryId
        : actionEntry.kind === "usage-reregistration" ? actionEntry.restoresEntryId : actionEntry.correctsEntryId;
      if (!actionDebit || !actionCredit || !relatedEntryId) return [];
      return [Object.freeze({
        kind: action.kind,
        entryId: action.entryId,
        relatedEntryId,
        actedAt: action.actedAt,
        postedOn: actionEntry.postedOn,
        debitAccount: actionDebit.account,
        creditAccount: actionCredit.account,
        ...(action.kind !== "correction" ? {} : {
          beforeSeconds: action.beforeSeconds,
          afterSeconds: action.afterSeconds,
          deltaSeconds: action.deltaSeconds,
          ...(action.reason === undefined ? {} : { reason: action.reason }),
        }),
      })];
    });
    const active = isTimeMeasurementActive(measurement);
    const latestCancellation = [...actions].reverse().find((action) => action.kind === "cancellation");
    rows.push(Object.freeze({
      recordId: imported.recordId,
      entryId: imported.entryId,
      sourceEventId: imported.sourceEventId,
      usedOn: measurement.occurredOn,
      serviceName: serviceNameFromFingerprint(imported.fingerprint),
      durationSeconds: measurement.actualInputSeconds,
      effectiveSeconds: effectiveTimeMeasurementSeconds(measurement),
      importedAt: imported.importedAt,
      status: !active ? "取消済み" : actions.some((action) => action.kind === "reregistration") ? "再登録済み" : "取り込み済み",
      debitAccount: debit.account,
      creditAccount: credit.account,
      actions: Object.freeze(actions),
      ...(latestCancellation === undefined ? {} : {
        reversalEntryId: latestCancellation.entryId,
        reversalPostedOn: latestCancellation.postedOn,
        cancelledAt: latestCancellation.actedAt,
      }),
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
