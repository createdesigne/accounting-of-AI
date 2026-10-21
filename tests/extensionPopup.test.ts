import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const script = readFileSync(new URL('../chrome-extension/popup.js', import.meta.url), 'utf8');
const conversation = { aiService: 'ChatGPT', conversationTitle: '相談 + 100% & 日本語', messages: [{ role: 'user', text: '実際の会話本文' }] };
function popup({ source = 'https://chatgpt.com/c/example', result = conversation, destination = 'production', failure = '' } = {}) {
  let click: () => Promise<void>;
  const created: string[] = [];
  let injected = 0;
  const elements = { createReceipt: { disabled: false, addEventListener: (_event: string, handler: typeof click) => { click = handler; } }, status: { textContent: '' }, destination: { value: destination } };
  vm.runInNewContext(script, {
    document: { getElementById: (id: keyof typeof elements) => elements[id] },
    chrome: { tabs: { query: async () => [{ id: 1, url: source, title: 'ChatGPT' }], create: async ({ url }: { url: string }) => { if (failure) throw new Error(failure); created.push(url); } }, scripting: { executeScript: async () => { injected++; return [{ result }]; } } },
    URL, URLSearchParams, Date, Error, console: { error() {} },
  });
  return { run: () => click(), created, elements, injections: () => injected };
}
test('extension defaults to production and sends actual text in a fragment, not the HTTP query', async () => {
  const page = popup(); await page.run();
  const url = new URL(page.created[0]);
  assert.equal(url.origin + url.pathname, 'https://createdesigne.github.io/accounting-of-AI/');
  assert.equal(url.search, '');
  const raw = JSON.parse(new URLSearchParams(url.hash.slice(1)).get('draft')!);
  assert.deepEqual(raw.messages, conversation.messages);
  assert.equal(raw.conversationTitle, conversation.conversationTitle);
  assert.equal(page.elements.createReceipt.disabled, false);
});
test('preview/local destinations preserve the application base path', async () => {
  for (const [destination, expected] of [['preview', 'https://createdesigne.github.io/accounting-of-AI/preview/month-ledger/'], ['local', 'http://localhost:5173/accounting-of-AI/']]) {
    const page = popup({ destination }); await page.run();
    assert.ok(page.created[0].startsWith(expected + '#draft='));
  }
});
test('empty extraction never substitutes title or demo conversation', async () => {
  const page = popup({ result: { ...conversation, messages: [] } }); await page.run();
  assert.equal(page.created.length, 0);
  assert.match(page.elements.status.textContent, /会話本文が見つかりません/);
  assert.equal(page.elements.createReceipt.disabled, false);
});
test('unsupported or lookalike domains are not read', async () => {
  for (const source of ['chrome://extensions/', 'https://example.com/', 'https://chatgpt.com.example.com/', 'https://example.com/?chatgpt.com']) {
    const page = popup({ source }); await page.run();
    assert.equal(page.injections(), 0); assert.equal(page.created.length, 0);
  }
});
test('navigation failures show an error and allow retry', async () => {
  const page = popup({ failure: 'タブを開けませんでした' }); await page.run();
  assert.equal(page.created.length, 0);
  assert.match(page.elements.status.textContent, /タブを開けませんでした/);
  assert.equal(page.elements.createReceipt.disabled, false);
});
