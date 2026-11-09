import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIME_ACCOUNTS,
  TimeAccountingError,
  accountBalanceMinutes,
  calculateTimeProfitAndLoss,
  createTimeAccountingLedger,
  isBalancedJournalEntry,
  journalTotals,
  recordAiUsage,
  recordMonthEndAdjustment,
  summarizeTimeMeasurements,
} from '../src/timeAccounting.ts';

const usage = {
  entryId: 'entry-use-001',
  sourceEventId: 'conversation-001',
  occurredOn: '2026-10-20',
  actualInputMinutes: 60,
  estimatedSavedMinutes: 180,
};

test('records 60 actual minutes as AI clearing debit and time contribution credit', () => {
  const ledger = recordAiUsage(createTimeAccountingLedger(), usage);
  assert.equal(ledger.unit, 'minute');
  assert.deepEqual(ledger.entries[0], {
    id: 'entry-use-001',
    kind: 'ai-usage',
    postedOn: '2026-10-20',
    sourceEventId: 'conversation-001',
    lines: [
      { side: 'debit', account: 'AI仮受品', minutes: 60, measurement: 'actual-input' },
      { side: 'credit', account: '時間拠出', minutes: 60, measurement: 'actual-input' },
    ],
  });
  assert.deepEqual(journalTotals(ledger.entries[0]), { debitMinutes: 60, creditMinutes: 60 });
  assert.equal(isBalancedJournalEntry(ledger.entries[0]), true);
});

test('moves the same actual 60 minutes to thought exploration expense at month end', () => {
  const used = recordAiUsage(createTimeAccountingLedger(), usage);
  const adjusted = recordMonthEndAdjustment(used, {
    entryId: 'entry-close-001',
    sourceEventId: 'conversation-001',
    postedOn: '2026-10-31',
  });

  assert.deepEqual(adjusted.entries[1], {
    id: 'entry-close-001',
    kind: 'month-end-adjustment',
    postedOn: '2026-10-31',
    sourceEventId: 'conversation-001',
    lines: [
      { side: 'debit', account: '思考探究費', minutes: 60, measurement: 'actual-input' },
      { side: 'credit', account: 'AI仮受品', minutes: 60, measurement: 'actual-input' },
    ],
  });
  assert.ok(adjusted.entries.every(isBalancedJournalEntry));
  assert.equal(accountBalanceMinutes(adjusted, TIME_ACCOUNTS.aiClearing), 0);
  assert.equal(accountBalanceMinutes(adjusted, TIME_ACCOUNTS.timeContribution), -60);
  assert.deepEqual(calculateTimeProfitAndLoss(adjusted), {
    thoughtExplorationExpenseMinutes: 60,
  });
});

test('keeps estimated savings separate and excludes them from profit and loss', () => {
  const used = recordAiUsage(createTimeAccountingLedger(), usage);
  assert.deepEqual(summarizeTimeMeasurements(used), {
    actualInputMinutes: 60,
    estimatedSavedMinutes: 180,
  });
  assert.deepEqual(calculateTimeProfitAndLoss(used), {
    thoughtExplorationExpenseMinutes: 0,
  });

  const adjusted = recordMonthEndAdjustment(used, {
    entryId: 'entry-close-001',
    sourceEventId: 'conversation-001',
    postedOn: '2026-10-31',
  });
  assert.equal(calculateTimeProfitAndLoss(adjusted).thoughtExplorationExpenseMinutes, 60);
  assert.equal(JSON.stringify(adjusted.entries).includes('180'), false);
});

test('rejects duplicate source events and duplicate journal entry ids without changing the ledger', () => {
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

test('allows each source event to be adjusted only once and requires an existing usage', () => {
  const used = recordAiUsage(createTimeAccountingLedger(), usage);
  assert.throws(
    () => recordMonthEndAdjustment(used, {
      entryId: 'entry-close-unknown', sourceEventId: 'unknown', postedOn: '2026-10-31',
    }),
    (error) => error instanceof TimeAccountingError && error.code === 'UNKNOWN_SOURCE_EVENT',
  );
  const adjusted = recordMonthEndAdjustment(used, {
    entryId: 'entry-close-001', sourceEventId: 'conversation-001', postedOn: '2026-10-31',
  });
  assert.throws(
    () => recordMonthEndAdjustment(adjusted, {
      entryId: 'entry-close-002', sourceEventId: 'conversation-001', postedOn: '2026-10-31',
    }),
    (error) => error instanceof TimeAccountingError && error.code === 'ALREADY_ADJUSTED',
  );
});

test('accepts only valid whole-minute measurements and calendar dates', () => {
  for (const actualInputMinutes of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => recordAiUsage(createTimeAccountingLedger(), { ...usage, actualInputMinutes }),
      (error) => error instanceof TimeAccountingError && error.code === 'INVALID_ACTUAL_MINUTES',
    );
  }
  for (const estimatedSavedMinutes of [-1, 1.5, Number.NaN]) {
    assert.throws(
      () => recordAiUsage(createTimeAccountingLedger(), { ...usage, estimatedSavedMinutes }),
      (error) => error instanceof TimeAccountingError && error.code === 'INVALID_ESTIMATED_MINUTES',
    );
  }
  for (const occurredOn of ['2026/10/20', '2026-02-29', '2026-13-01', '']) {
    assert.throws(
      () => recordAiUsage(createTimeAccountingLedger(), { ...usage, occurredOn }),
      (error) => error instanceof TimeAccountingError && error.code === 'INVALID_DATE',
    );
  }
  assert.doesNotThrow(() => recordAiUsage(createTimeAccountingLedger(), {
    ...usage, occurredOn: '2028-02-29', estimatedSavedMinutes: 0,
  }));
});

test('rejects an adjustment dated before its source usage', () => {
  const used = recordAiUsage(createTimeAccountingLedger(), usage);
  assert.throws(
    () => recordMonthEndAdjustment(used, {
      entryId: 'entry-close-001', sourceEventId: 'conversation-001', postedOn: '2026-10-19',
    }),
    (error) => error instanceof TimeAccountingError && error.code === 'ADJUSTMENT_BEFORE_USAGE',
  );
});
