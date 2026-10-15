import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarDate, dateKey, ledgerDate, parseLedgerDate, periodBounds, selectPeriod, shiftPeriod, formatPeriod } from '../src/ledgerPeriods.ts';

// Isolated date-boundary fixtures; never inserted into the application's ledger.
const dated = (issuedAt: string, conversationDate = '') => ({ issuedAt, conversationDate });
test('strict dates, saved formats, issued date priority and conversation fallback', () => {
  for (const value of ['2026/07/04 10:10', '2026-07-04', '2026年7月4日', '2026.7.4']) {
    assert.equal(dateKey(parseLedgerDate(value)!), '2026-07-04');
  }
  for (const value of ['', '2026/02/30', '2026/13/01', '2026/00/01', '2026/07', '2026/07/040']) assert.equal(parseLedgerDate(value), null);
  assert.equal(dateKey(ledgerDate(dated('2026/07/04', '2026/06/30'))!), '2026-07-04');
  assert.equal(dateKey(ledgerDate(dated('invalid', '2026/06/30'))!), '2026-06-30');
  assert.equal(ledgerDate(dated('invalid', 'invalid')), null);
});
test('Monday through Sunday uses half-open calendar bounds, even over years', () => {
  const anchor = calendarDate(2027, 0, 1);
  const bounds = periodBounds(anchor, 'weekly');
  assert.equal(dateKey(bounds.start), '2026-12-28');
  assert.equal(dateKey(bounds.end), '2027-01-04');
  const records = ['2026/12/27 23:59', '2026/12/28 00:00', '2027/01/03 23:59', '2027/01/04 00:00'].map(v => dated(v));
  assert.deepEqual(selectPeriod(records, anchor, 'weekly'), records.slice(1, 3));
});
test('month/year filter original records, never sum whole crossing weeks', () => {
  const records = ['2026/06/29', '2026/07/01', '2026/07/31 23:59', '2026/08/01', '2027/01/01'].map(v => dated(v));
  assert.deepEqual(selectPeriod(records, calendarDate(2026, 6, 4), 'weekly'), records.slice(0, 2));
  assert.deepEqual(selectPeriod(records, calendarDate(2026, 6, 4), 'monthly'), records.slice(1, 3));
  assert.deepEqual(selectPeriod(records, calendarDate(2026, 6, 4), 'annual'), records.slice(0, 4));
});
test('leap days, end-of-month movement and compact period labels', () => {
  assert.equal(dateKey(shiftPeriod(calendarDate(2028, 0, 31), 'monthly', 1)), '2028-02-29');
  assert.equal(dateKey(shiftPeriod(calendarDate(2028, 1, 29), 'annual', 1)), '2029-02-28');
  assert.equal(formatPeriod(calendarDate(2026, 9, 16), 'weekly'), '2026/10/12（月）〜10/18（日）');
  assert.equal(formatPeriod(calendarDate(2027, 0, 1), 'weekly'), '2026/12/28（月）〜2027/01/03（日）');
});
test('ISO timestamps use the browser/runtime timezone, not the literal ISO calendar day', () => {
  const instant = new Date('2026-06-30T16:00:00Z');
  assert.equal(dateKey(parseLedgerDate('2026-06-30T16:00:00Z')!), dateKey(instant));
  const data = [dated('2026-07-01T00:00:00+09:00'), dated('2026-07-01T00:00:00-07:00')];
  assert.equal(selectPeriod(data, instant, 'annual').length, 2);
});
test('adjacent weeks partition dated records once; invalid dates are excluded without rewriting', () => {
  const records = ['2026/07/05', '2026/07/06', 'bad'].map(v => dated(v));
  const snapshot = JSON.stringify(records);
  const left = selectPeriod(records, calendarDate(2026, 6, 5), 'weekly');
  const right = selectPeriod(records, calendarDate(2026, 6, 6), 'weekly');
  assert.equal(left.length, 1); assert.equal(right.length, 1);
  assert.equal(new Set([...left, ...right]).size, 2);
  assert.equal(JSON.stringify(records), snapshot);
});

test('month navigation crosses years and calendar weeks respect daylight-saving changes', () => {
  assert.equal(dateKey(shiftPeriod(calendarDate(2026, 11, 31), 'monthly', 1)), '2027-01-31');
  assert.equal(dateKey(shiftPeriod(calendarDate(2027, 0, 31), 'monthly', -1)), '2026-12-31');
  const { start, end } = periodBounds(calendarDate(2026, 2, 8), 'weekly');
  assert.equal(dateKey(start), '2026-03-02');
  assert.equal(dateKey(end), '2026-03-09');
  if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'America/Los_Angeles') assert.equal((end.getTime() - start.getTime()) / 3600000, 167);
});
