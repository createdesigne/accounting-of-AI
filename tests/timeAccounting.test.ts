import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIME_ACCOUNTS,
  TimeAccountingError,
  accountBalanceSeconds,
  calculateTimeProfitAndLoss,
  createTimeAccountingLedger,
  isBalancedJournalEntry,
  journalTotals,
  migrateTimeAccountingLedger,
  recordAiUsage,
  recordMonthEndAdjustment,
  summarizeTimeMeasurements,
} from '../src/timeAccounting.ts';

const usage = {
  entryId: 'entry-use-001',
  sourceEventId: 'conversation-001',
  occurredOn: '2026-10-20',
  actualInputSeconds: 3_600,
  estimatedSavedSeconds: 10_800,
};

test('records seconds as balanced AI clearing and time contribution lines', () => {
  const ledger = recordAiUsage(createTimeAccountingLedger(), usage);
  assert.equal(ledger.version, 2);
  assert.equal(ledger.unit, 'second');
  assert.deepEqual(ledger.entries[0], {
    id: 'entry-use-001', kind: 'ai-usage', postedOn: '2026-10-20', sourceEventId: 'conversation-001',
    lines: [
      { side: 'debit', account: 'AI仮受品', seconds: 3_600, measurement: 'actual-input' },
      { side: 'credit', account: '時間拠出', seconds: 3_600, measurement: 'actual-input' },
    ],
  });
  assert.deepEqual(journalTotals(ledger.entries[0]), { debitSeconds: 3_600, creditSeconds: 3_600 });
  assert.equal(isBalancedJournalEntry(ledger.entries[0]), true);
});

test('preserves 1, 59, 60 and 61 seconds exactly and keeps every entry balanced', () => {
  let ledger = createTimeAccountingLedger();
  for (const seconds of [1, 59, 60, 61]) {
    ledger = recordAiUsage(ledger, {
      entryId: `entry-${seconds}`, sourceEventId: `event-${seconds}`,
      occurredOn: '2026-10-20', actualInputSeconds: seconds,
    });
  }
  assert.deepEqual(ledger.measurements.map(item => item.actualInputSeconds), [1, 59, 60, 61]);
  assert.deepEqual(ledger.entries.map(entry => journalTotals(entry)), [
    { debitSeconds: 1, creditSeconds: 1 },
    { debitSeconds: 59, creditSeconds: 59 },
    { debitSeconds: 60, creditSeconds: 60 },
    { debitSeconds: 61, creditSeconds: 61 },
  ]);
  assert.ok(ledger.entries.every(isBalancedJournalEntry));
});

test('moves the same seconds to thought exploration expense at month end', () => {
  const used = recordAiUsage(createTimeAccountingLedger(), usage);
  const adjusted = recordMonthEndAdjustment(used, {
    entryId: 'entry-close-001', sourceEventId: 'conversation-001', postedOn: '2026-10-31',
  });
  assert.deepEqual(adjusted.entries[1].lines, [
    { side: 'debit', account: '思考探究費', seconds: 3_600, measurement: 'actual-input' },
    { side: 'credit', account: 'AI仮受品', seconds: 3_600, measurement: 'actual-input' },
  ]);
  assert.ok(adjusted.entries.every(isBalancedJournalEntry));
  assert.equal(accountBalanceSeconds(adjusted, TIME_ACCOUNTS.aiClearing), 0);
  assert.equal(accountBalanceSeconds(adjusted, TIME_ACCOUNTS.timeContribution), -3_600);
  assert.deepEqual(calculateTimeProfitAndLoss(adjusted), { thoughtExplorationExpenseSeconds: 3_600 });
});

test('migrates legacy whole minutes to exact seconds only once', () => {
  const legacy = {
    version: 1, unit: 'minute',
    measurements: [{
      sourceEventId: 'legacy-event', occurredOn: '2026-09-30',
      actualInputMinutes: 2, estimatedSavedMinutes: 3,
      usageEntryId: 'legacy-use', monthEndAdjustmentEntryId: 'legacy-close',
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
  };
  const migrated = migrateTimeAccountingLedger(legacy);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.unit, 'second');
  assert.equal(migrated.measurements[0].actualInputSeconds, 120);
  assert.equal(migrated.measurements[0].estimatedSavedSeconds, 180);
  assert.ok(migrated.entries.every(entry => entry.lines.every(line => line.seconds === 120)));
  assert.deepEqual(migrateTimeAccountingLedger(migrated), migrated);
});

test('rejects an unbalanced legacy ledger instead of silently migrating it', () => {
  const invalid = {
    version: 1, unit: 'minute',
    measurements: [{ sourceEventId: 'event', occurredOn: '2026-10-20', actualInputMinutes: 1, estimatedSavedMinutes: 0, usageEntryId: 'entry' }],
    entries: [{
      id: 'entry', kind: 'ai-usage', postedOn: '2026-10-20', sourceEventId: 'event',
      lines: [
        { side: 'debit', account: 'AI仮受品', minutes: 1, measurement: 'actual-input' },
        { side: 'credit', account: '時間拠出', minutes: 2, measurement: 'actual-input' },
      ],
    }],
  };
  assert.throws(
    () => migrateTimeAccountingLedger(invalid),
    (error) => error instanceof TimeAccountingError && error.code === 'INVALID_LEDGER',
  );
});

test('keeps estimated savings separate and excludes them from profit and loss', () => {
  const used = recordAiUsage(createTimeAccountingLedger(), usage);
  assert.deepEqual(summarizeTimeMeasurements(used), {
    actualInputSeconds: 3_600, estimatedSavedSeconds: 10_800,
  });
  assert.deepEqual(calculateTimeProfitAndLoss(used), { thoughtExplorationExpenseSeconds: 0 });
  assert.equal(JSON.stringify(used.entries).includes('10800'), false);
});

test('rejects duplicate source events and duplicate journal entry ids without mutation', () => {
  const ledger = recordAiUsage(createTimeAccountingLedger(), usage);
  const snapshot = JSON.stringify(ledger);
  assert.throws(
    () => recordAiUsage(ledger, { ...usage, entryId: 'entry-use-002' }),
    (error) => error instanceof TimeAccountingError && error.code === 'DUPLICATE_SOURCE_EVENT',
  );
  assert.throws(
    () => recordAiUsage(ledger, { ...usage, sourceEventId: 'conversation-002' }),
    (error) => error instanceof TimeAccountingError && error.code === 'DUPLICATE_ENTRY_ID',
  );
  assert.equal(JSON.stringify(ledger), snapshot);
});

test('allows one adjustment per event and rejects unknown or earlier adjustments', () => {
  const used = recordAiUsage(createTimeAccountingLedger(), usage);
  assert.throws(
    () => recordMonthEndAdjustment(used, { entryId: 'unknown', sourceEventId: 'unknown', postedOn: '2026-10-31' }),
    (error) => error instanceof TimeAccountingError && error.code === 'UNKNOWN_SOURCE_EVENT',
  );
  assert.throws(
    () => recordMonthEndAdjustment(used, { entryId: 'early', sourceEventId: usage.sourceEventId, postedOn: '2026-10-19' }),
    (error) => error instanceof TimeAccountingError && error.code === 'ADJUSTMENT_BEFORE_USAGE',
  );
  const adjusted = recordMonthEndAdjustment(used, { entryId: 'close', sourceEventId: usage.sourceEventId, postedOn: '2026-10-31' });
  assert.throws(
    () => recordMonthEndAdjustment(adjusted, { entryId: 'again', sourceEventId: usage.sourceEventId, postedOn: '2026-10-31' }),
    (error) => error instanceof TimeAccountingError && error.code === 'ALREADY_ADJUSTED',
  );
});

test('accepts only valid whole seconds and calendar dates', () => {
  for (const actualInputSeconds of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => recordAiUsage(createTimeAccountingLedger(), { ...usage, actualInputSeconds }),
      (error) => error instanceof TimeAccountingError && error.code === 'INVALID_ACTUAL_SECONDS',
    );
  }
  for (const estimatedSavedSeconds of [-1, 1.5, Number.NaN]) {
    assert.throws(
      () => recordAiUsage(createTimeAccountingLedger(), { ...usage, estimatedSavedSeconds }),
      (error) => error instanceof TimeAccountingError && error.code === 'INVALID_ESTIMATED_SECONDS',
    );
  }
  for (const occurredOn of ['2026/10/20', '2026-02-29', '2026-13-01', '']) {
    assert.throws(
      () => recordAiUsage(createTimeAccountingLedger(), { ...usage, occurredOn }),
      (error) => error instanceof TimeAccountingError && error.code === 'INVALID_DATE',
    );
  }
  assert.doesNotThrow(() => recordAiUsage(createTimeAccountingLedger(), {
    ...usage, occurredOn: '2028-02-29', estimatedSavedSeconds: 0,
  }));
});
