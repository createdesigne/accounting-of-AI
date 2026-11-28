import type {
  AnalysisActivityCategory,
  AnalysisScore,
} from "./analysisContract.ts";

export const WEEKLY_ANALYSIS_SCHEMA_VERSION = 1 as const;

export type WeeklyAnalysisOrigin = "gemini-api" | "test-fixture";
export type WeeklyAnalysisResponseStatus = "complete" | "partial" | "failed";
export type WeeklyAnalysisPartialReason = "missing-evidence" | "invalid-evidence";
export type WeeklyAnalysisUnresolvedFieldPath =
  | "analysis.activityCategory"
  | "analysis.accountCandidate"
  | "analysis.accountingDispositionCandidate"
  | "analysis.aiRole"
  | "analysis.collaborationBehaviors"
  | "analysis.initiative"
  | "analysis.reasoning"
  | "analysis.independence"
  | "analysis.metricAssessments.independence.deliberation"
  | "analysis.metricAssessments.independence.finalDecision"
  | "analysis.criticalJudgment"
  | "analysis.thinkingChange"
  | "analysis.discovery";
export type WeeklyAnalysisUnresolvedFieldV1 = Readonly<{
  field: WeeklyAnalysisUnresolvedFieldPath;
  reason: WeeklyAnalysisPartialReason;
}>;
export type WeeklyAnalysisAccountCandidate =
  | "相談活動費"
  | "思考探究費"
  | "成果物利用費"
  | "情報収集費"
  | "学習活動費"
  | "その他AI利用費"
  | null;
export type WeeklyAnalysisDispositionCandidate = "expense" | "asset" | "work-in-progress" | "unclassified" | null;
export type WeeklyAnalysisCollaborationKind =
  | "goal-setting"
  | "comparison"
  | "verification"
  | "revision"
  | "own-decision"
  | "delegation"
  | "synthesis";

export type WeeklyAnalysisEvidenceTarget =
  | "activity-category"
  | "account-candidate"
  | "accounting-disposition"
  | "ai-role"
  | "collaboration-behavior"
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

export type WeeklyAnalysisMetricStatusV2 = "confirmed" | "provisional" | "hold" | "not_applicable";
export type WeeklyAnalysisEvidenceSourceV2 = "observed_behavior" | "self_report";
export type WeeklyAnalysisEvidenceSufficiencyV2 = "high" | "medium" | "low";
export type WeeklyAnalysisMetricEvidenceV2 = Readonly<{
  conversationId: string;
  messageIndex: number;
  utteranceId: string;
  speaker: "user" | "assistant" | "system" | "unknown";
  quote: string;
  observedFeature: string;
  source: WeeklyAnalysisEvidenceSourceV2;
}>;
export type WeeklyAnalysisMetricAssessmentV2 = Readonly<{
  score: AnalysisScore;
  status: WeeklyAnalysisMetricStatusV2;
  reason: string;
  rubricLevel: 0 | 25 | 50 | 75 | 100 | null;
  evidence: readonly WeeklyAnalysisMetricEvidenceV2[];
  unconfirmed: readonly string[];
  evidenceSufficiency: WeeklyAnalysisEvidenceSufficiencyV2;
}>;
export type WeeklyAnalysisIndependenceAssessmentV2 = WeeklyAnalysisMetricAssessmentV2 & Readonly<{
  deliberation: WeeklyAnalysisMetricAssessmentV2;
  finalDecision: WeeklyAnalysisMetricAssessmentV2;
}>;
export type WeeklyAnalysisTaskComplexityV2 = Readonly<{
  level: "low" | "medium" | "high" | "unknown";
  reason: string;
  considerationFactors: string;
  uncertainty: string;
  reasoningProcess: string;
}>;

export type WeeklyAnalysisPayloadV1 = Readonly<{
  activityCategory: AnalysisActivityCategory;
  /** Advisory only. It never changes a saved journal or settlement. */
  accountCandidate?: WeeklyAnalysisAccountCandidate;
  /** Advisory only. It never changes the user's accounting disposition. */
  accountingDispositionCandidate?: WeeklyAnalysisDispositionCandidate;
  aiRole: string | null;
  collaborationBehaviors?: readonly Readonly<{
    kind: WeeklyAnalysisCollaborationKind;
    description: string;
  }>[];
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

export type WeeklyAnalysisPayloadV2 = Readonly<{
  activityCategory: AnalysisActivityCategory;
  accountCandidate: WeeklyAnalysisAccountCandidate;
  accountingDispositionCandidate: WeeklyAnalysisDispositionCandidate;
  aiRole: string | null;
  collaborationBehaviors: readonly Readonly<{ kind: WeeklyAnalysisCollaborationKind; description: string }>[];
  initiative: AnalysisScore;
  reasoning: AnalysisScore;
  independence: AnalysisScore;
  metricAssessments: Readonly<{
    initiative: WeeklyAnalysisMetricAssessmentV2;
    reasoning: WeeklyAnalysisMetricAssessmentV2;
    independence: WeeklyAnalysisIndependenceAssessmentV2;
  }>;
  taskComplexity: WeeklyAnalysisTaskComplexityV2;
  subjectiveDifficulty: Readonly<{ level: "not_provided"; source: "self_report"; note: null }>;
  thinkingChange: string | null;
  discovery: string | null;
  evidence: readonly WeeklyAnalysisEvidenceV1[];
}>;

export function isWeeklyAnalysisPayloadV2(value: WeeklyAnalysisPayloadV1 | WeeklyAnalysisPayloadV2): value is WeeklyAnalysisPayloadV2 {
  return "independence" in value && "metricAssessments" in value;
}

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

export type WeeklyAnalysisDiagnosticStage =
  | "provider-response"
  | "output-truncated"
  | "interaction-envelope"
  | "json-parse"
  | "schema-validation"
  | "evidence-validation";

export const WEEKLY_ANALYSIS_PROVIDER_API_VERSION = "v1beta" as const;
export const WEEKLY_ANALYSIS_PROVIDER_SDK_VERSION = "@google/genai@2.32.0" as const;
export type GeminiApiMethod = "interactions" | "generate-content";
export type WeeklyAnalysisValidationRule =
  | "required"
  | "unexpected-fields"
  | "type"
  | "enum"
  | "integer"
  | "non-empty"
  | "max-length"
  | "max-items"
  | "evidence-required"
  | "message-index-range"
  | "conversation-id-match"
  | "quote-match"
  | "score-match";

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
  /** Required for new API responses; omitted only by legacy stored responses. */
  model?: string;
  /** Explicit transport selected by the person. Omitted only by legacy stored responses. */
  apiMethod?: GeminiApiMethod;
  /** Required for new API responses; omitted only by legacy stored responses. */
  rubricVersion?: string;
  /** Required for new API responses; omitted only by legacy stored responses. */
  analyzedAt?: string;
  analysis: WeeklyAnalysisPayloadV1 | WeeklyAnalysisPayloadV2 | null;
  /** App-generated reasons only; never contains the rejected value or conversation text. */
  unresolvedFields?: readonly WeeklyAnalysisUnresolvedFieldV1[];
  error: Readonly<{
    code: WeeklyAnalysisErrorCode;
    retryable: boolean;
    /** Privacy-safe failure stage. Never contains API keys, prompts, or conversation text. */
    diagnosticStage?: WeeklyAnalysisDiagnosticStage;
    providerHttpStatus?: number;
    providerErrorCode?: string;
    timedOut?: boolean;
    providerApiVersion?: typeof WEEKLY_ANALYSIS_PROVIDER_API_VERSION;
    providerSdkVersion?: typeof WEEKLY_ANALYSIS_PROVIDER_SDK_VERSION;
    validationField?: string;
    validationRule?: WeeklyAnalysisValidationRule;
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
  allowedKeys(root, [
    "schemaVersion", "analysisId", "requestId", "recordId", "conversationId", "thoughtReceiptId",
    "conversationFingerprint", "origin", "analysisStatus", "receivedAt", "model", "apiMethod", "rubricVersion",
    "analyzedAt", "analysis", "unresolvedFields", "error",
  ], [
    "schemaVersion", "analysisId", "requestId", "recordId", "conversationId", "thoughtReceiptId",
    "conversationFingerprint", "origin", "analysisStatus", "receivedAt", "analysis", "error",
  ]);
  if (root.schemaVersion !== WEEKLY_ANALYSIS_SCHEMA_VERSION) invalid("Unsupported analysis response schema.");
  if (!oneOf(root.origin, ["gemini-api", "test-fixture"])) invalid("Analysis origin is invalid.");
  if (!oneOf(root.analysisStatus, ["complete", "partial", "failed"])) invalid("Analysis status is invalid.");
  const realResponse = root.origin === "gemini-api";
  const model = root.model === undefined ? undefined : requiredText(root.model, "model is invalid.", 128);
  const apiMethod = root.apiMethod === undefined ? undefined : root.apiMethod;
  if (!(apiMethod === undefined || oneOf(apiMethod, ["interactions", "generate-content"]))) invalid("apiMethod is invalid.");
  const rubricVersion = root.rubricVersion === undefined ? undefined : identifier(root.rubricVersion, "rubricVersion");
  const analyzedAt = root.analyzedAt === undefined ? undefined : timestamp(root.analyzedAt, "analyzedAt");
  const metadataCount = [model, rubricVersion, analyzedAt].filter(Boolean).length;
  if (metadataCount !== 0 && metadataCount !== 3) {
    invalid("Analysis metadata must be complete.");
  }
  const structuredRealResponse = realResponse && metadataCount === 3;
  const isV2 = rubricVersion === "research-thinking-rubric-v2";
  const analysis = root.analysis === null ? null : isV2
    ? parsePayloadV2(root.analysis)
    : parsePayload(root.analysis, structuredRealResponse);
  const unresolvedFields = root.unresolvedFields === undefined ? Object.freeze([]) : parseUnresolvedFields(root.unresolvedFields);
  const error = root.error === null ? null : parseError(root.error);
  if (root.analysisStatus === "complete" && (analysis === null || error !== null || unresolvedFields.length !== 0)) {
    invalid("A completed response requires analysis, no error, and no unresolved fields.");
  }
  if (root.analysisStatus === "partial" && (analysis === null || error !== null || unresolvedFields.length === 0)) {
    invalid("A partial response requires analysis and unresolved fields.");
  }
  if (root.analysisStatus === "failed" && (analysis !== null || error === null || unresolvedFields.length !== 0)) {
    invalid("A failed response requires an error and no analysis.");
  }
  if (analysis) {
    if (isWeeklyAnalysisPayloadV2(analysis)) assertUnresolvedFieldsMatchAnalysisV2(analysis, unresolvedFields);
    else assertUnresolvedFieldsMatchAnalysis(analysis, unresolvedFields);
  }
  if (structuredRealResponse && analysis && !isWeeklyAnalysisPayloadV2(analysis)) assertEvidenceCoverage(analysis);
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
    ...(model ? { model } : {}),
    ...(apiMethod ? { apiMethod } : {}),
    ...(rubricVersion ? { rubricVersion } : {}),
    ...(analyzedAt ? { analyzedAt } : {}),
    analysis,
    ...(root.unresolvedFields === undefined ? {} : { unresolvedFields }),
    error,
  });
}

function parseUnresolvedFields(value: unknown): readonly WeeklyAnalysisUnresolvedFieldV1[] {
  const rows = array(value, "Unresolved analysis fields are invalid.");
  const allowedFields: readonly WeeklyAnalysisUnresolvedFieldPath[] = [
    "analysis.activityCategory", "analysis.accountCandidate", "analysis.accountingDispositionCandidate",
    "analysis.aiRole", "analysis.collaborationBehaviors", "analysis.initiative", "analysis.reasoning",
    "analysis.independence", "analysis.metricAssessments.independence.deliberation", "analysis.metricAssessments.independence.finalDecision",
    "analysis.criticalJudgment", "analysis.thinkingChange", "analysis.discovery",
  ];
  if (rows.length > allowedFields.length) invalid("Unresolved analysis fields are too large.");
  const parsed = rows.map(item => {
    const row = object(item, "Unresolved analysis field is invalid.");
    exactKeys(row, ["field", "reason"]);
    if (!oneOf(row.field, allowedFields) || !oneOf(row.reason, ["missing-evidence", "invalid-evidence"])) {
      invalid("Unresolved analysis field is invalid.");
    }
    return Object.freeze({ field: row.field, reason: row.reason });
  });
  if (new Set(parsed.map(row => row.field)).size !== parsed.length) invalid("Unresolved analysis fields are duplicated.");
  return Object.freeze(parsed);
}

function assertUnresolvedFieldsMatchAnalysis(
  analysis: WeeklyAnalysisPayloadV1,
  unresolvedFields: readonly WeeklyAnalysisUnresolvedFieldV1[],
) {
  const targets: Partial<Record<WeeklyAnalysisUnresolvedFieldPath, WeeklyAnalysisEvidenceTarget>> = {
    "analysis.activityCategory": "activity-category",
    "analysis.accountCandidate": "account-candidate",
    "analysis.accountingDispositionCandidate": "accounting-disposition",
    "analysis.aiRole": "ai-role",
    "analysis.collaborationBehaviors": "collaboration-behavior",
    "analysis.initiative": "initiative",
    "analysis.reasoning": "reasoning",
    "analysis.criticalJudgment": "critical-judgment",
    "analysis.thinkingChange": "thinking-change",
    "analysis.discovery": "discovery",
  } as const;
  for (const row of unresolvedFields) {
    if (row.field === "analysis.independence" || row.field.startsWith("analysis.metricAssessments.")) invalid("v2 unresolved fields cannot be attached to v1 analysis.");
    const field = row.field.slice("analysis.".length) as keyof WeeklyAnalysisPayloadV1;
    const value = analysis[field];
    const empty = field === "collaborationBehaviors" ? Array.isArray(value) && value.length === 0 : value === null;
    if (!empty || analysis.evidence.some(evidence => evidence.target === targets[row.field])) {
      invalid("An unresolved field must be null/empty and have no retained evidence.");
    }
  }
}

function assertUnresolvedFieldsMatchAnalysisV2(
  analysis: WeeklyAnalysisPayloadV2,
  unresolvedFields: readonly WeeklyAnalysisUnresolvedFieldV1[],
) {
  const commonTargets: Partial<Record<WeeklyAnalysisUnresolvedFieldPath, WeeklyAnalysisEvidenceTarget>> = {
    "analysis.activityCategory": "activity-category", "analysis.accountCandidate": "account-candidate",
    "analysis.accountingDispositionCandidate": "accounting-disposition", "analysis.aiRole": "ai-role",
    "analysis.collaborationBehaviors": "collaboration-behavior", "analysis.thinkingChange": "thinking-change",
    "analysis.discovery": "discovery",
  };
  for (const row of unresolvedFields) {
    if (row.field === "analysis.criticalJudgment") invalid("v1 critical judgment cannot be a v2 unresolved field.");
    if (row.field === "analysis.metricAssessments.independence.deliberation" || row.field === "analysis.metricAssessments.independence.finalDecision") {
      const stage = row.field.endsWith("deliberation") ? analysis.metricAssessments.independence.deliberation : analysis.metricAssessments.independence.finalDecision;
      if (stage.score !== null || stage.status !== "hold" || stage.evidence.length !== 0) invalid("An unresolved independence stage must be held without a score.");
      continue;
    }
    const metric = row.field === "analysis.initiative" ? analysis.metricAssessments.initiative
      : row.field === "analysis.reasoning" ? analysis.metricAssessments.reasoning
        : row.field === "analysis.independence" ? analysis.metricAssessments.independence : null;
    if (metric) {
      if (metric.score !== null || metric.status !== "hold" || metric.evidence.length !== 0) invalid("An unresolved v2 metric must be held without a score.");
      continue;
    }
    const field = row.field.slice("analysis.".length) as keyof WeeklyAnalysisPayloadV2;
    const value = analysis[field];
    const empty = field === "collaborationBehaviors" ? Array.isArray(value) && value.length === 0 : value === null;
    const target = commonTargets[row.field];
    if (!empty || (target && analysis.evidence.some(evidence => evidence.target === target))) invalid("An unresolved v2 field must be null/empty without evidence.");
  }
}

function parsePayloadV2(value: unknown): WeeklyAnalysisPayloadV2 {
  const payload = object(value, "Analysis v2 payload is invalid.");
  exactKeys(payload, [
    "activityCategory", "accountCandidate", "accountingDispositionCandidate", "aiRole",
    "collaborationBehaviors", "initiative", "reasoning", "independence", "metricAssessments",
    "taskComplexity", "subjectiveDifficulty", "thinkingChange", "discovery", "evidence",
  ]);
  const assessments = object(payload.metricAssessments, "Metric assessments are invalid.");
  exactKeys(assessments, ["initiative", "reasoning", "independence"]);
  const initiativeAssessment = parseMetricAssessmentV2(assessments.initiative, "initiative");
  const reasoningAssessment = parseMetricAssessmentV2(assessments.reasoning, "reasoning");
  const independenceAssessment = parseIndependenceAssessmentV2(assessments.independence);
  const initiative = score(payload.initiative, "analysis.initiative");
  const reasoning = score(payload.reasoning, "analysis.reasoning");
  const independence = score(payload.independence, "analysis.independence");
  if (initiative !== initiativeAssessment.score || reasoning !== reasoningAssessment.score
    || independence !== independenceAssessment.score) invalid("Metric score and assessment do not match.");
  const complexity = object(payload.taskComplexity, "Task complexity is invalid.");
  exactKeys(complexity, ["level", "reason", "considerationFactors", "uncertainty", "reasoningProcess"]);
  if (!oneOf(complexity.level, ["low", "medium", "high", "unknown"])) invalid("Task complexity level is invalid.");
  const subjective = object(payload.subjectiveDifficulty, "Subjective difficulty is invalid.");
  exactKeys(subjective, ["level", "source", "note"]);
  if (subjective.level !== "not_provided" || subjective.source !== "self_report" || subjective.note !== null) {
    invalid("AI must not infer subjective difficulty.");
  }
  const commonEvidence = parseLinkedEvidenceV2(payload.evidence, "analysis.evidence");
  return Object.freeze({
    activityCategory: activityCategory(payload.activityCategory),
    accountCandidate: accountCandidate(payload.accountCandidate),
    accountingDispositionCandidate: dispositionCandidate(payload.accountingDispositionCandidate),
    aiRole: nullableText(payload.aiRole, "analysis.aiRole", 2_000),
    collaborationBehaviors: parseCollaborationBehaviors(payload.collaborationBehaviors),
    initiative,
    reasoning,
    independence,
    metricAssessments: Object.freeze({
      initiative: initiativeAssessment,
      reasoning: reasoningAssessment,
      independence: independenceAssessment,
    }),
    taskComplexity: Object.freeze({
      level: complexity.level,
      reason: requiredText(complexity.reason, "Complexity reason is invalid.", 4_000),
      considerationFactors: requiredText(complexity.considerationFactors, "Complexity factors are invalid.", 4_000),
      uncertainty: requiredText(complexity.uncertainty, "Complexity uncertainty is invalid.", 4_000),
      reasoningProcess: requiredText(complexity.reasoningProcess, "Complexity reasoning process is invalid.", 4_000),
    }),
    subjectiveDifficulty: Object.freeze({ level: "not_provided", source: "self_report", note: null }),
    thinkingChange: nullableText(payload.thinkingChange, "analysis.thinkingChange", 8_000),
    discovery: nullableText(payload.discovery, "analysis.discovery", 8_000),
    evidence: commonEvidence,
  });
}

function parseMetricAssessmentV2(value: unknown, name: string): WeeklyAnalysisMetricAssessmentV2 {
  const row = object(value, `Metric ${name} is invalid.`);
  exactKeys(row, ["score", "status", "reason", "rubricLevel", "evidence", "unconfirmed", "evidenceSufficiency"]);
  if (!oneOf(row.status, ["confirmed", "provisional", "hold", "not_applicable"])) invalid(`Metric ${name} status is invalid.`);
  const metricScore = score(row.score, `analysis.metricAssessments.${name}.score`);
  const rubricLevel = score(row.rubricLevel, `analysis.metricAssessments.${name}.rubricLevel`);
  const evidence = parseMetricEvidenceV2(row.evidence, `analysis.metricAssessments.${name}.evidence`);
  const unconfirmed = parseTextList(row.unconfirmed, `analysis.metricAssessments.${name}.unconfirmed`);
  if (!oneOf(row.evidenceSufficiency, ["high", "medium", "low"])) invalid(`Metric ${name} evidence sufficiency is invalid.`);
  if ((row.status === "confirmed" || row.status === "provisional")
    && (metricScore === null || rubricLevel !== metricScore || evidence.length === 0)) {
    invalid(`Scored metric ${name} requires matching rubric and evidence.`);
  }
  if ((row.status === "hold" || row.status === "not_applicable") && (metricScore !== null || rubricLevel !== null)) {
    invalid(`Unscored metric ${name} must use null.`);
  }
  return Object.freeze({
    score: metricScore,
    status: row.status,
    reason: requiredText(row.reason, `Metric ${name} reason is invalid.`, 4_000),
    rubricLevel,
    evidence,
    unconfirmed,
    evidenceSufficiency: row.evidenceSufficiency,
  });
}

function parseIndependenceAssessmentV2(value: unknown): WeeklyAnalysisIndependenceAssessmentV2 {
  const row = object(value, "Independence assessment is invalid.");
  exactKeys(row, ["score", "status", "reason", "rubricLevel", "evidence", "unconfirmed", "evidenceSufficiency", "deliberation", "finalDecision"]);
  const base = parseMetricAssessmentV2(Object.fromEntries(Object.entries(row).filter(([key]) => !["deliberation", "finalDecision"].includes(key))), "independence");
  return Object.freeze({
    ...base,
    deliberation: parseMetricAssessmentV2(row.deliberation, "independence.deliberation"),
    finalDecision: parseMetricAssessmentV2(row.finalDecision, "independence.finalDecision"),
  });
}

function parseMetricEvidenceV2(value: unknown, name: string): readonly WeeklyAnalysisMetricEvidenceV2[] {
  const rows = array(value, `${name} is invalid.`);
  if (rows.length > 50) invalid(`${name} is too large.`);
  return Object.freeze(rows.map((item) => {
    const row = object(item, `${name} item is invalid.`);
    exactKeys(row, ["conversationId", "messageIndex", "utteranceId", "speaker", "quote", "observedFeature", "source"]);
    if (!Number.isSafeInteger(row.messageIndex) || (row.messageIndex as number) < 0
      || !oneOf(row.speaker, ["user", "assistant", "system", "unknown"])
      || !oneOf(row.source, ["observed_behavior", "self_report"])) invalid(`${name} item is invalid.`);
    if (row.source === "self_report" && row.speaker !== "user") invalid("Self-report evidence must be a user utterance.");
    return Object.freeze({
      conversationId: identifier(row.conversationId, `${name}.conversationId`),
      messageIndex: row.messageIndex as number,
      utteranceId: identifier(row.utteranceId, `${name}.utteranceId`),
      speaker: row.speaker,
      quote: requiredText(row.quote, `${name}.quote is invalid.`, 2_000),
      observedFeature: requiredText(row.observedFeature, `${name}.observedFeature is invalid.`, 2_000),
      source: row.source,
    });
  }));
}

function parseLinkedEvidenceV2(value: unknown, name: string): readonly WeeklyAnalysisEvidenceV1[] {
  const rows = array(value, `${name} is invalid.`);
  if (rows.length > 100) invalid(`${name} is too large.`);
  return Object.freeze(rows.map((item) => {
    const row = object(item, `${name} item is invalid.`);
    exactKeys(row, ["target", "conversationId", "messageIndex", "quote"]);
    if (!oneOf(row.target, ["activity-category", "account-candidate", "accounting-disposition", "ai-role", "collaboration-behavior", "thinking-change", "discovery"])
      || !Number.isSafeInteger(row.messageIndex) || (row.messageIndex as number) < 0) invalid(`${name} item is invalid.`);
    return Object.freeze({ target: row.target, conversationId: identifier(row.conversationId, `${name}.conversationId`), messageIndex: row.messageIndex as number, quote: requiredText(row.quote, `${name}.quote is invalid.`, 2_000) });
  }));
}

function parseTextList(value: unknown, name: string): readonly string[] {
  const rows = array(value, `${name} is invalid.`);
  if (rows.length > 20) invalid(`${name} is too large.`);
  return Object.freeze(rows.map(item => requiredText(item, `${name} item is invalid.`, 2_000)));
}

function parsePayload(value: unknown, requireResearchFields: boolean): WeeklyAnalysisPayloadV1 {
  const payload = object(value, "Analysis payload is invalid.");
  allowedKeys(payload, [
    "activityCategory", "aiRole", "initiative", "reasoning", "criticalJudgment",
    "thinkingChange", "discovery", "evidence", "accountCandidate",
    "accountingDispositionCandidate", "collaborationBehaviors",
  ], ["activityCategory", "aiRole", "initiative", "reasoning", "criticalJudgment", "thinkingChange", "discovery", "evidence"]);
  if (requireResearchFields && (!hasOwn(payload, "accountCandidate")
    || !hasOwn(payload, "accountingDispositionCandidate")
    || !hasOwn(payload, "collaborationBehaviors"))) {
    invalid("A Gemini analysis is missing research fields.");
  }
  const evidence = array(payload.evidence, "Analysis evidence is invalid.");
  if (evidence.length > 100) invalid("Analysis evidence is too large.");
  const collaborationBehaviors = payload.collaborationBehaviors === undefined
    ? undefined
    : parseCollaborationBehaviors(payload.collaborationBehaviors);
  return Object.freeze({
    activityCategory: activityCategory(payload.activityCategory),
    ...(payload.accountCandidate !== undefined ? { accountCandidate: accountCandidate(payload.accountCandidate) } : {}),
    ...(payload.accountingDispositionCandidate !== undefined
      ? { accountingDispositionCandidate: dispositionCandidate(payload.accountingDispositionCandidate) } : {}),
    aiRole: nullableText(payload.aiRole, "analysis.aiRole", 2_000),
    ...(collaborationBehaviors ? { collaborationBehaviors } : {}),
    initiative: score(payload.initiative, "analysis.initiative"),
    reasoning: score(payload.reasoning, "analysis.reasoning"),
    criticalJudgment: score(payload.criticalJudgment, "analysis.criticalJudgment"),
    thinkingChange: nullableText(payload.thinkingChange, "analysis.thinkingChange", 8_000),
    discovery: nullableText(payload.discovery, "analysis.discovery", 8_000),
    evidence: Object.freeze(evidence.map((item) => {
      const row = object(item, "Analysis evidence is invalid.");
      exactKeys(row, ["target", "conversationId", "messageIndex", "quote"]);
      if (!oneOf(row.target, [
        "activity-category", "account-candidate", "accounting-disposition", "ai-role",
        "collaboration-behavior", "initiative", "reasoning", "critical-judgment", "thinking-change", "discovery",
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

function parseCollaborationBehaviors(value: unknown): readonly Readonly<{ kind: WeeklyAnalysisCollaborationKind; description: string }>[] {
  const rows = array(value, "Collaboration behaviors are invalid.");
  if (rows.length > 20) invalid("Collaboration behaviors are too large.");
  return Object.freeze(rows.map((item) => {
    const row = object(item, "Collaboration behavior is invalid.");
    exactKeys(row, ["kind", "description"]);
    if (!oneOf(row.kind, ["goal-setting", "comparison", "verification", "revision", "own-decision", "delegation", "synthesis"])) {
      invalid("Collaboration behavior kind is invalid.");
    }
    return Object.freeze({ kind: row.kind, description: requiredText(row.description, "Collaboration behavior description is invalid.", 2_000) });
  }));
}

function accountCandidate(value: unknown): WeeklyAnalysisAccountCandidate {
  if (value === null || oneOf(value, ["相談活動費", "思考探究費", "成果物利用費", "情報収集費", "学習活動費", "その他AI利用費"])) return value;
  return invalid("accountCandidate is invalid.");
}

function dispositionCandidate(value: unknown): WeeklyAnalysisDispositionCandidate {
  if (value === null || oneOf(value, ["expense", "asset", "work-in-progress", "unclassified"])) return value;
  return invalid("accountingDispositionCandidate is invalid.");
}

function assertEvidenceCoverage(payload: WeeklyAnalysisPayloadV1) {
  const targets = new Set(payload.evidence.map((item) => item.target));
  const required: Array<[boolean, WeeklyAnalysisEvidenceTarget]> = [
    [payload.activityCategory !== null, "activity-category"],
    [payload.accountCandidate !== undefined && payload.accountCandidate !== null, "account-candidate"],
    [payload.accountingDispositionCandidate !== undefined && payload.accountingDispositionCandidate !== null, "accounting-disposition"],
    [payload.aiRole !== null, "ai-role"],
    [(payload.collaborationBehaviors?.length ?? 0) > 0, "collaboration-behavior"],
    [payload.initiative !== null, "initiative"],
    [payload.reasoning !== null, "reasoning"],
    [payload.criticalJudgment !== null, "critical-judgment"],
    [payload.thinkingChange !== null, "thinking-change"],
    [payload.discovery !== null, "discovery"],
  ];
  if (required.some(([needed, target]) => needed && !targets.has(target))) {
    invalid("A non-null analysis value requires conversation evidence.");
  }
}

function parseError(value: unknown): NonNullable<WeeklyAnalysisResponseV1["error"]> {
  const error = object(value, "Analysis error is invalid.");
  allowedKeys(error, [
    "code", "retryable", "diagnosticStage", "providerHttpStatus", "providerErrorCode",
    "timedOut", "providerApiVersion", "providerSdkVersion", "validationField", "validationRule",
  ], ["code", "retryable"]);
  if (!oneOf(error.code, [
    "INVALID_INPUT", "NOT_AUTHENTICATED", "NOT_AUTHORIZED", "TOO_LARGE", "RATE_LIMITED",
    "MODEL_UNAVAILABLE", "CONTENT_BLOCKED", "INVALID_OUTPUT", "TIMEOUT", "PROVIDER_ERROR",
  ]) || typeof error.retryable !== "boolean"
    || !(error.diagnosticStage === undefined || oneOf(error.diagnosticStage, [
      "provider-response", "output-truncated", "interaction-envelope", "json-parse",
      "schema-validation", "evidence-validation",
    ]))
    || !(error.providerHttpStatus === undefined || (Number.isSafeInteger(error.providerHttpStatus)
      && (error.providerHttpStatus as number) >= 100 && (error.providerHttpStatus as number) <= 599))
    || !(error.providerErrorCode === undefined || (typeof error.providerErrorCode === "string"
      && /^[a-z][a-z0-9_]{0,63}$/.test(error.providerErrorCode)))
    || !(error.timedOut === undefined || typeof error.timedOut === "boolean")
    || !(error.providerApiVersion === undefined || error.providerApiVersion === WEEKLY_ANALYSIS_PROVIDER_API_VERSION)
    || !(error.providerSdkVersion === undefined || error.providerSdkVersion === WEEKLY_ANALYSIS_PROVIDER_SDK_VERSION)
    || !(error.validationField === undefined || (typeof error.validationField === "string"
      && /^analysis(?:\.[a-zA-Z][a-zA-Z0-9]*|\[[0-9]{1,3}\]){0,8}$/.test(error.validationField)
      && error.validationField.length <= 192))
    || !(error.validationRule === undefined || oneOf(error.validationRule, [
      "required", "unexpected-fields", "type", "enum", "integer", "non-empty", "max-length",
      "max-items", "evidence-required", "message-index-range", "conversation-id-match", "quote-match", "score-match",
    ]))) invalid("Analysis error is invalid.");
  return Object.freeze({
    code: error.code,
    retryable: error.retryable,
    ...(error.diagnosticStage === undefined ? {} : { diagnosticStage: error.diagnosticStage }),
    ...(error.providerHttpStatus === undefined ? {} : { providerHttpStatus: error.providerHttpStatus as number }),
    ...(error.providerErrorCode === undefined ? {} : { providerErrorCode: error.providerErrorCode }),
    ...(error.timedOut === undefined ? {} : { timedOut: error.timedOut }),
    ...(error.providerApiVersion === undefined ? {} : { providerApiVersion: error.providerApiVersion }),
    ...(error.providerSdkVersion === undefined ? {} : { providerSdkVersion: error.providerSdkVersion }),
    ...(error.validationField === undefined ? {} : { validationField: error.validationField }),
    ...(error.validationRule === undefined ? {} : { validationRule: error.validationRule }),
  });
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

function allowedKeys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[]) {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key)) || required.some((key) => !hasOwn(value, key))) {
    invalid("Unexpected or missing fields.");
  }
}

function hasOwn(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
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
