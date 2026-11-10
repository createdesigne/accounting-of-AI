import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const protocolSource = readFileSync(new URL('../chrome-extension/timeRecordProtocol.js', import.meta.url), 'utf8');
const bridgeSource = readFileSync(new URL('../chrome-extension/timeRecordBridge.js', import.meta.url), 'utf8');

function createBridge(url = 'https://createdesigne.github.io/accounting-of-AI/') {
  const runtimeListeners: Array<(message: any, sender: any, respond: (value: any) => void) => any> = [];
  const windowListeners: Array<(event: any) => void> = [];
  const posted: Array<{ message: any; targetOrigin: string }> = [];
  const parsed = new URL(url);
  const fakeWindow: any = {
    location: { href: url, origin: parsed.origin },
    addEventListener(type: string, listener: (event: any) => void) {
      if (type === 'message') windowListeners.push(listener);
    },
    postMessage(message: any, targetOrigin: string) { posted.push({ message, targetOrigin }); },
  };
  const chrome = {
    runtime: {
      id: 'extension-id',
      onMessage: { addListener(listener: any) { runtimeListeners.push(listener); } },
    },
  };
  const context = vm.createContext({
    window: fakeWindow, chrome, URL, Intl, TextEncoder, encodeURIComponent, unescape,
  });
  vm.runInContext(protocolSource, context);
  vm.runInContext(bridgeSource, context);
  const protocol = (context as { TimeRecordProtocol: any }).TimeRecordProtocol;
  const payload = protocol.createPayload([{
    recordId: 'session-1:day:2026-11-10', sessionId: 'session-1', provider: 'ChatGPT',
    localDate: '2026-11-10', timeZone: 'Asia/Tokyo', startedAt: 1_000,
    endedAt: 61_000, durationSeconds: 60,
  }], 'request-1');
  return { runtimeListeners, windowListeners, posted, fakeWindow, protocol, payload };
}

function sendToBridge(app: ReturnType<typeof createBridge>, message: any, senderId = 'extension-id') {
  let response: any;
  const handled = app.runtimeListeners[0]?.(message, { id: senderId }, (value: any) => { response = value; });
  return { handled, response };
}

test('delivers a valid payload only to the exact current Web app origin', () => {
  const app = createBridge();
  const result = sendToBridge(app, { type: 'time-records:deliver', payload: app.payload });

  assert.equal(result.response.ok, true);
  assert.equal(result.response.recordCount, 1);
  assert.equal(app.posted.length, 1);
  assert.equal(app.posted[0].targetOrigin, 'https://createdesigne.github.io');
  assert.equal(app.posted[0].message.payload.records[0].recordId, 'session-1:day:2026-11-10');
});

test('does not install the bridge on an unapproved page', () => {
  const app = createBridge('https://example.com/accounting-of-AI/');
  assert.equal(app.runtimeListeners.length, 0);
  assert.equal(app.windowListeners.length, 0);
  assert.equal(app.posted.length, 0);
});

test('rejects invalid senders and malformed time data', () => {
  const app = createBridge();
  const foreign = sendToBridge(app, { type: 'time-records:deliver', payload: app.payload }, 'another-extension');
  assert.equal(foreign.handled, false);
  assert.equal(app.posted.length, 0);

  const invalid = sendToBridge(app, {
    type: 'time-records:deliver',
    payload: { ...app.payload, records: [{ ...app.payload.records[0], durationSeconds: -1 }] },
  });
  assert.equal(invalid.response.ok, false);
  assert.equal(app.posted.length, 0);
});

test('replays the pending payload when the Web app announces readiness', () => {
  const app = createBridge();
  sendToBridge(app, { type: 'time-records:deliver', payload: app.payload });
  app.windowListeners[0]({
    source: app.fakeWindow,
    origin: app.fakeWindow.location.origin,
    data: { source: app.protocol.WINDOW_READY_SOURCE, type: app.protocol.WINDOW_READY_TYPE },
  });
  assert.equal(app.posted.length, 2);
  assert.deepEqual(app.posted[0].message.payload, app.posted[1].message.payload);
});
