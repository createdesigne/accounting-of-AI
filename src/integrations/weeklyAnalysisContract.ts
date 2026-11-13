import type {
  AnalysisActivityCategory,
  AnalysisScore,
} from "./analysisContract.ts";

export const WEEKLY_ANALYSIS_SCHEMA_VERSION = 1 as const;

export type WeeklyAnalysisOrigin = "gemini-api" | "test-fixture";
export type WeeklyAnalysisResponseStatus = "complete" | "failed";

export type WeeklyAnalysisEvidenceTarget =
  | "activity-category"
  | "ai-role"
  | "initiative"
  | "reasoning"
  | "critical-judgment"
  | "thinking-change"
  | "discovery";

export type WeeklyAnalysisEvidenceV1 = Readonly<{
  target: WeeklyAnalysisEvidenceTarget;
  conversationId: string;
  messageIndex: number;
  quote: string;
}>;

export type WeeklyAnalysisPayloadV1 = Readonly<{
  activityCategory: AnalysisActivityCategory;
  aiRole: string | null;
  /** Research-specific indicator. It is not an official AIAS score. */
  initiative: AnalysisScore;
  /** Research-specific indicator. It is not an official AIAS score. */
  reasoning: AnalysisScore;
  /** Research-specific indicator. It is not an official AIAS score. */
  criticalJudgment: AnalysisScore;
  thinkingChange: string | null;
  discovery: string | null;
  evidence: readonly WeeklyAnalysisEvidenceV1[];
}>;

export type WeeklyAnalysisRequestV1 = Readonly<{
  schemaVersion: 1;
  requestId: string;
  recordId: string;
  conversationId: string;
  thoughtReceiptId: string;
  conversationFingerprint: string;
  requestedAt: string;
  consent: Readonly<{
    externalAnalysisAllowed: true;
    privacy: "full";
    captureScope: "full" | "partial" | "unknown";
    consentedAt: string;
  }>;
  taskContext: Readonly<{
    taskId: string | null;
    plannedAiasLevel: 1 | 2 | 3 | 4 | 5 | null;
    activityCategory: AnalysisActivityCategory;
    expectedAiRole: string | null;
  }>;
  messages: readonly Readonly<{
    role: "user" | "assistant" | "system" | "unknown";
    text: string;
  }>[];
}>;

export type WeeklyAnalysisErrorCode =
  | "INVALID_INPUT"
  | "NOT_AUTHENTICATED"
  | "NOT_AUTHORIZED"
  | "TOO_LARGE"
  | "RATE_LIMITED"
  | "MODEL_UNAVAILABLE"
  | "CONTENT_BLOCKED"
  | "INVALID_OUTPUT"
  | "TIMEOUT"
  | "PROVIDER_ERROR";

export type WeeklyAnalysisResponseV1 = Readonly<{
  schemaVersion: 1;
  analysisId: string;
  requestId: string;
  recordId: string;
  conversationId: string;
  thoughtReceiptId: string;
  conversationFingerprint: string;
  origin: WeeklyAnalysisOrigin;
  analysisStatus: WeeklyAnalysisResponseStatus;
  receivedAt: string;
  analysis: WeeklyAnalysisPayloadV1 | null;
  error: Readonly<{
    code: WeeklyAnalysisErrorCode;
    retryable: boolean;
  }> | null;
}>;

export function parseWeeklyAnalysisRequestV1(value: unknown): WeeklyAnalysisRequestV1 {
  const root = object(value, "Analysis request must be an object.");
  exactKeys(root, [
    "schemaVersion", "requestId", "recordId", "conversationId", "thoughtReceiptId",
    "conversationFingerprint", "requestedAt", "consent", "taskContext", "messages",
  ]);
  if (root.schemaVersion !== WEEKLY_ANALYSIS_SCHEMA_VERSION) invalid("Unsupported analysis request schema.");
  const consent = object(root.consent, "Consent is invalid.");
  exactKeys(consent, ["externalAnalysisAllowed", "privacy", "captureScope", "consentedAt"]);
  if (consent.externalAnalysisAllowed !== true || consent.privacy !== "full"
    || !oneOf(consent.captureScope, ["full", "partial", "unknown"])) invalid("Consent is invalid.");
  const taskContext = object(root.taskContext, "Task context is invalid.");
  exactKeys(taskContext, ["taskId", "plannedAiasLevel", "activityCategory", "expectedAiRole"]);
  const messages = array(root.messages, "Messages are invalid.");
  if (messages.length === 0 || messages.length > 200) invalid("Messages are invalid.");
  const parsedMessages = messages.map((item) => {
    const message = object(item, "Message is invalid.");
    exactKeys(message, ["role", "text"]);
    if (!oneOf(message.role, ["user", "assistant", "system", "unknown"])) invalid("Message role is invalid.");
    return Object.freeze({
      role: message.role,
      text: requiredText(message.text, "Message text is invalid.", 12_000),
    });
  });
  if (parsedMessages.reduce((total, message) => total + message.text.length, 0) > 60_000) {
    invalid("Messages are too large.");
  }
  return Object.freeze({
    schemaVersion: 1,
    requestId: identifier(root.requestId, "requestId"),
    recordId: identifier(root.recordId, "recordId"),
    conversationId: identifier(root.conversationId, "conversationId"),
    thoughtReceiptId: identifier(root.thoughtReceiptId, "thoughtReceiptId"),
    conversationFingerprint: identifier(root.conversationFingerprint, "conversationFingerprint"),
    requestedAt: timestamp(root.requestedAt, "requestedAt"),
    consent: Object.freeze({
      externalAnalysisAllowed: true,
      privacy: "full",
      captureScope: consent.captureScope,
      consentedAt: timestamp(consent.consentedAt, "consentedAt"),
    }),
    taskContext: Object.freeze({
      taskId: nullableIdentifier(taskContext.taskId, "taskContext.taskId"),
      plannedAiasLevel: aiasLevel(taskContext.plannedAiasLevel),
      activityCategory: activityCategory(taskContext.activityCategory),
      expectedAiRole: nullableText(taskContext.expectedAiRole, "taskContext.expectedAiRole", 2_000),
    }),
    messages: Object.freeze(parsedMessages),
  });
}

export function parseWeeklyAnalysisResponseV1(value: unknown): WeeklyAnalysisResponseV1 {
  const root = object(value, "Analysis response must be an object.");
  exactKeys(root, [
    "schemaVersion", "analysisId", "requestId", "recordId", "conversationId", "thoughtReceiptId",
    "conversationFingerprint", "origin", "analysisStatus", "receivedAt", "analysis", "error",
  ]);
  if (root.schemaVersion !== WEEKLY_ANALYSIS_SCHEMA_VERSION) invalid("Unsupported analysis response schema.");
  if (!oneOf(root.origin, ["gemini-api", "test-fixture"])) invalid("Analysis origin is invalid.");
  if (!oneOf(root.analysisStatus, ["complete", "failed"])) invalid("Analysis status is invalid.");
  const analysis = root.analysis === null ? null : parsePayload(root.analysis);
  const error = root.error === null ? null : parseError(root.error);
  if (root.analysisStatus === "complete" && (analysis === null || error !== null)) {
    invalid("A completed response requires analysis and no error.");
  }
  if (root.analysisStatus === "failed" && (analysis !== null || error === null)) {
    invalid("A failed response requires an error and no analysis.");
  }
  return Object.freeze({
    schemaVersion: 1,
    analysisId: identifier(root.analysisId, "analysisId"),
    requestId: identifier(root.requestId, "requestId"),
    recordId: identifier(root.recordId, "recordId"),
    conversationId: identifier(root.conversationId, "conversationId"),
    thoughtReceiptId: identifier(root.thoughtReceiptId, "thoughtReceiptId"),
    conversationFingerprint: identifier(root.conversationFingerprint, "conversationFingerprint"),
    origin: root.origin,
    analysisStatus: root.analysisStatus,
    receivedAt: timestamp(root.receivedAt, "receivedAt"),
    analysis,
    error,
  });
}

function parsePayload(value: unknown): WeeklyAnalysisPayloadV1 {
  const payload = object(value, "Analysis payload is invalid.");
  exactKeys(payload, [
    "activityCategory", "aiRole", "initiative", "reasoning", "criticalJudgment",
    "thinkingChange", "discovery", "evidence",
  ]);
  const evidence = array(payload.evidence, "Analysis evidence is invalid.");
  if (evidence.length > 100) invalid("Analysis evidence is too large.");
  return Object.freeze({
    activityCategory: activityCategory(payload.activityCategory),
    aiRole: nullableText(payload.aiRole, "analysis.aiRole", 2_000),
    initiative: score(payload.initiative, "analysis.initiative"),
    reasoning: score(payload.reasoning, "analysis.reasoning"),
    criticalJudgment: score(payload.criticalJudgment, "analysis.criticalJudgment"),
    thinkingChange: nullableText(payload.thinkingChange, "analysis.thinkingChange", 8_000),
    discovery: nullableText(payload.discovery, "analysis.discovery", 8_000),
    evidence: Object.freeze(evidence.map((item) => {
      const row = object(item, "Analysis evidence is invalid.");
      exactKeys(row, ["target", "conversationId", "messageIndex", "quote"]);
      if (!oneOf(row.target, [
        "activity-category", "ai-role", "initiative", "reasoning", "critical-judgment",
        "thinking-change", "discovery",
      ])) invalid("Analysis evidence target is invalid.");
      if (!Number.isSafeInteger(row.messageIndex) || (row.messageIndex as number) < 0) {
        invalid("Analysis evidence messageIndex is invalid.");
      }
      return Object.freeze({
        target: row.target,
        conversationId: identifier(row.conversationId, "analysis.evidence.conversationId"),
        messageIndex: row.messageIndex as number,
        quote: requiredText(row.quote, "Analysis evidence quote is invalid.", 2_000),
      });
    })),
  });
}

function parseError(value: unknown): NonNullable<WeeklyAnalysisResponseV1["error"]> {
  const error = object(value, "Analysis error is invalid.");
  exactKeys(error, ["code", "retryable"]);
  if (!oneOf(error.code, [
    "INVALID_INPUT", "NOT_AUTHENTICATED", "NOT_AUTHORIZED", "TOO_LARGE", "RATE_LIMITED",
    "MODEL_UNAVAILABLE", "CONTENT_BLOCKED", "INVALID_OUTPUT", "TIMEOUT", "PROVIDER_ERROR",
  ]) || typeof error.retryable !== "boolean") invalid("Analysis error is invalid.");
  return Object.freeze({ code: error.code, retryable: error.retryable });
}

function score(value: unknown, name: string): AnalysisScore {
  if (value === null || oneOf(value, [0, 25, 50, 75, 100])) return value;
  return invalid(`${name} is invalid.`);
}

function activityCategory(value: unknown): AnalysisActivityCategory {
  if (value === null || oneOf(value, ["相談", "壁打ち", "文章作成", "情報収集", "学習", "その他"])) return value;
  return invalid("activityCategory is invalid.");
}

function aiasLevel(value: unknown): 1 | 2 | 3 | 4 | 5 | null {
  if (value === null || oneOf(value, [1, 2, 3, 4, 5])) return value;
  return invalid("plannedAiasLevel is invalid.");
}

function identifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 256) return invalid(`${name} is invalid.`);
  return value;
}

function nullableIdentifier(value: unknown, name: string): string | null {
  return value === null ? null : identifier(value, name);
}

function timestamp(value: unknown, name: string): string {
  if (typeof value !== "string" || Number.isNaN(new Date(value).getTime())) return invalid(`${name} is invalid.`);
  return new Date(value).toISOString();
}

function nullableText(value: unknown, name: string, limit: number): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > limit) return invalid(`${name} is invalid.`);
  return value;
}

function requiredText(value: unknown, message: string, limit: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) return invalid(message);
  return value;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const expected = new Set(keys);
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !expected.has(key))) {
    invalid("Unexpected or missing fields.");
  }
}

function object(value: unknown, message: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid(message);
  return value as Record<string, unknown>;
}

function array(value: unknown, message: string): unknown[] {
  if (!Array.isArray(value)) return invalid(message);
  return value;
}

function oneOf<T extends string | number>(value: unknown, values: readonly T[]): value is T {
  return values.includes(value as T);
}

function invalid(message: string): never {
  throw new Error(message);
}
