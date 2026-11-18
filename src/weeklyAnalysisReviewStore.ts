import type { AnalysisActivityCategory, AnalysisScore } from "./integrations/analysisContract.ts";
import type {
  WeeklyAnalysisAccountCandidate,
  WeeklyAnalysisDispositionCandidate,
} from "./integrations/weeklyAnalysisContract.ts";
import { loadWeeklyAnalysisStore } from "./weeklyAnalysisStore.ts";
import { loadWeeklyRecordStore } from "./weeklyStore.ts";

export const WEEKLY_ANALYSIS_REVIEWS_STORAGE_KEY = "watashi-to-ai-weekly-analysis-reviews:v1";
export const WEEKLY_ANALYSIS_REVIEWS_LOCK = "watashi-to-ai-weekly-analysis-reviews-mutation";

export type WeeklyAnalysisReviewFieldsV1 = Readonly<{
  activityCategory: AnalysisActivityCategory;
  accountCandidate: WeeklyAnalysisAccountCandidate;
  accountingDispositionCandidate: WeeklyAnalysisDispositionCandidate;
  aiRole: string | null;
  collaborationSummary: string | null;
  initiative: AnalysisScore;
  reasoning: AnalysisScore;
  criticalJudgment: AnalysisScore;
  thinkingChange: string | null;
  discovery: string | null;
  reviewerNote: string | null;
}>;

export type WeeklyAnalysisReviewV1 = Readonly<{
  schemaVersion: 1;
  analysisId: string;
  recordId: string;
  thoughtReceiptId: string;
  reviewedAt: string;
  fields: WeeklyAnalysisReviewFieldsV1;
}>;

export type WeeklyAnalysisReviewStoreV1 = Readonly<{
  schemaVersion: 1;
  reviews: readonly WeeklyAnalysisReviewV1[];
}>;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type LockManagerLike = {
  request<T>(name: string, options: { mode: "exclusive" }, callback: () => Promise<T> | T): Promise<T>;
};

export type WeeklyAnalysisReviewOptions = Readonly<{
  storage?: StorageLike;
  locks?: LockManagerLike | null;
}>;

export class WeeklyAnalysisReviewStoreError extends Error {
  readonly code: "STORE_INVALID" | "LOCK_UNAVAILABLE" | "SAVE_FAILED" | "LINK_MISMATCH";
  constructor(code: WeeklyAnalysisReviewStoreError["code"], message: string) {
    super(message);
    this.name = "WeeklyAnalysisReviewStoreError";
    this.code = code;
  }
}

export function loadWeeklyAnalysisReviewStore(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): WeeklyAnalysisReviewStoreV1 {
  const raw = storage.getItem(WEEKLY_ANALYSIS_REVIEWS_STORAGE_KEY);
  if (raw === null) return freezeStore([]);
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return invalid("本人確認済み分析を読み込めませんでした。"); }
  if (!isObject(value) || value.schemaVersion !== 1 || !Array.isArray(value.reviews)) {
    return invalid("本人確認済み分析の保存形式が正しくありません。");
  }
  const reviews = value.reviews.map(parseReview);
  if (new Set(reviews.map((review) => review.analysisId)).size !== reviews.length) {
    return invalid("本人確認済み分析IDが重複しています。");
  }
  return freezeStore(reviews);
}

export async function saveWeeklyAnalysisReview(
  input: unknown,
  options: WeeklyAnalysisReviewOptions = {},
): Promise<WeeklyAnalysisReviewStoreV1> {
  const review = parseReview(input);
  const storage = options.storage ?? window.localStorage;
  const locks = options.locks === null
    ? undefined
    : options.locks ?? globalThis.navigator?.locks as unknown as LockManagerLike | undefined;
  if (!locks?.request) throw new WeeklyAnalysisReviewStoreError("LOCK_UNAVAILABLE", "安全な排他制御を利用できません。");
  return locks.request(WEEKLY_ANALYSIS_REVIEWS_LOCK, { mode: "exclusive" }, () => {
    const analyses = loadWeeklyAnalysisStore(storage);
    const records = loadWeeklyRecordStore(storage);
    const entry = analyses.entries.find((item) => item.response?.analysisId === review.analysisId);
    const record = records.records.find((item) => item.id === review.recordId);
    if (!entry?.response || !["complete", "partial"].includes(entry.analysisStatus) || !record
      || entry.recordId !== record.id || entry.thoughtReceiptId !== review.thoughtReceiptId
      || entry.response.analysisId !== review.analysisId) {
      throw new WeeklyAnalysisReviewStoreError("LINK_MISMATCH", "分析結果と活動・思考レシートの関連付けが一致しません。");
    }
    const current = loadWeeklyAnalysisReviewStore(storage);
    const next = freezeStore([
      ...current.reviews.filter((item) => item.analysisId !== review.analysisId),
      review,
    ]);
    save(storage, next);
    return next;
  });
}

export function findWeeklyAnalysisReview(
  store: WeeklyAnalysisReviewStoreV1,
  analysisId: string | undefined,
): WeeklyAnalysisReviewV1 | null {
  return analysisId ? store.reviews.find((review) => review.analysisId === analysisId) ?? null : null;
}

function parseReview(value: unknown): WeeklyAnalysisReviewV1 {
  if (!isObject(value) || !exactKeys(value, ["schemaVersion", "analysisId", "recordId", "thoughtReceiptId", "reviewedAt", "fields"])
    || value.schemaVersion !== 1 || !identifier(value.analysisId) || !identifier(value.recordId)
    || !identifier(value.thoughtReceiptId) || !timestamp(value.reviewedAt) || !isObject(value.fields)) {
    return invalid("本人確認済み分析の内容が正しくありません。");
  }
  const fields = value.fields;
  if (!exactKeys(fields, ["activityCategory", "accountCandidate", "accountingDispositionCandidate", "aiRole", "collaborationSummary", "initiative", "reasoning", "criticalJudgment", "thinkingChange", "discovery", "reviewerNote"])
    || !category(fields.activityCategory) || !account(fields.accountCandidate) || !disposition(fields.accountingDispositionCandidate)
    || !nullableText(fields.aiRole, 2_000) || !nullableText(fields.collaborationSummary, 8_000)
    || !score(fields.initiative) || !score(fields.reasoning) || !score(fields.criticalJudgment)
    || !nullableText(fields.thinkingChange, 8_000) || !nullableText(fields.discovery, 8_000)
    || !nullableText(fields.reviewerNote, 8_000)) {
    return invalid("本人確認済み分析の修正内容が正しくありません。");
  }
  return Object.freeze({
    schemaVersion: 1,
    analysisId: value.analysisId,
    recordId: value.recordId,
    thoughtReceiptId: value.thoughtReceiptId,
    reviewedAt: new Date(value.reviewedAt).toISOString(),
    fields: Object.freeze({
      activityCategory: fields.activityCategory,
      accountCandidate: fields.accountCandidate,
      accountingDispositionCandidate: fields.accountingDispositionCandidate,
      aiRole: normalize(fields.aiRole),
      collaborationSummary: normalize(fields.collaborationSummary),
      initiative: fields.initiative,
      reasoning: fields.reasoning,
      criticalJudgment: fields.criticalJudgment,
      thinkingChange: normalize(fields.thinkingChange),
      discovery: normalize(fields.discovery),
      reviewerNote: normalize(fields.reviewerNote),
    } as WeeklyAnalysisReviewFieldsV1),
  });
}

function save(storage: StorageLike, store: WeeklyAnalysisReviewStoreV1) {
  const previous = storage.getItem(WEEKLY_ANALYSIS_REVIEWS_STORAGE_KEY);
  const serialized = JSON.stringify(store);
  try {
    storage.setItem(WEEKLY_ANALYSIS_REVIEWS_STORAGE_KEY, serialized);
    if (storage.getItem(WEEKLY_ANALYSIS_REVIEWS_STORAGE_KEY) !== serialized) throw new Error("Verification failed.");
  } catch {
    try { if (previous === null) storage.removeItem(WEEKLY_ANALYSIS_REVIEWS_STORAGE_KEY); else storage.setItem(WEEKLY_ANALYSIS_REVIEWS_STORAGE_KEY, previous); }
    catch { /* Preserve the original error. */ }
    throw new WeeklyAnalysisReviewStoreError("SAVE_FAILED", "本人確認済み分析を保存できませんでした。");
  }
}

function freezeStore(reviews: readonly WeeklyAnalysisReviewV1[]): WeeklyAnalysisReviewStoreV1 {
  return Object.freeze({ schemaVersion: 1, reviews: Object.freeze([...reviews]) });
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) { const actual = Object.keys(value); return actual.length === keys.length && actual.every((key) => keys.includes(key)); }
function identifier(value: unknown): value is string { return typeof value === "string" && !!value.trim() && value.length <= 256; }
function timestamp(value: unknown): value is string { return typeof value === "string" && !Number.isNaN(new Date(value).getTime()); }
function score(value: unknown): value is AnalysisScore { return value === null || [0, 25, 50, 75, 100].includes(value as number); }
function category(value: unknown): value is AnalysisActivityCategory { return value === null || ["相談", "壁打ち", "文章作成", "情報収集", "学習", "その他"].includes(value as string); }
function account(value: unknown): value is WeeklyAnalysisAccountCandidate { return value === null || ["相談活動費", "思考探究費", "成果物利用費", "情報収集費", "学習活動費", "その他AI利用費"].includes(value as string); }
function disposition(value: unknown): value is WeeklyAnalysisDispositionCandidate { return value === null || ["expense", "asset", "work-in-progress", "unclassified"].includes(value as string); }
function nullableText(value: unknown, limit: number) { return value === null || (typeof value === "string" && value.length <= limit); }
function normalize(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function isObject(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function invalid(message: string): never { throw new WeeklyAnalysisReviewStoreError("STORE_INVALID", message); }
