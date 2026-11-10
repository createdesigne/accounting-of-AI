import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const coreSource = readFileSync(new URL('../chrome-extension/activityTracker.js', import.meta.url), 'utf8');
const protocolSource = readFileSync(new URL('../chrome-extension/timeRecordProtocol.js', import.meta.url), 'utf8');
const backgroundSource = readFileSync(new URL('../chrome-extension/background.js', import.meta.url), 'utf8');

type Listener = (...args: any[]) => any;

function eventHook() {
  const listeners: Listener[] = [];
  return { listeners, addListener(listener: Listener) { listeners.push(listener); } };
}

function createHarness({ initialStored, initialNow = 0, initialUuid = 0 }: {
  initialStored?: any; initialNow?: number; initialUuid?: number;
} = {}) {
  let now = initialNow;
  let uuid = initialUuid;
  let stored: any = initialStored ? JSON.parse(JSON.stringify(initialStored)) : undefined;
  let alarmExists = false;
  let lastFocusedWindowId = 10;
  const tabs = new Map<number, any>([
    [1, { id: 1, windowId: 10, active: true, url: 'https://chatgpt.com/c/one' }],
    [2, { id: 2, windowId: 20, active: true, url: 'https://chatgpt.com/c/two' }],
  ]);
  const windows = new Map<number, any>([
    [10, { id: 10, focused: true }],
    [20, { id: 20, focused: false }],
  ]);
  const hooks = {
    installed: eventHook(), startup: eventHook(), message: eventHook(), alarm: eventHook(),
    activated: eventHook(), updated: eventHook(), removed: eventHook(), focusChanged: eventHook(),
  };

  class FakeDate extends Date {
    static now() { return now; }
  }

  const chrome = {
    runtime: {
      onInstalled: hooks.installed,
      onStartup: hooks.startup,
      onMessage: hooks.message,
    },
    alarms: {
      get: async () => alarmExists ? { name: 'chatgpt-active-time-tick' } : undefined,
      create: async () => { alarmExists = true; },
      onAlarm: hooks.alarm,
    },
    tabs: {
      onActivated: hooks.activated,
      onUpdated: hooks.updated,
      onRemoved: hooks.removed,
      get: async (id: number) => {
        const tab = tabs.get(id);
        if (!tab) throw new Error('Unknown tab');
        return { ...tab };
      },
      query: async ({ active, windowId }: { active?: boolean; windowId?: number }) => (
        [...tabs.values()].filter(tab => (!active || tab.active) && (windowId === undefined || tab.windowId === windowId))
          .map(tab => ({ ...tab }))
      ),
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged: hooks.focusChanged,
      get: async (id: number) => {
        const window = windows.get(id);
        if (!window) throw new Error('Unknown window');
        return { ...window };
      },
      getLastFocused: async () => ({ ...windows.get(lastFocusedWindowId) }),
    },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: stored }),
        set: async (value: Record<string, any>) => {
          stored = JSON.parse(JSON.stringify(Object.values(value)[0]));
        },
      },
    },
  };

  const context = vm.createContext({
    chrome,
    console: { error() {} },
    crypto: { randomUUID: () => `uuid-${++uuid}` },
    Date: FakeDate,
    importScripts() {},
    URL,
    Intl,
    TextEncoder,
    encodeURIComponent,
    unescape,
  });
  vm.runInContext(coreSource, context);
  vm.runInContext(protocolSource, context);
  vm.runInContext(backgroundSource, context);

  async function send(message: any, tabId?: number) {
    const listener = hooks.message.listeners[0];
    const sender = tabId ? { tab: { ...tabs.get(tabId) } } : {};
    if (message.type === 'tracking:activity' || message.type === 'tracking:pageInactive') {
      listener(message, sender, () => {});
      return;
    }
    return new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('message timeout')), 1000);
      listener(message, sender, (response: any) => {
        clearTimeout(timeout);
        resolve(response);
      });
    });
  }

  async function summary() {
    return send({ type: 'tracking:get' });
  }

  async function activity(tabId: number) {
    await send({ type: 'tracking:activity' }, tabId);
    return summary();
  }

  async function focus(windowId: number) {
    for (const window of windows.values()) window.focused = window.id === windowId;
    if (windowId !== -1) lastFocusedWindowId = windowId;
    hooks.focusChanged.listeners[0](windowId);
    return summary();
  }

  async function alarm() {
    hooks.alarm.listeners[0]({ name: 'chatgpt-active-time-tick' });
    return summary();
  }

  async function startup() {
    hooks.startup.listeners[0]();
    return summary();
  }

  return {
    tabs,
    windows,
    setNow(value: number) { now = value; },
    enable: () => send({ type: 'tracking:setEnabled', enabled: true }),
    disable: () => send({ type: 'tracking:setEnabled', enabled: false }),
    finalizedRecords: () => send({ type: 'time-records:getFinalized' }),
    activity,
    focus,
    alarm,
    startup,
    summary,
    stored: () => stored,
    alarmExists: () => alarmExists,
  };
}

test('five-minute allowance stops measuring but keeps the logical session open until twenty minutes', async () => {
  const app = createHarness();
  const started = await app.enable();
  assert.equal(started.active, true);
  assert.equal(started.totalSeconds, 0);

  app.setNow(360_000);
  const afterSixMinutes = await app.alarm();
  assert.equal(afterSixMinutes.active, false);
  assert.equal(afterSixMinutes.sessionOpen, true);
  assert.equal(afterSixMinutes.totalSeconds, 300);
  assert.equal(app.stored().records.length, 0);
  assert.equal(app.stored().session.segments[0].durationSeconds, 300);

  app.setNow(1_200_000);
  const finalized = await app.alarm();
  assert.equal(finalized.sessionOpen, false);
  assert.equal(app.stored().records.length, 1);
  assert.equal(app.stored().records[0].durationSeconds, 300);
});

test('service worker restart restores the active segment and keeps the first five minutes', async () => {
  const firstWorker = createHarness();
  await firstWorker.enable();
  firstWorker.setNow(120_000);
  assert.equal((await firstWorker.alarm()).totalSeconds, 120);
  const persisted = firstWorker.stored();

  const restartedWorker = createHarness({ initialStored: persisted, initialNow: 360_000 });
  const afterDelayedAlarm = await restartedWorker.alarm();
  assert.equal(afterDelayedAlarm.active, false);
  assert.equal(afterDelayedAlarm.sessionOpen, true);
  assert.equal(afterDelayedAlarm.totalSeconds, 300);
  assert.equal(restartedWorker.stored().records.length, 0);
  assert.equal(restartedWorker.stored().session.segments[0].durationSeconds, 300);
  assert.equal(restartedWorker.alarmExists(), true);
});

test('browser restart ends the active segment at the last saved instant without counting closed time', async () => {
  const firstWorker = createHarness();
  await firstWorker.enable();
  firstWorker.setNow(120_000);
  assert.equal((await firstWorker.alarm()).totalSeconds, 120);
  const originalSessionId = firstWorker.stored().session.id;

  const restartedWorker = createHarness({ initialStored: firstWorker.stored(), initialNow: 360_000 });
  const afterStartup = await restartedWorker.startup();
  assert.equal(afterStartup.totalSeconds, 120);
  assert.equal(afterStartup.active, false);
  assert.equal(afterStartup.sessionOpen, true);
  assert.equal(restartedWorker.stored().session.id, originalSessionId);
  assert.equal(restartedWorker.stored().session.segments[0].endedAt, 120_000);

  restartedWorker.setNow(361_000);
  await restartedWorker.activity(1);
  restartedWorker.setNow(366_000);
  const resumed = await restartedWorker.activity(1);
  assert.equal(resumed.currentSessionId, originalSessionId);
  assert.equal(resumed.totalSeconds, 125);
});

test('browser restart after twenty minutes finalizes the saved session and the next activity starts another', async () => {
  const firstWorker = createHarness();
  await firstWorker.enable();
  firstWorker.setNow(120_000);
  await firstWorker.alarm();
  const originalSessionId = firstWorker.stored().session.id;

  const restartedWorker = createHarness({
    initialStored: firstWorker.stored(), initialNow: 1_300_000, initialUuid: 100,
  });
  const afterStartup = await restartedWorker.startup();
  assert.equal(afterStartup.totalSeconds, 120);
  assert.equal(afterStartup.sessionOpen, false);
  assert.equal(restartedWorker.stored().records[0].sessionId, originalSessionId);

  await restartedWorker.activity(1);
  assert.equal(restartedWorker.stored().records.length, 1);
  assert.notEqual(restartedWorker.stored().session.id, originalSessionId);
});

test('Windows app switch stops immediately and returning to Chrome does not backfill time', async () => {
  const app = createHarness();
  await app.enable();
  await app.activity(1);
  app.setNow(12_000);
  const away = await app.focus(-1);
  assert.equal(away.totalSeconds, 12);
  assert.equal(away.active, false);

  app.setNow(112_000);
  const returned = await app.focus(10);
  assert.equal(returned.totalSeconds, 12);
  assert.equal(returned.active, false);

  app.setNow(113_000);
  await app.activity(1);
  app.setNow(118_000);
  const resumed = await app.activity(1);
  assert.equal(resumed.totalSeconds, 17);
  assert.equal(app.stored().records.length, 0);
  assert.equal(app.stored().session.segments.length, 1);
  assert.equal(resumed.currentSessionId, app.stored().session.id);
});

test('periodic focus recheck rejects external-app time when the focus event is missed', async () => {
  const app = createHarness();
  await app.enable();
  await app.activity(1);
  app.setNow(10_000);
  assert.equal((await app.alarm()).totalSeconds, 10);

  app.windows.get(10).focused = false;
  app.setNow(40_000);
  const checkedAway = await app.alarm();
  assert.equal(checkedAway.totalSeconds, 10);
  assert.equal(checkedAway.active, false);

  app.windows.get(10).focused = true;
  app.setNow(100_000);
  await app.focus(10);
  assert.equal((await app.activity(1)).totalSeconds, 10);
});

test('switching between Chrome windows closes one activity before another starts', async () => {
  const app = createHarness();
  await app.enable();
  await app.activity(1);
  app.setNow(8_000);
  const switched = await app.focus(20);
  assert.equal(switched.totalSeconds, 8);
  assert.equal(switched.active, false);

  await app.activity(2);
  app.setNow(13_000);
  await app.activity(2);
  assert.equal((await app.summary()).totalSeconds, 13);
  assert.equal(app.stored().records.length, 0);
  assert.equal(app.stored().session.segments.length, 1);
  assert.equal(app.stored().current.sessionId, app.stored().session.id);
});

test('duplicate focus and status events never count an interval twice', async () => {
  const app = createHarness();
  await app.enable();
  await app.activity(1);
  app.setNow(20_000);
  assert.equal((await app.summary()).totalSeconds, 20);
  assert.equal((await app.summary()).totalSeconds, 20);
  assert.equal((await app.alarm()).totalSeconds, 20);

  app.setNow(25_000);
  assert.equal((await app.focus(-1)).totalSeconds, 25);
  assert.equal((await app.focus(-1)).totalSeconds, 25);
  assert.equal(app.stored().records.length, 0);
  assert.equal(app.stored().session.segments.length, 1);
});

test('exports only finalized daily records with the minimum transfer fields', async () => {
  const app = createHarness();
  await app.enable();
  app.setNow(30_000);
  const whileActive = await app.finalizedRecords();
  assert.equal(whileActive.ok, true);
  assert.equal(whileActive.payload.records.length, 0);

  app.setNow(60_000);
  await app.disable();
  const finalized = await app.finalizedRecords();
  assert.equal(finalized.ok, true);
  assert.equal(finalized.payload.records.length, 1);
  assert.deepEqual(Object.keys(finalized.payload.records[0]), [
    'recordId', 'sessionId', 'provider', 'localDate', 'timeZone',
    'startedAt', 'endedAt', 'durationSeconds',
  ]);
  assert.equal(finalized.payload.records[0].durationSeconds, 60);
  assert.equal(JSON.stringify(finalized.payload).includes('tabId'), false);
});
