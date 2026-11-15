// Isolated browser profile and mocked provider only. No real Gemini request/key.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');

const base = process.env.APP_URL || 'http://127.0.0.1:5173/accounting-of-AI/';
const fakeKey = 'browser-weekly-analysis-test-key-not-real';
const model = 'gemini-browser-weekly-test';

(async () => {
  const [{ createAiServer }, { createWeeklySuccessResponse }] = await Promise.all([
    import('../../server/app.mjs'),
    import('../../server/weekly-analysis-contract.mjs'),
  ]);
  let calls = 0;
  const api = createAiServer({ providerFactory: ({ apiKey, model: requestedModel }) => {
    assert.equal(apiKey, fakeKey);
    assert.equal(requestedModel, model);
    return {
      rewrite: async input => ({ text: input.text }),
      analyzeWeekly: async request => {
        calls += 1;
        const quote = request.messages[0].text;
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
          thinkingChange: '根拠確認を優先するようになった',
          discovery: '比較軸を先に決めると判断しやすい',
          evidence: targets.map(target => ({ target, conversationId: request.conversationId, messageIndex: 0, quote })),
        }, { model: requestedModel, analysisId: `browser:${request.requestId}`, now: new Date('2026-11-16T02:00:00.000Z') });
      },
    };
  }});
  await new Promise((resolve, reject) => { api.once('error', reject); api.listen(8787, '127.0.0.1', resolve); });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(15000);
    await page.goto(base);

    await page.getByRole('button', { name: 'AI設定を開く', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'AI設定', exact: true });
    await settings.getByLabel('Gemini APIキー', { exact: true }).fill(fakeKey);
    await settings.getByLabel('Geminiモデル', { exact: true }).fill(model);
    await settings.getByRole('button', { name: 'この画面で使う', exact: true }).click();
    await settings.getByRole('button', { name: '閉じる', exact: true }).click();

    await page.getByRole('navigation', { name: '画面切り替え' }).getByRole('button', { name: '記録', exact: true }).click();
    await page.getByRole('navigation', { name: '週次画面の切り替え' }).getByRole('button', { name: '課題設定・手入力', exact: true }).click();
    const forms = page.locator('form.weekly-form');
    const taskForm = forms.nth(0);
    await taskForm.getByLabel('課題名', { exact: true }).fill('研究用分析テスト');
    await taskForm.getByLabel('活動目的', { exact: true }).fill('構造化分析の根拠と分離保存を確認する');
    await taskForm.getByLabel('期待するAIの役割', { exact: true }).fill('比較軸を整理する');
    await taskForm.getByRole('button', { name: '課題設定を保存', exact: true }).click();
    await page.getByText('活動前の課題設定を保存しました。', { exact: true }).waitFor();

    const activityForm = forms.nth(1);
    await activityForm.locator('select').first().selectOption({ index: 1 });
    await activityForm.getByLabel('利用時間（秒）').fill('720');
    await activityForm.getByLabel('AIとのやり取りの概要').fill('案Aと案Bを比較し、根拠を確認してから案Bを選びます。');
    await activityForm.getByLabel('自分が考えたこと・判断したこと').fill('最終判断は自分で行った');
    await activityForm.getByLabel('発見・学び').fill('比較軸を先に決める');
    await activityForm.getByRole('button', { name: '活動記録を保存', exact: true }).click();
    await page.getByText('活動記録を保存しました。', { exact: true }).waitFor();

    const record = page.locator('.weekly-record-card').filter({ hasText: '研究用分析テスト' });
    await record.waitFor();
    const weeklyBefore = await page.evaluate(() => localStorage.getItem('watashi-to-ai-weekly-records:v1'));
    await record.getByRole('checkbox').check();
    await record.getByRole('button', { name: 'Geminiで構造化分析', exact: true }).click();
    await record.getByText('分析結果を受信しました。本人入力と会計データは変更していません。', { exact: true }).waitFor();
    assert.equal(calls, 1);
    await record.getByRole('definition').filter({ hasText: '思考探究費' }).waitFor();
    await record.getByText(`モデル：${model}`, { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('watashi-to-ai-weekly-records:v1')), weeklyBefore);
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await record.evaluate(element => element.scrollWidth <= element.clientWidth));
    }
    await page.setViewportSize({ width: 390, height: 900 });

    const review = record.locator('details.weekly-analysis-review');
    await review.locator('summary').click();
    await review.getByLabel('批判的判断').selectOption('75');
    await review.getByLabel('本人確認メモ').fill('本人が会話を確認して50から75へ修正');
    await review.getByRole('button', { name: '本人の確認内容を別保存', exact: true }).click();
    await record.getByText('本人の確認・修正内容をAI分析とは別に保存しました。', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('watashi-to-ai-weekly-records:v1')), weeklyBefore);
    const storedAnalysis = await page.evaluate(() => JSON.parse(localStorage.getItem('watashi-to-ai-weekly-analyses:v1')));
    assert.equal(storedAnalysis.entries[0].response.model, model);
    assert.equal(storedAnalysis.entries[0].response.rubricVersion, 'research-thinking-rubric-v1');
    assert.equal(storedAnalysis.entries[0].response.analyzedAt, '2026-11-16T02:00:00.000Z');
    assert.ok(await page.evaluate(() => localStorage.getItem('watashi-to-ai-weekly-analysis-reviews:v1')));

    await page.reload();
    await page.getByRole('navigation', { name: '画面切り替え' }).getByRole('button', { name: '記録', exact: true }).click();
    await page.getByRole('navigation', { name: '週次画面の切り替え' }).getByRole('button', { name: '課題設定・手入力', exact: true }).click();
    const restored = page.locator('.weekly-record-card').filter({ hasText: '研究用分析テスト' });
    await restored.getByText('本人確認済み：', { exact: false }).waitFor();
    assert.equal(await restored.getByLabel('批判的判断').inputValue(), '75');
    assert.equal(await restored.getByLabel('本人確認メモ').inputValue(), '本人が会話を確認して50から75へ修正');
    assert.deepEqual(errors, []);
    console.log('PASS: explicit consent, mocked structured analysis, evidence display, separate human corrections, reload persistence, and no weekly/accounting mutation.');
  } finally {
    await browser.close();
    await new Promise(resolve => { api.close(resolve); api.closeAllConnections(); });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
