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

function activity(state: any, now: number, id: string, tabId = 1, windowId = 10) {
  return tracker.recordActivity(state, { now, tabId, windowId, activityId: id });
}

test('does not track until the user explicitly enables tracking', () => {
  const state = tracker.createState();
  activity(state, 0, 'ignored');
  tracker.tick(state, 60_000);
  const summary = tracker.summary(state);
  assert.equal(summary.enabled, false);
  assert.equal(summary.active, false);
  assert.equal(summary.currentSessionId, null);
  assert.equal(summary.totalSeconds, 0);
  assert.equal(summary.recordCount, 0);
});

test('five-minute idle closes only the measured segment and twenty minutes finalizes the session', () => {
  const state = enabledState();
  activity(state, 0, 'session-1');

  tracker.tick(state, 299_999);
  assert.equal(tracker.summary(state).active, true);
  tracker.tick(state, 300_000);
  assert.equal(tracker.summary(state).active, false);
  assert.equal(tracker.summary(state).sessionOpen, true);
  assert.equal(tracker.summary(state).totalSeconds, 300);
  assert.equal(state.records.length, 0);
  assert.equal(state.session.segments.length, 1);
  assert.equal(state.session.segments[0].endedAt, 300_000);

  tracker.tick(state, 1_199_999);
  assert.equal(state.records.length, 0);
  tracker.tick(state, 1_200_000);
  assert.equal(state.session, null);
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].sessionId, 'session-1');
  assert.equal(state.records[0].durationSeconds, 300);
  assert.equal(state.records[0].finalizedAt, 1_200_000);
});

test('resuming before twenty minutes keeps the session id and adds a separate measured segment', () => {
  const state = enabledState();
  activity(state, 0, 'session-1');
  tracker.tick(state, 300_000);

  activity(state, 1_199_999, 'segment-2');
  assert.equal(state.session.id, 'session-1');
  assert.equal(state.current.sessionId, 'session-1');
  assert.equal(state.current.id, 'segment-2');
  tracker.tick(state, 1_209_999);
  tracker.pause(state, 1_209_999);

  assert.equal(state.session.segments.length, 2);
  assert.equal(state.session.segments[0].durationMs, 300_000);
  assert.equal(state.session.segments[1].durationMs, 10_000);
  assert.equal(tracker.summary(state).totalSeconds, 310);
  assert.equal(state.records.length, 0);
});

test('activity at or after the twenty-minute boundary starts a new session', () => {
  for (const resumedAt of [1_200_000, 1_200_001, 1_500_000]) {
    const state = enabledState();
    activity(state, 0, 'old-session');
    tracker.tick(state, 300_000);
    activity(state, resumedAt, `new-session-${resumedAt}`);

    assert.equal(state.records.length, 1);
    assert.equal(state.records[0].sessionId, 'old-session');
    assert.equal(state.records[0].durationSeconds, 300);
    assert.equal(state.session.id, `new-session-${resumedAt}`);
    assert.equal(state.current.sessionId, `new-session-${resumedAt}`);
  }
});

test('manual stop finalizes the session and the next start issues a new session id', () => {
  const state = enabledState();
  activity(state, 0, 'manual-session-1');
  tracker.disable(state, 5_000);

  assert.equal(state.enabled, false);
  assert.equal(state.session, null);
  assert.equal(state.current, null);
  assert.equal(state.records[0].sessionId, 'manual-session-1');
  assert.equal(state.records[0].durationSeconds, 5);

  tracker.enable(state);
  activity(state, 6_000, 'manual-session-2');
  assert.equal(state.session.id, 'manual-session-2');
  assert.notEqual(state.session.id, state.records[0].sessionId);
  tracker.tick(state, 10_000);
  assert.equal(tracker.summary(state).totalSeconds, 9);
  assert.equal(state.records[0].durationSeconds, 5);
});

test('switching ChatGPT tabs keeps one session with non-overlapping measured segments', () => {
  const state = enabledState();
  activity(state, 0, 'session-1', 1, 10);
  activity(state, 8_000, 'tab-2-segment', 2, 20);
  tracker.tick(state, 13_000);
  tracker.pause(state, 13_000);

  assert.equal(state.records.length, 0);
  assert.equal(state.session.id, 'session-1');
  assert.equal(state.session.segments.length, 2);
  assert.deepEqual(
    Array.from(state.session.segments, (segment: any) => segment.durationMs),
    [8_000, 5_000],
  );
  assert.equal(tracker.summary(state).totalSeconds, 13);

  tracker.disable(state, 13_000);
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].durationSeconds, 13);
});

test('repeated ticks and pause events never count the same interval twice', () => {
  const state = enabledState();
  activity(state, 0, 'session-1');
  tracker.tick(state, 10_900);
  tracker.tick(state, 10_900);
  tracker.tick(state, 10_900);
  assert.equal(tracker.summary(state).totalSeconds, 10);

  tracker.pause(state, 20_100);
  tracker.pause(state, 30_000);
  tracker.tick(state, 30_000);
  assert.equal(state.session.segments.length, 1);
  assert.equal(tracker.summary(state).totalSeconds, 20);
});

test('an earlier focus-loss timestamp trims time already advanced by a delayed task', () => {
  const state = enabledState();
  activity(state, 0, 'session-1');
  tracker.tick(state, 20_000);
  tracker.pause(state, 12_000);
  assert.equal(state.session.segments[0].endedAt, 12_000);
  assert.equal(state.session.segments[0].durationSeconds, 12);
  assert.equal(tracker.summary(state).totalSeconds, 12);
});

test('normalization restores an open version-three session without adding elapsed time', () => {
  const state = enabledState();
  activity(state, 0, 'session-1');
  tracker.tick(state, 120_000);
  const restored = tracker.normalizeState(JSON.parse(JSON.stringify(state)));

  assert.equal(restored.session.id, 'session-1');
  assert.equal(restored.current.accountedThrough, 120_000);
  assert.equal(tracker.summary(restored).totalSeconds, 120);
});

test('legacy records and pending activity keep their ids and seconds as separate migrated sessions', () => {
  const migrated = tracker.normalizeState({
    version: 2,
    enabled: true,
    records: [{
      id: 'legacy-record', provider: 'ChatGPT', startedAt: 1_000, endedAt: 8_000, durationSeconds: 7,
    }],
    current: {
      id: 'legacy-current', tabId: 1, windowId: 10, startedAt: 10_000,
      lastActivityAt: 15_000, accountedThrough: 15_000, durationMs: 5_000,
    },
  });

  assert.equal(migrated.version, 3);
  assert.equal(migrated.session, null);
  assert.equal(migrated.current, null);
  assert.deepEqual(Array.from(migrated.records, (record: any) => record.id), ['legacy-record', 'legacy-current']);
  assert.deepEqual(Array.from(migrated.records, (record: any) => record.sessionId), ['legacy-record', 'legacy-current']);
  assert.equal(tracker.summary(migrated).totalSeconds, 12);

  activity(migrated, 20_000, 'new-session');
  assert.equal(migrated.session.id, 'new-session');
  assert.equal(migrated.records.length, 2);
});
