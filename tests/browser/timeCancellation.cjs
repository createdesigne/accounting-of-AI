const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');

const base = process.env.APP_URL || 'http://127.0.0.1:4173/accounting-of-AI/';
const storageKey = 'watashi-to-ai-time-accounting-ledger';
const recordId = 'browser-cancel:day:2026-11-10';
const sourceEventId = `chrome-time:${recordId}`;
const entryId = `ai-usage:${recordId}`;
const initialStore = {
  storeVersion: 1,
  ledger: {
    version: 2,
    unit: 'second',
    measurements: [{
      sourceEventId,
      occurredOn: '2026-11-10',
      actualInputSeconds: 61,
      estimatedSavedSeconds: 0,
      usageEntryId: entryId,
    }],
    entries: [{
      id: entryId,
      kind: 'ai-usage',
      postedOn: '2026-11-10',
      sourceEventId,
      lines: [
        { side: 'debit', account: 'AI仮受品', seconds: 61, measurement: 'actual-input' },
        { side: 'credit', account: '時間拠出', seconds: 61, measurement: 'actual-input' },
      ],
    }],
  },
  importedRecords: [{
    recordId,
    fingerprint: JSON.stringify([recordId, 'browser-cancel', 'ChatGPT']),
    sourceEventId,
    entryId,
    importedAt: '2026-11-10T03:00:00.000Z',
  }],
};

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(({ storageKey, initialStore }) => {
      if (localStorage.getItem(storageKey) === null) {
        localStorage.setItem(storageKey, JSON.stringify(initialStore));
      }
    }, { storageKey, initialStore });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(10000);
    await page.goto(base);
    const nav = page.getByRole('navigation', { name: '画面切り替え' });
    await nav.getByRole('button', { name: '仕訳', exact: true }).click();
    await page.getByRole('button', { name: '時間仕訳', exact: true }).click();
    await page.getByText('有効な会計上の利用時間', { exact: true }).waitFor();
    await page.getByText('取り込み履歴を見る', { exact: true }).click();
    await page.locator('.time-import-history-item > summary').click();
    const before = await page.evaluate(key => localStorage.getItem(key), storageKey);
    await page.getByRole('button', { name: 'この取り込みを取り消す', exact: true }).click();
    await page.getByRole('dialog', { name: 'この取り込みを取り消しますか？', exact: true }).waitFor();
    assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), before,
      'opening the confirmation must not change accounting data');
    await page.getByRole('button', { name: '取消仕訳を追加する', exact: true }).click();
    await page.getByText('取消済み', { exact: true }).first().waitFor();

    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
    assert.equal(saved.ledger.measurements[0].actualInputSeconds, 61);
    assert.equal(saved.ledger.entries.length, 2);
    assert.deepEqual(saved.ledger.entries[0], initialStore.ledger.entries[0]);
    assert.equal(saved.ledger.entries[1].kind, 'usage-reversal');
    assert.equal(saved.ledger.entries[1].reversesEntryId, entryId);
    assert.deepEqual(saved.ledger.entries[1].lines.map(line => [line.side, line.account, line.seconds]), [
      ['debit', '時間拠出', 61],
      ['credit', 'AI仮受品', 61],
    ]);
    assert.equal(saved.importedRecords[0].reversalEntryId, saved.ledger.entries[1].id);

    await page.reload();
    await nav.getByRole('button', { name: '仕訳', exact: true }).click();
    await page.getByRole('button', { name: '時間仕訳', exact: true }).click();
    assert.equal(await page.locator('.time-journal-summary > strong').textContent(), '0分0秒');
    assert.ok((await page.locator('.time-journal-summary > small').textContent()).includes('1分1秒'));
    await page.getByText('取り込み履歴を見る', { exact: true }).click();
    await page.locator('.time-import-history-item > summary').click();
    assert.equal(await page.getByRole('button', { name: 'この取り込みを取り消す', exact: true }).count(), 0);
    const cancelledSnapshot = await page.evaluate(key => localStorage.getItem(key), storageKey);
    await page.getByRole('button', { name: '再登録する', exact: true }).click();
    await page.getByRole('dialog', { name: 'この取り込みを再登録しますか？', exact: true }).waitFor();
    assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), cancelledSnapshot,
      'opening the re-registration confirmation must not change accounting data');
    await page.getByRole('button', { name: '再登録仕訳を追加する', exact: true }).click();
    await page.getByText('再登録済み', { exact: true }).first().waitFor();

    const reregistered = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
    assert.equal(reregistered.ledger.entries.length, 3);
    assert.deepEqual(reregistered.ledger.entries.slice(0, 2), saved.ledger.entries);
    assert.equal(reregistered.ledger.entries[2].kind, 'usage-reregistration');
    assert.equal(reregistered.ledger.entries[2].restoresEntryId, saved.ledger.entries[1].id);
    assert.deepEqual(reregistered.ledger.entries[2].lines.map(line => [line.side, line.account, line.seconds]), [
      ['debit', 'AI仮受品', 61],
      ['credit', '時間拠出', 61],
    ]);
    assert.deepEqual(reregistered.importedRecords[0].actions.map(action => action.kind), [
      'cancellation', 'reregistration',
    ]);
    assert.equal(await page.locator('.time-journal-summary > strong').textContent(), '1分1秒');

    await page.reload();
    await nav.getByRole('button', { name: '仕訳', exact: true }).click();
    await page.getByRole('button', { name: '時間仕訳', exact: true }).click();
    await page.getByText('取り込み履歴を見る', { exact: true }).click();
    await page.locator('.time-import-history-item > summary').click();
    await page.getByRole('button', { name: 'この取り込みを取り消す', exact: true }).click();
    await page.getByRole('button', { name: '取消仕訳を追加する', exact: true }).click();
    await page.getByText('取消済み', { exact: true }).first().waitFor();
    const recancelled = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
    assert.equal(recancelled.ledger.entries.length, 4);
    assert.deepEqual(recancelled.ledger.entries.slice(0, 3), reregistered.ledger.entries);
    assert.equal(recancelled.ledger.entries[3].kind, 'usage-reversal');
    assert.equal(recancelled.ledger.entries[3].reversesEntryId, reregistered.ledger.entries[2].id);
    assert.equal(await page.locator('.time-journal-summary > strong').textContent(), '0分0秒');
    assert.deepEqual(errors, []);
    console.log('PASS: cancellation, explicit re-registration, persistence, append-only links and later re-cancellation.');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
