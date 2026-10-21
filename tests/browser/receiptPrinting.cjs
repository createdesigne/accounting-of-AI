// Use isolated storage and the existing samples without changing their content/dates.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const base = process.env.APP_URL || 'http://127.0.0.1:4173/accounting-of-AI/';
const output = process.env.ARTIFACT_DIR || '/tmp/accounting-receipt-print';
fs.mkdirSync(output, { recursive: true });
const source = ts.createSourceFile('App.tsx', fs.readFileSync(path.join(__dirname, '../../src/App.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let samples;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'sampleThinkingLedgerReceipts') {
    samples = JSON.parse(JSON.stringify(vm.runInNewContext(ts.transpileModule('(' + node.initializer.getText(source) + ')', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText)));
  }
  ts.forEachChild(node, visit);
}
visit(source);
const prefix = new URL(base).pathname.startsWith('/accounting-of-AI/preview/') ? 'preview-month-ledger:' : '';
const ledgerKey = prefix + 'thinkingLedger';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(({ samples, ledgerKey }) => {
      if (!localStorage.getItem(ledgerKey)) localStorage.setItem(ledgerKey, JSON.stringify(samples));
    }, { samples, ledgerKey });
    const p = await context.newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message));
    p.setDefaultTimeout(10000);
    const read = () => p.evaluate(key => JSON.parse(localStorage.getItem(key)), ledgerKey);
    const home = async () => {
      await p.getByRole('button', { name: '思考レシートを読み取る' }).waitFor();
      assert.equal(await p.locator('.issued-receipt-panel').count(), 0);
      assert.equal(new URL(p.url()).hash, '');
      assert.equal(await p.locator('#receipt-page-size').count(), 0);
    };
    async function reloadHome() {
      await p.reload();
      assert.equal(new URL(p.url()).hash, '');
      assert.equal(await p.locator('.issued-receipt-panel').count(), 0);
      // The isolated report preview intentionally opens the settlement tab on load.
      if (prefix) await p.getByRole('navigation', { name: '画面切り替え' }).getByRole('button', { name: 'レシート', exact: true }).click();
      await home();
    }
    async function printAndCheck(name) {
      await p.getByAltText('思考レシート復元用QRコード').waitFor();
      assert.equal(await p.locator('iframe').count(), 0, 'measurement frame must be removed');
      await p.evaluate(() => { window.printCalls = 0; window.print = () => window.printCalls++; });
      await p.getByRole('button', { name: '印刷する', exact: true }).click();
      assert.equal(await p.evaluate(() => window.printCalls), 1);
      // This uses Chromium's actual paged-media renderer, not the mocked print button.
      await p.emulateMedia({ media: null });
      const pdf = await p.pdf({ path: path.join(output, name + '.pdf'), preferCSSPageSize: true, displayHeaderFooter: false });
      const content = pdf.toString('latin1');
      assert.equal((content.match(/\/Type \/Page\b/g) || []).length, 1, 'no extra blank page');
      const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(content);
      assert.ok(box, 'PDF paper dimensions must exist');
      const width = Number(box[1]) * 25.4 / 72, height = Number(box[2]) * 25.4 / 72;
      assert.ok(Math.abs(width - 80) < 0.2, `paper width ${width}mm must be 80mm`);
      await p.emulateMedia({ media: 'print' });
      const panel = await p.locator('.issued-receipt-panel').boundingBox();
      const contentHeight = panel.height * 25.4 / 96;
      assert.ok(height >= contentHeight - 0.1 && height - contentHeight < 0.4, 'paper must fit content without added whitespace');
      assert.equal(panel.x, 0); assert.equal(panel.y, 0);
      const spacing = await p.locator('.issued-receipt-panel').evaluate(el => {
        const s = getComputedStyle(el);
        return [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft, s.marginTop, s.marginRight, s.marginBottom, s.marginLeft];
      });
      assert.deepEqual(spacing.slice(4), Array(4).fill('0px'), 'no added paper margins');
      for (let i = 0; i < 4; i++) {
        const expectedMm = i % 2 === 0 ? 3.5 : 3.8;
        assert.ok(Math.abs(parseFloat(spacing[i]) * 25.4 / 96 - expectedMm) < 0.01, 'retain normal receipt padding within the 80mm paper');
      }
      for (const selector of ['.receipt-home-back', '.issued-receipt-actions', '.bottom-nav']) assert.equal(await p.locator(selector).isVisible(), false);
      assert.equal(await p.getByAltText('思考レシート復元用QRコード').isVisible(), true);
      await p.locator('.issued-receipt-panel').screenshot({ path: path.join(output, name + '.png') });
      await p.emulateMedia({ media: 'screen' });
      console.log(`${name}: 1 page, ${width.toFixed(1)} × ${height.toFixed(1)}mm; content ${contentHeight.toFixed(1)}mm`);
      return height;
    }
    await p.goto(base);
    await p.getByRole('navigation', { name: '画面切り替え' }).getByRole('button', { name: 'レシート', exact: true }).click();
    await p.getByRole('button', { name: 'サンプル会話を読み込む', exact: true }).click();
    await p.getByRole('button', { name: 'レシートを発行する', exact: true }).click();
    await printAndCheck('issued-receipt');
    assert.deepEqual(await read(), samples, 'printing must not save or change records');
    for (const width of [320, 390, 430]) {
      await p.setViewportSize({ width, height: 844 });
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const back = await p.getByRole('button', { name: 'レシート画面に戻る', exact: true }).boundingBox();
      assert.ok(back.width >= 44 && back.height >= 44);
    }
    await p.setViewportSize({ width: 390, height: 844 });
    await p.locator('.screen').evaluate(el => el.scrollTop = 0);
    await p.screenshot({ path: path.join(output, 'receipt-home-return.png'), fullPage: true });
    await p.getByRole('button', { name: 'レシート画面に戻る', exact: true }).click();
    await home(); assert.deepEqual(await read(), samples, 'returning without saving must not write a receipt');
    await reloadHome();

    const heights = [];
    for (let i = 0; i < samples.length; i++) {
      const url = base + '#receipt=' + Buffer.from(JSON.stringify(samples[i])).toString('base64url');
      await p.goto(url);
      await p.reload(); // QR restoration is intentionally performed on page load.
      heights.push(await printAndCheck('sample-' + (i + 1)));
      if (i === 0) {
        await p.getByRole('button', { name: '帳簿に保存する', exact: true }).click();
        await p.getByText('帳簿に保存しました。', { exact: true }).waitFor();
        assert.deepEqual(await read(), samples, 'saving an existing receipt must not duplicate it');
        const nav = p.getByRole('navigation', { name: '画面切り替え' });
        await nav.getByRole('button', { name: '帳簿', exact: true }).click();
        await nav.getByRole('button', { name: 'レシート', exact: true }).click();
      } else {
        await p.getByRole('button', { name: 'レシート画面に戻る', exact: true }).click();
      }
      await home(); await reloadHome();
      assert.deepEqual(await read(), samples);
    }
    assert.ok(new Set(heights).size > 1, 'paper length must follow different existing receipt contents');
    assert.deepEqual(errors, []);
    await context.close();
    console.log('PASS: native 80mm PDF sizing/content length with normal receipt padding, one page, no browser controls, QR preserved; explicit return, bottom-tab return, restored URL cleanup/reload; no unintended writes or duplicate samples; 320–430px.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
