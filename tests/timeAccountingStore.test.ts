import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBalancedJournalEntry, recordMonthEndAdjustment, TIME_ACCOUNTS } from '../src/timeAccounting.ts';
import { createAccountingPeriodState, withClosedAccountingPeriod } from '../src/accountingPeriods.ts';
import {
  TIME_ACCOUNTING_STORAGE_BASE_KEY,
  TimeAccountingImportError,
  cancelImportedTimeRecord,
  correctImportedTimeRecord,
  correctionEntryIdForTimeRecord,
  importTimeRecords,
  loadSharedAccountingPeriodState,
  loadTimeAccountingStore,
  saveAccountingPeriodState,
  reregisterImportedTimeRecord,
  reregistrationEntryIdForTimeRecord,
  reversalEntryIdForTimeRecord,
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

test('cancels an imported record with one balanced inverse journal and restores its history links', async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const record = timeRecord('cancel:day:2026-11-10', 61);
  const imported = await importTimeRecords([record], options(storage, locks));
  const originalSnapshot = JSON.stringify(imported.store.ledger.entries[0]);
  const result = await cancelImportedTimeRecord(record.recordId, {
    ...options(storage, locks),
    now: () => Date.parse('2026-11-11T03:00:00Z'),
  });

  assert.equal(result.cancelled, true);
  assert.equal(result.alreadyCancelled, false);
  assert.equal(JSON.stringify(result.store.ledger.entries[0]), originalSnapshot);
  assert.equal(result.store.ledger.measurements[0].actualInputSeconds, 61);
  assert.equal(result.store.ledger.entries.length, 2);
  const reversal = result.store.ledger.entries[1];
  assert.equal(reversal.id, reversalEntryIdForTimeRecord(record.recordId));
  assert.equal(reversal.reversesEntryId, imported.store.ledger.entries[0].id);
  assert.deepEqual(reversal.lines.map((line) => [line.side, line.account, line.seconds]), [
    ['debit', TIME_ACCOUNTS.timeContribution, 61],
    ['credit', TIME_ACCOUNTS.aiClearing, 61],
  ]);
  assert.equal(isBalancedJournalEntry(reversal), true);
  const restored = loadTimeAccountingStore(storage);
  assert.equal(restored.importedRecords[0].reversalEntryId, reversal.id);
  assert.equal(restored.ledger.measurements[0].reversalEntryId, reversal.id);
});

test('double clicks, concurrent tabs and a resent source record never create another reversal or usage', async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const record = timeRecord('cancel-concurrent:day:2026-11-10', 60);
  await importTimeRecords([record], options(storage, locks));
  const cancelOptions = {
    ...options(storage, locks),
    now: () => Date.parse('2026-11-11T03:00:00Z'),
  };
  const results = await Promise.all([
    cancelImportedTimeRecord(record.recordId, cancelOptions),
    cancelImportedTimeRecord(record.recordId, cancelOptions),
  ]);
  assert.deepEqual(results.map((result) => result.cancelled).sort(), [false, true]);
  const resent = await importTimeRecords([record], options(storage, locks));
  assert.equal(resent.importedCount, 0);
  assert.equal(resent.skippedCount, 1);
  assert.equal(resent.store.ledger.entries.filter((entry) => entry.kind === 'ai-usage').length, 1);
  assert.equal(resent.store.ledger.entries.filter((entry) => entry.kind === 'usage-reversal').length, 1);
});

test('a failed cancellation save changes nothing and a retry creates exactly one reversal', async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const record = timeRecord('cancel-retry:day:2026-11-10', 59);
  await importTimeRecords([record], options(storage, locks));
  const snapshot = storage.getItem(TIME_ACCOUNTING_STORAGE_BASE_KEY);
  storage.failNextSet = true;
  await assert.rejects(
    () => cancelImportedTimeRecord(record.recordId, options(storage, locks)),
    (error) => error instanceof TimeAccountingImportError && error.code === 'SAVE_FAILED',
  );
  assert.equal(storage.getItem(TIME_ACCOUNTING_STORAGE_BASE_KEY), snapshot);
  assert.equal(loadTimeAccountingStore(storage).ledger.entries.length, 1);
  const retry = await cancelImportedTimeRecord(record.recordId, options(storage, locks));
  assert.equal(retry.cancelled, true);
  const lostResponseRetry = await cancelImportedTimeRecord(record.recordId, options(storage, locks));
  assert.equal(lostResponseRetry.alreadyCancelled, true);
  assert.equal(lostResponseRetry.store.ledger.entries.length, 2);
});

test('keeps a closed month unchanged and posts the correction into a later open month', async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const record = timeRecord('closed:day:2026-09-30', 60, '2026-09-30');
  const imported = await importTimeRecords([record], options(storage, locks));
  const adjustedLedger = recordMonthEndAdjustment(imported.store.ledger, {
    entryId: 'closed-month-adjustment',
    sourceEventId: imported.store.importedRecords[0].sourceEventId,
    postedOn: '2026-09-30',
  });
  storage.setItem(TIME_ACCOUNTING_STORAGE_BASE_KEY, JSON.stringify({
    ...imported.store,
    ledger: adjustedLedger,
  }));
  const closedSnapshot = JSON.stringify(adjustedLedger.entries);
  await assert.rejects(
    () => cancelImportedTimeRecord(record.recordId, {
      storage, locks, now: () => Date.parse('2026-09-30T12:00:00Z'),
    }),
    (error) => error instanceof TimeAccountingImportError && error.code === 'CLOSED_PERIOD',
  );
  assert.equal(JSON.stringify(loadTimeAccountingStore(storage).ledger.entries), closedSnapshot);
  const corrected = await cancelImportedTimeRecord(record.recordId, {
    storage, locks, now: () => Date.parse('2026-10-01T12:00:00Z'),
  });
  assert.deepEqual(corrected.store.ledger.entries.slice(0, 2), adjustedLedger.entries);
  assert.equal(corrected.store.ledger.entries[2].postedOn, '2026-10-01');
  const restored = await reregisterImportedTimeRecord(record.recordId, {
    storage, locks, now: () => Date.parse('2026-10-02T12:00:00Z'),
  });
  assert.deepEqual(restored.store.ledger.entries.slice(0, 2), adjustedLedger.entries);
  assert.equal(restored.store.ledger.entries[3].postedOn, '2026-10-02');
});

test('re-registers 61 seconds with a third linked journal while preserving the original and reversal', async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const record = timeRecord('reregister:day:2026-11-10', 61);
  await importTimeRecords([record], options(storage, locks));
  await cancelImportedTimeRecord(record.recordId, {
    storage, locks, now: () => Date.parse('2026-11-11T03:00:00Z'),
  });
  const before = loadTimeAccountingStore(storage);
  const originalAndReversal = JSON.stringify(before.ledger.entries);
  const result = await reregisterImportedTimeRecord(record.recordId, {
    storage, locks, now: () => Date.parse('2026-11-12T03:00:00Z'),
  });
  assert.equal(result.reregistered, true);
  assert.equal(result.alreadyRegistered, false);
  assert.equal(JSON.stringify(result.store.ledger.entries.slice(0, 2)), originalAndReversal);
  assert.equal(result.store.ledger.measurements[0].actualInputSeconds, 61);
  assert.equal(result.store.ledger.entries.length, 3);
  const reregistration = result.store.ledger.entries[2];
  assert.equal(reregistration.id, reregistrationEntryIdForTimeRecord(record.recordId));
  assert.equal(reregistration.kind, 'usage-reregistration');
  assert.equal(reregistration.restoresEntryId, result.store.ledger.entries[1].id);
  assert.deepEqual(reregistration.lines.map((line) => [line.side, line.account, line.seconds]), [
    ['debit', TIME_ACCOUNTS.aiClearing, 61],
    ['credit', TIME_ACCOUNTS.timeContribution, 61],
  ]);
  assert.deepEqual(result.store.importedRecords[0].actions?.map((action) => action.kind), [
    'cancellation', 'reregistration',
  ]);
  const resent = await importTimeRecords([record], options(storage, locks));
  assert.equal(resent.importedCount, 0);
  assert.equal(resent.store.ledger.entries.length, 3);
});

test('serializes concurrent re-registration and permits one later re-cancellation', async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const record = timeRecord('reregister-concurrent:day:2026-11-10', 60);
  await importTimeRecords([record], options(storage, locks));
  await cancelImportedTimeRecord(record.recordId, options(storage, locks));
  const operationOptions = {
    storage, locks, now: () => Date.parse('2026-11-12T03:00:00Z'),
  };
  const results = await Promise.all([
    reregisterImportedTimeRecord(record.recordId, operationOptions),
    reregisterImportedTimeRecord(record.recordId, operationOptions),
  ]);
  assert.deepEqual(results.map((result) => result.reregistered).sort(), [false, true]);
  const restored = loadTimeAccountingStore(storage);
  assert.equal(restored.ledger.entries.filter((entry) => entry.kind === 'usage-reregistration').length, 1);
  const recancelled = await cancelImportedTimeRecord(record.recordId, {
    storage, locks, now: () => Date.parse('2026-11-13T03:00:00Z'),
  });
  assert.equal(recancelled.cancelled, true);
  assert.equal(recancelled.reversalEntryId, reversalEntryIdForTimeRecord(record.recordId, 2));
  assert.equal(recancelled.store.ledger.entries.length, 4);
  assert.equal(recancelled.store.ledger.entries[3].reversesEntryId, restored.ledger.entries[2].id);
  assert.deepEqual(recancelled.store.importedRecords[0].actions?.map((action) => action.kind), [
    'cancellation', 'reregistration', 'cancellation',
  ]);
});

test('a failed re-registration save changes nothing and retries without a duplicate', async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const record = timeRecord('reregister-retry:day:2026-11-10', 59);
  await importTimeRecords([record], options(storage, locks));
  await cancelImportedTimeRecord(record.recordId, options(storage, locks));
  const snapshot = storage.getItem(TIME_ACCOUNTING_STORAGE_BASE_KEY);
  storage.failNextSet = true;
  await assert.rejects(
    () => reregisterImportedTimeRecord(record.recordId, options(storage, locks)),
    (error) => error instanceof TimeAccountingImportError && error.code === 'SAVE_FAILED',
  );
  assert.equal(storage.getItem(TIME_ACCOUNTING_STORAGE_BASE_KEY), snapshot);
  assert.equal(loadTimeAccountingStore(storage).ledger.entries.length, 2);
  const retry = await reregisterImportedTimeRecord(record.recordId, options(storage, locks));
  assert.equal(retry.reregistered, true);
  const lostResponseRetry = await reregisterImportedTimeRecord(record.recordId, options(storage, locks));
  assert.equal(lostResponseRetry.alreadyRegistered, true);
  assert.equal(lostResponseRetry.store.ledger.entries.length, 3);
});

test('restores the dedicated ledger after a page reload', async () => {
  const storage = new MemoryStorage();
  await importTimeRecords([timeRecord('reload:day:2026-11-10', 59)], options(storage));
  const restored = loadTimeAccountingStore(storage);
  assert.equal(restored.storeVersion, 2);
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

test('corrects 61 seconds down to 45 and up to 90 while preserving the raw measurement', async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const record = timeRecord('correct-sequential:day:2026-11-10', 61);
  await importTimeRecords([record], options(storage, locks));
  const reduced = await correctImportedTimeRecord(record.recordId, 45, '休憩を除外', options(storage, locks));
  assert.equal(reduced.corrected, true);
  assert.equal(reduced.store.ledger.measurements[0].actualInputSeconds, 61);
  assert.equal(reduced.store.ledger.measurements[0].effectiveInputSeconds, 45);
  assert.equal(reduced.store.ledger.entries[1].lines[0].account, TIME_ACCOUNTS.timeContribution);
  assert.equal(reduced.store.ledger.entries[1].lines[0].seconds, 16);
  const increased = await correctImportedTimeRecord(record.recordId, 90, '', options(storage, locks));
  assert.equal(increased.store.ledger.measurements[0].effectiveInputSeconds, 90);
  assert.equal(increased.store.ledger.entries[2].lines[0].account, TIME_ACCOUNTS.aiClearing);
  assert.equal(increased.store.ledger.entries[2].lines[0].seconds, 45);
  assert.ok(increased.store.ledger.entries.every(isBalancedJournalEntry));
  assert.deepEqual(increased.store.importedRecords[0].actions?.map((action) => action.kind), ['correction', 'correction']);
  assert.equal(loadTimeAccountingStore(storage).ledger.measurements[0].effectiveInputSeconds, 90);
});

test('same-time, double-click and concurrent correction never create duplicate journals', async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const record = timeRecord('correct-concurrent:day:2026-11-10', 61);
  await importTimeRecords([record], options(storage, locks));
  const unchanged = await correctImportedTimeRecord(record.recordId, 61, '', options(storage, locks));
  assert.equal(unchanged.unchanged, true);
  const [first, second] = await Promise.all([
    correctImportedTimeRecord(record.recordId, 45, '', options(storage, locks)),
    correctImportedTimeRecord(record.recordId, 45, '', options(storage, locks)),
  ]);
  assert.equal([first, second].filter((result) => result.corrected).length, 1);
  assert.equal([first, second].filter((result) => result.unchanged).length, 1);
  const restored = loadTimeAccountingStore(storage);
  assert.equal(restored.ledger.entries.filter((entry) => entry.kind === 'usage-correction').length, 1);
  assert.equal(restored.ledger.entries[1].id, correctionEntryIdForTimeRecord(record.recordId));
});

test('failed correction save leaves no journal and retry succeeds once', async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const record = timeRecord('correct-retry:day:2026-11-10', 61);
  await importTimeRecords([record], options(storage, locks));
  storage.failNextSet = true;
  await assert.rejects(
    () => correctImportedTimeRecord(record.recordId, 45, '再試行', options(storage, locks)),
    (error) => error instanceof TimeAccountingImportError && error.code === 'SAVE_FAILED',
  );
  assert.equal(loadTimeAccountingStore(storage).ledger.entries.length, 1);
  const retried = await correctImportedTimeRecord(record.recordId, 45, '再試行', options(storage, locks));
  assert.equal(retried.corrected, true);
  assert.equal(retried.store.ledger.entries.length, 2);
});

test('cancelled records cannot be corrected and re-registration restores the corrected amount', async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const record = timeRecord('correct-cancel:day:2026-11-10', 61);
  await importTimeRecords([record], options(storage, locks));
  await correctImportedTimeRecord(record.recordId, 45, '', options(storage, locks));
  const cancelled = await cancelImportedTimeRecord(record.recordId, options(storage, locks));
  assert.equal(cancelled.store.ledger.entries.at(-1)?.lines[0].seconds, 45);
  await assert.rejects(
    () => correctImportedTimeRecord(record.recordId, 90, '', options(storage, locks)),
    (error) => error instanceof TimeAccountingImportError && error.code === 'INACTIVE_RECORD',
  );
  const restored = await reregisterImportedTimeRecord(record.recordId, options(storage, locks));
  assert.equal(restored.store.ledger.entries.at(-1)?.lines[0].seconds, 45);
  const correctedAgain = await correctImportedTimeRecord(record.recordId, 90, '', options(storage, locks));
  assert.equal(correctedAgain.effectiveSeconds, 90);
});

test('partial correction protects a closed date and posts only in a later open date', async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const record = timeRecord('closed-correction:day:2026-09-30', 61, '2026-09-30');
  const imported = await importTimeRecords([record], options(storage, locks));
  const adjustedLedger = recordMonthEndAdjustment(imported.store.ledger, {
    entryId: 'closed-correction-adjustment',
    sourceEventId: imported.store.importedRecords[0].sourceEventId,
    postedOn: '2026-09-30',
  });
  storage.setItem(TIME_ACCOUNTING_STORAGE_BASE_KEY, JSON.stringify({ ...imported.store, ledger: adjustedLedger }));
  await assert.rejects(
    () => correctImportedTimeRecord(record.recordId, 45, '', {
      storage, locks, now: () => Date.parse('2026-09-30T12:00:00Z'),
    }),
    (error) => error instanceof TimeAccountingImportError && error.code === 'CLOSED_PERIOD',
  );
  assert.equal(loadTimeAccountingStore(storage).ledger.entries.length, 2);
  const corrected = await correctImportedTimeRecord(record.recordId, 45, '', {
    storage, locks, now: () => Date.parse('2026-10-01T12:00:00Z'),
  });
  assert.equal(corrected.store.ledger.entries[2].postedOn, '2026-10-01');
  assert.deepEqual(corrected.store.ledger.entries.slice(0, 2), adjustedLedger.entries);
});

test('allows zero effective seconds but rejects negative corrections', async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const record = timeRecord('correct-zero:day:2026-11-10', 61);
  await importTimeRecords([record], options(storage, locks));
  const corrected = await correctImportedTimeRecord(record.recordId, 0, '', options(storage, locks));
  assert.equal(corrected.effectiveSeconds, 0);
  assert.equal(loadTimeAccountingStore(storage).ledger.measurements[0].effectiveInputSeconds, 0);
  const cancelled = await cancelImportedTimeRecord(record.recordId, options(storage, locks));
  assert.equal(cancelled.store.ledger.entries.at(-1)?.lines[0].seconds, 0);
  const restored = await reregisterImportedTimeRecord(record.recordId, options(storage, locks));
  assert.equal(restored.store.ledger.entries.at(-1)?.lines[0].seconds, 0);
  await assert.rejects(
    () => correctImportedTimeRecord(record.recordId, -1, '', options(storage, locks)),
    (error) => error instanceof TimeAccountingImportError && error.code === 'INVALID_RECORD',
  );
});

test('migrates the existing version-one store with an open shared period state', async () => {
  const storage = new MemoryStorage();
  const imported = await importTimeRecords([
    timeRecord('period-migration:day:2026-11-10', 61),
  ], options(storage));
  const versionOne = {
    storeVersion: 1,
    ledger: imported.store.ledger,
    importedRecords: imported.store.importedRecords,
  };
  storage.setItem(TIME_ACCOUNTING_STORAGE_BASE_KEY, JSON.stringify(versionOne));
  const restored = loadTimeAccountingStore(storage);
  assert.equal(restored.storeVersion, 2);
  assert.equal(restored.ledger.measurements[0].actualInputSeconds, 61);
  assert.deepEqual(restored.periodState.closedPeriods, []);
});

test('persists and restores shared month-close state without changing either ledger collection', async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const imported = await importTimeRecords([
    timeRecord('period-save:day:2026-11-10', 61),
  ], options(storage, locks));
  const periodState = withClosedAccountingPeriod(
    createAccountingPeriodState('Asia/Tokyo'),
    '2026-10',
    '2026-11-01T01:02:03.000Z',
  );
  const saved = await saveAccountingPeriodState(periodState, { storage, locks });
  assert.deepEqual(saved.store.ledger, imported.store.ledger);
  assert.deepEqual(saved.store.importedRecords, imported.store.importedRecords);
  assert.deepEqual(loadTimeAccountingStore(storage).periodState, periodState);
  assert.deepEqual(loadSharedAccountingPeriodState(storage), periodState);
  const importedAfterSave = await importTimeRecords([
    timeRecord('period-save-next:day:2026-11-11', 59, '2026-11-11'),
  ], options(storage, locks));
  assert.deepEqual(importedAfterSave.store.periodState, periodState);
});

test('a failed month-close state save leaves the previous complete store untouched', async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  await importTimeRecords([timeRecord('period-failure:day:2026-11-10', 61)], options(storage, locks));
  const snapshot = storage.getItem(TIME_ACCOUNTING_STORAGE_BASE_KEY);
  storage.failNextSet = true;
  const periodState = withClosedAccountingPeriod(
    createAccountingPeriodState('UTC'),
    '2026-10',
    '2026-11-01T00:00:00.000Z',
  );
  await assert.rejects(
    () => saveAccountingPeriodState(periodState, { storage, locks }),
    (error) => error instanceof TimeAccountingImportError && error.code === 'SAVE_FAILED',
  );
  assert.equal(storage.getItem(TIME_ACCOUNTING_STORAGE_BASE_KEY), snapshot);
  assert.deepEqual(loadTimeAccountingStore(storage).periodState.closedPeriods, []);
});

test('serializes stale month-close state saves without losing either closed month', async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const october = withClosedAccountingPeriod(
    createAccountingPeriodState('Asia/Tokyo'), '2026-10', '2026-11-01T00:00:00.000Z',
  );
  const november = withClosedAccountingPeriod(
    createAccountingPeriodState('Asia/Tokyo'), '2026-11', '2026-12-01T00:00:00.000Z',
  );
  await Promise.all([
    saveAccountingPeriodState(october, { storage, locks }),
    saveAccountingPeriodState(november, { storage, locks }),
  ]);
  assert.deepEqual(
    loadTimeAccountingStore(storage).periodState.closedPeriods.map((item) => item.periodKey),
    ['2026-10', '2026-11'],
  );
});

test('late records keep their actual date and post on the first day of the next open month', async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  let periodState = withClosedAccountingPeriod(
    createAccountingPeriodState('Asia/Tokyo'), '2026-10', '2026-11-01T00:00:00.000Z',
  );
  periodState = withClosedAccountingPeriod(periodState, '2026-11', '2026-12-01T00:00:00.000Z');
  await saveAccountingPeriodState(periodState, { storage, locks });

  const late = await importTimeRecords([
    timeRecord('late-closed:day:2026-10-31', 61, '2026-10-31'),
  ], options(storage, locks));
  assert.equal(late.store.ledger.measurements[0].occurredOn, '2026-10-31');
  assert.equal(late.store.ledger.entries[0].postedOn, '2026-12-01');
  assert.equal(late.store.ledger.entries[0].lines[0].seconds, 61);

  const open = await importTimeRecords([
    timeRecord('open-period:day:2026-12-15', 59, '2026-12-15'),
  ], options(storage, locks));
  assert.equal(open.store.ledger.entries[1].postedOn, '2026-12-15');
});

test('cancellation, re-registration and correction never rewrite a closed month', async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const record = timeRecord('closed-actions:day:2026-09-30', 61, '2026-09-30');
  await importTimeRecords([record], {
    storage, locks, now: () => Date.parse('2026-09-30T12:00:00Z'),
  });
  let periodState = withClosedAccountingPeriod(
    createAccountingPeriodState('Asia/Tokyo'), '2026-09', '2026-10-01T00:00:00.000Z',
  );
  periodState = withClosedAccountingPeriod(periodState, '2026-10', '2026-11-01T00:00:00.000Z');
  await saveAccountingPeriodState(periodState, { storage, locks });
  const actionOptions = { storage, locks, now: () => Date.parse('2026-09-30T12:00:00Z') };

  const cancelled = await cancelImportedTimeRecord(record.recordId, actionOptions);
  const restored = await reregisterImportedTimeRecord(record.recordId, actionOptions);
  const corrected = await correctImportedTimeRecord(record.recordId, 45, '差分', actionOptions);
  assert.deepEqual(
    corrected.store.ledger.entries.map((entry) => entry.postedOn),
    ['2026-09-30', '2026-11-01', '2026-11-01', '2026-11-01'],
  );
  assert.equal(cancelled.store.ledger.entries[0].postedOn, '2026-09-30');
  assert.equal(restored.store.ledger.entries[0].postedOn, '2026-09-30');
  assert.equal(corrected.store.ledger.measurements[0].occurredOn, '2026-09-30');
  assert.ok(corrected.store.ledger.entries.every(isBalancedJournalEntry));
});

test('a close racing another tab wins before its queued late import', async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const periodState = withClosedAccountingPeriod(
    createAccountingPeriodState('Asia/Tokyo'), '2026-10', '2026-11-01T00:00:00.000Z',
  );
  const [, imported] = await Promise.all([
    saveAccountingPeriodState(periodState, { storage, locks }),
    importTimeRecords([
      timeRecord('close-race:day:2026-10-31', 60, '2026-10-31'),
    ], options(storage, locks)),
  ]);
  assert.equal(imported.store.ledger.measurements[0].occurredOn, '2026-10-31');
  assert.equal(imported.store.ledger.entries[0].postedOn, '2026-11-01');
});
