import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIME_RECORD_PROTOCOL,
  TIME_RECORD_AUTO_REQUEST_TYPE,
  TIME_RECORD_AUTO_RESULT_TYPE,
  TIME_RECORD_PENDING_ACK_BASE_KEY,
  TIME_RECORD_PENDING_PREVIEW_BASE_KEY,
  TIME_RECORD_WINDOW_SOURCE,
  acknowledgeImportedTimeRecords,
  clearPendingTimeRecordAcknowledgement,
  clearPendingTimeRecordPreview,
  formatTimeRecordDuration,
  loadPendingTimeRecordAcknowledgement,
  loadPendingTimeRecordAutomaticIds,
  loadPendingTimeRecordPreview,
  requestAutomaticTimeRecords,
  mergeTimeRecordPreviews,
  parseManualTimeRecordTransfer,
  parseTimeRecordPayload,
  savePendingTimeRecordAcknowledgement,
  savePendingTimeRecordPreview,
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

test('manual transfer accepts the same minimal payload and rejects sensitive or malformed text', () => {
  const serialized = JSON.stringify(payload([record()]));
  const parsed = parseManualTimeRecordTransfer(serialized);
  assert.equal(parsed?.records[0].recordId, 'session-1:day:2026-11-10');
  assert.equal(parsed?.records[0].startedAt, 1_000);
  assert.equal(parsed?.records[0].endedAt, 61_000);
  assert.equal(parsed?.records[0].durationSeconds, 60);
  assert.equal(parseManualTimeRecordTransfer(JSON.stringify(payload([record({ conversationText: 'secret' })]))), null);
  assert.equal(parseManualTimeRecordTransfer('{broken'), null);
  assert.equal(parseManualTimeRecordTransfer(''), null);
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

test('pending 19-second preview survives reload, deduplicates resends, and never changes accounting data', () => {
  const values = new Map<string, string>([['accounting-store', '137-seconds-unchanged']]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  const pending = record({
    recordId: 'session-19:day:2026-11-18',
    sessionId: 'session-19',
    localDate: '2026-11-18',
    startedAt: 10_000,
    endedAt: 29_000,
    durationSeconds: 19,
  }) as any;

  savePendingTimeRecordPreview([pending], storage, TIME_RECORD_PENDING_PREVIEW_BASE_KEY, [pending.recordId]);
  savePendingTimeRecordPreview([pending], storage, TIME_RECORD_PENDING_PREVIEW_BASE_KEY, [pending.recordId]);
  const restored = loadPendingTimeRecordPreview(storage);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].recordId, pending.recordId);
  assert.equal(restored[0].startedAt, 10_000);
  assert.equal(restored[0].endedAt, 29_000);
  assert.equal(restored[0].durationSeconds, 19);
  assert.deepEqual(loadPendingTimeRecordAutomaticIds(storage), [pending.recordId]);
  assert.equal(values.get('accounting-store'), '137-seconds-unchanged');
  const envelope = JSON.parse(values.get(TIME_RECORD_PENDING_PREVIEW_BASE_KEY)!);
  assert.equal(envelope.status, 'received-unconfirmed');
  assert.deepEqual(envelope.automaticRecordIds, [pending.recordId]);
  assert.deepEqual(Object.keys(envelope.records[0]).sort(), [
    'durationSeconds', 'endedAt', 'localDate', 'provider', 'recordId', 'sessionId', 'startedAt', 'timeZone',
  ]);

  const beforeConflict = values.get(TIME_RECORD_PENDING_PREVIEW_BASE_KEY);
  assert.throws(() => savePendingTimeRecordPreview([{ ...pending, durationSeconds: 20 }], storage), /同じ記録IDに異なる内容/);
  assert.equal(values.get(TIME_RECORD_PENDING_PREVIEW_BASE_KEY), beforeConflict);
  clearPendingTimeRecordPreview(storage);
  assert.deepEqual(loadPendingTimeRecordPreview(storage), []);
  assert.equal(values.get('accounting-store'), '137-seconds-unchanged');
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

test('retries a transient completion notification with the same records and correlated request id', async () => {
  const listeners = new Set<(event: any) => void>();
  const sent: any[] = [];
  const channel: any = {
    location: { origin: 'http://localhost:5174' },
    setTimeout: (handler: () => void, timeout: number) => setTimeout(handler, timeout),
    clearTimeout,
    addEventListener: (_type: string, listener: (event: any) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: any) => void) => listeners.delete(listener),
    postMessage(message: any, targetOrigin: string) {
      sent.push({ message, targetOrigin });
      const attempt = sent.length;
      queueMicrotask(() => {
        for (const listener of [...listeners]) listener({
          source: channel,
          origin: channel.location.origin,
          data: {
            source: 'ai-time-record-extension',
            type: 'AI_TIME_RECORDS_IMPORT_ACK_RESULT',
            requestId: message.payload.requestId,
            ok: attempt > 1,
            message: attempt > 1 ? '' : 'Service Workerを一時的に利用できません。',
          },
        });
      });
    },
  };

  await acknowledgeImportedTimeRecords([record() as any], 200, channel);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].message.payload.requestId, sent[1].message.payload.requestId);
  assert.deepEqual(sent[0].message.payload.records, sent[1].message.payload.records);
  assert.equal(listeners.size, 0);
});

test('persists only validated completion-pending records and restores them after reload', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  const validRecord = record() as any;
  savePendingTimeRecordAcknowledgement([validRecord], storage);
  assert.equal(loadPendingTimeRecordAcknowledgement(storage).length, 1);
  assert.equal(loadPendingTimeRecordAcknowledgement(storage)[0].recordId, validRecord.recordId);

  values.set(TIME_RECORD_PENDING_ACK_BASE_KEY, JSON.stringify({
    version: 1,
    records: [{ ...validRecord, durationSeconds: -1 }],
  }));
  assert.deepEqual(loadPendingTimeRecordAcknowledgement(storage), []);

  savePendingTimeRecordAcknowledgement([validRecord], storage);
  clearPendingTimeRecordAcknowledgement(storage);
  assert.deepEqual(loadPendingTimeRecordAcknowledgement(storage), []);
});

test('keeps an earlier completion notification pending when a later record is queued', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  const first = record({
    recordId: 'session-24:day:2026-11-20',
    sessionId: 'session-24',
    localDate: '2026-11-20',
    durationSeconds: 24,
  }) as any;
  const second = record({
    recordId: 'session-31:day:2026-11-20',
    sessionId: 'session-31',
    localDate: '2026-11-20',
    startedAt: 70_000,
    endedAt: 101_000,
    durationSeconds: 31,
  }) as any;

  savePendingTimeRecordAcknowledgement([first], storage);
  const queue = mergeTimeRecordPreviews(
    [...loadPendingTimeRecordAcknowledgement(storage)],
    [second],
  );
  savePendingTimeRecordAcknowledgement(queue, storage);

  assert.deepEqual(
    loadPendingTimeRecordAcknowledgement(storage).map(item => item.recordId),
    [first.recordId, second.recordId],
  );
  assert.equal(loadPendingTimeRecordAcknowledgement(storage).reduce((sum, item) => sum + item.durationSeconds, 0), 55);
});
