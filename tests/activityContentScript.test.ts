import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../chrome-extension/activity.js', import.meta.url), 'utf8');

function eventTarget() {
  const listeners = new Map<string, Set<(...args: any[]) => any>>();
  return {
    addEventListener(name: string, listener: (...args: any[]) => any) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
    },
    removeEventListener(name: string, listener: (...args: any[]) => any) {
      listeners.get(name)?.delete(listener);
    },
    dispatch(name: string, ...args: any[]) {
      return [...(listeners.get(name) || [])].map(listener => listener(...args));
    },
    listenerCount(name: string) {
      return listeners.get(name)?.size || 0;
    },
  };
}

function harness(sendMessage: (message: any) => any, runtimeId: string | undefined = 'extension-id') {
  let now = 1_000;
  const window = eventTarget();
  const document = Object.assign(eventTarget(), { visibilityState: 'visible' });
  const runtimeListeners = new Set<(...args: any[]) => any>();
  const chrome = { runtime: {
    id: runtimeId,
    sendMessage,
    onMessage: {
      addListener(listener: (...args: any[]) => any) { runtimeListeners.add(listener); },
      removeListener(listener: (...args: any[]) => any) { runtimeListeners.delete(listener); },
    },
  } };
  class FakeDate extends Date { static now() { return now; } }
  const context = vm.createContext({ window, document, chrome, Date: FakeDate, Error });
  vm.runInContext(source, context);
  return {
    window, document, chrome,
    reinject: () => vm.runInContext(source, context),
    ping: () => new Promise(resolve => {
      const listener = [...runtimeListeners][0];
      if (!listener) return resolve(null);
      listener({ type: 'tracking:watcherPing' }, {}, resolve);
    }),
    runtimeListenerCount: () => runtimeListeners.size,
    setNow(value: number) { now = value; },
  };
}

test('a synchronous invalidated-context error is swallowed and the old script stops', () => {
  let sends = 0;
  const page = harness(() => {
    sends++;
    throw new Error('Extension context invalidated.');
  });
  assert.doesNotThrow(() => page.window.dispatch('pointerdown'));
  assert.equal(sends, 1);
  assert.equal(page.window.listenerCount('pointerdown'), 0);
  assert.equal(page.window.listenerCount('blur'), 0);
  assert.equal(page.document.listenerCount('visibilitychange'), 0);
  page.setNow(3_000);
  page.window.dispatch('pointerdown');
  assert.equal(sends, 1);
});

test('an asynchronous invalidated-context rejection is caught and stops later events', async () => {
  let sends = 0;
  const page = harness(() => {
    sends++;
    return Promise.reject(new Error('Extension context invalidated'));
  });
  page.window.dispatch('pointerdown');
  await Promise.resolve();
  await Promise.resolve();
  page.setNow(3_000);
  page.window.dispatch('keydown');
  assert.equal(sends, 1);
  assert.equal(page.window.listenerCount('keydown'), 0);
});

test('a missing runtime id disables an invalid old script before it sends', () => {
  let sends = 0;
  const page = harness(() => { sends++; return Promise.resolve(); }, '');
  assert.doesNotThrow(() => page.window.dispatch('pointerdown'));
  assert.equal(sends, 0);
  assert.equal(page.window.listenerCount('pointerdown'), 0);
});

test('valid contexts still send activity and inactive signals without page content', async () => {
  const messages: any[] = [];
  const page = harness((message) => { messages.push(message); return Promise.resolve(); });
  page.window.dispatch('pointerdown');
  page.window.dispatch('blur');
  page.document.visibilityState = 'hidden';
  page.document.dispatch('visibilitychange');
  await Promise.resolve();
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [
    { type: 'tracking:activity' },
    { type: 'tracking:pageInactive' },
    { type: 'tracking:pageInactive' },
  ]);
});

test('reinjection on an already-open ChatGPT tab does not duplicate listeners', async () => {
  const messages: any[] = [];
  const page = harness((message) => { messages.push(message); return Promise.resolve(); });
  page.reinject();
  assert.equal(page.window.listenerCount('pointerdown'), 1);
  assert.equal(page.window.listenerCount('keydown'), 1);
  page.window.dispatch('pointerdown');
  await Promise.resolve();
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [{ type: 'tracking:activity' }]);
});

test('the watcher acknowledges the service worker and removes the channel after invalidation', async () => {
  const page = harness(() => Promise.resolve());
  assert.deepEqual(JSON.parse(JSON.stringify(await page.ping())), { ok: true });
  assert.equal(page.runtimeListenerCount(), 1);
  page.chrome.runtime.id = '';
  page.window.dispatch('pointerdown');
  assert.equal(page.runtimeListenerCount(), 0);
  assert.equal(await page.ping(), null);
});
