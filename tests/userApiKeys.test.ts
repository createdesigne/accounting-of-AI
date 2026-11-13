import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAiServer } from '../server/app.mjs';
import { createStaticHandler } from '../server/static.mjs';
import { createAiClient } from '../src/aiClient.ts';

async function start(options) {
  const server = createAiServer(options); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { baseUrl: `http://127.0.0.1:${server.address().port}/api/ai`, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
const input = { text: 'テスト文章' };
test('two concurrent users keep keys and models isolated; no shared fallback or health disclosure', async () => {
  const seen = [];
  const app = await start({ providerFactory: ({ apiKey, model }) => ({ rewrite: async value => {
    seen.push({ apiKey, model, value }); await new Promise(resolve => setTimeout(resolve, apiKey === 'test-user-a' ? 30 : 1));
    return { text: model };
  } }) });
  try {
    const results = await Promise.all(['a', 'b'].map(user => createAiClient({ baseUrl: app.baseUrl, apiKey: `test-user-${user}`, model: `gemini-test-${user}` }).rewrite(input)));
    assert.deepEqual(results, [{ text: 'gemini-test-a' }, { text: 'gemini-test-b' }]);
    assert.deepEqual(seen.map(x => [x.apiKey, x.model]).sort(), [['test-user-a', 'gemini-test-a'], ['test-user-b', 'gemini-test-b']]);
    assert.ok(seen.every(x => JSON.stringify(x.value) === JSON.stringify(input)));
    assert.deepEqual(await (await fetch(app.baseUrl + '/health')).json(), { status: 'requires_key', configured: false, credentialMode: 'per_request' });
    const response = await fetch(app.baseUrl + '/rewrite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    assert.equal(response.status, 401); assert.deepEqual(await response.json(), { error: { code: 'API_KEY_REQUIRED' } });
    assert.equal(seen.length, 2);
  } finally { await app.close(); }
});
test('missing/invalid credentials never send; failed provider setup never reflects secrets', async () => {
  let calls = 0;
  const app = await start({ providerFactory: () => { calls++; throw new Error('private-key-and-provider-details'); } });
  try {
    for (const apiKey of ['', 'contains space', 'x'.repeat(513), '日本語']) await assert.rejects(createAiClient({ baseUrl: app.baseUrl, apiKey }).rewrite(input));
    assert.equal(calls, 0);
    const post = headers => fetch(app.baseUrl + '/rewrite', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input) });
    for (const headers of [{ Authorization: 'Basic test' }, { Authorization: 'Bearer test', 'X-Gemini-Model': '../other' }]) assert.equal((await post(headers)).status, 400);
    assert.equal(calls, 0);
    const response = await post({ Authorization: 'Bearer test', 'X-Gemini-Model': 'gemini-test' });
    assert.equal(response.status, 400); assert.equal(await response.text(), '{"error":{"code":"INVALID_CREDENTIALS"}}');
    assert.equal(calls, 1);
    const options = await fetch(app.baseUrl + '/rewrite', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization,x-gemini-model' } });
    assert.equal(options.status, 204);
    assert.equal((await post({ Origin: 'https://evil.invalid', Authorization: 'Bearer test', 'X-Gemini-Model': 'gemini-test' })).status, 403);
    assert.equal(calls, 1);
  } finally { await app.close(); }
});
test('production handler serves only dist assets, with app/API routes and no repository secrets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-static-test-'));
  await writeFile(join(dir, 'index.html'), '<html>test app</html>');
  await writeFile(join(dir, '.env'), 'test-private-file');
  const app = await start({ staticHandler: createStaticHandler(dir) });
  const origin = new URL(app.baseUrl).origin;
  try {
    const response = await fetch(origin + '/accounting-of-AI/');
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
    assert.equal(await response.text(), '<html>test app</html>');
    assert.equal((await fetch(origin, { redirect: 'manual' })).status, 302);
    for (const path of ['/server/.env', '/accounting-of-AI/.env', '/accounting-of-AI/%2e%2e%2fserver/.env', '/accounting-of-AI/missing.js', '/api/missing']) assert.equal((await fetch(origin + path)).status, 404);
    assert.equal((await fetch(app.baseUrl + '/health')).status, 200);
  } finally { await app.close(); await rm(dir, { recursive: true }); }
});
