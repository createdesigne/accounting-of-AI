import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../chrome-extension/activityTracker.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context);
const tracker = (context as { ActivityTrackerCore: any }).ActivityTrackerCore;

function enabledState() {
  return tracker.enable(tracker.createState());
}

test('does not track until the user explicitly enables tracking', () => {
  const state = tracker.createState();
  tracker.recordActivity(state, { now: 0, tabId: 1, windowId: 10, activityId: 'ignored' });
  tracker.tick(state, 60_000);
  const summary = tracker.summary(state);
  assert.equal(summary.enabled, false);
  assert.equal(summary.active, false);
  assert.equal(summary.currentActivityId, null);
  assert.equal(summary.totalSeconds, 0);
  assert.equal(summary.recordCount, 0);
});

test('stops immediately on tab switch and does not count time on another tab', () => {
  const state = enabledState();
  tracker.recordActivity(state, { now: 0, tabId: 1, windowId: 10, activityId: 'activity-1' });
  tracker.pause(state, 12_400);
  tracker.tick(state, 80_000);
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].id, 'activity-1');
  assert.equal(state.records[0].durationSeconds, 12);
  assert.equal(tracker.summary(state).totalSeconds, 12);
});

test('counts at most five minutes after the last operation', () => {
  const state = enabledState();
  tracker.recordActivity(state, { now: 10_000, tabId: 1, windowId: 10, activityId: 'activity-1' });
  tracker.tick(state, 1_000_000);
  assert.equal(state.current, null);
  assert.equal(state.records[0].endedAt, 310_000);
  assert.equal(state.records[0].durationSeconds, 300);
});

test('resumes with a new stable activity id after more than five minutes idle', () => {
  const state = enabledState();
  tracker.recordActivity(state, { now: 0, tabId: 1, windowId: 10, activityId: 'before-idle' });
  tracker.recordActivity(state, { now: 301_000, tabId: 1, windowId: 10, activityId: 'after-idle' });
  tracker.tick(state, 311_000);
  assert.equal(state.records[0].id, 'before-idle');
  assert.equal(state.records[0].durationSeconds, 300);
  assert.equal(state.current.id, 'after-idle');
  assert.equal(tracker.summary(state).totalSeconds, 310);
});

test('repeated ticks never count the same interval twice', () => {
  const state = enabledState();
  tracker.recordActivity(state, { now: 0, tabId: 1, windowId: 10, activityId: 'activity-1' });
  tracker.tick(state, 10_900);
  tracker.tick(state, 10_900);
  tracker.tick(state, 10_900);
  assert.equal(tracker.summary(state).totalSeconds, 10);
  tracker.pause(state, 20_100);
  tracker.pause(state, 30_000);
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].durationSeconds, 20);
});

test('disable finalizes the current record and prevents automatic restart', () => {
  const state = enabledState();
  tracker.recordActivity(state, { now: 0, tabId: 1, windowId: 10, activityId: 'activity-1' });
  tracker.disable(state, 5_000);
  tracker.recordActivity(state, { now: 6_000, tabId: 1, windowId: 10, activityId: 'ignored' });
  assert.equal(state.enabled, false);
  assert.equal(state.current, null);
  assert.equal(state.records[0].durationSeconds, 5);
});

test('an earlier focus-loss timestamp trims time already advanced by a delayed task', () => {
  const state = enabledState();
  tracker.recordActivity(state, { now: 0, tabId: 1, windowId: 10, activityId: 'activity-1' });
  tracker.tick(state, 20_000);
  tracker.pause(state, 12_000);
  assert.equal(state.records[0].endedAt, 12_000);
  assert.equal(state.records[0].durationSeconds, 12);
});

test('switching Chrome windows closes the previous activity and preserves both records', () => {
  const state = enabledState();
  tracker.recordActivity(state, { now: 0, tabId: 1, windowId: 10, activityId: 'window-1' });
  tracker.recordActivity(state, { now: 8_000, tabId: 2, windowId: 20, activityId: 'window-2' });
  tracker.tick(state, 13_000);
  assert.equal(state.records[0].id, 'window-1');
  assert.equal(state.records[0].durationSeconds, 8);
  assert.equal(state.current.id, 'window-2');
  assert.equal(tracker.summary(state).totalSeconds, 13);
});
