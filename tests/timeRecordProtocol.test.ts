import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../chrome-extension/timeRecordProtocol.js', import.meta.url), 'utf8');
const context = vm.createContext({ URL, TextEncoder, encodeURIComponent, unescape });
vm.runInContext(source, context);
const protocol = (context as { TimeRecordProtocol: any }).TimeRecordProtocol;

const record = (overrides: Record<string, unknown> = {}) => ({
  recordId: 'session-1:day:2026-11-10',
  sessionId: 'session-1',
  provider: 'ChatGPT',
  localDate: '2026-11-10',
  timeZone: 'Asia/Tokyo',
  startedAt: 1_000,
  endedAt: 61_000,
  durationSeconds: 60,
  ...overrides,
});

test('allows only the configured Web app origins and paths', () => {
  for (const url of [
    'https://createdesigne.github.io/accounting-of-AI/',
    'https://createdesigne.github.io/accounting-of-AI/preview/month-ledger/',
    'http://localhost:5173/accounting-of-AI/',
  ]) assert.equal(protocol.isAllowedAppUrl(url), true);

  for (const url of [
    'https://example.com/accounting-of-AI/',
    'https://createdesigne.github.io/another-app/',
    'https://createdesigne.github.io.evil.example/accounting-of-AI/',
    'http://localhost:5174/accounting-of-AI/',
    'javascript:alert(1)',
  ]) assert.equal(protocol.isAllowedAppUrl(url), false);
});

test('projects only the minimum time fields and never sends page or secret data', () => {
  const payload = protocol.createPayload([record({
    conversationText: '会話本文の秘密',
    url: 'https://chatgpt.com/c/private',
    tabId: 99,
    apiKey: 'secret-api-key',
  })], 'request-1');
  const sent = JSON.stringify(payload);

  assert.deepEqual(Object.keys(payload.records[0]), Array.from(protocol.ALLOWED_KEYS));
  assert.doesNotMatch(sent, /会話本文の秘密|chatgpt\.com|secret-api-key|tabId/);
  assert.equal(protocol.validatePayload(payload).ok, true);
});

test('rejects malformed records, duplicate ids and oversized payloads', () => {
  const valid = protocol.createPayload([record()], 'request-valid');
  assert.equal(protocol.validatePayload({ ...valid, records: [record({ durationSeconds: -1 })] }).ok, false);
  assert.equal(protocol.validatePayload({ ...valid, records: [record(), record()] }).ok, false);
  assert.equal(protocol.validatePayload({ ...valid, records: [{ ...record(), conversationText: 'not allowed' }] }).ok, false);
  assert.equal(protocol.validatePayload({ ...valid, conversationText: 'not allowed' }).ok, false);
  assert.equal(protocol.validatePayload({ ...valid, records: [record({ localDate: '2026-02-30' })] }).ok, false);

  const oversized = Array.from({ length: 500 }, (_, index) => record({
    recordId: `${String(index).padStart(3, '0')}-${'r'.repeat(156)}`,
    sessionId: `${String(index).padStart(3, '0')}-${'s'.repeat(156)}`,
    timeZone: 'America/Argentina/Buenos_Aires',
  }));
  assert.throws(() => protocol.createPayload(oversized, 'request-large'), /大きすぎ/);
});

test('deduplicates the same finalized record before transfer', () => {
  const payload = protocol.createPayload([record(), record(), record({
    recordId: 'session-1:day:2026-11-11', localDate: '2026-11-11',
  })], 'request-deduplicate');
  assert.equal(payload.records.length, 2);
  assert.deepEqual(Array.from(payload.records, (item: any) => item.recordId), [
    'session-1:day:2026-11-10',
    'session-1:day:2026-11-11',
  ]);
});
