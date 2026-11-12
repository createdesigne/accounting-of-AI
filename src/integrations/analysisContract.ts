/**
 * Proposed boundary shared with the analysis implementation.
 *
 * This module intentionally contains data types and validation only. It does
 * not call an AI service, build prompts, choose models, or manage API keys.
 */
export type AnalysisStatus =
  | "not-connected"
  | "pending"
  | "complete"
  | "failed"
  | "not-applicable";

export type AnalysisScore = 0 | 25 | 50 | 75 | 100 | null;

export type AnalysisActivityCategory =
  | "相談"
  | "壁打ち"
  | "文章作成"
  | "情報収集"
  | "学習"
  | "その他"
  | null;

export type ObservedBehaviorKind =
  | "goal-setting"
  | "comparison"
  | "verification"
  | "revision"
  | "own-decision";

export type ThoughtAnalysisV1 = Readonly<{
  schemaVersion: 1;
  recordId: string;
  activityCategory: AnalysisActivityCategory;
  observedBehaviors: readonly Readonly<{
    kind: ObservedBehaviorKind;
    evidence: string | null;
  }>[];
  /** Research-specific indicator. This is not an official AIAS score. */
  initiative: AnalysisScore;
  /** Research-specific indicator. This is not an official AIAS score. */
  reasoning: AnalysisScore;
  /** Research-specific indicator. This is not an official AIAS score. */
  criticalJudgment: AnalysisScore;
  thinkingChange: string | null;
  discovery: string | null;
  analysisStatus: AnalysisStatus;
}>;

/** The only analysis value created by the non-Gemini implementation. */
export function createNotConnectedAnalysis(recordId: string): ThoughtAnalysisV1 {
  if (!recordId.trim()) throw new Error("recordId is required.");
  return Object.freeze({
    schemaVersion: 1,
    recordId,
    activityCategory: null,
    observedBehaviors: Object.freeze([]),
    initiative: null,
    reasoning: null,
    criticalJudgment: null,
    thinkingChange: null,
    discovery: null,
    analysisStatus: "not-connected",
  });
}

export function parseThoughtAnalysisV1(value: unknown): ThoughtAnalysisV1 {
  if (!isObject(value) || value.schemaVersion !== 1 || typeof value.recordId !== "string" || !value.recordId.trim()) {
    throw new Error("Analysis schema is invalid.");
  }
  if (!isCategory(value.activityCategory) || !isStatus(value.analysisStatus)
    || !isScore(value.initiative) || !isScore(value.reasoning) || !isScore(value.criticalJudgment)
    || !isNullableString(value.thinkingChange) || !isNullableString(value.discovery)
    || !Array.isArray(value.observedBehaviors)) {
    throw new Error("Analysis value is invalid.");
  }
  const observedBehaviors = value.observedBehaviors.map((item) => {
    if (!isObject(item) || !isOneOf(item.kind, ["goal-setting", "comparison", "verification", "revision", "own-decision"])
      || !isNullableString(item.evidence)) throw new Error("Analysis evidence is invalid.");
    return Object.freeze({ kind: item.kind, evidence: item.evidence });
  });
  return Object.freeze({
    schemaVersion: 1,
    recordId: value.recordId,
    activityCategory: value.activityCategory,
    observedBehaviors: Object.freeze(observedBehaviors),
    initiative: value.initiative,
    reasoning: value.reasoning,
    criticalJudgment: value.criticalJudgment,
    thinkingChange: value.thinkingChange,
    discovery: value.discovery,
    analysisStatus: value.analysisStatus,
  });
}

function isScore(value: unknown): value is AnalysisScore {
  return value === null || isOneOf(value, [0, 25, 50, 75, 100]);
}

function isStatus(value: unknown): value is AnalysisStatus {
  return isOneOf(value, ["not-connected", "pending", "complete", "failed", "not-applicable"]);
}

function isCategory(value: unknown): value is AnalysisActivityCategory {
  return value === null || isOneOf(value, ["相談", "壁打ち", "文章作成", "情報収集", "学習", "その他"]);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isOneOf<T extends string | number>(value: unknown, values: readonly T[]): value is T {
  return values.includes(value as T);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
