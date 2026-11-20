import { randomUUID } from 'node:crypto';
import { AiError } from './contract.mjs';

export const WEEKLY_ANALYSIS_RUBRIC_VERSION = 'research-thinking-rubric-v2';
export const WEEKLY_ANALYSIS_REQUEST_LIMIT = 96 * 1024;
const categories = ['相談', '壁打ち', '文章作成', '情報収集', '学習', 'その他'];
const accounts = ['相談活動費', '思考探究費', '成果物利用費', '情報収集費', '学習活動費', 'その他AI利用費'];
const dispositions = ['expense', 'asset', 'work-in-progress', 'unclassified'];
const behaviors = ['goal-setting', 'comparison', 'verification', 'revision', 'own-decision', 'delegation', 'synthesis'];
const targets = ['activity-category', 'account-candidate', 'accounting-disposition', 'ai-role', 'collaboration-behavior', 'thinking-change', 'discovery'];
const errorCodes = ['INVALID_INPUT', 'NOT_AUTHENTICATED', 'NOT_AUTHORIZED', 'TOO_LARGE', 'RATE_LIMITED', 'MODEL_UNAVAILABLE', 'CONTENT_BLOCKED', 'INVALID_OUTPUT', 'TIMEOUT', 'PROVIDER_ERROR'];
export const WEEKLY_ANALYSIS_DIAGNOSTIC_STAGES = Object.freeze([
  'provider-response', 'output-truncated', 'interaction-envelope', 'json-parse',
  'schema-validation', 'evidence-validation',
]);
export const WEEKLY_ANALYSIS_PROVIDER_API_VERSION = 'v1beta';
export const WEEKLY_ANALYSIS_PROVIDER_SDK_VERSION = '@google/genai@2.32.0';
export const WEEKLY_ANALYSIS_API_METHODS = Object.freeze(['interactions', 'generate-content']);
export const WEEKLY_ANALYSIS_VALIDATION_RULES = Object.freeze([
  'required', 'unexpected-fields', 'type', 'enum', 'integer', 'non-empty',
  'max-length', 'max-items', 'evidence-required', 'message-index-range',
  'conversation-id-match', 'quote-match', 'score-match',
]);
export const WEEKLY_ANALYSIS_PARTIAL_REASONS = Object.freeze(['missing-evidence', 'invalid-evidence']);

export function parseWeeklyAnalysisRequest(value) {
  if (!plain(value) || !exact(value, ['schemaVersion', 'requestId', 'recordId', 'conversationId', 'thoughtReceiptId', 'conversationFingerprint', 'requestedAt', 'consent', 'taskContext', 'messages'])
    || value.schemaVersion !== 1 || !id(value.requestId) || !id(value.recordId) || !id(value.conversationId)
    || !id(value.thoughtReceiptId) || !id(value.conversationFingerprint) || !timestamp(value.requestedAt)
    || !plain(value.consent) || !exact(value.consent, ['externalAnalysisAllowed', 'privacy', 'captureScope', 'consentedAt'])
    || value.consent.externalAnalysisAllowed !== true || value.consent.privacy !== 'full'
    || !['full', 'partial', 'unknown'].includes(value.consent.captureScope) || !timestamp(value.consent.consentedAt)
    || !plain(value.taskContext) || !exact(value.taskContext, ['taskId', 'plannedAiasLevel', 'activityCategory', 'expectedAiRole'])
    || !(value.taskContext.taskId === null || id(value.taskContext.taskId))
    || !(value.taskContext.plannedAiasLevel === null || [1, 2, 3, 4, 5].includes(value.taskContext.plannedAiasLevel))
    || !(value.taskContext.activityCategory === null || categories.includes(value.taskContext.activityCategory))
    || !nullableText(value.taskContext.expectedAiRole, 2000)
    || !Array.isArray(value.messages) || value.messages.length < 1 || value.messages.length > 200) return null;
  const messages = [];
  let characters = 0;
  for (const message of value.messages) {
    if (!plain(message) || !exact(message, ['role', 'text']) || !['user', 'assistant', 'system', 'unknown'].includes(message.role)
      || !nonEmptyText(message.text, 12000)) return null;
    characters += message.text.length;
    if (characters > 60000) return null;
    messages.push({ role: message.role, text: message.text });
  }
  if (value.taskContext.plannedAiasLevel === 1) return null;
  return Object.freeze({
    schemaVersion: 1,
    requestId: value.requestId,
    recordId: value.recordId,
    conversationId: value.conversationId,
    thoughtReceiptId: value.thoughtReceiptId,
    conversationFingerprint: value.conversationFingerprint,
    requestedAt: new Date(value.requestedAt).toISOString(),
    consent: Object.freeze({ ...value.consent, consentedAt: new Date(value.consent.consentedAt).toISOString() }),
    taskContext: Object.freeze({ ...value.taskContext }),
    messages: Object.freeze(messages.map(message => Object.freeze(message))),
  });
}

/** Parse only the fields Gemini is responsible for generating. */
export function parseGeminiAnalysisCandidate(value) {
  return parseAnalysisV2(value, false);
}

/** Parse the app's linked analysis payload, including app-owned conversation IDs. */
export function parseGeminiAnalysisPayload(value) {
  return parseAnalysisV2(value, true);
}

function parseAnalysisV2(value, linked) {
  const fields = ['activityCategory', 'accountCandidate', 'accountingDispositionCandidate', 'aiRole', 'collaborationBehaviors', 'initiative', 'reasoning', 'independence', 'metricAssessments', 'taskComplexity', ...(linked ? ['subjectiveDifficulty'] : []), 'thinkingChange', 'discovery', 'evidence'];
  if (!plain(value)) invalidAnalysis('analysis', 'type');
  for (const field of fields) if (!Object.hasOwn(value, field)) invalidAnalysis(`analysis.${field}`, 'required');
  if (Object.keys(value).some(field => !fields.includes(field))) invalidAnalysis('analysis', 'unexpected-fields');
  nullableEnum(value.activityCategory, categories, 'analysis.activityCategory');
  nullableEnum(value.accountCandidate, accounts, 'analysis.accountCandidate');
  nullableEnum(value.accountingDispositionCandidate, dispositions, 'analysis.accountingDispositionCandidate');
  validateNullableText(value.aiRole, 2000, 'analysis.aiRole');
  if (!Array.isArray(value.collaborationBehaviors)) invalidAnalysis('analysis.collaborationBehaviors', 'type');
  if (value.collaborationBehaviors.length > 20) invalidAnalysis('analysis.collaborationBehaviors', 'max-items');
  validateScore(value.initiative, 'analysis.initiative');
  validateScore(value.reasoning, 'analysis.reasoning');
  validateScore(value.independence, 'analysis.independence');
  validateNullableText(value.thinkingChange, 8000, 'analysis.thinkingChange');
  validateNullableText(value.discovery, 8000, 'analysis.discovery');
  if (!Array.isArray(value.evidence)) invalidAnalysis('analysis.evidence', 'type');
  if (value.evidence.length > 100) invalidAnalysis('analysis.evidence', 'max-items');
  const collaborationBehaviors = value.collaborationBehaviors.map((row, index) => {
    const path = `analysis.collaborationBehaviors[${index}]`;
    if (!plain(row)) invalidAnalysis(path, 'type');
    for (const field of ['kind', 'description']) if (!Object.hasOwn(row, field)) invalidAnalysis(`${path}.${field}`, 'required');
    if (Object.keys(row).some(field => !['kind', 'description'].includes(field))) invalidAnalysis(path, 'unexpected-fields');
    if (!behaviors.includes(row.kind)) invalidAnalysis(`${path}.kind`, 'enum');
    validateRequiredText(row.description, 2000, `${path}.description`);
    return Object.freeze({ kind: row.kind, description: row.description });
  });
  const evidence = value.evidence.map((row, index) => {
    const path = `analysis.evidence[${index}]`;
    const evidenceFields = linked ? ['target', 'conversationId', 'messageIndex', 'quote'] : ['target', 'messageIndex', 'quote'];
    if (!plain(row)) invalidAnalysis(path, 'type');
    for (const field of evidenceFields) if (!Object.hasOwn(row, field)) invalidAnalysis(`${path}.${field}`, 'required');
    if (Object.keys(row).some(field => !evidenceFields.includes(field))) invalidAnalysis(path, 'unexpected-fields');
    if (!targets.includes(row.target)) invalidAnalysis(`${path}.target`, 'enum');
    if (linked && !id(row.conversationId)) invalidAnalysis(`${path}.conversationId`, 'type');
    if (!Number.isSafeInteger(row.messageIndex)) invalidAnalysis(`${path}.messageIndex`, 'integer');
    if (row.messageIndex < 0) invalidAnalysis(`${path}.messageIndex`, 'message-index-range');
    validateRequiredText(row.quote, 2000, `${path}.quote`);
    return Object.freeze({
      target: row.target,
      ...(linked ? { conversationId: row.conversationId } : {}),
      messageIndex: row.messageIndex,
      quote: row.quote,
    });
  });
  if (!plain(value.metricAssessments) || !exact(value.metricAssessments, ['initiative', 'reasoning', 'independence'])) invalidAnalysis('analysis.metricAssessments', 'type');
  const initiativeAssessment = parseMetricAssessment(value.metricAssessments.initiative, 'analysis.metricAssessments.initiative', linked);
  const reasoningAssessment = parseMetricAssessment(value.metricAssessments.reasoning, 'analysis.metricAssessments.reasoning', linked);
  const independenceAssessment = parseIndependenceAssessment(value.metricAssessments.independence, linked);
  if (value.initiative !== initiativeAssessment.score || value.reasoning !== reasoningAssessment.score || value.independence !== independenceAssessment.score) invalidAnalysis('analysis.metricAssessments', 'score-match');
  if (!plain(value.taskComplexity) || !exact(value.taskComplexity, ['level', 'reason', 'considerationFactors', 'uncertainty', 'reasoningProcess'])
    || !['low', 'medium', 'high', 'unknown'].includes(value.taskComplexity.level)) invalidAnalysis('analysis.taskComplexity', 'type');
  for (const field of ['reason', 'considerationFactors', 'uncertainty', 'reasoningProcess']) validateRequiredText(value.taskComplexity[field], 4000, `analysis.taskComplexity.${field}`);
  if (linked && (!plain(value.subjectiveDifficulty) || !exact(value.subjectiveDifficulty, ['level', 'source', 'note'])
    || value.subjectiveDifficulty.level !== 'not_provided' || value.subjectiveDifficulty.source !== 'self_report' || value.subjectiveDifficulty.note !== null)) invalidAnalysis('analysis.subjectiveDifficulty', 'enum');
  return Object.freeze({
    activityCategory: value.activityCategory, accountCandidate: value.accountCandidate,
    accountingDispositionCandidate: value.accountingDispositionCandidate, aiRole: value.aiRole,
    collaborationBehaviors: Object.freeze(collaborationBehaviors), initiative: value.initiative,
    reasoning: value.reasoning, independence: value.independence,
    metricAssessments: Object.freeze({ initiative: initiativeAssessment, reasoning: reasoningAssessment, independence: independenceAssessment }),
    taskComplexity: Object.freeze({ ...value.taskComplexity }),
    ...(linked ? { subjectiveDifficulty: Object.freeze({ level: 'not_provided', source: 'self_report', note: null }) } : {}),
    thinkingChange: value.thinkingChange, discovery: value.discovery, evidence: Object.freeze(evidence),
  });
}

const fieldByTarget = Object.freeze({
  'activity-category': 'activityCategory', 'account-candidate': 'accountCandidate',
  'accounting-disposition': 'accountingDispositionCandidate', 'ai-role': 'aiRole',
  'collaboration-behavior': 'collaborationBehaviors', 'thinking-change': 'thinkingChange', discovery: 'discovery',
});

function parseMetricAssessment(value, path, linked) {
  const fields = ['score', 'status', 'reason', 'rubricLevel', 'evidence', 'unconfirmed', 'evidenceSufficiency'];
  if (!plain(value) || !exact(value, fields)) invalidAnalysis(path, 'type');
  validateScore(value.score, `${path}.score`); validateScore(value.rubricLevel, `${path}.rubricLevel`);
  if (!['confirmed', 'provisional', 'hold', 'not_applicable'].includes(value.status)) invalidAnalysis(`${path}.status`, 'enum');
  validateRequiredText(value.reason, 4000, `${path}.reason`);
  if (!['high', 'medium', 'low'].includes(value.evidenceSufficiency)) invalidAnalysis(`${path}.evidenceSufficiency`, 'enum');
  if (!Array.isArray(value.evidence) || value.evidence.length > 50) invalidAnalysis(`${path}.evidence`, 'type');
  const evidence = value.evidence.map((row, index) => parseMetricEvidence(row, `${path}.evidence[${index}]`, linked));
  if (!Array.isArray(value.unconfirmed) || value.unconfirmed.length > 20) invalidAnalysis(`${path}.unconfirmed`, 'type');
  value.unconfirmed.forEach((item, index) => validateRequiredText(item, 2000, `${path}.unconfirmed[${index}]`));
  if (['confirmed', 'provisional'].includes(value.status) && (value.score === null || value.rubricLevel !== value.score || evidence.length === 0)) invalidAnalysis(path, 'evidence-required');
  if (['hold', 'not_applicable'].includes(value.status) && (value.score !== null || value.rubricLevel !== null)) invalidAnalysis(path, 'enum');
  return Object.freeze({ ...value, evidence: Object.freeze(evidence), unconfirmed: Object.freeze([...value.unconfirmed]) });
}

function parseIndependenceAssessment(value, linked) {
  const path = 'analysis.metricAssessments.independence';
  if (!plain(value) || !exact(value, ['score', 'status', 'reason', 'rubricLevel', 'evidence', 'unconfirmed', 'evidenceSufficiency', 'deliberation', 'finalDecision'])) invalidAnalysis(path, 'type');
  const base = parseMetricAssessment(Object.fromEntries(Object.entries(value).filter(([key]) => !['deliberation', 'finalDecision'].includes(key))), path, linked);
  return Object.freeze({ ...base, deliberation: parseMetricAssessment(value.deliberation, `${path}.deliberation`, linked), finalDecision: parseMetricAssessment(value.finalDecision, `${path}.finalDecision`, linked) });
}

function parseMetricEvidence(value, path, linked) {
  const fields = linked ? ['conversationId', 'messageIndex', 'utteranceId', 'speaker', 'quote', 'observedFeature', 'source'] : ['messageIndex', 'quote', 'observedFeature', 'source'];
  if (!plain(value) || !exact(value, fields)) invalidAnalysis(path, 'type');
  if (!Number.isSafeInteger(value.messageIndex) || value.messageIndex < 0) invalidAnalysis(`${path}.messageIndex`, 'message-index-range');
  if (!['observed_behavior', 'self_report'].includes(value.source)) invalidAnalysis(`${path}.source`, 'enum');
  validateRequiredText(value.quote, 2000, `${path}.quote`); validateRequiredText(value.observedFeature, 2000, `${path}.observedFeature`);
  if (linked && (!id(value.conversationId) || !id(value.utteranceId) || !['user', 'assistant', 'system', 'unknown'].includes(value.speaker))) invalidAnalysis(path, 'type');
  if (linked && value.source === 'self_report' && value.speaker !== 'user') invalidAnalysis(`${path}.source`, 'enum');
  return Object.freeze({ ...value });
}

/** Keep independently supported fields and replace unsupported claims with null/empty before persistence. */
export function linkGeminiAnalysisCandidateWithPartial(request, value) {
  const parsedRequest = parseWeeklyAnalysisRequest(request);
  if (!parsedRequest) throw new AiError('INVALID_INPUT');
  const candidate = parseGeminiAnalysisCandidate(value);
  const invalidTargets = new Set();
  const linkedEvidence = candidate.evidence.flatMap((row) => {
    const message = parsedRequest.messages[row.messageIndex];
    if (!message || !message.text.includes(row.quote)) { invalidTargets.add(row.target); return []; }
    return [Object.freeze({ ...row, conversationId: parsedRequest.conversationId })];
  });
  const validTargets = new Set(linkedEvidence.map(row => row.target));
  const required = [
    [candidate.activityCategory !== null, 'activity-category'],
    [candidate.accountCandidate !== null, 'account-candidate'],
    [candidate.accountingDispositionCandidate !== null, 'accounting-disposition'],
    [candidate.aiRole !== null, 'ai-role'],
    [candidate.collaborationBehaviors.length > 0, 'collaboration-behavior'],
    [candidate.thinkingChange !== null, 'thinking-change'], [candidate.discovery !== null, 'discovery'],
  ];
  const unresolvedFields = [];
  const sanitized = { ...candidate };
  for (const [needed, target] of required) {
    if (!needed || validTargets.has(target)) continue;
    const field = fieldByTarget[target];
    sanitized[field] = field === 'collaborationBehaviors' ? [] : null;
    unresolvedFields.push(Object.freeze({
      field: `analysis.${field}`,
      reason: invalidTargets.has(target) ? 'invalid-evidence' : 'missing-evidence',
    }));
  }
  const supportedTargets = new Set(required.flatMap(([needed, target]) => needed && validTargets.has(target) ? [target] : []));
  sanitized.evidence = linkedEvidence.filter(row => supportedTargets.has(row.target));
  const linkedAssessments = {};
  for (const metric of ['initiative', 'reasoning', 'independence']) {
    const raw = candidate.metricAssessments[metric];
    const sanitizedMetric = linkMetricAssessment(parsedRequest, raw, `analysis.${metric}`, unresolvedFields);
    linkedAssessments[metric] = metric === 'independence' ? Object.freeze({
      ...sanitizedMetric,
      deliberation: linkMetricAssessment(parsedRequest, raw.deliberation, 'analysis.metricAssessments.independence.deliberation', unresolvedFields),
      finalDecision: linkMetricAssessment(parsedRequest, raw.finalDecision, 'analysis.metricAssessments.independence.finalDecision', unresolvedFields),
    }) : sanitizedMetric;
    sanitized[metric] = linkedAssessments[metric].score;
  }
  sanitized.metricAssessments = Object.freeze(linkedAssessments);
  sanitized.subjectiveDifficulty = Object.freeze({ level: 'not_provided', source: 'self_report', note: null });
  const analysis = parseGeminiAnalysisPayload(sanitized);
  const deduplicated = [...new Map(unresolvedFields.map(row => [row.field, row])).values()];
  return Object.freeze({ analysis, unresolvedFields: Object.freeze(deduplicated) });
}

function linkMetricAssessment(request, assessment, unresolvedField, unresolvedFields) {
  let invalidEvidence = false;
  const linked = assessment.evidence.flatMap(row => {
    const message = request.messages[row.messageIndex];
    if (!message || !message.text.includes(row.quote)) { invalidEvidence = true; return []; }
    return [Object.freeze({ ...row, conversationId: request.conversationId, utteranceId: `${request.conversationId}:message:${row.messageIndex}`, speaker: message.role })];
  });
  if (['confirmed', 'provisional'].includes(assessment.status) && linked.length === 0) {
    unresolvedFields.push(Object.freeze({ field: unresolvedField, reason: invalidEvidence ? 'invalid-evidence' : 'missing-evidence' }));
    return Object.freeze({ score: null, status: 'hold', reason: '根拠発言を検証できないため評価保留。', rubricLevel: null, evidence: Object.freeze([]), unconfirmed: Object.freeze([...assessment.unconfirmed, '対応する根拠発言を確認できない']), evidenceSufficiency: 'low' });
  }
  return Object.freeze({ ...assessment, evidence: Object.freeze(linked) });
}

/** Attach app-owned IDs and verify every quote against the consented conversation. */
export function linkGeminiAnalysisCandidate(request, value) {
  const parsedRequest = parseWeeklyAnalysisRequest(request);
  if (!parsedRequest) throw new AiError('INVALID_INPUT');
  const candidate = parseGeminiAnalysisCandidate(value);
  const result = linkGeminiAnalysisCandidateWithPartial(parsedRequest, candidate);
  if (result.unresolvedFields.length) invalidAnalysis(result.unresolvedFields[0].field, 'evidence-required');
  return result.analysis;
}

export function createWeeklySuccessResponse(request, analysis, {
  model, apiMethod = 'interactions', analysisId = `gemini:${randomUUID()}`, now = new Date(), unresolvedFields = [],
}) {
  const parsedRequest = parseWeeklyAnalysisRequest(request);
  const parsedAnalysis = parseGeminiAnalysisPayload(analysis);
  if (!parsedRequest || !modelId(model) || !WEEKLY_ANALYSIS_API_METHODS.includes(apiMethod)
    || !validUnresolvedFields(unresolvedFields)
    || !id(analysisId) || !(now instanceof Date) || Number.isNaN(now.getTime())) throw new AiError('INVALID_OUTPUT');
  assertUnresolvedFieldsMatchAnalysis(parsedAnalysis, unresolvedFields);
  assertEvidenceMatchesRequest(parsedRequest, parsedAnalysis);
  const instant = now.toISOString();
  return Object.freeze({
    schemaVersion: 1, analysisId, requestId: parsedRequest.requestId, recordId: parsedRequest.recordId,
    conversationId: parsedRequest.conversationId, thoughtReceiptId: parsedRequest.thoughtReceiptId,
    conversationFingerprint: parsedRequest.conversationFingerprint, origin: 'gemini-api', analysisStatus: unresolvedFields.length ? 'partial' : 'complete',
    receivedAt: instant, model, apiMethod, rubricVersion: WEEKLY_ANALYSIS_RUBRIC_VERSION, analyzedAt: instant,
    analysis: parsedAnalysis, unresolvedFields: Object.freeze(unresolvedFields.map(row => Object.freeze({ ...row }))), error: null,
  });
}

export function assertEvidenceMatchesRequest(request, analysis) {
  const groups = [
    ['analysis.evidence', analysis.evidence],
    ['analysis.metricAssessments.initiative.evidence', analysis.metricAssessments.initiative.evidence],
    ['analysis.metricAssessments.reasoning.evidence', analysis.metricAssessments.reasoning.evidence],
    ['analysis.metricAssessments.independence.evidence', analysis.metricAssessments.independence.evidence],
    ['analysis.metricAssessments.independence.deliberation.evidence', analysis.metricAssessments.independence.deliberation.evidence],
    ['analysis.metricAssessments.independence.finalDecision.evidence', analysis.metricAssessments.independence.finalDecision.evidence],
  ];
  for (const [path, evidenceRows] of groups) for (const [index, evidence] of evidenceRows.entries()) {
    const message = request.messages[evidence.messageIndex];
    if (evidence.conversationId !== request.conversationId) invalidAnalysis(`${path}[${index}].conversationId`, 'conversation-id-match');
    if (!message) invalidAnalysis(`${path}[${index}].messageIndex`, 'message-index-range');
    if (!message.text.includes(evidence.quote)) invalidAnalysis(`${path}[${index}].quote`, 'quote-match');
    if (evidence.speaker && evidence.speaker !== message.role) invalidAnalysis(`${path}[${index}].speaker`, 'conversation-id-match');
  }
}

export function createWeeklyFailureResponse(request, code, {
  model, analysisId = `gemini-failure:${randomUUID()}`, now = new Date(), diagnosticStage,
  providerHttpStatus, providerErrorCode, timedOut, providerApiVersion, providerSdkVersion,
  validationField, validationRule, apiMethod = 'interactions',
} = {}) {
  const parsedRequest = parseWeeklyAnalysisRequest(request);
  if (!parsedRequest || !errorCodes.includes(code) || !modelId(model) || !id(analysisId)
    || !(now instanceof Date) || Number.isNaN(now.getTime())
    || !(diagnosticStage === undefined || WEEKLY_ANALYSIS_DIAGNOSTIC_STAGES.includes(diagnosticStage))
    || !(providerHttpStatus === undefined || (Number.isSafeInteger(providerHttpStatus) && providerHttpStatus >= 100 && providerHttpStatus <= 599))
    || !(providerErrorCode === undefined || providerCode(providerErrorCode))
    || !(timedOut === undefined || typeof timedOut === 'boolean')
    || !(providerApiVersion === undefined || providerApiVersion === WEEKLY_ANALYSIS_PROVIDER_API_VERSION)
    || !(providerSdkVersion === undefined || providerSdkVersion === WEEKLY_ANALYSIS_PROVIDER_SDK_VERSION)
    || !WEEKLY_ANALYSIS_API_METHODS.includes(apiMethod)
    || !(validationField === undefined || safeValidationField(validationField))
    || !(validationRule === undefined || WEEKLY_ANALYSIS_VALIDATION_RULES.includes(validationRule))) throw new AiError('INVALID_OUTPUT');
  const instant = now.toISOString();
  return Object.freeze({
    schemaVersion: 1, analysisId, requestId: parsedRequest.requestId, recordId: parsedRequest.recordId,
    conversationId: parsedRequest.conversationId, thoughtReceiptId: parsedRequest.thoughtReceiptId,
    conversationFingerprint: parsedRequest.conversationFingerprint, origin: 'gemini-api', analysisStatus: 'failed',
    receivedAt: instant, model, apiMethod, rubricVersion: WEEKLY_ANALYSIS_RUBRIC_VERSION, analyzedAt: instant,
    analysis: null, unresolvedFields: Object.freeze([]), error: Object.freeze({
      code,
      retryable: ['RATE_LIMITED', 'MODEL_UNAVAILABLE', 'TIMEOUT', 'PROVIDER_ERROR'].includes(code),
      ...(diagnosticStage === undefined ? {} : { diagnosticStage }),
      ...(providerHttpStatus === undefined ? {} : { providerHttpStatus }),
      ...(providerErrorCode === undefined ? {} : { providerErrorCode }),
      ...(timedOut === undefined ? {} : { timedOut }),
      ...(providerApiVersion === undefined ? {} : { providerApiVersion }),
      ...(providerSdkVersion === undefined ? {} : { providerSdkVersion }),
      ...(validationField === undefined ? {} : { validationField }),
      ...(validationRule === undefined ? {} : { validationRule }),
    }),
  });
}

export function parseWeeklyAnalysisResponse(value) {
  if (!plain(value) || !allowed(value, ['schemaVersion', 'analysisId', 'requestId', 'recordId', 'conversationId', 'thoughtReceiptId', 'conversationFingerprint', 'origin', 'analysisStatus', 'receivedAt', 'model', 'apiMethod', 'rubricVersion', 'analyzedAt', 'analysis', 'unresolvedFields', 'error'], ['schemaVersion', 'analysisId', 'requestId', 'recordId', 'conversationId', 'thoughtReceiptId', 'conversationFingerprint', 'origin', 'analysisStatus', 'receivedAt', 'model', 'rubricVersion', 'analyzedAt', 'analysis', 'error'])
    || value.schemaVersion !== 1 || !id(value.analysisId) || !id(value.requestId) || !id(value.recordId)
    || !id(value.conversationId) || !id(value.thoughtReceiptId) || !id(value.conversationFingerprint)
    || value.origin !== 'gemini-api' || !['complete', 'partial', 'failed'].includes(value.analysisStatus)
    || !timestamp(value.receivedAt) || !modelId(value.model)
    || !(value.apiMethod === undefined || WEEKLY_ANALYSIS_API_METHODS.includes(value.apiMethod))
    || value.rubricVersion !== WEEKLY_ANALYSIS_RUBRIC_VERSION || !timestamp(value.analyzedAt)
    || !(value.unresolvedFields === undefined || validUnresolvedFields(value.unresolvedFields))) throw new AiError('INVALID_OUTPUT');
  const unresolvedFields = value.unresolvedFields ?? [];
  if (value.analysisStatus === 'complete' || value.analysisStatus === 'partial') {
    if (value.error !== null || (value.analysisStatus === 'complete' && unresolvedFields.length)
      || (value.analysisStatus === 'partial' && !unresolvedFields.length)) throw new AiError('INVALID_OUTPUT');
    parseGeminiAnalysisPayload(value.analysis);
    assertUnresolvedFieldsMatchAnalysis(value.analysis, unresolvedFields);
  } else if (value.analysis !== null || unresolvedFields.length || !plain(value.error)
    || !allowed(value.error, ['code', 'retryable', 'diagnosticStage', 'providerHttpStatus', 'providerErrorCode', 'timedOut', 'providerApiVersion', 'providerSdkVersion', 'validationField', 'validationRule'], ['code', 'retryable'])
    || !errorCodes.includes(value.error.code) || typeof value.error.retryable !== 'boolean'
    || !(value.error.diagnosticStage === undefined || WEEKLY_ANALYSIS_DIAGNOSTIC_STAGES.includes(value.error.diagnosticStage))
    || !(value.error.providerHttpStatus === undefined || (Number.isSafeInteger(value.error.providerHttpStatus) && value.error.providerHttpStatus >= 100 && value.error.providerHttpStatus <= 599))
    || !(value.error.providerErrorCode === undefined || providerCode(value.error.providerErrorCode))
    || !(value.error.timedOut === undefined || typeof value.error.timedOut === 'boolean')
    || !(value.error.providerApiVersion === undefined || value.error.providerApiVersion === WEEKLY_ANALYSIS_PROVIDER_API_VERSION)
    || !(value.error.providerSdkVersion === undefined || value.error.providerSdkVersion === WEEKLY_ANALYSIS_PROVIDER_SDK_VERSION)
    || !(value.error.validationField === undefined || safeValidationField(value.error.validationField))
    || !(value.error.validationRule === undefined || WEEKLY_ANALYSIS_VALIDATION_RULES.includes(value.error.validationRule))) throw new AiError('INVALID_OUTPUT');
  return value;
}

function score(value) { return value === null || [0, 25, 50, 75, 100].includes(value); }
function validateScore(value, field) { if (!score(value)) invalidAnalysis(field, Number.isSafeInteger(value) ? 'enum' : 'integer'); }
function nullableEnum(value, values, field) { if (!(value === null || values.includes(value))) invalidAnalysis(field, 'enum'); }
function validateNullableText(value, limit, field) {
  if (value === null) return;
  if (typeof value !== 'string') invalidAnalysis(field, 'type');
  if (value.length > limit) invalidAnalysis(field, 'max-length');
}
function validateRequiredText(value, limit, field) {
  if (typeof value !== 'string') invalidAnalysis(field, 'type');
  if (!value.trim()) invalidAnalysis(field, 'non-empty');
  if (value.length > limit) invalidAnalysis(field, 'max-length');
}
function invalidAnalysis(validationField, validationRule) { throw new AiError('INVALID_OUTPUT', { validationField, validationRule }); }
function id(value) { return typeof value === 'string' && !!value.trim() && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value); }
function modelId(value) { return typeof value === 'string' && /^gemini-[a-zA-Z0-9._-]{1,120}$/.test(value); }
function providerCode(value) { return typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value); }
function safeValidationField(value) { return typeof value === 'string' && /^analysis(?:\.[a-zA-Z][a-zA-Z0-9]*|\[[0-9]{1,3}\]){0,8}$/.test(value) && value.length <= 192; }
function validUnresolvedFields(value) {
  const allowedFields = [...Object.values(fieldByTarget).map(field => `analysis.${field}`), 'analysis.initiative', 'analysis.reasoning', 'analysis.independence', 'analysis.metricAssessments.independence.deliberation', 'analysis.metricAssessments.independence.finalDecision'];
  return Array.isArray(value) && value.length <= 10
    && new Set(value.map(row => row?.field)).size === value.length
    && value.every(row => plain(row) && exact(row, ['field', 'reason'])
      && allowedFields.includes(row.field) && WEEKLY_ANALYSIS_PARTIAL_REASONS.includes(row.reason));
}
function assertUnresolvedFieldsMatchAnalysis(analysis, unresolvedFields) {
  const targetByField = Object.fromEntries(Object.entries(fieldByTarget).map(([target, field]) => [`analysis.${field}`, target]));
  for (const row of unresolvedFields) {
    if (row.field === 'analysis.metricAssessments.independence.deliberation' || row.field === 'analysis.metricAssessments.independence.finalDecision') {
      const stage = row.field.endsWith('deliberation') ? analysis.metricAssessments.independence.deliberation : analysis.metricAssessments.independence.finalDecision;
      if (stage.score !== null || stage.status !== 'hold' || stage.evidence.length) throw new AiError('INVALID_OUTPUT');
      continue;
    }
    const field = row.field.slice('analysis.'.length);
    const empty = field === 'collaborationBehaviors' ? Array.isArray(analysis[field]) && analysis[field].length === 0 : analysis[field] === null;
    if (!empty || (targetByField[row.field] && analysis.evidence.some(evidence => evidence.target === targetByField[row.field]))) throw new AiError('INVALID_OUTPUT');
  }
}
function timestamp(value) { return typeof value === 'string' && !Number.isNaN(new Date(value).getTime()); }
function nonEmptyText(value, limit) { return typeof value === 'string' && !!value.trim() && value.length <= limit; }
function nullableText(value, limit) { return value === null || (typeof value === 'string' && value.length <= limit); }
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function exact(value, keys) { const actual = Object.keys(value); return actual.length === keys.length && actual.every(key => keys.includes(key)); }
function allowed(value, keys, required) { const actual = Object.keys(value); return required.every(key => actual.includes(key)) && actual.every(key => keys.includes(key)); }
