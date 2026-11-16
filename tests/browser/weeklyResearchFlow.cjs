// Isolated browser + mocked Gemini provider. No real key, billable request, or user data.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');

const base = process.env.APP_URL || 'http://127.0.0.1:5174/accounting-of-AI/';
const fakeKey = 'research-flow-browser-key-not-real';
const model = 'gemini-research-flow-mock';
const rawConversation = {
  aiService: 'ChatGPT',
  url: 'https://chatgpt.com/c/browser-research-flow',
  capturedAt: '2026/11/16 10:15',
  conversationTitle: '研究設計の壁打ち',
  messages: [
    { role: 'user', text: '案Aと案Bの違いを整理してください。' },
    { role: 'assistant', text: '案Aは速さ、案Bは検証可能性を重視します。' },
    { role: 'user', text: '根拠を確認して案Bを選びます。' },
  ],
};
const timeRecord = {
  recordId: 'browser-research-session:day:2026-11-16',
  sessionId: 'browser-research-session',
  provider: 'ChatGPT',
  localDate: '2026-11-16',
  timeZone: 'Asia/Tokyo',
  startedAt: Date.parse('2026-11-16T10:00:00+09:00'),
  endedAt: Date.parse('2026-11-16T10:12:00+09:00'),
  durationSeconds: 720,
};

(async () => {
  const [{ createAiServer }, { createWeeklySuccessResponse }] = await Promise.all([
    import('../../server/app.mjs'),
    import('../../server/weekly-analysis-contract.mjs'),
  ]);
  let analysisCalls = 0;
  const api = createAiServer({ providerFactory: ({ apiKey, model: selectedModel }) => {
    assert.equal(apiKey, fakeKey);
    assert.equal(selectedModel, model);
    return {
      rewrite: async input => ({ text: input.text }),
      analyzeWeekly: async request => {
        analysisCalls += 1;
        const targets = ['activity-category', 'account-candidate', 'accounting-disposition', 'ai-role', 'collaboration-behavior', 'initiative', 'reasoning', 'critical-judgment', 'thinking-change', 'discovery'];
        return createWeeklySuccessResponse(request, {
          activityCategory: '壁打ち',
          accountCandidate: '思考探究費',
          accountingDispositionCandidate: 'expense',
          aiRole: '比較軸を示す整理役',
          collaborationBehaviors: [{ kind: 'comparison', description: 'AIが比較軸を示し、本人が採否を判断した' }],
          initiative: 75,
          reasoning: 75,
          criticalJudgment: 50,
          thinkingChange: '速度だけでなく検証可能性も確認した',
          discovery: '比較軸を先に決めると判断しやすい',
          evidence: targets.map(target => ({ target, conversationId: request.conversationId, messageIndex: 0, quote: request.messages[0].text })),
        }, { model: selectedModel, analysisId: `browser-flow:${request.requestId}`, now: new Date('2026-11-16T03:00:00Z') });
      },
    };
  }});
  await new Promise((resolve, reject) => { api.once('error', reject); api.listen(8787, '127.0.0.1', resolve); });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 }, timezoneId: 'Asia/Tokyo' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(15000);
    await page.clock.setFixedTime(new Date('2026-11-16T04:00:00Z'));
    const url = new URL(base);
    url.hash = new URLSearchParams({ draft: JSON.stringify(rawConversation) }).toString();
    await page.goto(url.href);

    // Simulate only the extension content-script boundary: deliver finalized time
    // and acknowledge the app after its atomic local save.
    await page.evaluate(record => {
      window.addEventListener('message', event => {
        if (event.source !== window || event.data?.type !== 'AI_TIME_RECORDS_IMPORT_ACK') return;
        window.postMessage({
          source: 'ai-time-record-extension',
          type: 'AI_TIME_RECORDS_IMPORT_ACK_RESULT',
          requestId: event.data.payload.requestId,
          ok: true,
        }, window.location.origin);
      });
      window.postMessage({
        source: 'ai-time-record-extension',
        type: 'AI_TIME_RECORDS_PREVIEW',
        payload: { protocol: 'ai-time-records-preview-v1', requestId: 'browser-time-transfer', records: [record] },
      }, window.location.origin);
    }, timeRecord);
    await page.getByRole('button', { name: '会計に取り込む', exact: true }).click();
    await page.getByText('1件・合計12分0秒を時間会計へ取り込みました。', { exact: true }).waitFor();

    await page.getByRole('button', { name: 'AI設定を開く', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'AI設定', exact: true });
    await settings.getByLabel('Gemini APIキー', { exact: true }).fill(fakeKey);
    await settings.getByLabel('Geminiモデル', { exact: true }).fill(model);
    await settings.getByRole('button', { name: 'この画面で使う', exact: true }).click();
    await settings.getByRole('button', { name: '閉じる', exact: true }).click();

    await page.getByRole('navigation', { name: '画面切り替え' }).getByRole('button', { name: '記録', exact: true }).click();
    const weeklyNav = page.getByRole('navigation', { name: '週次画面の切り替え' });
    await weeklyNav.getByRole('button', { name: '拡張連携', exact: true }).click();
    await page.getByText('研究設計の壁打ち', { exact: true }).waitFor();
    await page.getByLabel('対応する実測時間').selectOption(timeRecord.recordId);
    await page.getByLabel('本人確認後の会計区分').selectOption('expense');
    await page.getByLabel('自分が考えたこと・判断したこと（本人入力）').fill('比較軸を確認して自分で案Bを選んだ');
    await page.getByLabel('発見・学び（本人入力）').fill('比較軸を先に決めると判断しやすい');
    await page.getByRole('button', { name: '本人確認して週次活動に取り込む', exact: true }).click();
    await page.getByText('本人確認済みの活動として保存しました。週次記録・仕訳・決算・振り返りから参照できます。', { exact: true }).waitFor();
    await page.getByRole('button', { name: '保存した活動・Gemini分析へ', exact: true }).click();

    const record = page.locator('.weekly-record-card').filter({ hasText: '拡張機能の実測' });
    await record.waitFor();
    assert.match(await record.textContent(), /720秒/);
    await record.getByRole('checkbox').check();
    await record.getByRole('button', { name: 'Geminiで構造化分析', exact: true }).click();
    await record.getByText('分析結果を受信しました。本人入力と会計データは変更していません。', { exact: true }).waitFor();
    assert.equal(analysisCalls, 1);
    const review = record.locator('details.weekly-analysis-review');
    await review.locator('summary').click();
    await review.getByLabel('批判的判断').selectOption('75');
    await review.getByLabel('本人確認メモ').fill('会話を確認して本人が修正');
    await review.getByRole('button', { name: '本人の確認内容を別保存', exact: true }).click();
    await record.getByText('本人の確認・修正内容をAI分析とは別に保存しました。', { exact: true }).waitFor();

    await weeklyNav.getByRole('button', { name: '週次仕訳・決算', exact: true }).click();
    const preview = page.getByRole('heading', { name: '週次決算プレビュー', exact: true }).locator('..').locator('..');
    assert.match(await preview.textContent(), /12分00秒/);
    assert.match(await preview.textContent(), /仕訳貸借一致/);
    await page.getByRole('button', { name: 'プレビューを確認して確定する', exact: true }).click();
    await page.getByText(/週次決算を改訂1として確定しました。/).waitFor();

    await weeklyNav.getByRole('button', { name: '今週の振り返り', exact: true }).click();
    await page.getByLabel('今週の大きな発見・学び').fill('比較軸の明示が研究判断に有効だった');
    await page.getByLabel('AIの提案に対して自分が判断・修正したこと').fill('案Bの採用は本人が決めた');
    await page.getByLabel('今週のAIとの関わり方についての振り返り').fill('整理はAI、採否は本人が担った');
    await page.getByLabel('来週の小さな挑戦').fill('比較軸を活動前に書く');
    await page.locator('.weekly-reflection-activities input[type="checkbox"]').check();
    await page.getByRole('button', { name: '振り返りを保存する', exact: true }).click();
    await page.getByText('本人による週次の振り返りを端末内に保存しました。', { exact: true }).waitFor();

    await weeklyNav.getByRole('button', { name: '週次ダッシュボード', exact: true }).click();
    assert.match(await page.locator('.weekly-dashboard-screen').textContent(), /12分00秒/);
    const saved = await page.evaluate(() => ({
      weekly: JSON.parse(localStorage.getItem('watashi-to-ai-weekly-records:v1')),
      conversations: JSON.parse(localStorage.getItem('watashi-to-ai-weekly-conversations:v1')),
      analyses: JSON.parse(localStorage.getItem('watashi-to-ai-weekly-analyses:v1')),
      reviews: JSON.parse(localStorage.getItem('watashi-to-ai-weekly-analysis-reviews:v1')),
      settlements: JSON.parse(localStorage.getItem('watashi-to-ai-weekly-settlements:v1')),
      reflections: JSON.parse(localStorage.getItem('watashi-to-ai-weekly-reflections:v1')),
    }));
    assert.equal(saved.weekly.records.length, 1);
    assert.equal(saved.weekly.records[0].timeSource, 'measured');
    assert.equal(saved.weekly.records[0].activeSeconds, 720);
    assert.equal(saved.conversations.conversations.length, 1);
    assert.equal(saved.analyses.entries.length, 1);
    assert.equal(saved.reviews.reviews.length, 1);
    assert.equal(saved.settlements.weeks[0].revisions.length, 1);
    assert.equal(saved.reflections.reflections[0].selectedActivities.length, 1);
    assert.deepEqual(errors, []);
    console.log('PASS: extension conversation + measured time confirmation + mocked Gemini + human review + balanced weekly settlement + reflection, with separate persisted sources.');
  } finally {
    await browser.close();
    await new Promise(resolve => { api.close(resolve); api.closeAllConnections(); });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
