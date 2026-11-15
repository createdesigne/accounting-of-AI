import { randomUUID } from 'node:crypto';
import { AiError } from './contract.mjs';

export const WEEKLY_ANALYSIS_RUBRIC_VERSION = 'research-thinking-rubric-v1';
export const WEEKLY_ANALYSIS_REQUEST_LIMIT = 96 * 1024;
const categories = ['相談', '壁打ち', '文章作成', '情報収集', '学習', 'その他'];
const accounts = ['相談活動費', '思考探究費', '成果物利用費', '情報収集費', '学習活動費', 'その他AI利用費'];
const dispositions = ['expense', 'asset', 'work-in-progress', 'unclassified'];
const behaviors = ['goal-setting', 'comparison', 'verification', 'revision', 'own-decision', 'delegation', 'synthesis'];
const targets = ['activity-category', 'account-candidate', 'accounting-disposition', 'ai-role', 'collaboration-behavior', 'initiative', 'reasoning', 'critical-judgment', 'thinking-change', 'discovery'];
const errorCodes = ['INVALID_INPUT', 'NOT_AUTHENTICATED', 'NOT_AUTHORIZED', 'TOO_LARGE', 'RATE_LIMITED', 'MODEL_UNAVAILABLE', 'CONTENT_BLOCKED', 'INVALID_OUTPUT', 'TIMEOUT', 'PROVIDER_ERROR'];

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

/** Parse the JSON object produced by Gemini before it is linked to app IDs. */
export function parseGeminiAnalysisPayload(value) {
  const fields = ['activityCategory', 'accountCandidate', 'accountingDispositionCandidate', 'aiRole', 'collaborationBehaviors', 'initiative', 'reasoning', 'criticalJudgment', 'thinkingChange', 'discovery', 'evidence'];
  if (!plain(value) || !exact(value, fields)
    || !(value.activityCategory === null || categories.includes(value.activityCategory))
    || !(value.accountCandidate === null || accounts.includes(value.accountCandidate))
    || !(value.accountingDispositionCandidate === null || dispositions.includes(value.accountingDispositionCandidate))
    || !nullableText(value.aiRole, 2000)
    || !Array.isArray(value.collaborationBehaviors) || value.collaborationBehaviors.length > 20
    || !score(value.initiative) || !score(value.reasoning) || !score(value.criticalJudgment)
    || !nullableText(value.thinkingChange, 8000) || !nullableText(value.discovery, 8000)
    || !Array.isArray(value.evidence) || value.evidence.length > 100) throw new AiError('INVALID_OUTPUT');
  const collaborationBehaviors = value.collaborationBehaviors.map(row => {
    if (!plain(row) || !exact(row, ['kind', 'description']) || !behaviors.includes(row.kind) || !nonEmptyText(row.description, 2000)) throw new AiError('INVALID_OUTPUT');
    return Object.freeze({ kind: row.kind, description: row.description });
  });
  const evidence = value.evidence.map(row => {
    if (!plain(row) || !exact(row, ['target', 'conversationId', 'messageIndex', 'quote']) || !targets.includes(row.target)
      || !id(row.conversationId) || !Number.isSafeInteger(row.messageIndex) || row.messageIndex < 0 || !nonEmptyText(row.quote, 2000)) throw new AiError('INVALID_OUTPUT');
    return Object.freeze({ target: row.target, conversationId: row.conversationId, messageIndex: row.messageIndex, quote: row.quote });
  });
  const evidenceTargets = new Set(evidence.map(row => row.target));
  const required = [
    [value.activityCategory !== null, 'activity-category'],
    [value.accountCandidate !== null, 'account-candidate'],
    [value.accountingDispositionCandidate !== null, 'accounting-disposition'],
    [value.aiRole !== null, 'ai-role'],
    [collaborationBehaviors.length > 0, 'collaboration-behavior'],
    [value.initiative !== null, 'initiative'],
    [value.reasoning !== null, 'reasoning'],
    [value.criticalJudgment !== null, 'critical-judgment'],
    [value.thinkingChange !== null, 'thinking-change'],
    [value.discovery !== null, 'discovery'],
  ];
  if (required.some(([needed, target]) => needed && !evidenceTargets.has(target))) throw new AiError('INVALID_OUTPUT');
  return Object.freeze({ ...value, collaborationBehaviors: Object.freeze(collaborationBehaviors), evidence: Object.freeze(evidence) });
}

export function createWeeklySuccessResponse(request, analysis, { model, analysisId = `gemini:${randomUUID()}`, now = new Date() }) {
  const parsedRequest = parseWeeklyAnalysisRequest(request);
  const parsedAnalysis = parseGeminiAnalysisPayload(analysis);
  if (!parsedRequest || !modelId(model) || !id(analysisId) || !(now instanceof Date) || Number.isNaN(now.getTime())) throw new AiError('INVALID_OUTPUT');
  assertEvidenceMatchesRequest(parsedRequest, parsedAnalysis);
  const instant = now.toISOString();
  return Object.freeze({
    schemaVersion: 1, analysisId, requestId: parsedRequest.requestId, recordId: parsedRequest.recordId,
    conversationId: parsedRequest.conversationId, thoughtReceiptId: parsedRequest.thoughtReceiptId,
    conversationFingerprint: parsedRequest.conversationFingerprint, origin: 'gemini-api', analysisStatus: 'complete',
    receivedAt: instant, model, rubricVersion: WEEKLY_ANALYSIS_RUBRIC_VERSION, analyzedAt: instant,
    analysis: parsedAnalysis, error: null,
  });
}

export function assertEvidenceMatchesRequest(request, analysis) {
  for (const evidence of analysis.evidence) {
    const message = request.messages[evidence.messageIndex];
    if (evidence.conversationId !== request.conversationId || !message || !message.text.includes(evidence.quote)) {
      throw new AiError('INVALID_OUTPUT');
    }
  }
}

export function createWeeklyFailureResponse(request, code, { model, analysisId = `gemini-failure:${randomUUID()}`, now = new Date() }) {
  const parsedRequest = parseWeeklyAnalysisRequest(request);
  if (!parsedRequest || !errorCodes.includes(code) || !modelId(model) || !id(analysisId)
    || !(now instanceof Date) || Number.isNaN(now.getTime())) throw new AiError('INVALID_OUTPUT');
  const instant = now.toISOString();
  return Object.freeze({
    schemaVersion: 1, analysisId, requestId: parsedRequest.requestId, recordId: parsedRequest.recordId,
    conversationId: parsedRequest.conversationId, thoughtReceiptId: parsedRequest.thoughtReceiptId,
    conversationFingerprint: parsedRequest.conversationFingerprint, origin: 'gemini-api', analysisStatus: 'failed',
    receivedAt: instant, model, rubricVersion: WEEKLY_ANALYSIS_RUBRIC_VERSION, analyzedAt: instant,
    analysis: null, error: Object.freeze({ code, retryable: ['RATE_LIMITED', 'MODEL_UNAVAILABLE', 'TIMEOUT', 'PROVIDER_ERROR'].includes(code) }),
  });
}

export function parseWeeklyAnalysisResponse(value) {
  if (!plain(value) || !exact(value, ['schemaVersion', 'analysisId', 'requestId', 'recordId', 'conversationId', 'thoughtReceiptId', 'conversationFingerprint', 'origin', 'analysisStatus', 'receivedAt', 'model', 'rubricVersion', 'analyzedAt', 'analysis', 'error'])
    || value.schemaVersion !== 1 || !id(value.analysisId) || !id(value.requestId) || !id(value.recordId)
    || !id(value.conversationId) || !id(value.thoughtReceiptId) || !id(value.conversationFingerprint)
    || value.origin !== 'gemini-api' || !['complete', 'failed'].includes(value.analysisStatus)
    || !timestamp(value.receivedAt) || !modelId(value.model) || value.rubricVersion !== WEEKLY_ANALYSIS_RUBRIC_VERSION || !timestamp(value.analyzedAt)) throw new AiError('INVALID_OUTPUT');
  if (value.analysisStatus === 'complete') {
    if (value.error !== null) throw new AiError('INVALID_OUTPUT');
    parseGeminiAnalysisPayload(value.analysis);
  } else if (value.analysis !== null || !plain(value.error) || !exact(value.error, ['code', 'retryable'])
    || !errorCodes.includes(value.error.code) || typeof value.error.retryable !== 'boolean') throw new AiError('INVALID_OUTPUT');
  return value;
}

function score(value) { return value === null || [0, 25, 50, 75, 100].includes(value); }
function id(value) { return typeof value === 'string' && !!value.trim() && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value); }
function modelId(value) { return typeof value === 'string' && /^gemini-[a-zA-Z0-9._-]{1,120}$/.test(value); }
function timestamp(value) { return typeof value === 'string' && !Number.isNaN(new Date(value).getTime()); }
function nonEmptyText(value, limit) { return typeof value === 'string' && !!value.trim() && value.length <= limit; }
function nullableText(value, limit) { return value === null || (typeof value === 'string' && value.length <= limit); }
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function exact(value, keys) { const actual = Object.keys(value); return actual.length === keys.length && actual.every(key => keys.includes(key)); }
