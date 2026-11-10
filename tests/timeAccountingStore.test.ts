import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBalancedJournalEntry, TIME_ACCOUNTS } from '../src/timeAccounting.ts';
import {
  TIME_ACCOUNTING_STORAGE_BASE_KEY,
  TimeAccountingImportError,
  importTimeRecords,
  loadTimeAccountingStore,
} from '../src/timeAccountingStore.ts';
import type { TimeRecordPreview } from '../src/timeRecordTransfer.ts';

class MemoryStorage {
  values = new Map<string, string>();
  failNextSet = false;

  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.failNextSet) {
      this.failNextSet = false;
      throw new Error('simulated storage failure');
    }
    this.values.set(key, value);
  }
}

class SerialLocks {
  private tail: Promise<unknown> = Promise.resolve();

  request<T>(_name: string, _options: { mode: 'exclusive' }, callback: () => Promise<T> | T) {
    const result = this.tail.then(callback, callback);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

const timeRecord = (
  recordId: string,
  durationSeconds: number,
  localDate = '2026-11-10',
): TimeRecordPreview => ({
  recordId,
  sessionId: recordId.split(':day:')[0],
  provider: 'ChatGPT',
  localDate,
  timeZone: 'Asia/Tokyo',
  startedAt: Date.parse(`${localDate}T00:00:00+09:00`),
  endedAt: Date.parse(`${localDate}T00:00:00+09:00`) + durationSeconds * 1000,
  durationSeconds,
});

const options = (storage: MemoryStorage, locks = new SerialLocks()) => ({
  storage,
  locks,
  now: () => Date.parse('2026-11-10T12:00:00Z'),
});

test('imports 1, 59, 60 and 61 seconds as balanced clearing/contribution journals', async () => {
  const storage = new MemoryStorage();
  const records = [1, 59, 60, 61].map((seconds) => timeRecord(`session-${seconds}:day:2026-11-10`, seconds));
  const result = await importTimeRecords(records, options(storage));

  assert.equal(result.importedCount, 4);
  assert.equal(result.importedSeconds, 181);
  assert.deepEqual(result.store.ledger.measurements.map((item) => item.actualInputSeconds), [1, 59, 60, 61]);
  assert.ok(result.store.ledger.entries.every(isBalancedJournalEntry));
  for (const entry of result.store.ledger.entries) {
    assert.equal(entry.lines[0].account, TIME_ACCOUNTS.aiClearing);
    assert.equal(entry.lines[1].account, TIME_ACCOUNTS.timeContribution);
    assert.equal(entry.lines[0].seconds, entry.lines[1].seconds);
  }
});

test('skips an identical resend and rejects different content for the same record id', async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const original = timeRecord('same:day:2026-11-10', 60);
  await importTimeRecords([original], options(storage, locks));
  const resent = await importTimeRecords([original], options(storage, locks));
  assert.equal(resent.importedCount, 0);
  assert.equal(resent.skippedCount, 1);
  assert.equal(resent.store.ledger.entries.length, 1);

  const snapshot = storage.getItem(TIME_ACCOUNTING_STORAGE_BASE_KEY);
  await assert.rejects(
    () => importTimeRecords([{ ...original, durationSeconds: 61 }], options(storage, locks)),
    (error) => error instanceof TimeAccountingImportError && error.code === 'CONTENT_MISMATCH',
  );
  assert.equal(storage.getItem(TIME_ACCOUNTING_STORAGE_BASE_KEY), snapshot);
});

test('serializes concurrent imports from multiple app tabs without duplicate journals', async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const record = timeRecord('concurrent:day:2026-11-10', 60);
  const results = await Promise.all([
    importTimeRecords([record], options(storage, locks)),
    importTimeRecords([record], options(storage, locks)),
  ]);

  assert.deepEqual(results.map((result) => result.importedCount).sort(), [0, 1]);
  const restored = loadTimeAccountingStore(storage);
  assert.equal(restored.ledger.entries.length, 1);
  assert.equal(restored.importedRecords.length, 1);
});

test('does not persist a partial batch when a later record conflicts', async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const existing = timeRecord('existing:day:2026-11-10', 60);
  await importTimeRecords([existing], options(storage, locks));
  const snapshot = storage.getItem(TIME_ACCOUNTING_STORAGE_BASE_KEY);

  await assert.rejects(
    () => importTimeRecords([
      timeRecord('new:day:2026-11-10', 59),
      { ...existing, durationSeconds: 61 },
    ], options(storage, locks)),
    (error) => error instanceof TimeAccountingImportError && error.code === 'CONTENT_MISMATCH',
  );
  assert.equal(storage.getItem(TIME_ACCOUNTING_STORAGE_BASE_KEY), snapshot);
  assert.equal(loadTimeAccountingStore(storage).ledger.entries.length, 1);
});

test('recovers from storage failure and from a lost acknowledgement without double accounting', async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const record = timeRecord('retry:day:2026-11-10', 61);
  storage.failNextSet = true;
  await assert.rejects(
    () => importTimeRecords([record], options(storage, locks)),
    (error) => error instanceof TimeAccountingImportError && error.code === 'SAVE_FAILED',
  );
  assert.equal(storage.getItem(TIME_ACCOUNTING_STORAGE_BASE_KEY), null);

  const savedButAckLost = await importTimeRecords([record], options(storage, locks));
  assert.equal(savedButAckLost.importedCount, 1);
  // Simulate a response/ACK failure by retrying the same delivered record.
  const retry = await importTimeRecords([record], options(storage, locks));
  assert.equal(retry.importedCount, 0);
  assert.equal(retry.skippedCount, 1);
  assert.equal(retry.store.ledger.entries.length, 1);
});

test('restores the dedicated ledger after a page reload', async () => {
  const storage = new MemoryStorage();
  await importTimeRecords([timeRecord('reload:day:2026-11-10', 59)], options(storage));
  const restored = loadTimeAccountingStore(storage);
  assert.equal(restored.storeVersion, 1);
  assert.equal(restored.ledger.unit, 'second');
  assert.equal(restored.ledger.measurements[0].actualInputSeconds, 59);
  assert.equal(restored.importedRecords[0].recordId, 'reload:day:2026-11-10');
});

test('preserves actual dates and seconds for records split across month end', async () => {
  const storage = new MemoryStorage();
  const result = await importTimeRecords([
    timeRecord('month-session:day:2026-06-30', 30, '2026-06-30'),
    timeRecord('month-session:day:2026-07-01', 45, '2026-07-01'),
  ], options(storage));
  assert.deepEqual(result.store.ledger.measurements.map((item) => [
    item.occurredOn, item.actualInputSeconds,
  ]), [
    ['2026-06-30', 30],
    ['2026-07-01', 45],
  ]);
});

test('migrates a legacy minute ledger and preserves its month-end adjustment', async () => {
  const storage = new MemoryStorage();
  storage.setItem(TIME_ACCOUNTING_STORAGE_BASE_KEY, JSON.stringify({
    version: 1,
    unit: 'minute',
    measurements: [{
      sourceEventId: 'legacy-event', occurredOn: '2026-09-30', actualInputMinutes: 2,
      estimatedSavedMinutes: 0, usageEntryId: 'legacy-use', monthEndAdjustmentEntryId: 'legacy-close',
    }],
    entries: [
      {
        id: 'legacy-use', kind: 'ai-usage', postedOn: '2026-09-30', sourceEventId: 'legacy-event',
        lines: [
          { side: 'debit', account: 'AI仮受品', minutes: 2, measurement: 'actual-input' },
          { side: 'credit', account: '時間拠出', minutes: 2, measurement: 'actual-input' },
        ],
      },
      {
        id: 'legacy-close', kind: 'month-end-adjustment', postedOn: '2026-09-30', sourceEventId: 'legacy-event',
        lines: [
          { side: 'debit', account: '思考探究費', minutes: 2, measurement: 'actual-input' },
          { side: 'credit', account: 'AI仮受品', minutes: 2, measurement: 'actual-input' },
        ],
      },
    ],
  }));

  const result = await importTimeRecords([
    timeRecord('after-migration:day:2026-10-01', 61, '2026-10-01'),
  ], options(storage));
  assert.equal(result.store.ledger.measurements[0].actualInputSeconds, 120);
  assert.equal(result.store.ledger.measurements[0].monthEndAdjustmentEntryId, 'legacy-close');
  assert.equal(result.store.ledger.entries[1].kind, 'month-end-adjustment');
  assert.equal(result.store.ledger.measurements[1].actualInputSeconds, 61);
});

test('rejects invalid records and refuses to import without an exclusive lock', async () => {
  const storage = new MemoryStorage();
  await assert.rejects(
    () => importTimeRecords([{ ...timeRecord('invalid:day:2026-11-10', 60), durationSeconds: 0 }], options(storage)),
    (error) => error instanceof TimeAccountingImportError && error.code === 'INVALID_RECORD',
  );
  await assert.rejects(
    () => importTimeRecords([timeRecord('no-lock:day:2026-11-10', 60)], {
      storage,
      locks: null,
    }),
    (error) => error instanceof TimeAccountingImportError && error.code === 'LOCK_UNAVAILABLE',
  );
});

test('rejects persisted import metadata that is not linked to its journal', async () => {
  const storage = new MemoryStorage();
  const result = await importTimeRecords([
    timeRecord('linked:day:2026-11-10', 60),
  ], options(storage));
  const corrupted = JSON.parse(storage.getItem(TIME_ACCOUNTING_STORAGE_BASE_KEY)!);
  corrupted.importedRecords[0].entryId = 'missing-entry';
  storage.setItem(TIME_ACCOUNTING_STORAGE_BASE_KEY, JSON.stringify(corrupted));
  assert.throws(
    () => loadTimeAccountingStore(storage),
    (error) => error instanceof TimeAccountingImportError && error.code === 'STORE_INVALID',
  );
  assert.equal(result.store.ledger.entries.length, 1);
});
