import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../chrome-extension/activityTracker.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context);
const tracker = (context as { ActivityTrackerCore: any }).ActivityTrackerCore;

const at = (iso: string) => Date.parse(iso);
const segment = (id: string, startedAt: number, endedAt: number, durationMs = endedAt - startedAt) => ({
  id, startedAt, endedAt, durationMs, durationSeconds: Math.floor(durationMs / 1000),
});

function split(sessionId: string, timeZone: string, segments: any[], totalSeconds?: number) {
  return tracker.splitMeasuredSegmentsByDate({
    sessionId,
    timeZone,
    segments,
    totalSeconds: totalSeconds ?? Math.floor(segments.reduce((sum, item) => sum + item.durationMs, 0) / 1000),
  });
}

test('keeps usage within one local date as one deterministic daily record', () => {
  const startedAt = at('2026-06-15T10:00:00.000Z');
  const records = split('same-day', 'UTC', [segment('segment-1', startedAt, startedAt + 61_000)]);

  assert.equal(records.length, 1);
  assert.equal(records[0].localDate, '2026-06-15');
  assert.equal(records[0].recordId, 'same-day:day:2026-06-15');
  assert.equal(records[0].durationSeconds, 61);
});

test('splits a measured interval exactly at the local date boundary', () => {
  const records = split('date-boundary', 'UTC', [segment(
    'segment-1',
    at('2026-06-15T23:59:30.000Z'),
    at('2026-06-16T00:00:30.000Z'),
  )]);

  assert.deepEqual(Array.from(records, (record: any) => [record.localDate, record.durationSeconds]), [
    ['2026-06-15', 30],
    ['2026-06-16', 30],
  ]);
});

test('splits month-end and year-end intervals without losing seconds', () => {
  const monthEnd = split('month-end', 'UTC', [segment(
    'month-segment',
    at('2026-06-30T23:59:45.000Z'),
    at('2026-07-01T00:00:30.000Z'),
  )]);
  assert.deepEqual(Array.from(monthEnd, (record: any) => [record.localDate, record.durationSeconds]), [
    ['2026-06-30', 15],
    ['2026-07-01', 30],
  ]);

  const yearEnd = split('year-end', 'UTC', [segment(
    'year-segment',
    at('2026-12-31T23:59:40.000Z'),
    at('2027-01-01T00:00:40.000Z'),
  )]);
  assert.deepEqual(Array.from(yearEnd, (record: any) => [record.localDate, record.durationSeconds]), [
    ['2026-12-31', 20],
    ['2027-01-01', 40],
  ]);
});

test('uses only measured segments and excludes an idle gap across midnight', () => {
  const records = split('idle-gap', 'UTC', [
    segment('before-idle', at('2026-06-15T23:58:00.000Z'), at('2026-06-15T23:59:00.000Z')),
    segment('after-idle', at('2026-06-16T00:05:00.000Z'), at('2026-06-16T00:05:30.000Z')),
  ]);

  assert.deepEqual(Array.from(records, (record: any) => [record.localDate, record.durationSeconds]), [
    ['2026-06-15', 60],
    ['2026-06-16', 30],
  ]);
  assert.equal(records.reduce((sum: number, record: any) => sum + record.durationSeconds, 0), 90);
});

test('aggregates multiple measured segments from one session by local date', () => {
  const records = split('multi-segment', 'Asia/Tokyo', [
    segment('morning', at('2026-06-15T00:00:00.000Z'), at('2026-06-15T00:00:20.000Z')),
    segment('evening', at('2026-06-15T10:00:00.000Z'), at('2026-06-15T10:00:40.000Z')),
    segment('next-day', at('2026-06-15T15:00:00.000Z'), at('2026-06-15T15:00:10.000Z')),
  ]);

  assert.deepEqual(Array.from(records, (record: any) => [record.localDate, record.durationSeconds, record.segments.length]), [
    ['2026-06-15', 60, 2],
    ['2026-06-16', 10, 1],
  ]);
});

test('uses IANA timezone rules across daylight-saving changes', () => {
  const records = split('dst-session', 'America/New_York', [
    // 01:59:30 EST to 03:00:30 EDT: the skipped wall-clock hour is not counted.
    segment('spring-forward', at('2026-03-08T06:59:30.000Z'), at('2026-03-08T07:00:30.000Z')),
    // 01:59:30 EDT to 01:00:30 EST: the repeated wall-clock hour is not double-counted.
    segment('fall-back', at('2026-11-01T05:59:30.000Z'), at('2026-11-01T06:00:30.000Z')),
  ]);

  assert.deepEqual(Array.from(records, (record: any) => [record.localDate, record.durationSeconds]), [
    ['2026-03-08', 60],
    ['2026-11-01', 60],
  ]);
  assert.equal(records.reduce((sum: number, record: any) => sum + record.durationSeconds, 0), 120);
});

test('distributes fractional seconds deterministically while preserving the exact total', () => {
  const records = split('fractional', 'UTC', [
    segment('day-one', at('2026-06-15T12:00:00.000Z'), at('2026-06-15T12:00:01.500Z')),
    segment('day-two', at('2026-06-16T12:00:00.000Z'), at('2026-06-16T12:00:01.500Z')),
  ], 3);

  assert.deepEqual(Array.from(records, (record: any) => [record.localDate, record.durationSeconds]), [
    ['2026-06-15', 2],
    ['2026-06-16', 1],
  ]);
  assert.equal(records.reduce((sum: number, record: any) => sum + record.durationSeconds, 0), 3);
});

test('re-running the split produces the same unique ids without duplicate daily records', () => {
  const segments = [
    segment('part-1', at('2026-06-15T23:59:30.000Z'), at('2026-06-16T00:00:30.000Z')),
    segment('part-2', at('2026-06-16T00:02:00.000Z'), at('2026-06-16T00:02:10.000Z')),
  ];
  const first = split('stable-session', 'UTC', segments);
  const second = split('stable-session', 'UTC', segments);

  assert.deepEqual(first, second);
  assert.deepEqual(Array.from(first, (record: any) => record.recordId), [
    'stable-session:day:2026-06-15',
    'stable-session:day:2026-06-16',
  ]);
  assert.equal(new Set(first.map((record: any) => record.recordId)).size, first.length);
});

test('finalized tracker sessions store daily records from their measured segments only', () => {
  const state = tracker.enable(tracker.createState());
  tracker.recordActivity(state, {
    now: at('2026-06-15T23:58:30.000Z'), tabId: 1, windowId: 10,
    activityId: 'tracked-session', timeZone: 'UTC',
  });
  tracker.pause(state, at('2026-06-15T23:59:00.000Z'));
  tracker.recordActivity(state, {
    now: at('2026-06-16T00:05:00.000Z'), tabId: 1, windowId: 10,
    activityId: 'second-segment', timeZone: 'UTC',
  });
  tracker.disable(state, at('2026-06-16T00:05:30.000Z'));

  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].sessionId, 'tracked-session');
  assert.deepEqual(Array.from(state.records[0].dailyRecords, (record: any) => [record.localDate, record.durationSeconds]), [
    ['2026-06-15', 30],
    ['2026-06-16', 30],
  ]);
  assert.equal(state.records[0].durationSeconds, 60);
});
