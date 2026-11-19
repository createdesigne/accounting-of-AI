import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDraftConversation } from '../src/conversationDraft.ts';

const raw = { aiService: 'ChatGPT', conversationTitle: '展示と会計 + 100% & 比較', messages: [{ role: 'user', text: '相談です。' }, { role: 'assistant', text: '一緒に整理しましょう。' }] };
test('accepts new fragment JSON and legacy JSON, escaped JSON and base64url', () => {
  const json = JSON.stringify(raw);
  const encoded = new URLSearchParams({ draft: json }).toString();
  assert.deepEqual(parseDraftConversation(new URLSearchParams(encoded).get('draft')!), raw);
  assert.deepEqual(parseDraftConversation(json), raw);
  assert.deepEqual(parseDraftConversation(encodeURIComponent(json)), raw);
  assert.deepEqual(parseDraftConversation(Buffer.from(json).toString('base64url')), raw);
});
test('rejects malformed or empty conversation messages rather than generating a fake candidate', () => {
  for (const raw of [null, {}, [], { messages: [] }, { messages: [null] }, { messages: ['text'] }, { messages: [{ text: 3 }] }, { messages: [{ text: ' ' }] }, { messages: [{ text: 'valid', role: {} }] }, { aiService: 3, messages: [{ text: 'valid' }] }]) {
    assert.equal(parseDraftConversation(JSON.stringify(raw)), null);
  }
  for (const value of ['{broken', '%zz', 'not base64']) assert.equal(parseDraftConversation(value), null);
});

test('accepts an optional capture id without requiring it from legacy drafts', () => {
  const base = { aiService: 'ChatGPT', messages: [{ role: 'user', text: '本文' }] };
  assert.equal(parseDraftConversation(JSON.stringify(base))?.captureId, undefined);
  assert.equal(parseDraftConversation(JSON.stringify({ ...base, captureId: 'capture-123' }))?.captureId, 'capture-123');
  assert.equal(parseDraftConversation(JSON.stringify({ ...base, captureId: '' })), null);
  assert.equal(parseDraftConversation(JSON.stringify({ ...base, captureId: `capture-${'x'.repeat(200)}` })), null);
});
