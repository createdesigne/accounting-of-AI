// Run against a built preview server. Chrome API calls are simulated at the
// boundary; the shipped popup, DOM extractor, receiver and ledger UI run as-is.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { providers, conversationMarkup } = require('./aiConversationFixtures.cjs');
const root = path.resolve(__dirname, '../..');
const base = process.env.APP_URL || 'http://127.0.0.1:4173/accounting-of-AI/';
const artifacts = process.env.ARTIFACT_DIR || '/tmp/accounting-extension-proof';
fs.mkdirSync(artifacts, { recursive: true });
const source = ts.createSourceFile('App.tsx', fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function existingFixture(name) {
  let result;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) result = vm.runInNewContext('(' + node.initializer.getText(source) + ')');
    ts.forEachChild(node, visit);
  }
  visit(source); return JSON.parse(JSON.stringify(result));
}
const provider = process.env.AI_PROVIDER || 'ChatGPT';
const extensionVersion = JSON.parse(fs.readFileSync(path.join(root, 'chrome-extension/manifest.json'), 'utf8')).version;
const demo = { ...existingFixture('demoConversation'), aiService: provider };
const samples = existingFixture('sampleThinkingLedgerReceipts');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Tokyo', acceptDownloads: true });
    const errors = []; context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
    await context.addInitScript(samples => { if (location.hostname === '127.0.0.1' && localStorage.getItem('thinkingLedger') === null) localStorage.setItem('thinkingLedger', JSON.stringify(samples)); }, samples);
    const ai = await context.newPage();
    let markup = conversationMarkup(provider, demo.messages, demo.conversationTitle);
    if (provider === 'ChatGPT' && process.env.CHATGPT_LAYOUT === 'alternate') {
      markup = '<main hidden></main>' + markup.replaceAll('<article data-message-author-role=', '<article data-turn=');
    }
    await ai.route(providers[provider].url, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: markup }));
    await ai.goto(providers[provider].url);
    const popup = await context.newPage(); let sentUrl;
    await popup.exposeFunction('testQuery', () => [{ id: 1, url: ai.url(), title: demo.conversationTitle }]);
    await popup.exposeFunction('testExecute', async fn => [{ result: await ai.evaluate(`(${fn})()`) }]);
    await popup.exposeFunction('testCreate', ({ url }) => { sentUrl = url; });
    await popup.addInitScript(version => {
      window.chrome = Object.assign(window.chrome || {}, { runtime: { getManifest: () => ({ version }) }, tabs: { query: () => window.testQuery(), create: args => window.testCreate(args) }, scripting: { executeScript: args => window.testExecute(args.func.toString()) } });
    }, extensionVersion);
    const popupUrl = new URL('/extension-proof/popup.html', base).href;
    await popup.route(popupUrl, r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(root, 'chrome-extension/popup.html'), 'utf8') }));
    await popup.route(new URL('popup.js', popupUrl).href, r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(root, 'chrome-extension/popup.js'), 'utf8') }));
    await popup.goto(popupUrl);
    assert.equal(await popup.locator('#version').textContent(), 'バージョン ' + extensionVersion);
    assert.equal(await popup.getByLabel('送信先').inputValue(), 'production');
    await popup.getByLabel('送信先').selectOption('local');
    await popup.getByRole('button', { name: '思考レシート化する', exact: true }).click();
    await popup.getByRole('status').filter({ hasText: 'Webアプリを開きました。' }).waitFor();
    const url = new URL(sentUrl); assert.equal(url.search, '');
    const raw = JSON.parse(new URLSearchParams(url.hash.slice(1)).get('draft'));
    assert.deepEqual(raw.messages, demo.messages);
    assert.equal(raw.aiService, provider);
    const app = await context.newPage(); await app.clock.setFixedTime(new Date('2026-10-21T03:00:00Z'));
    await app.goto(base + url.hash);
    await app.getByLabel('相談テーマ', { exact: true }).waitFor();
    assert.equal(await app.getByLabel('相談テーマ', { exact: true }).inputValue(), demo.conversationTitle);
    assert.equal(await app.getByLabel('使用AI', { exact: true }).inputValue(), provider);
    assert.equal(new URL(app.url()).hash, '');
    assert.deepEqual(await app.evaluate(() => JSON.parse(localStorage.getItem('thinkingLedger'))), samples);
    for (const width of [320, 390, 768]) {
      await app.setViewportSize({ width, height: 844 });
      assert.ok(await app.locator('.screen').evaluate(e => e.scrollWidth <= e.clientWidth));
    }
    await app.setViewportSize({ width: 390, height: 844 });
    await app.screenshot({ path: path.join(artifacts, 'extension-candidate-' + provider.toLowerCase() + '.png') });
    await app.getByLabel('AIに求めた役割', { exact: true }).selectOption('先生');
    await app.getByRole('button', { name: 'レシートを発行する', exact: true }).click();
    await app.getByRole('button', { name: '帳簿に保存する', exact: true }).click();
    await app.getByRole('button', { name: '帳簿に保存する', exact: true }).click();
    const saved = await app.evaluate(() => JSON.parse(localStorage.getItem('thinkingLedger')));
    assert.equal(saved.length, samples.length + 1);
    for (const sample of samples) assert.deepEqual(saved.find(r => r.receiptNo === sample.receiptNo), sample);
    assert.equal(saved.find(r => !samples.some(s => s.receiptNo === r.receiptNo)).aiRole, '先生');
    assert.equal(saved.find(r => !samples.some(s => s.receiptNo === r.receiptNo)).aiService, provider);
    await app.getByRole('navigation', { name: '画面切り替え' }).getByRole('button', { name: '決算', exact: true }).click();
    for (const [label, expected] of [['週間', '1件'], ['月間', '1件'], ['年間', '6件']]) {
      await app.getByRole('navigation', { name: '決算の期間' }).getByRole('button', { name: label, exact: true }).click();
      assert.equal(await app.locator('.report-summary-count').textContent(), expected);
    }
    await app.goto(base);
    await app.getByRole('button', { name: '拡張機能データを読み込む', exact: true }).click();
    assert.equal(await app.getByLabel('相談テーマ', { exact: true }).inputValue(), demo.conversationTitle);
    for (const payload of ['?draft=' + encodeURIComponent(JSON.stringify(demo)), '#draft=' + encodeURIComponent(Buffer.from(JSON.stringify(demo)).toString('base64url'))]) {
      // The extension opens a new document/tab for every conversation.
      await app.goto('about:blank');
      await app.goto(base + payload);
      await app.getByLabel('相談テーマ', { exact: true }).waitFor();
      assert.equal(await app.getByLabel('使用AI', { exact: true }).inputValue(), demo.aiService);
      assert.equal(new URL(app.url()).search + new URL(app.url()).hash, '');
    }
    for (const bad of ['#draft=%7Bbroken', '?draft=%7B%22messages%22%3A%5Bnull%5D%7D', '#draft=']) {
      await app.goto('about:blank');
      await app.goto(base + bad);
      await app.getByRole('status').filter({ hasText: '会話データを読み込めませんでした' }).waitFor();
      assert.equal(await app.locator('.candidate-form').count(), 0);
      assert.equal(new URL(app.url()).search + new URL(app.url()).hash, '');
    }
    await app.getByRole('button', { name: 'レシート画面に戻る', exact: true }).click();
    const downloadPromise = app.waitForEvent('download');
    await app.getByRole('link', { name: 'Chrome拡張機能をダウンロード', exact: true }).click();
    const download = await downloadPromise; assert.equal(await download.failure(), null);
    assert.deepEqual(fs.readFileSync(await download.path()), fs.readFileSync(path.join(root, 'public/ai-thought-receipt-bridge.zip')));
    assert.deepEqual(errors, []);
    console.log(`PASS (${provider} representative markup): shipped popup + real DOM extraction + receiver/edit/issue/save; original samples unchanged; duplicate save prevented; weekly/monthly/annual reflect import; legacy URLs; malformed/empty data; 320–768px; actual ZIP download; no page errors. Chrome API boundary simulated.`);
    await context.close();
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
