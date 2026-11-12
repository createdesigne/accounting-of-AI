// Real browser + Vite proxy + real SDK, with a mocked Google HTTP transport.
// No real API key, external Gemini calls, or user browser profile is used.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const base = process.env.APP_URL || 'http://127.0.0.1:5173/accounting-of-AI/';
const output = process.env.ARTIFACT_DIR || '/tmp/gemini-writing-proof';
fs.mkdirSync(output, { recursive: true });
(async () => {
  const { createAiServer } = await import(pathToFileURL(path.resolve(__dirname, '../../server/app.mjs')));
  const { createGeminiProvider } = await import(pathToFileURL(path.resolve(__dirname, '../../server/gemini.mjs')));
  let mode = 'success'; let calls = 0;
  const testKey = 'not-a-real-key-for-browser-tests';
  const proposedText = 'テスト応答：体験の流れと展示で伝える文章を整理した。';
  const provider = createGeminiProvider({ apiKey: testKey, model: 'gemini-test-model', fetchImpl: async (_url, options) => {
    calls++;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, mode === 'slow' ? 1500 : 200);
      options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
    });
    return mode === 'quota' ? Response.json({ error: { message: 'private upstream message' } }, { status: 429 })
      : Response.json({ id: 'test-response', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: proposedText }] }] });
  } });
  const server = createAiServer({ providerFactory: ({ apiKey, model }) => { assert.equal(apiKey, testKey); assert.equal(model, 'gemini-test-model'); return provider; } });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(8787, '127.0.0.1', resolve); });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const p = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; const sent = [];
    p.on('pageerror', e => errors.push(e.message));
    p.on('request', r => { if (r.url().endsWith('/api/ai/rewrite')) sent.push({ headers: r.headers(), body: r.postDataJSON() }); });
    p.setDefaultTimeout(10000);
    p.setDefaultNavigationTimeout(30000);
    await p.goto(base);
    await p.getByRole('button', { name: 'AI設定を開く', exact: true }).click();
    const settings = p.getByRole('dialog', { name: 'AI設定', exact: true });
    await settings.getByLabel('Gemini APIキー', { exact: true }).fill(testKey);
    await settings.getByLabel('Geminiモデル', { exact: true }).fill('gemini-test-model');
    await settings.getByRole('button', { name: 'この画面で使う', exact: true }).click();
    assert.equal(await settings.getByLabel('Gemini APIキー', { exact: true }).inputValue(), '');
    assert.equal(calls, 0);
    await settings.screenshot({ path: path.join(output, 'api-key-settings.png') });
    await settings.getByRole('button', { name: '閉じる', exact: true }).click();
    await p.getByRole('navigation', { name: '画面切り替え' }).getByRole('button', { name: 'レシート', exact: true }).click();
    await p.getByRole('button', { name: 'サンプル会話を読み込む', exact: true }).click();
    const panel = p.locator('.ai-writing-panel'); await panel.waitFor();
    const original = p.getByLabel('AIが足したこと', { exact: true });
    const originalText = await original.inputValue();
    const storage = () => p.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
    const before = await storage();
    const role = await p.getByLabel('AIに求めた役割', { exact: true }).inputValue();
    const balance = await p.getByLabel('思考残高', { exact: true }).inputValue();
    const send = panel.getByRole('button', { name: 'Geminiに送信して文章を整える', exact: true });
    assert.equal(calls, 0, 'opening a candidate must not automatically send data');
    await send.click();
    await panel.getByRole('status').filter({ hasText: '応答を待っています' }).waitFor();
    await panel.getByLabel('生成した文章', { exact: true }).waitFor().catch(async error => {
      console.error('AI panel failure (isolated test data only):', { sdkCalls: calls, panel: await panel.innerText() });
      throw error;
    });
    assert.equal(await panel.getByLabel('生成した文章').inputValue(), proposedText);
    assert.equal(await original.inputValue(), originalText);
    assert.deepEqual(await storage(), before, 'generation must not save data');
    await panel.getByRole('button', { name: '生成した文章を破棄する', exact: true }).click();
    assert.equal(await original.inputValue(), originalText);

    await send.click(); await panel.getByLabel('生成した文章').waitFor();
    for (const width of [320, 390, 768]) {
      await p.setViewportSize({ width, height: 844 });
      assert.ok(await p.locator('.screen').evaluate(e => e.scrollWidth <= e.clientWidth), `no horizontal overflow at ${width}px`);
    }
    await p.setViewportSize({ width: 390, height: 844 });
    await panel.screenshot({ path: path.join(output, 'gemini-writing-preview.png') });
    await panel.getByRole('button', { name: 'この文章を候補に反映する', exact: true }).click();
    assert.equal(await original.inputValue(), proposedText);
    assert.deepEqual(await storage(), before, 'applying to draft must not save data');
    assert.equal(await p.getByLabel('AIに求めた役割', { exact: true }).inputValue(), role);
    assert.equal(await p.getByLabel('思考残高', { exact: true }).inputValue(), balance);

    await original.fill(''); assert.equal(await send.isDisabled(), true);
    await original.fill('x'.repeat(6001)); assert.equal(await send.isDisabled(), true);
    await panel.getByRole('alert').filter({ hasText: '6000文字以内' }).waitFor();
    await original.fill(originalText);
    mode = 'quota'; await send.click();
    await panel.getByRole('alert').filter({ hasText: '利用上限' }).waitFor();
    assert.equal(await original.inputValue(), originalText);
    assert.equal(await panel.getByLabel('生成した文章').count(), 0);
    mode = 'slow'; await send.click();
    await panel.getByRole('button', { name: '生成を中止する', exact: true }).click();
    await panel.getByRole('status').filter({ hasText: '生成を中止' }).waitFor();
    assert.equal(await original.inputValue(), originalText);
    await send.click(); await panel.getByRole('status').filter({ hasText: '応答を待っています' }).waitFor();
    await original.fill('編集中の新しい文章');
    await p.waitForTimeout(1700); // A stale provider reply must never reappear.
    assert.equal(await panel.getByLabel('生成した文章').count(), 0);
    assert.equal(await original.inputValue(), '編集中の新しい文章');

    await send.click(); await panel.getByRole('status').filter({ hasText: '応答を待っています' }).waitFor();
    await p.getByRole('button', { name: 'AI設定を開く', exact: true }).first().click();
    await settings.getByRole('button', { name: 'キーを削除する', exact: true }).click();
    await settings.getByRole('button', { name: '閉じる', exact: true }).click();
    await p.waitForTimeout(1700);
    assert.equal(await send.isDisabled(), true);
    assert.equal(await panel.getByLabel('生成した文章').count(), 0, 'deleting a key discards pending responses');
    await p.getByRole('button', { name: 'AI設定を開く', exact: true }).first().click();
    await settings.getByLabel('Gemini APIキー', { exact: true }).fill(testKey);
    await settings.getByLabel('Geminiモデル', { exact: true }).fill('gemini-test-model');
    await settings.getByRole('button', { name: 'この画面で使う', exact: true }).click();
    await settings.getByRole('button', { name: '閉じる', exact: true }).click();
    mode = 'success'; await panel.getByLabel('整える項目').selectOption('topic');
    await send.click(); await panel.getByLabel('生成した文章').waitFor();
    assert.equal(sent.at(-1).body.text, await p.getByLabel('相談テーマ', { exact: true }).inputValue());
    await panel.getByRole('button', { name: '生成した文章を破棄する', exact: true }).click();
    await panel.getByLabel('整える項目').selectOption('aiAdded');
    await send.click(); await panel.getByLabel('生成した文章').waitFor();
    await panel.getByRole('button', { name: 'この文章を候補に反映する', exact: true }).click();
    await p.getByRole('button', { name: 'レシートを発行する', exact: true }).click();
    await p.getByRole('button', { name: '帳簿に保存する', exact: true }).click();
    await p.getByRole('button', { name: '帳簿に保存する', exact: true }).click();
    const ledger = await p.evaluate(() => JSON.parse(localStorage.getItem('thinkingLedger')));
    assert.equal(ledger.length, 1); assert.equal(ledger[0].aiAdded, proposedText);
    assert.equal(ledger[0].aiRole, role); assert.equal(ledger[0].thinkingBalance, balance);
    for (const request of sent) {
      assert.deepEqual(Object.keys(request.body).sort(), ['instruction', 'text']);
      assert.equal(request.headers.authorization, `Bearer ${testKey}`);
      assert.equal(request.headers['x-gemini-model'], 'gemini-test-model');
      assert.ok(!JSON.stringify(request.body).includes(testKey), 'keys must not enter the receipt payload');
      assert.equal(request.headers['x-goog-api-key'], undefined);
    }
    assert.ok(!JSON.stringify(await storage()).includes(testKey));
    assert.ok(!await p.evaluate(key => JSON.stringify(Object.fromEntries(Object.entries(sessionStorage))).includes(key), testKey));
    await p.getByRole('button', { name: 'AI設定を開く', exact: true }).first().click();
    await settings.getByRole('button', { name: 'キーを削除する', exact: true }).click();
    await settings.getByText('APIキー：未設定', { exact: true }).waitFor();
    await settings.getByLabel('Gemini APIキー', { exact: true }).fill(testKey);
    await settings.getByRole('button', { name: 'この画面で使う', exact: true }).click();
    await settings.getByRole('button', { name: '閉じる', exact: true }).click();
    const saved = await storage();
    await p.reload();
    await p.getByRole('button', { name: 'AI設定を開く', exact: true }).first().click();
    await settings.getByText('APIキー：未設定', { exact: true }).waitFor();
    assert.deepEqual(await storage(), saved, 'reload clears key without losing ledger');
    assert.deepEqual(errors, []);
    console.log('PASS: browser → Vite proxy → server → real SDK with mocked Interactions; opt-in send, loading, preview/discard/apply, no automatic storage, save without duplicates, other definitions preserved, quota/cancel/stale-response/empty/length checks, 320–768px; per-user API header, no persistent key, delete and reload clearing.');
  } finally {
    await browser.close();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
