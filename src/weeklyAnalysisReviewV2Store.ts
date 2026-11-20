import type { AnalysisScore } from "./integrations/analysisContract.ts";
import type { WeeklyAnalysisMetricStatusV2 } from "./integrations/weeklyAnalysisContract.ts";
import { isWeeklyAnalysisPayloadV2 } from "./integrations/weeklyAnalysisContract.ts";
import { WEEKLY_ANALYSIS_RUBRIC_VERSION } from "./integrations/weeklyAnalysisRubric.ts";
import { loadWeeklyAnalysisStore } from "./weeklyAnalysisStore.ts";
import { loadWeeklyRecordStore } from "./weeklyStore.ts";

export const WEEKLY_ANALYSIS_REVIEW_V2_STORAGE_KEY = "watashi-to-ai-weekly-analysis-review-history:v2";
export const WEEKLY_ANALYSIS_REVIEW_V2_LOCK = "watashi-to-ai-weekly-analysis-review-history-mutation";

export type WeeklyAnalysisReviewActionV2 = "supplement" | "objection" | "exclusion" | "reassessment";
export type WeeklyAnalysisReviewMetricV2 = Readonly<{
  score: AnalysisScore;
  status: WeeklyAnalysisMetricStatusV2;
  reason: string;
}>;
export type WeeklyAnalysisReviewRevisionV2 = Readonly<{
  schemaVersion: 2;
  revisionId: string;
  analysisId: string;
  recordId: string;
  thoughtReceiptId: string;
  rubricVersion: typeof WEEKLY_ANALYSIS_RUBRIC_VERSION;
  reviewedAt: string;
  action: WeeklyAnalysisReviewActionV2;
  supplement: string | null;
  objection: string | null;
  excluded: boolean;
  exclusionReason: string | null;
  subjectiveDifficulty: "low" | "medium" | "high" | "not_provided";
  metrics: Readonly<{
    initiative: WeeklyAnalysisReviewMetricV2;
    reasoning: WeeklyAnalysisReviewMetricV2;
    independence: WeeklyAnalysisReviewMetricV2;
  }>;
}>;
export type WeeklyAnalysisReviewHistoryStoreV2 = Readonly<{ schemaVersion: 2; revisions: readonly WeeklyAnalysisReviewRevisionV2[] }>;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type LockLike = { request<T>(name: string, options: { mode: "exclusive" }, callback: () => Promise<T> | T): Promise<T> };

export class WeeklyAnalysisReviewV2Error extends Error {
  readonly code: "INVALID" | "LINK_MISMATCH" | "LOCK_UNAVAILABLE" | "SAVE_FAILED";
  constructor(code: WeeklyAnalysisReviewV2Error["code"], message: string) {
    super(message); this.name = "WeeklyAnalysisReviewV2Error"; this.code = code;
  }
}

export function loadWeeklyAnalysisReviewHistoryV2(storage: Pick<Storage, "getItem"> = window.localStorage): WeeklyAnalysisReviewHistoryStoreV2 {
  const raw = storage.getItem(WEEKLY_ANALYSIS_REVIEW_V2_STORAGE_KEY);
  if (raw === null) return freeze([]);
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new WeeklyAnalysisReviewV2Error("INVALID", "v2本人確認履歴を読み込めません。"); }
  if (!object(value) || value.schemaVersion !== 2 || !Array.isArray(value.revisions)) throw new WeeklyAnalysisReviewV2Error("INVALID", "v2本人確認履歴の形式が正しくありません。");
  const revisions = value.revisions.map(parseRevision);
  if (new Set(revisions.map(row => row.revisionId)).size !== revisions.length) throw new WeeklyAnalysisReviewV2Error("INVALID", "v2本人確認履歴IDが重複しています。");
  return freeze(revisions);
}

export async function appendWeeklyAnalysisReviewRevisionV2(
  input: unknown,
  options: { storage?: StorageLike; locks?: LockLike | null } = {},
) {
  const revision = parseRevision(input);
  const storage = options.storage ?? window.localStorage;
  const locks = options.locks === null ? null : options.locks ?? globalThis.navigator?.locks as unknown as LockLike | undefined;
  if (!locks?.request) throw new WeeklyAnalysisReviewV2Error("LOCK_UNAVAILABLE", "安全な排他制御を利用できません。");
  return locks.request(WEEKLY_ANALYSIS_REVIEW_V2_LOCK, { mode: "exclusive" }, () => {
    const records = loadWeeklyRecordStore(storage);
    const analyses = loadWeeklyAnalysisStore(storage);
    const record = records.records.find(row => row.id === revision.recordId);
    const entry = analyses.entries.find(row => row.response?.analysisId === revision.analysisId);
    if (!record || !entry?.response?.analysis || !isWeeklyAnalysisPayloadV2(entry.response.analysis)
      || entry.response.rubricVersion !== WEEKLY_ANALYSIS_RUBRIC_VERSION
      || record.links.thoughtReceiptId !== revision.thoughtReceiptId) {
      throw new WeeklyAnalysisReviewV2Error("LINK_MISMATCH", "v2分析と活動・思考レシートの関連付けが一致しません。");
    }
    const current = loadWeeklyAnalysisReviewHistoryV2(storage);
    const same = current.revisions.find(row => row.revisionId === revision.revisionId);
    if (same) {
      if (JSON.stringify(same) === JSON.stringify(revision)) return current;
      throw new WeeklyAnalysisReviewV2Error("INVALID", "同じ履歴IDに異なる内容を保存できません。");
    }
    const next = freeze([...current.revisions, revision]);
    const previous = storage.getItem(WEEKLY_ANALYSIS_REVIEW_V2_STORAGE_KEY);
    const serialized = JSON.stringify(next);
    try {
      storage.setItem(WEEKLY_ANALYSIS_REVIEW_V2_STORAGE_KEY, serialized);
      if (storage.getItem(WEEKLY_ANALYSIS_REVIEW_V2_STORAGE_KEY) !== serialized) throw new Error("verification failed");
    } catch {
      try { if (previous === null) storage.removeItem(WEEKLY_ANALYSIS_REVIEW_V2_STORAGE_KEY); else storage.setItem(WEEKLY_ANALYSIS_REVIEW_V2_STORAGE_KEY, previous); } catch { /* Preserve original failure. */ }
      throw new WeeklyAnalysisReviewV2Error("SAVE_FAILED", "v2本人確認履歴を保存できませんでした。");
    }
    return next;
  });
}

export function revisionsForAnalysis(store: WeeklyAnalysisReviewHistoryStoreV2, analysisId: string | undefined) {
  return analysisId ? store.revisions.filter(row => row.analysisId === analysisId) : [];
}

function parseRevision(value: unknown): WeeklyAnalysisReviewRevisionV2 {
  if (!object(value) || value.schemaVersion !== 2 || !exact(value, ["schemaVersion", "revisionId", "analysisId", "recordId", "thoughtReceiptId", "rubricVersion", "reviewedAt", "action", "supplement", "objection", "excluded", "exclusionReason", "subjectiveDifficulty", "metrics"])
    || !id(value.revisionId) || !id(value.analysisId) || !id(value.recordId) || !id(value.thoughtReceiptId)
    || value.rubricVersion !== WEEKLY_ANALYSIS_RUBRIC_VERSION || !timestamp(value.reviewedAt)
    || !["supplement", "objection", "exclusion", "reassessment"].includes(value.action as string)
    || !nullableText(value.supplement) || !nullableText(value.objection) || typeof value.excluded !== "boolean"
    || !nullableText(value.exclusionReason) || !["low", "medium", "high", "not_provided"].includes(value.subjectiveDifficulty as string)
    || !object(value.metrics) || !exact(value.metrics, ["initiative", "reasoning", "independence"])) invalid();
  const action = value.action as WeeklyAnalysisReviewActionV2;
  if (action === "exclusion" && (value.excluded !== true || !normalize(value.exclusionReason))) invalid();
  return Object.freeze({
    schemaVersion: 2, revisionId: value.revisionId as string, analysisId: value.analysisId as string,
    recordId: value.recordId as string, thoughtReceiptId: value.thoughtReceiptId as string,
    rubricVersion: WEEKLY_ANALYSIS_RUBRIC_VERSION, reviewedAt: new Date(value.reviewedAt as string).toISOString(), action,
    supplement: normalize(value.supplement), objection: normalize(value.objection), excluded: value.excluded as boolean,
    exclusionReason: normalize(value.exclusionReason), subjectiveDifficulty: value.subjectiveDifficulty as WeeklyAnalysisReviewRevisionV2["subjectiveDifficulty"],
    metrics: Object.freeze({ initiative: parseMetric(value.metrics.initiative), reasoning: parseMetric(value.metrics.reasoning), independence: parseMetric(value.metrics.independence) }),
  });
}
function parseMetric(value: unknown): WeeklyAnalysisReviewMetricV2 {
  if (!object(value) || !exact(value, ["score", "status", "reason"]) || !score(value.score)
    || !["confirmed", "provisional", "hold", "not_applicable"].includes(value.status as string) || typeof value.reason !== "string" || value.reason.length > 4000) invalid();
  if (["hold", "not_applicable"].includes(value.status as string) && value.score !== null) invalid();
  if (["confirmed", "provisional"].includes(value.status as string) && value.score === null) invalid();
  return Object.freeze({ score: value.score as AnalysisScore, status: value.status as WeeklyAnalysisMetricStatusV2, reason: value.reason.trim() });
}
function freeze(revisions: readonly WeeklyAnalysisReviewRevisionV2[]): WeeklyAnalysisReviewHistoryStoreV2 { return Object.freeze({ schemaVersion: 2, revisions: Object.freeze([...revisions]) }); }
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: readonly string[]) { const actual = Object.keys(value); return actual.length === keys.length && actual.every(key => keys.includes(key)); }
function id(value: unknown) { return typeof value === "string" && !!value.trim() && value.length <= 256; }
function timestamp(value: unknown) { return typeof value === "string" && !Number.isNaN(new Date(value).getTime()); }
function nullableText(value: unknown) { return value === null || (typeof value === "string" && value.length <= 8000); }
function normalize(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function score(value: unknown): value is AnalysisScore { return value === null || [0, 25, 50, 75, 100].includes(value as number); }
function invalid(): never { throw new WeeklyAnalysisReviewV2Error("INVALID", "v2本人確認内容が正しくありません。"); }
