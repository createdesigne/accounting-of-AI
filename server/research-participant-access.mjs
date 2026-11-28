import { createHash, timingSafeEqual } from 'node:crypto';

const CODE_PATTERN = /^[\x21-\x7e]{20,128}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const MODEL_PATTERN = /^gemini-[a-zA-Z0-9._-]{1,120}$/;
const NAMESPACE_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const API_METHODS = ['interactions', 'generate-content'];
const QUOTA_SCRIPT = `
local participant = tonumber(redis.call('GET', KEYS[1]) or '0')
local global = tonumber(redis.call('GET', KEYS[2]) or '0')
if redis.call('EXISTS', KEYS[3]) == 1 then
  return {1, participant, global, 1}
end
local participantLimit = tonumber(ARGV[1])
local globalLimit = tonumber(ARGV[2])
if participant >= participantLimit then return {0, participant, global, 2} end
if global >= globalLimit then return {0, participant, global, 3} end
participant = redis.call('INCR', KEYS[1])
global = redis.call('INCR', KEYS[2])
redis.call('SET', KEYS[3], '1', 'EX', tonumber(ARGV[3]))
return {1, participant, global, 0}
`;

export class ResearchParticipantAccessError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ResearchParticipantAccessError';
    this.code = code;
  }
}

export function createResearchParticipantAccess(env = {}, { fetchImpl = fetch, quotaTimeoutMs = 3000 } = {}) {
  if (!Number.isInteger(quotaTimeoutMs) || quotaTimeoutMs < 1 || quotaTimeoutMs > 5000) throw new Error('Invalid quota timeout');
  const configuration = readConfiguration(env);
  return Object.freeze({
    available: configuration !== null,
    async authorize({ accessCode, requestId, requestFingerprint, signal } = {}) {
      if (!configuration) throw new ResearchParticipantAccessError('RESEARCH_SERVICE_UNAVAILABLE');
      if (typeof accessCode !== 'string' || !CODE_PATTERN.test(accessCode)) {
        throw new ResearchParticipantAccessError('INVALID_ACCESS_CODE');
      }
      if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 256 || /[\u0000-\u001f\u007f]/.test(requestId)) {
        throw new ResearchParticipantAccessError('INVALID_INPUT');
      }
      if (typeof requestFingerprint !== 'string' || !HASH_PATTERN.test(requestFingerprint)) {
        throw new ResearchParticipantAccessError('INVALID_INPUT');
      }
      const participantId = matchParticipant(configuration.participants, accessCode);
      if (!participantId) throw new ResearchParticipantAccessError('INVALID_ACCESS_CODE');
      const allowed = await reserveQuota(configuration, participantId, requestId, requestFingerprint, signal, fetchImpl, quotaTimeoutMs);
      if (!allowed) throw new ResearchParticipantAccessError('RESEARCH_LIMIT_REACHED');
      return Object.freeze({
        apiKey: configuration.apiKey,
        model: configuration.model,
        apiMethod: configuration.apiMethod,
      });
    },
  });
}

export function hashResearchAccessCode(accessCode) {
  if (typeof accessCode !== 'string' || !CODE_PATTERN.test(accessCode)) throw new Error('Invalid access code');
  return createHash('sha256').update(accessCode, 'utf8').digest('hex');
}

function readConfiguration(env) {
  const names = [
    'RESEARCH_GEMINI_API_KEY', 'RESEARCH_PARTICIPANT_CODES_SHA256', 'RESEARCH_GEMINI_MODEL',
    'RESEARCH_PARTICIPANT_LIMIT', 'RESEARCH_GLOBAL_LIMIT', 'RESEARCH_QUOTA_NAMESPACE',
    'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
  ];
  if (names.every(name => env[name] === undefined || env[name] === '')) return null;
  try {
    const apiKey = env.RESEARCH_GEMINI_API_KEY;
    const model = env.RESEARCH_GEMINI_MODEL;
    const apiMethod = env.RESEARCH_GEMINI_API_METHOD || 'generate-content';
    const participantLimit = positiveInteger(env.RESEARCH_PARTICIPANT_LIMIT, 1, 10_000);
    const globalLimit = positiveInteger(env.RESEARCH_GLOBAL_LIMIT, 1, 100_000);
    const namespace = env.RESEARCH_QUOTA_NAMESPACE;
    const redisUrl = new URL(env.UPSTASH_REDIS_REST_URL);
    const redisToken = env.UPSTASH_REDIS_REST_TOKEN;
    if (typeof apiKey !== 'string' || !/^[\x21-\x7e]{1,512}$/.test(apiKey)
      || typeof model !== 'string' || !MODEL_PATTERN.test(model)
      || !API_METHODS.includes(apiMethod)
      || typeof namespace !== 'string' || !NAMESPACE_PATTERN.test(namespace)
      || redisUrl.protocol !== 'https:' || redisUrl.username || redisUrl.password || redisUrl.search || redisUrl.hash
      || typeof redisToken !== 'string' || !/^[\x21-\x7e]{20,2048}$/.test(redisToken)) throw new Error('invalid');
    const parsed = JSON.parse(env.RESEARCH_PARTICIPANT_CODES_SHA256);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    const entries = Object.entries(parsed);
    if (entries.length < 1 || entries.length > 100
      || entries.some(([id, hash]) => !ID_PATTERN.test(id) || typeof hash !== 'string' || !HASH_PATTERN.test(hash))) throw new Error('invalid');
    const hashes = entries.map(([, hash]) => hash);
    if (new Set(hashes).size !== hashes.length) throw new Error('duplicate');
    return Object.freeze({
      apiKey, model, apiMethod, participantLimit, globalLimit, namespace,
      redisUrl: redisUrl.toString().replace(/\/$/, ''), redisToken,
      participants: Object.freeze(entries.map(([id, hash]) => Object.freeze({ id, hash: Buffer.from(hash, 'hex') }))),
      idempotencyTtlSeconds: positiveInteger(env.RESEARCH_IDEMPOTENCY_TTL_SECONDS || '2592000', 3600, 7776000),
    });
  } catch {
    // Partial or malformed configuration must never fall back to an unmetered mode.
    return null;
  }
}

function matchParticipant(participants, accessCode) {
  const candidate = Buffer.from(hashResearchAccessCode(accessCode), 'hex');
  let matched = null;
  for (const participant of participants) {
    if (timingSafeEqual(candidate, participant.hash)) matched = participant.id;
  }
  return matched;
}

async function reserveQuota(configuration, participantId, requestId, requestFingerprint, signal, fetchImpl, quotaTimeoutMs) {
  const tag = `{research:${configuration.namespace}}`;
  const participantKey = `${tag}:participant:${participantId}`;
  const globalKey = `${tag}:global`;
  const requestHash = createHash('sha256').update(requestId, 'utf8').update('\0').update(requestFingerprint, 'utf8').digest('hex');
  const idempotencyKey = `${tag}:request:${participantId}:${requestHash}`;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, quotaTimeoutMs);
  let response;
  let payload;
  try {
    response = await fetchImpl(configuration.redisUrl, {
      method: 'POST', redirect: 'error', cache: 'no-store', signal: controller.signal,
      headers: { Authorization: `Bearer ${configuration.redisToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['EVAL', QUOTA_SCRIPT, '3', participantKey, globalKey, idempotencyKey,
        String(configuration.participantLimit), String(configuration.globalLimit), String(configuration.idempotencyTtlSeconds)]),
    });
    if (!response?.ok) throw new Error('storage unavailable');
    payload = await response.json();
  } catch {
    throw new ResearchParticipantAccessError('RESEARCH_SERVICE_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
  const result = payload?.result;
  if (!Array.isArray(result) || result.length !== 4 || !result.every(Number.isInteger)) {
    throw new ResearchParticipantAccessError('RESEARCH_SERVICE_UNAVAILABLE');
  }
  if (result[0] === 1) return true;
  if (result[0] === 0 && [2, 3].includes(result[3])) return false;
  throw new ResearchParticipantAccessError('RESEARCH_SERVICE_UNAVAILABLE');
}

function positiveInteger(value, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error('invalid');
  return parsed;
}
