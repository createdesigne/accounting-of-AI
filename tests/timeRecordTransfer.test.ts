import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIME_RECORD_PROTOCOL,
  TIME_RECORD_AUTO_REQUEST_TYPE,
  TIME_RECORD_AUTO_RESULT_TYPE,
  TIME_RECORD_WINDOW_SOURCE,
  formatTimeRecordDuration,
  requestAutomaticTimeRecords,
  mergeTimeRecordPreviews,
  parseTimeRecordPayload,
} from '../src/timeRecordTransfer.ts';

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

const payload = (records: unknown[]) => ({
  protocol: TIME_RECORD_PROTOCOL,
  requestId: 'request-1',
  records,
});

test('accepts the minimal transfer payload and rejects extra or invalid data', () => {
  assert.equal(parseTimeRecordPayload(payload([record()]))?.records.length, 1);
  assert.equal(parseTimeRecordPayload(payload([record({ conversationText: 'must not arrive' })])), null);
  assert.equal(parseTimeRecordPayload(payload([record({ durationSeconds: -1 })])), null);
  assert.equal(parseTimeRecordPayload(payload([record({ durationSeconds: 0 })])), null);
  assert.equal(parseTimeRecordPayload(payload([record({ timeZone: 'Invalid/Zone' })])), null);
  assert.equal(parseTimeRecordPayload(payload([record({ localDate: '2026-02-30' })])), null);
  assert.equal(parseTimeRecordPayload({ ...payload([record()]), conversationText: 'not allowed' }), null);
});

test('rejects duplicate ids inside one received message', () => {
  assert.equal(parseTimeRecordPayload(payload([record(), record()])), null);
});

test('merges identical deliveries without duplication and rejects changed content', () => {
  const first = parseTimeRecordPayload(payload([record()]))!.records;
  const resent = parseTimeRecordPayload(payload([
    record(),
    record({ recordId: 'session-2:day:2026-11-11', sessionId: 'session-2', localDate: '2026-11-11' }),
  ]))!.records;
  const merged = mergeTimeRecordPreviews(first, resent);

  assert.equal(merged.length, 2);
  assert.equal(merged[0].recordId, 'session-1:day:2026-11-10');
  assert.equal(merged[0].durationSeconds, 60);
  assert.equal(merged[1].recordId, 'session-2:day:2026-11-11');
  assert.throws(
    () => mergeTimeRecordPreviews(first, [{ ...first[0], durationSeconds: 999 }]),
    /同じ記録IDに異なる内容/,
  );
});

test('formats the confirmation total in Japanese seconds', () => {
  assert.equal(formatTimeRecordDuration(59), '0分59秒');
  assert.equal(formatTimeRecordDuration(3_661), '1時間1分1秒');
});

test('requests automatic records with a correlated response and validates the payload', async () => {
  const listeners = new Set<(event: any) => void>();
  const sent: any[] = [];
  const channel: any = {
    location: { origin: 'https://createdesigne.github.io' },
    setTimeout: (handler: () => void, timeout: number) => setTimeout(handler, timeout) as any,
    clearTimeout,
    addEventListener: (_type: string, listener: (event: any) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: any) => void) => listeners.delete(listener),
    postMessage(message: any, targetOrigin: string) {
      sent.push({ message, targetOrigin });
      const responsePayload = payload([record()]);
      queueMicrotask(() => {
        for (const listener of listeners) listener({
          source: channel,
          origin: channel.location.origin,
          data: {
            source: TIME_RECORD_WINDOW_SOURCE,
            type: TIME_RECORD_AUTO_RESULT_TYPE,
            requestId: message.requestId,
            ok: true,
            payload: responsePayload,
          },
        });
      });
    },
  };

  const result = await requestAutomaticTimeRecords(100, channel);
  assert.equal(result.records.length, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].message.type, TIME_RECORD_AUTO_REQUEST_TYPE);
  assert.equal(sent[0].targetOrigin, channel.location.origin);
  assert.equal(listeners.size, 0);
});
