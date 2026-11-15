import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../chrome-extension/activity.js', import.meta.url), 'utf8');

function eventTarget() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    addEventListener(name: string, listener: () => void) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
    },
    removeEventListener(name: string, listener: () => void) {
      listeners.get(name)?.delete(listener);
    },
    dispatch(name: string) {
      for (const listener of [...(listeners.get(name) || [])]) listener();
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
  const chrome = { runtime: { id: runtimeId, sendMessage } };
  class FakeDate extends Date { static now() { return now; } }
  vm.runInNewContext(source, { window, document, chrome, Date: FakeDate, Error });
  return { window, document, chrome, setNow(value: number) { now = value; } };
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
