import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createVercelHandler } from '../server/vercel.mjs';

async function start(env = {}, dependencies = {}) {
  const server = createServer(createVercelHandler(env, dependencies));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return {
    base: `http://127.0.0.1:${server.address().port}/api/ai`,
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }),
  };
}
const origin = 'https://accounting-of-ai.vercel.app';
const input = { text: '自分で決めた文章', instruction: '短く整える' };
const post = (app, body = input, from = origin) => fetch(app.base + '/rewrite', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: from }, body: JSON.stringify(body),
});

test('Vercel handler reuses the actual SDK and contracts without exposing the key', async () => {
  let calls = 0;
  const key = 'vercel-test-not-a-real-key';
  const app = await start({ AI_ENABLED: 'true', GEMINI_API_KEY: key }, { fetchImpl: async (url, options) => {
    calls++;
    assert.equal(new Headers(options.headers).get('x-goog-api-key'), key);
    assert.equal(JSON.parse(options.body).input, JSON.stringify(input));
    return Response.json({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: '自分で決めました。' }] }] });
  } });
  try {
    const response = await post(app);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { text: '自分で決めました。' });
    assert.equal(calls, 1);
    assert.equal((await post(app, { text: '' })).status, 400);
    assert.equal((await post(app, { text: 'x'.repeat(40000) })).status, 413);
    assert.equal((await post(app, input, 'https://attacker.example')).status, 403);
    assert.equal(calls, 1);
  } finally { await app.close(); }
});

test('Vercel supports its production/preview origins and rejects lookalikes', async () => {
  const app = await start({ VERCEL_URL: 'accounting-of-ai-preview.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'school-project.vercel.app' });
  try {
    for (const host of [origin, 'https://accounting-of-ai-preview.vercel.app', 'https://school-project.vercel.app']) {
      const response = await fetch(app.base + '/health', { headers: { Origin: host } });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: 'disabled', configured: false });
    }
    assert.equal((await post(app)).status, 503);
    assert.equal((await post(app, input, origin + '.evil.example')).status, 403);
    assert.equal((await fetch(app.base + '/unknown')).status, 404);
    assert.equal((await fetch(app.base + '/rewrite')).status, 405);
  } finally { await app.close(); }
});

test('Vercel reports invalid configuration safely and never calls the provider', async () => {
  for (const env of [{ AI_ENABLED: 'true' }, { AI_ENABLED: 'invalid', GEMINI_API_KEY: 'do-not-expose' }, { VERCEL_URL: 'evil.example/path' }]) {
    const app = await start(env, { fetchImpl: () => { throw new Error('must not run'); } });
    try {
      const response = await post(app);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: { code: 'AI_NOT_CONFIGURED' } });
    } finally { await app.close(); }
  }
});

test('Vercel function entry exports a request handler without opening a port', async () => {
  const entry = await import('../api/ai/[action].mjs');
  assert.equal(typeof entry.default, 'function');
});
