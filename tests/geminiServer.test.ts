import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { AiError, parseInput, parseResult } from '../server/contract.mjs';
import { createGeminiProvider, providerFromEnvironment } from '../server/gemini.mjs';
import { createAiServer } from '../server/app.mjs';
import { createAiClient, AiClientError } from '../src/aiClient.ts';

// Test credentials and mock responses only. No actual Gemini request/key is used.
const testKey = 'test-key-not-a-real-api-key';
const model = 'gemini-test-model';
const input = { text: '元の文章です。\n\n自分の判断を残します。', instruction: '意味を変えず短く整える' };
const success = (parts = [{ text: '接続確認用の文章（テスト応答）' }]) => ({ candidates: [{ finishReason: 'STOP', content: { parts } }] });
const provider = (fetchImpl) => createGeminiProvider({ apiKey: testKey, model, fetchImpl });
const rejectsCode = (promise, code) => assert.rejects(promise, e => e instanceof AiError && e.code === code && !e.message.includes(testKey));
async function start(options = {}) {
  const server = createAiServer(options); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { base: `http://127.0.0.1:${server.address().port}/api/ai`, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
const post = (base, value = input, headers = {}) => fetch(base + '/rewrite', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });

test('Gemini is disabled by default, and disabled mode does not inspect keys or send requests', () => {
  let calls = 0;
  const env = { AI_ENABLED: 'false', get GEMINI_API_KEY() { throw new Error('must not read'); } };
  assert.equal(providerFromEnvironment(env, { fetchImpl: async () => { calls++; } }), null);
  assert.equal(providerFromEnvironment({}), null);
  assert.equal(calls, 0);
  for (const config of [{ AI_ENABLED: 'yes' }, { AI_ENABLED: 'true', AI_PROVIDER: 'unknown' }, { AI_ENABLED: 'true' }, { AI_ENABLED: 'true', GEMINI_API_KEY: testKey, GEMINI_MODEL: '../other-host' }]) assert.throws(() => providerFromEnvironment(config), e => e.code === 'INVALID_CONFIG');
});

test('Gemini request uses a fixed HTTPS endpoint, header key, selected model, no redirect/retry, and selected text only', async () => {
  let calls = 0; const before = JSON.stringify(input); const controller = new AbortController();
  const adapter = provider(async (url, options) => {
    calls++;
    assert.equal(url, `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`);
    assert.ok(!url.includes(testKey)); assert.equal(options.headers['x-goog-api-key'], testKey);
    assert.equal(options.redirect, 'error'); assert.equal(options.signal, controller.signal);
    const body = JSON.parse(options.body);
    assert.deepEqual(body.contents, [{ role: 'user', parts: [{ text: JSON.stringify(input) }] }]);
    assert.deepEqual(body.generationConfig, { candidateCount: 1, maxOutputTokens: 2048 });
    assert.match(body.systemInstruction.parts[0].text, /原文の事実/);
    assert.ok(!options.body.includes(testKey));
    return Response.json(success());
  });
  assert.deepEqual(await adapter.rewrite(input, { signal: controller.signal }), { text: '接続確認用の文章（テスト応答）' });
  assert.equal(calls, 1); assert.equal(JSON.stringify(input), before);
});

test('Gemini distinguishes permissions, quota, model errors and service errors without exposing upstream details', async () => {
  for (const [status, code] of [[401, 'AUTH_ERROR'], [403, 'AUTH_ERROR'], [429, 'RATE_LIMITED'], [404, 'MODEL_UNAVAILABLE'], [500, 'PROVIDER_ERROR']]) {
    let calls = 0;
    await rejectsCode(provider(async () => { calls++; return Response.json({ error: { message: testKey + input.text } }, { status }); }).rewrite(input), code);
    assert.equal(calls, 1);
  }
  await rejectsCode(provider(async () => { throw new Error(testKey + input.text); }).rewrite(input), 'PROVIDER_ERROR');
});

test('Gemini blocked, truncated, malformed, oversized and empty output are never treated as generated text', async () => {
  for (const data of [{ promptFeedback: { blockReason: 'SAFETY' } }, { candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: 'must not show' }] } }] }]) await rejectsCode(provider(async () => Response.json(data)).rewrite(input), 'CONTENT_BLOCKED');
  await rejectsCode(provider(async () => Response.json({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'partial' }] } }] })).rewrite(input), 'OUTPUT_TRUNCATED');
  for (const data of [null, {}, { candidates: [null] }, { candidates: [] }, success([{ text: '' }]), success([{ text: 'x'.repeat(8001) }]), success([{ functionCall: { name: 'unexpected' } }]), success([{ text: 'x'.repeat(140000) }])]) await rejectsCode(provider(async () => Response.json(data)).rewrite(input), 'INVALID_OUTPUT');
  await rejectsCode(provider(async () => new Response('not JSON')).rewrite(input), 'INVALID_OUTPUT');
});

test('Gemini excludes reasoning content and preserves actual answer parts', async () => {
  const adapter = provider(async () => Response.json(success([{ thought: true, text: 'internal reasoning' }, { text: '文章' }, { text: 'の候補' }])));
  assert.deepEqual(await adapter.rewrite(input), { text: '文章の候補' });
});

test('Writing contracts reject unexpected data and keep existing text unchanged', () => {
  assert.deepEqual(parseInput(input), input);
  assert.ok(parseInput({ text: 'x'.repeat(6000), instruction: 'x'.repeat(500) }));
  for (const value of [null, [], {}, { text: '' }, { text: '  ' }, { text: 'x'.repeat(6001) }, { text: 'x', instruction: 'x'.repeat(501) }, { text: 'x', apiKey: testKey }, { text: 'x', ledger: [] }]) assert.equal(parseInput(value), null);
  assert.equal(parseResult({ text: 'x', thinkingBalance: 3 }), null);
});

test('Local AI server reports disabled mode without exposing any credential/config values', async () => {
  const app = await start();
  try {
    const health = await fetch(app.base + '/health');
    assert.equal(health.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await health.json(), { status: 'disabled', configured: false });
    const response = await post(app.base);
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: { code: 'AI_NOT_CONFIGURED' } });
  } finally { await app.close(); }
});

test('Browser client → local server → mocked Gemini adapter returns a draft, not a storage change', async () => {
  const app = await start({ provider: provider(async () => Response.json(success())) });
  try {
    const before = JSON.stringify(input);
    assert.deepEqual(await createAiClient({ baseUrl: app.base }).rewrite(input), { text: '接続確認用の文章（テスト応答）' });
    assert.equal(JSON.stringify(input), before);
  } finally { await app.close(); }
});

test('Local server rejects unapproved origins, invalid input, oversized requests and methods before calling Gemini', async () => {
  let calls = 0;
  const app = await start({ provider: provider(async () => { calls++; return Response.json(success()); }) });
  try {
    assert.equal((await post(app.base, input, { Origin: 'https://unapproved.example' })).status, 403);
    assert.equal((await post(app.base, { text: 'x', apiKey: testKey })).status, 400);
    assert.equal((await post(app.base, { text: 'x'.repeat(40000) })).status, 413);
    assert.equal((await fetch(app.base + '/rewrite')).status, 405);
    assert.equal((await fetch(app.base + '/rewrite', { method: 'POST', body: 'not JSON' })).status, 400);
    assert.equal(calls, 0);
    const preflight = await fetch(app.base + '/rewrite', { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:5173', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(preflight.status, 204);
  } finally { await app.close(); }
});

test('Server bounds concurrent requests and aborts Gemini when the deadline expires', async () => {
  let started, observedSignal;
  const ready = new Promise(resolve => { started = resolve; });
  const adapter = provider(async (_url, options) => {
    observedSignal = options.signal; started();
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  });
  const app = await start({ provider: adapter, maxConcurrent: 1, timeoutMs: 500 });
  try {
    const first = post(app.base); await ready;
    assert.equal((await post(app.base)).status, 429);
    const response = await first; assert.equal(response.status, 504);
    assert.deepEqual(await response.json(), { error: { code: 'TIMEOUT' } });
    assert.equal(observedSignal.aborted, true);
  } finally { await app.close(); }
});

test('Client is opt-in, sends no key/cookies, and normalizes cancellation, errors and invalid response', async () => {
  let calls = 0;
  const mock = async () => { calls++; return Response.json(success()); };
  await assert.rejects(createAiClient({ fetchImpl: mock }).rewrite(input), e => e.code === 'AI_NOT_CONFIGURED');
  await assert.rejects(createAiClient({ baseUrl: '/api/ai', fetchImpl: mock }).rewrite({ text: '' }));
  assert.equal(calls, 0);
  for (const baseUrl of ['//evil.example', '/\\evil.example', 'http://public.example', 'https://user:password@example.com', 'https://example.com?key=secret']) assert.throws(() => createAiClient({ baseUrl }));
  await assert.rejects(createAiClient({ baseUrl: '/api/ai', fetchImpl: async (_url, options) => {
    assert.equal(options.credentials, 'omit');
    assert.deepEqual(options.headers, { 'Content-Type': 'application/json' });
    return Response.json({ error: { code: 'AUTH_ERROR', message: testKey } }, { status: 502 });
  } }).rewrite(input), e => e instanceof AiClientError && e.code === 'AUTH_ERROR' && !e.message.includes(testKey));
  const pending = async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  await assert.rejects(createAiClient({ baseUrl: '/api/ai', timeoutMs: 10, fetchImpl: pending }).rewrite(input), e => e.code === 'TIMEOUT');
  const controller = new AbortController();
  const request = createAiClient({ baseUrl: '/api/ai', fetchImpl: pending }).rewrite(input, { signal: controller.signal });
  controller.abort(); await assert.rejects(request, e => e.code === 'CANCELLED');
  await assert.rejects(createAiClient({ baseUrl: '/api/ai', fetchImpl: async () => Response.json({ text: '', score: 3 }) }).rewrite(input), e => e.code === 'INVALID_OUTPUT');
});
