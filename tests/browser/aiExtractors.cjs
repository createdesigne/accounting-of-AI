const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { providers, conversationMarkup } = require('./aiConversationFixtures.cjs');
const script = fs.readFileSync(process.env.EXTRACTOR_SOURCE || path.resolve(__dirname, '../../chrome-extension/popup.js'), 'utf8');
const sandbox = vm.createContext({ document: { getElementById: () => ({ addEventListener() {} }) } });
vm.runInContext(script, sandbox);
const extractor = vm.runInContext('extractConversationFromPage.toString()', sandbox);
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  let checks = 0;
  try {
    const page = await browser.newPage();
    async function extract(url, body, setup) {
      await page.route(url, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body }));
      await page.goto(url);
      if (setup) await setup(page);
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

    // Regression: the first main may be a stale/empty layout, not the chat.
    for (const [name, config] of Object.entries(providers)) {
      const markup = '<main hidden><h1>Old layout</h1></main>' + conversationMarkup(name, repeated, '表示中の会話');
      assert.deepEqual((await extract(config.url, markup)).messages, repeated, name + ': skip stale first main');
      const noMain = '<main></main><section>' + repeated.map(config.message).join('') + '</section>';
      assert.deepEqual((await extract(config.url, noMain)).messages, repeated, name + ': explicit chat markers outside main');
    }
    // ChatGPT turn-level speaker markers are explicit, unlike article order.
    for (const url of [providers.ChatGPT.url, 'https://chatgpt.com/share/bridge-check']) {
      for (const tag of ['article', 'div']) {
        const turns = repeated.map((m, i) => `<${tag} data-testid="conversation-turn-${i}" data-turn="${m.role}"><div class="${m.role === 'user' ? 'whitespace-pre-wrap' : 'markdown'}">${m.text}</div><button>Copy</button></${tag}>`).join('');
        assert.deepEqual((await extract(url, '<main>' + turns + '</main>')).messages, repeated, 'ChatGPT: turn-level roles, regular/shared routes');
      }
    }
    const nested = await extract(providers.ChatGPT.url, '<main><article data-turn="user"><div data-message-author-role="user"><div class="whitespace-pre-wrap">質問</div></div></article><article data-turn="assistant"><div data-message-author-role="assistant"><div class="markdown">回答</div></div></article><article data-turn="tool">Not a speaker</article></main>');
    assert.deepEqual(nested.messages, [{ role: 'user', text: '質問' }, { role: 'assistant', text: '回答' }], 'nested old/new markers must not duplicate messages or guess tool roles');
    const hydrated = await extract(providers.ChatGPT.url, '<main id="chat"></main>', async p => {
      await p.evaluate(() => { setTimeout(() => {
        document.getElementById('chat').innerHTML = '<div data-message-author-role="user">表示後の質問</div><div data-message-author-role="assistant">表示後の回答</div>';
      }, 150); });
    });
    assert.deepEqual(hydrated.messages, [{ role: 'user', text: '表示後の質問' }, { role: 'assistant', text: '表示後の回答' }], 'bounded wait for conversation hydration');
    const menus = await extract(providers.ChatGPT.url, '<div role="navigation"><article data-turn="assistant">Navigation noise</article></div><div role="menu"><div data-message-author-role="user">Menu noise</div></div><main><article data-turn="user">会話の質問</article><article data-turn="assistant">会話の回答</article></main>');
    assert.deepEqual(menus.messages, [{ role: 'user', text: '会話の質問' }, { role: 'assistant', text: '会話の回答' }]);
    const blank = await extract(providers.ChatGPT.url, '<main><h1>新しいチャット</h1><textarea>未送信の文章</textarea><article data-turn="unknown">Unknown speaker</article></main>');
    assert.deepEqual(blank.messages, [], 'never substitute headings, drafts, or guessed speaker roles');
    console.log(`PASS: ${checks} real-browser extraction cases: three provider DOM adapters, nesting, hidden/UI noise, genuine repeated messages, one-character text, multiline code, multipart replies, last 20, unknown markup and hostname spoofing. Fixtures are representative, not live-site snapshots.`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
