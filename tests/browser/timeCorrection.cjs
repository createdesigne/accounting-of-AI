const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');

const base = process.env.APP_URL || 'http://127.0.0.1:4173/accounting-of-AI/';
const storageKey = 'watashi-to-ai-time-accounting-ledger';
const recordId = 'browser-correction:day:2026-11-10';
const sourceEventId = `chrome-time:${recordId}`;
const entryId = `ai-usage:${recordId}`;
const initialStore = {
  storeVersion: 1,
  ledger: {
    version: 2, unit: 'second',
    measurements: [{ sourceEventId, occurredOn: '2026-11-10', actualInputSeconds: 61, estimatedSavedSeconds: 0, usageEntryId: entryId }],
    entries: [{
      id: entryId, kind: 'ai-usage', postedOn: '2026-11-10', sourceEventId,
      lines: [
        { side: 'debit', account: 'AI仮受品', seconds: 61, measurement: 'actual-input' },
        { side: 'credit', account: '時間拠出', seconds: 61, measurement: 'actual-input' },
      ],
    }],
  },
  importedRecords: [{
    recordId, fingerprint: JSON.stringify([recordId, 'browser-correction', 'ChatGPT']),
    sourceEventId, entryId, importedAt: '2026-11-10T03:00:00.000Z',
  }],
};

async function openHistory(page) {
  const nav = page.getByRole('navigation', { name: '画面切り替え' });
  await nav.getByRole('button', { name: '仕訳', exact: true }).click();
  await page.getByRole('button', { name: '時間仕訳', exact: true }).click();
  await page.getByText('取り込み履歴を見る', { exact: true }).click();
  await page.locator('.time-import-history-item > summary').click();
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(({ storageKey, initialStore }) => {
      if (localStorage.getItem(storageKey) === null) localStorage.setItem(storageKey, JSON.stringify(initialStore));
    }, { storageKey, initialStore });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(10000);
    await page.goto(base);
    await openHistory(page);

    const before = await page.evaluate(key => localStorage.getItem(key), storageKey);
    await page.getByRole('button', { name: '利用時間を訂正する', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '有効な利用時間を訂正しますか？', exact: true });
    await dialog.waitFor();
    assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), before,
      'opening correction confirmation must not change accounting data');
    await dialog.getByLabel('新しい利用時間（秒）').fill('45');
    await dialog.getByLabel('訂正理由（任意）').fill('休憩を除外');
    await dialog.getByRole('button', { name: '差分の訂正仕訳を追加する', exact: true }).click();
    await page.getByText('45秒', { exact: true }).first().waitFor();

    let saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
    assert.equal(saved.ledger.measurements[0].actualInputSeconds, 61);
    assert.equal(saved.ledger.measurements[0].effectiveInputSeconds, 45);
    assert.equal(saved.ledger.entries.length, 2);
    assert.equal(saved.ledger.entries[1].kind, 'usage-correction');
    assert.deepEqual(saved.ledger.entries[1].lines.map(line => [line.account, line.seconds]), [
      ['時間拠出', 16], ['AI仮受品', 16],
    ]);
    assert.equal(saved.importedRecords[0].actions[0].reason, '休憩を除外');

    await page.reload();
    await openHistory(page);
    assert.equal(await page.locator('.time-journal-summary > strong').textContent(), '0分45秒');
    assert.ok((await page.locator('.history-action').textContent()).includes('61秒 → 45秒'));
    await page.getByRole('button', { name: '利用時間を訂正する', exact: true }).click();
    const secondDialog = page.getByRole('dialog', { name: '有効な利用時間を訂正しますか？', exact: true });
    await secondDialog.getByLabel('新しい利用時間（秒）').fill('90');
    await secondDialog.getByRole('button', { name: '差分の訂正仕訳を追加する', exact: true }).click();
    await page.getByText('1分30秒', { exact: true }).first().waitFor();
    saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
    assert.equal(saved.ledger.measurements[0].actualInputSeconds, 61);
    assert.equal(saved.ledger.measurements[0].effectiveInputSeconds, 90);
    assert.equal(saved.ledger.entries[2].effectiveSecondsBefore, 45);
    assert.equal(saved.ledger.entries[2].effectiveSecondsAfter, 90);
    assert.deepEqual(saved.ledger.entries[2].lines.map(line => [line.account, line.seconds]), [
      ['AI仮受品', 45], ['時間拠出', 45],
    ]);
    assert.deepEqual(errors, []);
    console.log('PASS: partial decrease/increase correction, raw-time preservation and reload history.');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
