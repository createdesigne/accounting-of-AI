// Isolated browser profiles only: existing sample definitions are read as-is.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const base = process.env.APP_URL || 'http://127.0.0.1:4173/accounting-of-AI/';
const output = process.env.ARTIFACT_DIR || '/tmp/accounting-journal-audit';
fs.mkdirSync(output, { recursive: true });
const tree = ts.createSourceFile('App.tsx', fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function fixture(name) {
  let result;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) result = vm.runInNewContext(ts.transpileModule('(' + node.initializer.getText(tree) + ')', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText);
    ts.forEachChild(node, visit);
  }
  visit(tree); return JSON.parse(JSON.stringify(result));
}
const sample = fixture('sampleScannedReceipt');
const ledger = fixture('sampleThinkingLedgerReceipts');
const categories = fixture('journalCategories');
const prefix = new URL(base).pathname.startsWith('/accounting-of-AI/preview/') ? 'preview-month-ledger:' : '';
const key = prefix + 'watashi-to-ai-thought-receipts';
const ledgerKey = prefix + 'thinkingLedger';
const journalTotal = receipts => receipts.reduce((sum, receipt) => sum + categories.reduce((n, c) => n + (receipt.journal?.[c.key]?.amount || 0), 0), 0);
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(({ ledger, ledgerKey }) => { if (localStorage.getItem(ledgerKey) === null) localStorage.setItem(ledgerKey, JSON.stringify(ledger)); }, { ledger, ledgerKey });
    const p = await context.newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message));
    p.setDefaultTimeout(10000);
    await p.goto(base);
    const nav = p.getByRole('navigation', { name: '画面切り替え' });
    const goHome = () => nav.getByRole('button', { name: 'レシート', exact: true }).click();
    const read = () => p.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
    async function preview() {
      await goHome(); await p.getByRole('button', { name: '思考レシートを読み取る' }).click();
      const scanBox = await p.locator('.reader-modal').boundingBox();
      assert.ok(scanBox.y >= 0 && scanBox.y + scanBox.height <= p.viewportSize().height);
      await p.getByRole('button', { name: 'サンプルレシートを読み込む', exact: true }).click();
      await p.getByRole('heading', { name: '読み取り内容の確認', exact: true }).waitFor();
      const confirmBox = await p.locator('.reader-modal').boundingBox();
      assert.ok(confirmBox.y >= 0 && confirmBox.y + confirmBox.height <= p.viewportSize().height);
    }
    async function setAmounts(values) {
      for (let i = 0; i < categories.length; i++) {
        const slider = p.getByRole('slider', { name: categories[i].label, exact: true });
        assert.equal(await slider.getAttribute('min'), '1'); assert.equal(await slider.getAttribute('max'), '5');
        await slider.focus(); await slider.press('Home'); await slider.press('ArrowLeft'); assert.equal(await slider.inputValue(), '1');
        await slider.press('End'); await slider.press('ArrowRight'); assert.equal(await slider.inputValue(), '5');
        await slider.press('Home');
        for (let n = 1; n < values[i]; n++) await slider.press('ArrowRight');
        assert.equal(await slider.inputValue(), String(values[i]));
        assert.equal(await p.locator('.journal-confirm-line output').nth(i).textContent(), String(values[i]));
      }
    }
    await nav.waitFor(); await goHome();
    await p.getByRole('button', { name: '思考レシートを読み取る' }).waitFor();
    const before = await read();
    await preview(); assert.equal(await p.getByRole('slider').count(), 5);
    for (const category of categories) {
      const unit = sample.journal[category.key];
      assert.equal(await p.locator(`#preview-journal-${category.key}-hint`).textContent(), unit.tags ? unit.tags.join(' / ') : unit.text);
    }
    await setAmounts([1, 2, 3, 4, 5]); assert.deepEqual(await read(), before);
    await p.getByRole('button', { name: '保存せず戻る', exact: true }).click(); assert.deepEqual(await read(), before);
    await preview();
    for (let i = 0; i < categories.length; i++) assert.equal(await p.getByRole('slider', { name: categories[i].label, exact: true }).inputValue(), String(sample.journal[categories[i].key].amount));
    await setAmounts([1, 2, 3, 4, 5]);
    for (const width of [320, 390, 768]) {
      await p.setViewportSize({ width, height: 844 });
      assert.ok(await p.locator('.reader-modal').evaluate(e => e.scrollWidth <= e.clientWidth));
      for (const slider of await p.getByRole('slider').all()) assert.ok((await slider.boundingBox()).height >= 44);
    }
    await p.setViewportSize({ width: 390, height: 844 });
    await p.locator('.confirm-journal').scrollIntoViewIfNeeded();
    await p.screenshot({ path: path.join(output, 'journal-sliders.png') });
    await p.getByRole('button', { name: '思考帳簿に保存', exact: true }).click();
    assert.equal(await p.getByRole('dialog').count(), 0);
    let saved = await read(); assert.equal(saved.length, before.length + 1);
    const added = saved.find(r => r.id === sample.id);
    for (let i = 0; i < categories.length; i++) {
      const c = categories[i]; assert.equal(added.journal[c.key].amount, i + 1);
      if (sample.journal[c.key].tags) assert.deepEqual(added.journal[c.key].tags, sample.journal[c.key].tags);
      else assert.equal(added.journal[c.key].text, sample.journal[c.key].text);
    }
    for (const old of before) assert.deepEqual(saved.find(r => r.id === old.id), old);
    assert.equal(await p.locator('.journal-summary-card > strong').textContent(), String(journalTotal(before) + 15));
    assert.deepEqual(await p.evaluate(ledgerKey => JSON.parse(localStorage.getItem(ledgerKey)), ledgerKey), ledger);
    await p.getByRole('button').filter({ hasText: sample.topic }).first().click();
    await p.getByRole('heading', { name: '思考仕訳明細', exact: true }).waitFor();
    const detailValues = await p.locator('.journal-detail-row').evaluateAll(rows => rows.map(r => r.querySelector(':scope > span')?.textContent.replace('思考量 ', '')));
    assert.deepEqual(detailValues, ['1', '2', '3', '4', '5']);
    await p.getByRole('button', { name: '仕訳に戻る', exact: true }).click();
    await p.reload(); await preview();
    assert.equal(await p.getByRole('slider', { name: 'AI借入', exact: true }).inputValue(), '1');
    await p.getByRole('slider', { name: 'AI借入', exact: true }).press('End');
    await p.getByRole('button', { name: '思考帳簿に保存', exact: true }).click();
    saved = await read(); assert.equal(saved.length, before.length + 1);
    assert.equal(saved.filter(r => r.id === sample.id).length, 1); assert.equal(saved.find(r => r.id === sample.id).journal.aiBorrowing.amount, 5);
    assert.equal(await p.locator('.journal-summary-card > strong').textContent(), String(journalTotal(before) + 19));
    await goHome(); const timeBefore = await p.locator('.hero-total > span').textContent();
    await p.locator('.hero-total').click();
    await p.getByRole('dialog', { name: 'AIスクリーンタイム', exact: true }).waitFor();
    assert.equal(await p.locator('.screen-time-total').textContent(), timeBefore);
    assert.ok(await p.locator('.monthly-bars .month-col').count() >= 4);
    for (const width of [320, 390, 768]) {
      await p.setViewportSize({ width, height: 844 });
      assert.ok(await p.locator('.reader-modal').evaluate(e => e.scrollWidth <= e.clientWidth));
      const graph = await p.locator('.monthly-bars').boundingBox();
      const note = await p.locator('.screen-time-chart > p').boundingBox();
      assert.ok(graph.y + graph.height <= note.y);
    }
    await p.setViewportSize({ width: 390, height: 844 });
    await p.keyboard.press('Escape'); assert.equal(await p.getByRole('dialog').count(), 0);
    for (const label of ['よく相談した科目', 'AIに求めた役割', '自己判断残高']) {
      await goHome(); await p.locator('.summary-row').filter({ hasText: label }).click();
      assert.ok(await p.locator('.receipt-row').count() > 0);
      await p.locator('.receipt-row').first().click(); await p.getByText('思考レシート詳細', { exact: true }).waitFor();
      await p.getByRole('button', { name: '一覧に戻る', exact: true }).first().click();
      await p.getByRole('button', { name: 'レシートに戻る', exact: true }).first().click();
    }
    await goHome(); await p.getByRole('button', { name: 'サンプル会話を読み込む', exact: true }).click();
    await p.getByLabel('相談テーマ', { exact: true }).waitFor(); assert.deepEqual(await read(), saved);
    await p.getByRole('button', { name: 'レシートを発行する', exact: true }).click();
    await p.getByAltText('思考レシート復元用QRコード').waitFor();
    await p.evaluate(() => { window.testPrintCalls = 0; window.print = () => window.testPrintCalls++; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Denied'); } } }); });
    await p.getByRole('button', { name: '印刷する', exact: true }).click(); assert.equal(await p.evaluate(() => window.testPrintCalls), 1);
    await p.getByRole('button', { name: '共有URLをコピーする', exact: true }).click();
    const fallback = p.getByRole('textbox', { name: '復元URL', exact: true }); await fallback.waitFor();
    const shared = await fallback.inputValue(); assert.ok(new URL(shared).hash.startsWith('#receipt='));
    await fallback.focus(); assert.ok(await fallback.evaluate(e => e.selectionStart === 0 && e.selectionEnd === e.value.length));
    await p.emulateMedia({ media: 'print' }); assert.equal(await fallback.isVisible(), false); await p.emulateMedia({ media: 'screen' });
    const restored = await context.newPage(); await restored.goto(shared);
    await restored.getByRole('button', { name: '帳簿に保存する', exact: true }).waitFor();
    assert.deepEqual(await restored.evaluate(ledgerKey => JSON.parse(localStorage.getItem(ledgerKey)), ledgerKey), ledger);
    await restored.getByRole('button', { name: '帳簿に保存する', exact: true }).click();
    assert.equal(await restored.evaluate(ledgerKey => JSON.parse(localStorage.getItem(ledgerKey)).length, ledgerKey), ledger.length + 1);
    if (prefix) {
      assert.equal(await p.evaluate(() => localStorage.getItem('thinkingLedger')), null);
      assert.equal(await p.evaluate(() => localStorage.getItem('watashi-to-ai-thought-receipts')), null);
    }
    assert.deepEqual(await read(), saved);
    assert.deepEqual(errors, []); await context.close();

    const blocked = await browser.newContext(); const q = await blocked.newPage(); await q.goto(base);
    await q.getByRole('navigation', { name: '画面切り替え' }).getByRole('button', { name: 'レシート', exact: true }).click();
    await q.getByRole('button', { name: '思考レシートを読み取る' }).click();
    await q.getByRole('button', { name: 'サンプルレシートを読み込む', exact: true }).click();
    const storedBefore = await q.evaluate(key => localStorage.getItem(key), key);
    await q.getByRole('slider', { name: 'AI借入', exact: true }).focus(); await q.keyboard.press('Home');
    await q.evaluate(key => { const original = Storage.prototype.setItem; window.restoreTestWrites = () => Storage.prototype.setItem = original; Storage.prototype.setItem = function(k, v) { if (k === key) throw new DOMException('Full', 'QuotaExceededError'); return original.call(this, k, v); }; }, key);
    await q.getByRole('button', { name: '思考帳簿に保存', exact: true }).click();
    await q.getByRole('alert').filter({ hasText: '保存できませんでした' }).waitFor();
    assert.equal(await q.getByRole('slider', { name: 'AI借入', exact: true }).inputValue(), '1');
    assert.equal(await q.evaluate(key => localStorage.getItem(key), key), storedBefore);
    await q.evaluate(() => window.restoreTestWrites()); await q.getByRole('button', { name: '思考帳簿に保存', exact: true }).click();
    assert.equal(await q.evaluate(({ key, id }) => JSON.parse(localStorage.getItem(key)).find(r => r.id === id)?.journal.aiBorrowing.amount, { key, id: sample.id }), 1);
    await blocked.close();
    console.log('PASS: all five 1–5 sliders, keyboard/bounds, staged changes/cancel, save/reload/re-save without duplicates, exact journal totals/tags/details, original samples and other ledger unchanged; home filters/details/time modal; sample conversation/issue/QR restore; print invocation and clipboard failure fallback; 320–768px; quota failure retains draft and retry saves.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
