import { dateKey, periodBounds } from "./ledgerPeriods.ts";
import {
  allocateRecordToWeeks,
  confirmedAccountForWeeklyRecord,
} from "./weeklyAccounting.ts";
import {
  previewWeeklySettlement,
  type WeeklySettlementStoreV1,
} from "./weeklySettlementStore.ts";
import {
  findWeeklyAnalysisReview,
  type WeeklyAnalysisReviewStoreV1,
} from "./weeklyAnalysisReviewStore.ts";
import {
  resolveWeeklyAnalysisState,
  type WeeklyAnalysisStoreV1,
} from "./weeklyAnalysisStore.ts";
import type { WeeklyReflectionStoreV1 } from "./weeklyReflectionStore.ts";
import type {
  WeeklyConversationStoreV1,
  WeeklyRecordStoreV1,
} from "./weeklyStore.ts";

export const RESEARCH_EXPORT_SCHEMA_VERSION = 1 as const;

export type ResearchExportScope =
  | Readonly<{ kind: "week"; anchor: Date }>
  | Readonly<{ kind: "all" }>;

export type ResearchExportSources = Readonly<{
  records: WeeklyRecordStoreV1;
  conversations: WeeklyConversationStoreV1;
  analyses: WeeklyAnalysisStoreV1;
  reviews: WeeklyAnalysisReviewStoreV1;
  reflections: WeeklyReflectionStoreV1;
  settlements: WeeklySettlementStoreV1;
}>;

export type ResearchExportOptions = Readonly<{
  scope: ResearchExportScope;
  includeSensitiveText: boolean;
  exportedAt?: string;
}>;

export class ResearchExportError extends Error {
  readonly code: "DUPLICATE_ID" | "DUPLICATE_TIME" | "INVALID_DATE";
  constructor(code: ResearchExportError["code"], message: string) {
    super(message);
    this.name = "ResearchExportError";
    this.code = code;
  }
}

export function buildResearchExportBundle(
  sources: ResearchExportSources,
  options: ResearchExportOptions,
) {
  validateSourceUniqueness(sources);
  const exportedAt = normalizedTimestamp(options.exportedAt ?? new Date().toISOString());
  const selectedWeekKey = options.scope.kind === "week"
    ? dateKey(periodBounds(validDate(options.scope.anchor), "weekly").start)
    : null;
  const conversationByRecord = new Map(sources.conversations.conversations.map((item) => [item.recordId, item]));
  const taskById = new Map(sources.records.tasks.map((task) => [task.id, task]));
  const selectedRecords = sources.records.records.flatMap((record) => {
    const allocations = allocateRecordToWeeks(record);
    if (selectedWeekKey === null) return [{ record, allocatedSeconds: record.activeSeconds, weekKeys: allocations.map((item) => item.weekKey) }];
    const allocation = allocations.find((item) => item.weekKey === selectedWeekKey);
    return allocation ? [{ record, allocatedSeconds: allocation.seconds, weekKeys: [selectedWeekKey] }] : [];
  });
  const selectedReflections = sources.reflections.reflections.filter(
    (reflection) => selectedWeekKey === null || reflection.weekKey === selectedWeekKey,
  );
  const activities = selectedRecords.map(({ record, allocatedSeconds, weekKeys }) => {
    const conversation = conversationByRecord.get(record.id) ?? null;
    const task = record.taskId ? taskById.get(record.taskId) ?? null : null;
    const analysisState = resolveWeeklyAnalysisState(record, sources.analyses, conversation);
    const response = analysisState.response;
    const analysis = response?.analysis ?? null;
    const review = findWeeklyAnalysisReview(sources.reviews, response?.analysisId);
    const relatedReflections = selectedReflections.filter((reflection) => (
      reflection.selectedActivities.some((item) => item.recordId === record.id)
    ));
    return Object.freeze({
      exportRowId: `${record.id}:${selectedWeekKey ?? "all"}`,
      activityId: record.id,
      conversationId: record.links.conversationId,
      thoughtReceiptId: record.links.thoughtReceiptId,
      sourceEventId: record.sourceEventId,
      taskId: record.taskId,
      recordedAt: record.recordedAt,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      weekKeys: Object.freeze([...weekKeys]),
      activeSeconds: record.activeSeconds,
      scopeAllocatedSeconds: allocatedSeconds,
      timeSource: record.timeSource,
      measurementRecordId: record.timeSource === "measured" ? record.sessionId : null,
      measurementRange: Object.freeze({ startedAt: record.startedAt, endedAt: record.endedAt }),
      aiService: record.aiService,
      privacy: record.privacy,
      activityCategory: record.activityCategory,
      activityCategorySource: record.activityCategorySource,
      accountingAccount: confirmedAccountForWeeklyRecord(record),
      accountingDisposition: record.accountingDisposition,
      aiasTask: task === null ? null : Object.freeze({
        taskId: task.id,
        plannedLevel: task.plannedAiasLevel,
        activityCategory: task.activityCategory,
        title: options.includeSensitiveText ? task.title : null,
        goal: options.includeSensitiveText ? task.goal : null,
        expectedAiRole: options.includeSensitiveText ? task.delegatedToAi : null,
        humanDecision: options.includeSensitiveText ? task.humanDecision : null,
      }),
      analysis: Object.freeze({
        status: analysisState.analysisStatus,
        origin: response?.origin ?? null,
        analysisId: response?.analysisId ?? null,
        activityCategory: analysis?.activityCategory ?? null,
        accountCandidate: analysis?.accountCandidate ?? null,
        accountingDispositionCandidate: analysis?.accountingDispositionCandidate ?? null,
        aiRole: options.includeSensitiveText ? analysis?.aiRole ?? null : null,
        collaborationBehaviors: options.includeSensitiveText
          ? Object.freeze([...(analysis?.collaborationBehaviors ?? [])])
          : Object.freeze([]),
        initiative: analysis?.initiative ?? null,
        reasoning: analysis?.reasoning ?? null,
        criticalJudgment: analysis?.criticalJudgment ?? null,
        thinkingChange: options.includeSensitiveText ? analysis?.thinkingChange ?? null : null,
        discovery: options.includeSensitiveText ? analysis?.discovery ?? null : null,
        evidenceCount: analysis?.evidence.length ?? 0,
        evidence: options.includeSensitiveText ? Object.freeze([...(analysis?.evidence ?? [])]) : Object.freeze([]),
        model: response?.model ?? null,
        rubricVersion: response?.rubricVersion ?? null,
        analyzedAt: response?.analyzedAt ?? response?.receivedAt ?? null,
        errorCode: response?.error?.code ?? null,
      }),
      humanReview: review === null ? null : Object.freeze({
        analysisId: review.analysisId,
        reviewedAt: review.reviewedAt,
        activityCategory: review.fields.activityCategory,
        accountCandidate: review.fields.accountCandidate,
        accountingDispositionCandidate: review.fields.accountingDispositionCandidate,
        initiative: review.fields.initiative,
        reasoning: review.fields.reasoning,
        criticalJudgment: review.fields.criticalJudgment,
        aiRole: options.includeSensitiveText ? review.fields.aiRole : null,
        collaborationSummary: options.includeSensitiveText ? review.fields.collaborationSummary : null,
        thinkingChange: options.includeSensitiveText ? review.fields.thinkingChange : null,
        discovery: options.includeSensitiveText ? review.fields.discovery : null,
        reviewerNote: options.includeSensitiveText ? review.fields.reviewerNote : null,
      }),
      personAuthored: Object.freeze({
        interactionSummary: options.includeSensitiveText ? record.manualNotes?.interactionSummary ?? null : null,
        ownThoughts: options.includeSensitiveText ? record.manualNotes?.ownThoughts ?? null : null,
        discovery: options.includeSensitiveText ? record.manualNotes?.discovery ?? null : null,
        selfReflection: options.includeSensitiveText ? record.selfReflection : null,
      }),
      representativeInReflectionWeeks: Object.freeze(relatedReflections.map((item) => item.weekKey)),
    });
  });
  const reflections = selectedReflections.map((reflection) => Object.freeze({
    weekKey: reflection.weekKey,
    weekStart: reflection.weekStart,
    weekEndExclusive: reflection.weekEndExclusive,
    selectedActivities: reflection.selectedActivities,
    updatedAt: reflection.updatedAt,
    discoveryLearning: options.includeSensitiveText ? reflection.discoveryLearning : null,
    humanJudgment: options.includeSensitiveText ? reflection.humanJudgment : null,
    relationshipReflection: options.includeSensitiveText ? reflection.relationshipReflection : null,
    nextWeekChallenge: options.includeSensitiveText ? reflection.nextWeekChallenge : null,
  }));
  const weeklyStatements = statementWeekKeys(sources, selectedWeekKey).map((weekKey) => {
    const preview = previewWeeklySettlement(
      sources.records.records,
      sources.records.tasks,
      anchorForWeekKey(weekKey),
      sources.settlements,
    );
    return Object.freeze({
      weekKey,
      confirmationStatus: preview.confirmationStatus,
      latestRevisionId: preview.latestRevision?.id ?? null,
      latestConfirmedAt: preview.latestRevision?.confirmedAt ?? null,
      totals: preview.settlement.totals,
      trialBalance: preview.settlement.trialBalance,
      balanceSheet: preview.settlement.balanceSheet,
      profitAndLoss: preview.settlement.profitAndLoss,
    });
  });
  return Object.freeze({
    schemaVersion: RESEARCH_EXPORT_SCHEMA_VERSION,
    exportedAt,
    scope: Object.freeze({ kind: options.scope.kind, weekKey: selectedWeekKey }),
    sensitiveTextIncluded: options.includeSensitiveText,
    privacyNotice: "Conversation message bodies and API keys are never included.",
    scoreNotice: "null means unevaluated or insufficient evidence; it is not zero.",
    activities: Object.freeze(activities),
    reflections: Object.freeze(reflections),
    weeklyStatements: Object.freeze(weeklyStatements),
  });
}

export type ResearchExportBundleV1 = ReturnType<typeof buildResearchExportBundle>;

const activityCsvColumns = [
  "export_row_id", "activity_id", "conversation_id", "thought_receipt_id", "source_event_id", "task_id",
  "recorded_at", "started_at", "ended_at", "week_keys", "active_seconds", "scope_allocated_seconds",
  "ai_service", "time_source", "measurement_record_id", "privacy", "activity_category",
  "activity_category_source", "accounting_account", "accounting_disposition", "aias_planned_level",
  "aias_activity_category", "aias_task_title", "aias_goal", "aias_expected_ai_role", "aias_human_decision",
  "analysis_status", "analysis_origin", "analysis_id", "ai_activity_category", "ai_account_candidate",
  "ai_accounting_disposition_candidate", "ai_role", "ai_collaboration_behaviors", "ai_initiative",
  "ai_reasoning", "ai_critical_judgment", "ai_thinking_change", "ai_discovery", "evidence_count",
  "evidence", "model", "rubric_version", "analyzed_at", "analysis_error_code", "human_reviewed_at",
  "human_activity_category", "human_account_candidate", "human_accounting_disposition_candidate",
  "human_initiative", "human_reasoning", "human_critical_judgment", "human_ai_role",
  "human_collaboration_summary", "human_thinking_change", "human_discovery", "human_reviewer_note",
  "person_interaction_summary", "person_own_thoughts", "person_discovery", "person_self_reflection",
  "representative_reflection_weeks", "measurement_range", "sensitive_text_included",
] as const;

export function serializeResearchActivitiesCsv(bundle: ResearchExportBundleV1) {
  const rows = bundle.activities.map((item) => ({
    export_row_id: item.exportRowId,
    activity_id: item.activityId,
    conversation_id: item.conversationId,
    thought_receipt_id: item.thoughtReceiptId,
    source_event_id: item.sourceEventId,
    task_id: item.taskId,
    recorded_at: item.recordedAt,
    started_at: item.startedAt,
    ended_at: item.endedAt,
    week_keys: item.weekKeys.join("|"),
    active_seconds: item.activeSeconds,
    scope_allocated_seconds: item.scopeAllocatedSeconds,
    ai_service: item.aiService,
    time_source: item.timeSource,
    measurement_record_id: item.measurementRecordId,
    privacy: item.privacy,
    activity_category: item.activityCategory,
    activity_category_source: item.activityCategorySource,
    accounting_account: item.accountingAccount,
    accounting_disposition: item.accountingDisposition,
    aias_planned_level: item.aiasTask?.plannedLevel ?? null,
    aias_activity_category: item.aiasTask?.activityCategory ?? null,
    aias_task_title: item.aiasTask?.title ?? null,
    aias_goal: item.aiasTask?.goal ?? null,
    aias_expected_ai_role: item.aiasTask?.expectedAiRole ?? null,
    aias_human_decision: item.aiasTask?.humanDecision ?? null,
    analysis_status: item.analysis.status,
    analysis_origin: item.analysis.origin,
    analysis_id: item.analysis.analysisId,
    ai_activity_category: item.analysis.activityCategory,
    ai_account_candidate: item.analysis.accountCandidate,
    ai_accounting_disposition_candidate: item.analysis.accountingDispositionCandidate,
    ai_role: item.analysis.aiRole,
    ai_collaboration_behaviors: jsonCell(item.analysis.collaborationBehaviors),
    ai_initiative: item.analysis.initiative,
    ai_reasoning: item.analysis.reasoning,
    ai_critical_judgment: item.analysis.criticalJudgment,
    ai_thinking_change: item.analysis.thinkingChange,
    ai_discovery: item.analysis.discovery,
    evidence_count: item.analysis.evidenceCount,
    evidence: jsonCell(item.analysis.evidence),
    model: item.analysis.model,
    rubric_version: item.analysis.rubricVersion,
    analyzed_at: item.analysis.analyzedAt,
    analysis_error_code: item.analysis.errorCode,
    human_reviewed_at: item.humanReview?.reviewedAt ?? null,
    human_activity_category: item.humanReview?.activityCategory ?? null,
    human_account_candidate: item.humanReview?.accountCandidate ?? null,
    human_accounting_disposition_candidate: item.humanReview?.accountingDispositionCandidate ?? null,
    human_initiative: item.humanReview?.initiative ?? null,
    human_reasoning: item.humanReview?.reasoning ?? null,
    human_critical_judgment: item.humanReview?.criticalJudgment ?? null,
    human_ai_role: item.humanReview?.aiRole ?? null,
    human_collaboration_summary: item.humanReview?.collaborationSummary ?? null,
    human_thinking_change: item.humanReview?.thinkingChange ?? null,
    human_discovery: item.humanReview?.discovery ?? null,
    human_reviewer_note: item.humanReview?.reviewerNote ?? null,
    person_interaction_summary: item.personAuthored.interactionSummary,
    person_own_thoughts: item.personAuthored.ownThoughts,
    person_discovery: item.personAuthored.discovery,
    person_self_reflection: item.personAuthored.selfReflection,
    representative_reflection_weeks: item.representativeInReflectionWeeks.join("|"),
    measurement_range: jsonCell([item.measurementRange]),
    sensitive_text_included: bundle.sensitiveTextIncluded,
  }));
  return toCsv(activityCsvColumns, rows);
}

export function serializeResearchAccountingCsv(bundle: ResearchExportBundleV1) {
  const columns = ["week_key", "confirmation_status", "latest_revision_id", "confirmed_at", "statement", "side", "account", "seconds"] as const;
  const rows = bundle.weeklyStatements.flatMap((statement) => [
    ...statement.balanceSheet.debit.map((line) => ({ week_key: statement.weekKey, confirmation_status: statement.confirmationStatus, latest_revision_id: statement.latestRevisionId, confirmed_at: statement.latestConfirmedAt, statement: "B/S", side: "debit", account: line.account, seconds: line.seconds })),
    ...statement.balanceSheet.credit.map((line) => ({ week_key: statement.weekKey, confirmation_status: statement.confirmationStatus, latest_revision_id: statement.latestRevisionId, confirmed_at: statement.latestConfirmedAt, statement: "B/S", side: "credit", account: line.account, seconds: line.seconds })),
    ...statement.profitAndLoss.expenses.map((line) => ({ week_key: statement.weekKey, confirmation_status: statement.confirmationStatus, latest_revision_id: statement.latestRevisionId, confirmed_at: statement.latestConfirmedAt, statement: "P/L", side: "debit", account: line.account, seconds: line.seconds })),
    { week_key: statement.weekKey, confirmation_status: statement.confirmationStatus, latest_revision_id: statement.latestRevisionId, confirmed_at: statement.latestConfirmedAt, statement: "B/S total", side: "debit", account: "借方合計", seconds: statement.balanceSheet.debitSeconds },
    { week_key: statement.weekKey, confirmation_status: statement.confirmationStatus, latest_revision_id: statement.latestRevisionId, confirmed_at: statement.latestConfirmedAt, statement: "B/S total", side: "credit", account: "貸方合計", seconds: statement.balanceSheet.creditSeconds },
    { week_key: statement.weekKey, confirmation_status: statement.confirmationStatus, latest_revision_id: statement.latestRevisionId, confirmed_at: statement.latestConfirmedAt, statement: "P/L total", side: "debit", account: "費用合計", seconds: statement.profitAndLoss.totalExpenseSeconds },
    { week_key: statement.weekKey, confirmation_status: statement.confirmationStatus, latest_revision_id: statement.latestRevisionId, confirmed_at: statement.latestConfirmedAt, statement: "trial balance", side: "debit", account: "借方合計", seconds: statement.trialBalance.debitSeconds },
    { week_key: statement.weekKey, confirmation_status: statement.confirmationStatus, latest_revision_id: statement.latestRevisionId, confirmed_at: statement.latestConfirmedAt, statement: "trial balance", side: "credit", account: "貸方合計", seconds: statement.trialBalance.creditSeconds },
  ]);
  return toCsv(columns, rows);
}

export function serializeResearchReflectionsCsv(bundle: ResearchExportBundleV1) {
  const columns = [
    "week_key", "week_start", "week_end_exclusive", "selected_activity_ids", "updated_at",
    "discovery_learning", "human_judgment", "relationship_reflection", "next_week_challenge",
    "sensitive_text_included",
  ] as const;
  const rows = bundle.reflections.map((reflection) => ({
    week_key: reflection.weekKey,
    week_start: reflection.weekStart,
    week_end_exclusive: reflection.weekEndExclusive,
    selected_activity_ids: reflection.selectedActivities.map((item) => item.recordId).join("|"),
    updated_at: reflection.updatedAt,
    discovery_learning: reflection.discoveryLearning,
    human_judgment: reflection.humanJudgment,
    relationship_reflection: reflection.relationshipReflection,
    next_week_challenge: reflection.nextWeekChallenge,
    sensitive_text_included: bundle.sensitiveTextIncluded,
  }));
  return toCsv(columns, rows);
}

export function serializeResearchJson(bundle: ResearchExportBundleV1) {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

function toCsv<Column extends string>(
  columns: readonly Column[],
  rows: readonly Record<Column, unknown>[],
) {
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvCell(row[column])).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** Quotes every value and neutralizes spreadsheet formula prefixes after optional whitespace. */
export function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : typeof value === "string" ? value : String(value);
  text = text.replace(/\0/g, "");
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function jsonCell(value: readonly unknown[]) {
  return value.length === 0 ? "" : JSON.stringify(value);
}

function statementWeekKeys(sources: ResearchExportSources, selectedWeekKey: string | null) {
  if (selectedWeekKey) return [selectedWeekKey];
  const keys = new Set<string>();
  for (const record of sources.records.records) {
    for (const allocation of allocateRecordToWeeks(record)) keys.add(allocation.weekKey);
  }
  for (const reflection of sources.reflections.reflections) keys.add(reflection.weekKey);
  for (const week of sources.settlements.weeks) keys.add(week.weekKey);
  return [...keys].sort();
}

function anchorForWeekKey(weekKey: string) {
  const value = new Date(`${weekKey}T12:00:00`);
  if (Number.isNaN(value.getTime())) throw new ResearchExportError("INVALID_DATE", "出力対象週が正しくありません。");
  return value;
}

function validDate(value: Date) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ResearchExportError("INVALID_DATE", "出力対象週が正しくありません。");
  }
  return value;
}

function normalizedTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ResearchExportError("INVALID_DATE", "出力日時が正しくありません。");
  return date.toISOString();
}

function validateSourceUniqueness(sources: ResearchExportSources) {
  assertUnique(sources.records.records.map((item) => item.id), "活動ID");
  assertUnique(sources.records.records.flatMap((item) => item.sourceEventId ? [item.sourceEventId] : []), "取込イベントID");
  assertUnique(sources.records.records.map((item) => item.links.usageId), "時間利用ID");
  assertUnique(sources.records.records.map((item) => item.links.thoughtReceiptId), "思考レシートID");
  assertUnique(sources.conversations.conversations.map((item) => item.id), "会話ID");
  assertUnique(sources.conversations.conversations.map((item) => item.recordId), "会話の活動関連付け");
  assertUnique(sources.analyses.entries.map((item) => item.requestId), "分析リクエストID");
  assertUnique(sources.analyses.entries.flatMap((item) => item.response ? [item.response.analysisId] : []), "分析結果ID");
  assertUnique(sources.reviews.reviews.map((item) => item.analysisId), "本人確認済み分析ID");
  assertUnique(sources.reflections.reflections.map((item) => item.weekKey), "週次振り返り週");
  assertUnique(sources.settlements.weeks.map((item) => item.weekKey), "週次決算週");
  const measuredIds = sources.records.records
    .filter((record) => record.timeSource === "measured" && record.sessionId !== null)
    .map((record) => record.sessionId as string);
  if (new Set(measuredIds).size !== measuredIds.length) {
    throw new ResearchExportError("DUPLICATE_TIME", "同じ実測時間が複数の活動に関連付けられているため出力できません。");
  }
}

function assertUnique(values: readonly string[], label: string) {
  if (new Set(values).size !== values.length) {
    throw new ResearchExportError("DUPLICATE_ID", `${label}が重複しているため出力できません。`);
  }
}
