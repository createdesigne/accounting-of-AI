import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createAiHandler } from '../server/app.mjs';
import { vercelOrigins } from '../server/vercel.mjs';
import healthHandler from '../api/ai/health.mjs';
import rewriteHandler from '../api/ai/rewrite.mjs';

const allowed = 'https://deployment.example';
async function start(handler, parsed = false) {
  const server = createServer(async (req, res) => {
    if (parsed) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      Object.defineProperty(req, 'body', { get() { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } });
    }
    await handler(req, res);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
test('Vercel parsed-body requests preserve credentials, limits, sanitized errors and same-origin checks', async () => {
  let calls = 0;
  const app = await start(createAiHandler({ allowedOrigins: [allowed], providerFactory: ({ apiKey, model }) => {
    assert.equal(apiKey, 'test-only-key'); assert.equal(model, 'gemini-test');
    return { rewrite: async input => { calls++; return { text: input.text }; } };
  } }), true);
  const post = (body, origin = allowed) => fetch(app.url + '/api/ai/rewrite', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Authorization: 'Bearer test-only-key', 'X-Gemini-Model': 'gemini-test' }, body });
  try {
    const result = await post(JSON.stringify({ text: 'selected text', instruction: 'edit' }));
    assert.equal(result.status, 200); assert.deepEqual(await result.json(), { text: 'selected text' });
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal((await post('{broken')).status, 400);
    assert.equal((await post(JSON.stringify({ text: 'x'.repeat(40000) }))).status, 413);
    assert.equal((await post(JSON.stringify({ text: 'x', apiKey: 'secret' }))).status, 400);
    assert.equal((await post(JSON.stringify({ text: 'x' }), 'https://evil.example')).status, 403);
    assert.equal(calls, 1);
  } finally { await app.close(); }
});
test('Vercel entrypoints return health and reject missing keys without an upstream request', async () => {
  const app = await start((req, res) => req.url.endsWith('health') ? healthHandler(req, res) : rewriteHandler(req, res), true);
  try {
    const health = await fetch(app.url + '/api/ai/health');
    assert.equal(health.status, 200); assert.equal((await health.json()).credentialMode, 'per_request');
    const response = await fetch(app.url + '/api/ai/rewrite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'test' }) });
    assert.equal(response.status, 401); assert.deepEqual(await response.json(), { error: { code: 'API_KEY_REQUIRED' } });
  } finally { await app.close(); }
});
test('only explicit Vercel deployment hosts and HTTPS public origins are allowed', () => {
  assert.deepEqual(vercelOrigins({ VERCEL_URL: 'preview.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'app.vercel.app', VERCEL_BRANCH_URL: 'branch.vercel.app', PUBLIC_ORIGIN: 'https://custom.example' }), ['https://preview.vercel.app', 'https://app.vercel.app', 'https://branch.vercel.app', 'https://custom.example']);
  assert.deepEqual(vercelOrigins({}), []);
  for (const env of [{ VERCEL_URL: 'evil.example/path' }, { VERCEL_URL: 'user@evil.example' }, { PUBLIC_ORIGIN: 'http://insecure.example' }, { PUBLIC_ORIGIN: 'https://good.example/path' }]) assert.throws(() => vercelOrigins(env));
});
