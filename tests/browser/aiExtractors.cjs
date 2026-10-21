const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { providers, conversationMarkup } = require('./aiConversationFixtures.cjs');
const script = fs.readFileSync(path.resolve(__dirname, '../../chrome-extension/popup.js'), 'utf8');
const sandbox = vm.createContext({ document: { getElementById: () => ({ addEventListener() {} }) } });
vm.runInContext(script, sandbox);
const extractor = vm.runInContext('extractConversationFromPage.toString()', sandbox);
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  let checks = 0;
  try {
    const page = await browser.newPage();
    async function extract(url, body) {
      await page.route(url, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body }));
      await page.goto(url);
      const data = await page.evaluate(`(${extractor})()`);
      await page.unroute(url); checks++; return data;
    }
    const repeated = [{ role: 'user', text: '同じ質問です。' }, { role: 'assistant', text: '同じ回答です。' }, { role: 'user', text: '同じ質問です。' }, { role: 'assistant', text: '同じ回答です。' }, { role: 'user', text: '?' }];
    for (const [name, config] of Object.entries(providers)) {
      const result = await extract(config.url, conversationMarkup(name, repeated, '日本語 + 100% & 会話'));
      assert.equal(result.aiService, name);
      assert.equal(result.conversationTitle, '日本語 + 100% & 会話');
      assert.deepEqual(result.messages, repeated, name + ': ordered speakers, genuine repetitions, one-character messages, no hidden/sidebar/toolbar text or nested duplicates');
      const many = Array.from({ length: 25 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: '発言' + i }));
      assert.deepEqual((await extract(config.url, conversationMarkup(name, many, '長い会話'))).messages, many.slice(-20));
      assert.deepEqual((await extract(config.url, '<main><article>Unknown answer</article><div data-testid="user-menu">Profile</div><textarea>Unsent draft</textarea></main>')).messages, []);
    }
    const code = await extract(providers.ChatGPT.url, '<main><div data-message-author-role="assistant"><div class="markdown"><p>思考<span>レシート</span></p><pre><code>const x = 1;\n  console.log(x);</code></pre><button>Copy</button><div aria-hidden="true">Ignore</div></div></div></main>');
    assert.equal(code.messages[0].text, '思考レシート\n\nconst x = 1;\n  console.log(x);');
    const chunks = await extract(providers.Gemini.url, '<main><model-response><message-content>前半</message-content><message-content>後半</message-content></model-response></main>');
    assert.deepEqual(chunks.messages, [{ role: 'assistant', text: '前半\n\n後半' }]);
    const invisible = await extract(providers.Claude.url, '<main><div style="visibility:hidden"><div class="font-claude-response">Hidden</div></div><div data-testid="user-message" hidden>Hidden</div><div class="font-claude-response"><button>Copy only</button></div></main>');
    assert.deepEqual(invisible.messages, []);
    const unsafe = await extract('https://chatgpt.com.example.com/conversation', conversationMarkup('ChatGPT', repeated, 'Fake'));
    assert.deepEqual(unsafe.messages, []);
    console.log(`PASS: ${checks} real-browser extraction cases: three provider DOM adapters, nesting, hidden/UI noise, genuine repeated messages, one-character text, multiline code, multipart replies, last 20, unknown markup and hostname spoofing. Fixtures are representative, not live-site snapshots.`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
