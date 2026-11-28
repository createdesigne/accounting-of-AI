import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAiServer } from '../server/app.mjs';
import { AiError } from '../server/contract.mjs';
import {
  createResearchParticipantAccess,
  hashResearchAccessCode,
  ResearchParticipantAccessError,
} from '../server/research-participant-access.mjs';
import { createWeeklyAnalysisClient, WeeklyAnalysisClientError } from '../src/weeklyAnalysisClient.ts';

const accessCode = 'participant-test-code-0001';
const requestFingerprint = 'a'.repeat(64);
const env = {
  RESEARCH_GEMINI_API_KEY: 'test-research-key-not-real',
  RESEARCH_PARTICIPANT_CODES_SHA256: JSON.stringify({ 'participant-01': hashResearchAccessCode(accessCode) }),
  RESEARCH_GEMINI_MODEL: 'gemini-research-test',
  RESEARCH_GEMINI_API_METHOD: 'generate-content',
  RESEARCH_PARTICIPANT_LIMIT: '5',
  RESEARCH_GLOBAL_LIMIT: '20',
  RESEARCH_QUOTA_NAMESPACE: 'study-test',
  UPSTASH_REDIS_REST_URL: 'https://redis-test.example',
  UPSTASH_REDIS_REST_TOKEN: 'test-redis-token-not-real',
};

const request = {
  schemaVersion: 1 as const,
  requestId: 'research-participant-request-1',
  recordId: 'research-record-1',
  conversationId: 'research-conversation-1',
  thoughtReceiptId: 'research-receipt-1',
  conversationFingerprint: 'fnv1a32:12345678',
  requestedAt: '2026-11-28T01:00:00.000Z',
  consent: { externalAnalysisAllowed: true as const, privacy: 'full' as const, captureScope: 'full' as const, consentedAt: '2026-11-28T00:59:00.000Z' },
  taskContext: { taskId: null, plannedAiasLevel: null, activityCategory: '壁打ち' as const, expectedAiRole: null },
  messages: [{ role: 'user' as const, text: 'テスト用の会話です。' }],
};

test('participant access validates a hashed code and reserves participant/global quota atomically without sending secrets', async () => {
  let calls = 0;
  const idempotencyKeys: string[] = [];
  const access = createResearchParticipantAccess(env, { fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, env.UPSTASH_REDIS_REST_URL);
    assert.equal(new Headers(options.headers).get('authorization'), `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`);
    const command = JSON.parse(String(options.body));
    assert.equal(command[0], 'EVAL');
    assert.equal(command[2], '3');
    assert.match(command[3], /participant:participant-01$/);
    assert.match(command[4], /:global$/);
    assert.match(command[5], /:request:participant-01:[a-f0-9]{64}$/);
    idempotencyKeys.push(command[5]);
    assert.equal(String(options.body).includes(accessCode), false);
    assert.equal(String(options.body).includes(env.RESEARCH_GEMINI_API_KEY), false);
    return Response.json({ result: [1, 1, 1, 0] });
  }});
  assert.equal(access.available, true);
  assert.deepEqual(await access.authorize({ accessCode, requestId: request.requestId, requestFingerprint }), {
    apiKey: env.RESEARCH_GEMINI_API_KEY,
    model: env.RESEARCH_GEMINI_MODEL,
    apiMethod: env.RESEARCH_GEMINI_API_METHOD,
  });
  await access.authorize({ accessCode, requestId: request.requestId, requestFingerprint });
  await access.authorize({ accessCode, requestId: request.requestId, requestFingerprint: 'b'.repeat(64) });
  assert.equal(calls, 3);
  assert.equal(idempotencyKeys[0], idempotencyKeys[1]);
  assert.notEqual(idempotencyKeys[0], idempotencyKeys[2]);
});

test('invalid participant codes, exhausted quotas, missing configuration and storage failures fail closed', async () => {
  let calls = 0;
  const access = createResearchParticipantAccess(env, { fetchImpl: async () => { calls++; return Response.json({ result: [0, 5, 8, 2] }); } });
  await assert.rejects(access.authorize({ accessCode: 'invalid-participant-code-1', requestId: request.requestId, requestFingerprint }),
    error => error instanceof ResearchParticipantAccessError && error.code === 'INVALID_ACCESS_CODE');
  assert.equal(calls, 0);
  await assert.rejects(access.authorize({ accessCode, requestId: request.requestId, requestFingerprint }),
    error => error instanceof ResearchParticipantAccessError && error.code === 'RESEARCH_LIMIT_REACHED');
  const globalLimit = createResearchParticipantAccess(env, { fetchImpl: async () => Response.json({ result: [0, 1, 20, 3] }) });
  await assert.rejects(globalLimit.authorize({ accessCode, requestId: request.requestId, requestFingerprint }),
    error => error instanceof ResearchParticipantAccessError && error.code === 'RESEARCH_LIMIT_REACHED');
  const unavailable = createResearchParticipantAccess({ RESEARCH_GEMINI_API_KEY: 'partial' });
  assert.equal(unavailable.available, false);
  await assert.rejects(unavailable.authorize({ accessCode, requestId: request.requestId, requestFingerprint }),
    error => error instanceof ResearchParticipantAccessError && error.code === 'RESEARCH_SERVICE_UNAVAILABLE');
  const broken = createResearchParticipantAccess(env, { fetchImpl: async () => { throw new Error('private storage detail'); } });
  await assert.rejects(broken.authorize({ accessCode, requestId: request.requestId, requestFingerprint }),
    error => error instanceof ResearchParticipantAccessError && error.code === 'RESEARCH_SERVICE_UNAVAILABLE' && !error.message.includes('private'));
  const hanging = createResearchParticipantAccess(env, { quotaTimeoutMs: 10, fetchImpl: async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) });
  await assert.rejects(hanging.authorize({ accessCode, requestId: request.requestId, requestFingerprint }),
    error => error instanceof ResearchParticipantAccessError && error.code === 'RESEARCH_SERVICE_UNAVAILABLE');
});

test('participant mode is limited to weekly analysis, uses the server-selected model and preserves a sanitized provider failure', async () => {
  let authorizeCalls = 0;
  let providerCalls = 0;
  const participantAccess = { authorize: async ({ accessCode: supplied, requestId, requestFingerprint: suppliedFingerprint }) => {
    authorizeCalls++;
    assert.equal(supplied, accessCode);
    assert.equal(requestId, request.requestId);
    assert.match(suppliedFingerprint, /^[a-f0-9]{64}$/);
    return { apiKey: env.RESEARCH_GEMINI_API_KEY, model: env.RESEARCH_GEMINI_MODEL, apiMethod: env.RESEARCH_GEMINI_API_METHOD };
  }};
  const server = createAiServer({ participantAccess, providerFactory: ({ apiKey, model, apiMethod }) => {
    assert.equal(apiKey, env.RESEARCH_GEMINI_API_KEY);
    assert.equal(model, env.RESEARCH_GEMINI_MODEL);
    assert.equal(apiMethod, env.RESEARCH_GEMINI_API_METHOD);
    return { analyzeWeekly: async () => { providerCalls++; throw new AiError('PROVIDER_ERROR', { diagnosticStage: 'provider-response' }); } };
  }});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/ai`;
  try {
    const result = await createWeeklyAnalysisClient({ baseUrl, authMode: 'participant', participantCode: accessCode }).analyze(request);
    assert.equal(result.analysisStatus, 'failed');
    assert.equal(result.error?.code, 'PROVIDER_ERROR');
    assert.equal(result.model, env.RESEARCH_GEMINI_MODEL);
    assert.equal(result.apiMethod, env.RESEARCH_GEMINI_API_METHOD);
    assert.equal(authorizeCalls, 1);
    assert.equal(providerCalls, 1);
    const rewrite = await fetch(`${baseUrl}/rewrite`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Research-Access-Code': accessCode }, body: JSON.stringify({ text: 'test' }) });
    assert.equal(rewrite.status, 403);
  } finally { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); }
});

test('participant client sends only the participant credential header and maps invalid codes safely', async () => {
  let calls = 0;
  const client = createWeeklyAnalysisClient({ baseUrl: '/api/ai', authMode: 'participant', participantCode: accessCode, fetchImpl: async (_url, options) => {
    calls++;
    const headers = new Headers(options.headers);
    assert.equal(headers.get('x-research-access-code'), accessCode);
    assert.equal(headers.has('authorization'), false);
    assert.equal(headers.has('x-gemini-model'), false);
    return Response.json({ error: { code: 'INVALID_ACCESS_CODE' } }, { status: 401 });
  }});
  await assert.rejects(client.analyze(request), error => error instanceof WeeklyAnalysisClientError && error.code === 'INVALID_ACCESS_CODE' && !error.message.includes(accessCode));
  assert.equal(calls, 1);
});

test('participant credentials are not sent to another production origin', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL('https://preview.example/accounting-of-AI/') });
  let calls = 0;
  try {
    const client = createWeeklyAnalysisClient({ baseUrl: 'https://other.example/api/ai', authMode: 'participant', participantCode: accessCode, fetchImpl: async () => { calls++; return Response.json({}); } });
    await assert.rejects(client.analyze(request), error => error instanceof WeeklyAnalysisClientError && error.code === 'FORBIDDEN');
    assert.equal(calls, 0);
  } finally {
    if (original) Object.defineProperty(globalThis, 'location', original);
    else Reflect.deleteProperty(globalThis, 'location');
  }
});
