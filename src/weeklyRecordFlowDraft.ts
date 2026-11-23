import type { AnalysisActivityCategory } from "./integrations/analysisContract.ts";
import {
  parseWeeklyAnalysisResponseV1,
  type WeeklyAnalysisResponseV1,
} from "./integrations/weeklyAnalysisContract.ts";
import type { AccountingDisposition, WeeklyPrivacy } from "./weeklyData.ts";
import type { WeeklyExpenseAccount } from "./weeklyAccountingTypes.ts";

export const WEEKLY_RECORD_FLOW_DRAFT_BASE_KEY = "watashi-to-ai-weekly-record-flow-draft:v1";

export type WeeklyRecordFlowStep = 1 | 2 | 3 | 4 | 5;
export type WeeklyRecordFlowAnalysisState = "not-started" | "skipped" | "complete" | "partial" | "failed";

export type WeeklyRecordFlowDraftV1 = Readonly<{
  schemaVersion: 1;
  sourceEventId: string;
  step: WeeklyRecordFlowStep;
  measurementRecordId: string | null;
  taskId: string | null;
  privacy: WeeklyPrivacy;
  activityCategory: Exclude<AnalysisActivityCategory, null>;
  interactionSummary: string;
  ownThoughts: string;
  discovery: string;
  accountingDisposition: AccountingDisposition;
  accountingAccount: WeeklyExpenseAccount | null;
  analysisState: WeeklyRecordFlowAnalysisState;
  analysisRequest: Readonly<{
    requestId: string;
    requestedAt: string;
    consentedAt: string;
  }> | null;
  analysisResponse: WeeklyAnalysisResponseV1 | null;
  postAnalysisSupplement: string;
  postAnalysisObjection: string;
  updatedAt: string;
}>;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function weeklyRecordFlowDraftStorageKey(pathname = globalThis.location?.pathname ?? "") {
  return pathname.startsWith("/accounting-of-AI/preview/")
    ? `preview-month-ledger:${WEEKLY_RECORD_FLOW_DRAFT_BASE_KEY}`
    : WEEKLY_RECORD_FLOW_DRAFT_BASE_KEY;
}

export function createWeeklyRecordFlowDraft(
  sourceEventId: string,
  now = new Date(),
): WeeklyRecordFlowDraftV1 {
  return freezeDraft({
    schemaVersion: 1,
    sourceEventId: identifier(sourceEventId, "sourceEventId"),
    step: 1,
    measurementRecordId: null,
    taskId: null,
    privacy: "full",
    activityCategory: "壁打ち",
    interactionSummary: "",
    ownThoughts: "",
    discovery: "",
    accountingDisposition: "unclassified",
    accountingAccount: null,
    analysisState: "not-started",
    analysisRequest: null,
    analysisResponse: null,
    postAnalysisSupplement: "",
    postAnalysisObjection: "",
    updatedAt: now.toISOString(),
  });
}

export function loadWeeklyRecordFlowDraft(
  sourceEventId: string,
  storage: Pick<Storage, "getItem"> = window.localStorage,
  key = weeklyRecordFlowDraftStorageKey(),
): WeeklyRecordFlowDraftV1 {
  const raw = storage.getItem(key);
  if (raw === null) return createWeeklyRecordFlowDraft(sourceEventId);
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return createWeeklyRecordFlowDraft(sourceEventId); }
  try {
    const parsed = parseDraft(value);
    return parsed.sourceEventId === sourceEventId ? parsed : createWeeklyRecordFlowDraft(sourceEventId);
  } catch {
    return createWeeklyRecordFlowDraft(sourceEventId);
  }
}

export function saveWeeklyRecordFlowDraft(
  draft: WeeklyRecordFlowDraftV1,
  storage: Pick<Storage, "setItem"> = window.localStorage,
  key = weeklyRecordFlowDraftStorageKey(),
) {
  const parsed = parseDraft(draft);
  storage.setItem(key, JSON.stringify(parsed));
  return parsed;
}

export function clearWeeklyRecordFlowDraft(
  storage: Pick<Storage, "removeItem"> = window.localStorage,
  key = weeklyRecordFlowDraftStorageKey(),
) {
  storage.removeItem(key);
}

export function updateWeeklyRecordFlowDraft(
  draft: WeeklyRecordFlowDraftV1,
  changes: Partial<Omit<WeeklyRecordFlowDraftV1, "schemaVersion" | "sourceEventId" | "updatedAt">>,
  now = new Date(),
) {
  return parseDraft({ ...draft, ...changes, updatedAt: now.toISOString() });
}

function parseDraft(value: unknown): WeeklyRecordFlowDraftV1 {
  if (!isObject(value) || value.schemaVersion !== 1) invalid();
  const step = value.step;
  if (![1, 2, 3, 4, 5].includes(step as number)) invalid();
  const privacy = value.privacy;
  if (privacy !== "full" && privacy !== "time-only") invalid();
  const activityCategory = value.activityCategory;
  if (!["相談", "壁打ち", "文章作成", "情報収集", "学習", "その他"].includes(activityCategory as string)) invalid();
  const accountingDisposition = value.accountingDisposition;
  if (!["expense", "asset", "work-in-progress", "unclassified"].includes(accountingDisposition as string)) invalid();
  const account = value.accountingAccount;
  const accounts = ["相談活動費", "思考探究費", "成果物利用費", "情報収集費", "学習活動費", "その他AI利用費"];
  if (account !== null && !accounts.includes(account as string)) invalid();
  if (accountingDisposition === "expense" ? account === null : account !== null) invalid();
  const analysisState = value.analysisState;
  if (!["not-started", "skipped", "complete", "partial", "failed"].includes(analysisState as string)) invalid();
  let request: WeeklyRecordFlowDraftV1["analysisRequest"] = null;
  if (value.analysisRequest !== null) {
    if (!isObject(value.analysisRequest)) invalid();
    request = Object.freeze({
      requestId: identifier(value.analysisRequest.requestId, "analysisRequest.requestId"),
      requestedAt: timestamp(value.analysisRequest.requestedAt),
      consentedAt: timestamp(value.analysisRequest.consentedAt),
    });
  }
  const response = value.analysisResponse === null ? null : parseWeeklyAnalysisResponseV1(value.analysisResponse);
  if ((response === null) !== (request === null)) invalid();
  if (response && (response.requestId !== request?.requestId || response.analysisStatus !== analysisState)) invalid();
  return freezeDraft({
    schemaVersion: 1,
    sourceEventId: identifier(value.sourceEventId, "sourceEventId"),
    step: step as WeeklyRecordFlowStep,
    measurementRecordId: nullableIdentifier(value.measurementRecordId),
    taskId: nullableIdentifier(value.taskId),
    privacy,
    activityCategory: activityCategory as WeeklyRecordFlowDraftV1["activityCategory"],
    interactionSummary: text(value.interactionSummary),
    ownThoughts: text(value.ownThoughts),
    discovery: text(value.discovery),
    accountingDisposition: accountingDisposition as AccountingDisposition,
    accountingAccount: account as WeeklyExpenseAccount | null,
    analysisState: analysisState as WeeklyRecordFlowAnalysisState,
    analysisRequest: request,
    analysisResponse: response,
    postAnalysisSupplement: text(value.postAnalysisSupplement),
    postAnalysisObjection: text(value.postAnalysisObjection),
    updatedAt: timestamp(value.updatedAt),
  });
}

function freezeDraft(value: WeeklyRecordFlowDraftV1): WeeklyRecordFlowDraftV1 {
  return Object.freeze({ ...value });
}
function identifier(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 256) throw new Error(`${field} is invalid.`);
  return value;
}
function nullableIdentifier(value: unknown) { return value === null ? null : identifier(value, "identifier"); }
function timestamp(value: unknown) {
  if (typeof value !== "string" || Number.isNaN(new Date(value).getTime())) invalid();
  return new Date(value).toISOString();
}
function text(value: unknown) {
  if (typeof value !== "string" || value.length > 8_000) invalid();
  return value;
}
function isObject(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function invalid(): never { throw new Error("Weekly record flow draft is invalid."); }
