import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const script = readFileSync(new URL('../chrome-extension/popup.js', import.meta.url), 'utf8');
const protocolScript = readFileSync(new URL('../chrome-extension/timeRecordProtocol.js', import.meta.url), 'utf8');
const popupMarkup = readFileSync(new URL('../chrome-extension/popup.html', import.meta.url), 'utf8');

test('popup presents measurement, conversation and transfer in that order without duplicating controls', () => {
  const start = popupMarkup.indexOf('id="trackingStart"');
  const send = popupMarkup.indexOf('id="createReceipt"');
  const transfer = popupMarkup.indexOf('id="timeLedgerTransfer"');
  assert.ok(start > -1 && start < send && send < transfer);
  for (const id of ['trackingSessionTime','trackingFinalizedTime','trackingStop','timeTransferStatus','timeManualCopy']) {
    assert.equal(popupMarkup.split(`id="${id}"`).length, 2);
  }
  assert.match(popupMarkup, /確定済み（累計）/);
  assert.match(popupMarkup, /計測中に会話を送信/);
});
const conversation = { aiService: 'ChatGPT', conversationTitle: '相談 + 100% & 日本語', messages: [{ role: 'user', text: '実際の会話本文' }] };
function popup({ source = 'https://chatgpt.com/c/example', result = conversation, destination = 'production', storedDestination = '', failure = '', injectionFailure = '', trackingSession = '', trackingSessions = null, previewStates = null } = {}) {
  let click: () => Promise<void>;
  let changeDestination: () => Promise<void>;
  const created: string[] = [];
  const stored: Record<string, any> = {};
  if (storedDestination) stored.selectedWebAppDestinationV1 = storedDestination;
  let injected = 0;
  let captureCounter = 0;
  let trackingRequestCount = 0;
  let previewStateIndex = 0;
  const elements = { createReceipt: { disabled: false, addEventListener: (_event: string, handler: typeof click) => { click = handler; } }, status: { textContent: '' }, destination: { value: destination, disabled: false, addEventListener: (_event: string, handler: typeof changeDestination) => { changeDestination = handler; } } };
  vm.runInNewContext(script, {
    document: { getElementById: (id: keyof typeof elements) => elements[id] },
    chrome: { runtime: { getManifest: () => ({ version: '0.5.15' }), sendMessage: async () => ({ ok: true, currentSessionId: Array.isArray(trackingSessions) ? (trackingSessions[trackingRequestCount++] ?? '') : trackingSession }) }, storage: { local: { get: async () => ({ ...stored }), set: async (value: Record<string, any>) => Object.assign(stored, value) } }, tabs: { query: async () => [{ id: 1, url: source, title: 'ChatGPT' }], create: async ({ url }: { url: string }) => { if (failure) throw new Error(failure); created.push(url); return previewStates ? { id: 2, url, status: 'loading' } : undefined; }, get: async () => { const states = previewStates as any[] | null; return states?.[Math.min(previewStateIndex++, states.length - 1)] ?? { id: 2, url: created.at(-1), status: 'complete' }; }, update: async () => {} }, scripting: { executeScript: async () => { injected++; if (injectionFailure) throw new Error(injectionFailure); return [{ result }]; } } },
    URL, URLSearchParams, Date, Error, crypto: { randomUUID: () => `capture-test-${++captureCounter}` }, setTimeout: (handler: () => void) => { handler(); return 1; }, console: { error() {} },
  });
  return { run: () => click(), changeDestination: async (value: string) => { elements.destination.value = value; await changeDestination(); }, created, elements, stored, injections: () => injected };
}
test('extension defaults to production and sends actual text in a fragment, not the HTTP query', async () => {
  const page = popup(); await page.run();
  const url = new URL(page.created[0]);
  assert.equal(url.origin + url.pathname, 'https://accounting-of-ai.vercel.app/accounting-of-AI/');
  assert.equal(url.search, '');
  const raw = JSON.parse(new URLSearchParams(url.hash.slice(1)).get('draft')!);
  assert.deepEqual(Object.keys(raw).sort(), ['aiService', 'captureId', 'capturedAt', 'conversationTitle', 'messages', 'url']);
  assert.equal(raw.captureId, 'capture-capture-test-1');
  assert.deepEqual(raw.messages, conversation.messages);
  assert.equal(raw.conversationTitle, conversation.conversationTitle);
  assert.equal(page.elements.createReceipt.disabled, false);
});
test('each explicit conversation capture gets a new id while a delivered capture remains stable', async () => {
  const page = popup();
  await page.run();
  await page.run();
  const first = JSON.parse(new URLSearchParams(new URL(page.created[0]).hash.slice(1)).get('draft')!);
  const second = JSON.parse(new URLSearchParams(new URL(page.created[1]).hash.slice(1)).get('draft')!);
  assert.notEqual(first.captureId, second.captureId);
  assert.deepEqual(first.messages, second.messages);
});
test('an active tracker session is attached as an exact linking hint without changing conversation identity fields', async () => {
  const page = popup({ trackingSession: 'session-exact-1' }); await page.run();
  const raw = JSON.parse(new URLSearchParams(new URL(page.created[0]).hash.slice(1)).get('draft')!);
  assert.equal(raw.measurementSessionId, 'session-exact-1');
});
test('a session captured before extraction remains linked when tracking is stopped during extraction', async () => {
  const page = popup({ trackingSessions: ['session-stop-race', ''] }); await page.run();
  const raw = JSON.parse(new URLSearchParams(new URL(page.created[0]).hash.slice(1)).get('draft')!);
  assert.equal(raw.measurementSessionId, 'session-stop-race');
});
test('a session change during extraction is never guessed as the conversation measurement', async () => {
  const page = popup({ trackingSessions: ['session-before', 'session-after'] }); await page.run();
  const raw = JSON.parse(new URLSearchParams(new URL(page.created[0]).hash.slice(1)).get('draft')!);
  assert.equal(raw.measurementSessionId, undefined);
});
test('legacy/preview/local/research destinations preserve the application base path', async () => {
  for (const [destination, expected] of [['researchPreview', 'https://accounting-of-ai-git-feature-research-mvp-accounting-of-ai.vercel.app/accounting-of-AI/'], ['legacy', 'https://createdesigne.github.io/accounting-of-AI/'], ['preview', 'https://createdesigne.github.io/accounting-of-AI/preview/month-ledger/'], ['local', 'http://localhost:5173/accounting-of-AI/'], ['research', 'http://localhost:5174/accounting-of-AI/']]) {
    const page = popup({ destination }); await page.run();
    assert.ok(page.created[0].startsWith(expected + '#draft='));
  }
});
test('the last selected destination survives popup close and browser restart', async () => {
  const first = popup();
  await first.changeDestination('research');
  assert.equal(first.stored.selectedWebAppDestinationV1, 'research');

  const reopened = popup({ storedDestination: first.stored.selectedWebAppDestinationV1 });
  await reopened.run();
  assert.ok(reopened.created[0].startsWith('http://localhost:5174/accounting-of-AI/#draft='));

  const invalid = popup({ storedDestination: 'unapproved' });
  await invalid.run();
  assert.ok(invalid.created[0].startsWith('https://accounting-of-ai.vercel.app/accounting-of-AI/#draft='));
});
test('AI names come from the actual tab host for ChatGPT, Claude and Gemini', async () => {
  for (const [source, service] of [['https://chat.openai.com/c/example', 'ChatGPT'], ['https://claude.ai/chat/example', 'Claude'], ['https://gemini.google.com/app/example', 'Gemini']]) {
    const page = popup({ source }); await page.run();
    const raw = JSON.parse(new URLSearchParams(new URL(page.created[0]).hash.slice(1)).get('draft')!);
    assert.equal(raw.aiService, service);
    assert.equal(page.elements.status.textContent, 'Webアプリを開きました。');
  }
});
test('unknown speaker roles are never guessed as user or assistant', async () => {
  const page = popup({ result: { ...conversation, messages: [{ role: 'system', text: 'Not a conversation turn' }] } }); await page.run();
  assert.equal(page.created.length, 0);
  assert.match(page.elements.status.textContent, /会話本文が見つかりません/);
});
test('empty extraction never substitutes title or demo conversation', async () => {
  const page = popup({ result: { ...conversation, messages: [] } }); await page.run();
  assert.equal(page.created.length, 0);
  assert.match(page.elements.status.textContent, /会話本文が見つかりません/);
  assert.equal(page.elements.createReceipt.disabled, false);
  assert.match(page.elements.status.textContent, /ChatGPT／拡張機能 0\.5\.13/);
  assert.match(page.elements.status.textContent, /回答の生成が終わってから/);
});
test('unsupported or lookalike domains are not read', async () => {
  for (const source of ['chrome://extensions/', 'https://example.com/', 'https://chatgpt.com.example.com/', 'https://example.com/?chatgpt.com', 'https://constructor/', 'https://__proto__/']) {
    const page = popup({ source }); await page.run();
    assert.equal(page.injections(), 0); assert.equal(page.created.length, 0);
  }
});
test('navigation failures show an error and allow retry', async () => {
  const page = popup({ failure: 'タブを開けませんでした' }); await page.run();
  assert.equal(page.created.length, 0);
  assert.match(page.elements.status.textContent, /タブを開けませんでした/);
  assert.equal(page.elements.createReceipt.disabled, false);
});
test('protected research Preview explains Vercel authentication and allows a safe retry', async () => {
  const page = popup({
    destination: 'researchPreview',
    previewStates: [{ id: 2, url: 'https://vercel.com/sso-api?url=protected-preview', status: 'complete' }],
  });
  await page.run();
  assert.equal(page.created.length, 1);
  assert.match(page.elements.status.textContent, /Vercel Previewへのログインが必要/);
  assert.match(page.elements.status.textContent, /元のAI会話へ戻って/);
  assert.match(page.elements.status.textContent, /まだWebアプリへ保存されていません/);
  assert.equal(page.elements.createReceipt.disabled, false);
});
test('site access and missing receiver failures show current Japanese recovery steps', async () => {
  const denied = popup({ injectionFailure: 'Cannot access contents of url. Extension manifest must request permission to access this host.' });
  await denied.run();
  assert.match(denied.elements.status.textContent, /現在、ChatGPTへのサイトアクセス権限がありません/);
  assert.match(denied.elements.status.textContent, /すべてのサイト.*不要/);

  const disconnected = popup({ injectionFailure: 'Could not establish connection. Receiving end does not exist.' });
  await disconnected.run();
  assert.match(disconnected.elements.status.textContent, /現在、拡張機能のページ接続を確認できません/);
});

test('privacy-safe diagnostic reports stages and counts without conversation text or page identity', async () => {
  let diagnose: () => Promise<void>;
  let receivedArgs: any[] | undefined;
  const sensitiveText = '診断へ含めてはいけない実際の会話本文';
  const elements: Record<string, any> = {
    createReceipt: { disabled: false, addEventListener() {} }, status: { textContent: '' },
    destination: { value: 'research', disabled: false, addEventListener() {} },
    conversationDiagnostic: { disabled: false, addEventListener: (_event: string, handler: () => Promise<void>) => { diagnose = handler; } },
    diagnosticStatus: { textContent: '' }, version: { textContent: '' },
  };
  vm.runInNewContext(script, {
    document: { getElementById: (id: string) => elements[id] },
    chrome: {
      runtime: { getManifest: () => ({ version: '0.5.5' }), sendMessage: async () => ({ ok: true }) },
      storage: { local: { get: async () => ({}), set: async () => {} } },
      tabs: { query: async () => [{ id: 9, url: 'https://chatgpt.com/c/private-id', title: 'Private title' }] },
      scripting: { executeScript: async ({ args }: { args: any[] }) => {
        receivedArgs = args;
        return [{ result: { diagnostic: {
          schemaVersion: 1, aiService: 'ChatGPT', readyState: 'complete',
          currentRoleMarkers: 2, currentUserMarkers: 1, currentAssistantMarkers: 1,
          bodyCandidates: 2, nonEmptyBodies: 2, legacyTurnWrappers: 0,
          legacyAuthorMarkers: 0, extractedMessages: 2,
          extractedUserMessages: 1, extractedAssistantMessages: 1,
        } } }];
      } },
    },
    URL, URLSearchParams, Date, Error, Number, Set, console: { error() {} },
  });
  await diagnose!();
  assert.deepEqual(JSON.parse(JSON.stringify(receivedArgs)), [{ diagnosticOnly: true }]);
  assert.match(elements.diagnosticStatus.textContent, /注入成功/);
  assert.match(elements.diagnosticStatus.textContent, /取得結果 2件/);
  assert.equal(elements.diagnosticStatus.textContent.includes(sensitiveText), false);
  assert.equal(elements.diagnosticStatus.textContent.includes('private-id'), false);
  assert.equal(elements.diagnosticStatus.textContent.includes('Private title'), false);
  assert.equal(elements.conversationDiagnostic.disabled, false);
});

function transferPopup(destinationValue = 'production', options: {
  existingUrl?: string;
  activeTab?: { id: number; url: string; status: string };
  failuresBeforeSuccess?: number;
  alwaysFail?: boolean;
  injectionFailure?: string;
  targetStates?: Array<{ url?: string; pendingUrl?: string; status?: string }>;
  hostPermission?: boolean;
} = {}) {
  let transferClick: () => Promise<void>;
  let manualCopyClick: () => Promise<void>;
  let clipboardText = '';
  const delivered: any[] = [];
  const activated: number[] = [];
  const injections: any[] = [];
  const runtimeMessages: any[] = [];
  const permissionChecks: any[] = [];
  let deliveryAttempts = 0;
  let targetStateIndex = 0;
  let createdUrl = '';
  const elements: any = {
    createReceipt: { disabled: false, addEventListener() {} },
    status: { textContent: '' },
    destination: { value: destinationValue, disabled: false },
    timeLedgerTransfer: {
      disabled: false,
      addEventListener: (_event: string, handler: () => Promise<void>) => { transferClick = handler; },
    },
    timeTransferStatus: { textContent: '' },
    timeManualCopy: {
      disabled: false,
      addEventListener: (_event: string, handler: () => Promise<void>) => { manualCopyClick = handler; },
    },
    timeTransferText: { value: '', hidden: true, focus() {}, select() {} },
  };
  const sandbox: any = {
    document: { getElementById: (id: string) => elements[id], execCommand: () => false },
    navigator: { clipboard: { writeText: async (value: string) => { clipboardText = value; } } },
    chrome: {
      runtime: {
        getManifest: () => ({ version: '0.5.0' }),
        sendMessage: async (message: { type: string }) => {
          runtimeMessages.push(message);
          const { type } = message;
          if (type !== 'time-records:getFinalized') throw new Error('unexpected message');
          return {
            ok: true,
            payload: sandbox.TimeRecordProtocol.createPayload([{
              recordId: 'session-1:day:2026-11-10', sessionId: 'session-1', provider: 'ChatGPT',
              localDate: '2026-11-10', timeZone: 'Asia/Tokyo', startedAt: 1_000,
              endedAt: 61_000, durationSeconds: 60,
            }], 'request-1'),
          };
        },
      },
      tabs: {
        query: async (queryInfo: any) => queryInfo?.active
          ? [options.activeTab || { id: 7, url: options.existingUrl || 'https://accounting-of-ai.vercel.app/accounting-of-AI/', status: 'complete' }]
          : [{ id: 7, url: options.existingUrl || 'https://accounting-of-ai.vercel.app/accounting-of-AI/', status: 'complete' }],
        create: async ({ url }: { url: string }) => { createdUrl = url; return { id: 8, url, status: 'loading' }; },
        get: async (tabId: number) => {
          const configured = options.targetStates?.[Math.min(targetStateIndex, options.targetStates.length - 1)];
          if (options.targetStates?.length) targetStateIndex += 1;
          return configured || {
            id: tabId,
            url: tabId === 8 ? createdUrl : options.existingUrl || 'https://accounting-of-ai.vercel.app/accounting-of-AI/',
            status: 'complete',
          };
        },
        sendMessage: async (tabId: number, message: any) => {
          deliveryAttempts += 1;
          delivered.push({ tabId, message });
          if (options.alwaysFail || deliveryAttempts <= (options.failuresBeforeSuccess || 0)) {
            throw new Error('Could not establish connection. Receiving end does not exist.');
          }
          return { ok: true };
        },
        update: async (tabId: number) => { activated.push(tabId); },
      },
      scripting: { executeScript: async (details: any) => {
        injections.push(details);
        if (options.injectionFailure) throw new Error(options.injectionFailure);
        return [];
      } },
      permissions: {
        contains: async (details: any) => {
          permissionChecks.push(details);
          return options.hostPermission !== false;
        },
      },
    },
    URL, URLSearchParams, Date, Error, Intl, TextEncoder, encodeURIComponent, unescape,
    setTimeout: (handler: () => void) => { handler(); return 1; }, console: { error() {} },
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(protocolScript, context);
  vm.runInContext(script, context);
  return {
    run: () => transferClick(),
    copy: () => manualCopyClick(),
    clipboardText: () => clipboardText,
    delivered, activated, injections, runtimeMessages, permissionChecks, elements,
  };
}

test('time transfer sends finalized records to an existing approved Web app tab', async () => {
  const page = transferPopup();
  await page.run();
  assert.equal(page.delivered.length, 1);
  assert.equal(page.delivered[0].tabId, 7);
  assert.equal(page.delivered[0].message.type, 'time-records:deliver');
  assert.equal(page.activated[0], 7);
  assert.match(page.elements.timeTransferStatus.textContent, /1件/);
  assert.match(page.elements.timeTransferStatus.textContent, /まだ帳簿には保存されていません/);
});

test('time transfer prefers the active conversation destination over an older matching tab', async () => {
  const previewUrl = 'https://accounting-of-ai-git-feature-research-mvp-accounting-of-ai.vercel.app/accounting-of-AI/';
  const page = transferPopup('researchPreview', {
    existingUrl: previewUrl,
    activeTab: { id: 9, url: previewUrl, status: 'complete' },
  });
  await page.run();
  assert.equal(page.delivered.length, 1);
  assert.equal(page.delivered[0].tabId, 9);
  assert.equal(page.activated[0], 9);
});

test('time transfer can open the added research-local destination without changing production', async () => {
  const page = transferPopup('research');
  await page.run();
  assert.equal(page.delivered.length, 1);
  assert.equal(page.delivered[0].tabId, 8);
  assert.equal(page.activated[0], 8);
  assert.match(page.elements.timeTransferStatus.textContent, /1件/);
  assert.deepEqual(JSON.parse(JSON.stringify(page.permissionChecks)), [{ origins: ['http://localhost:5174/*'] }]);
});

test('time transfer uses the selected research Vercel Preview and its exact host permission', async () => {
  const page = transferPopup('researchPreview');
  await page.run();
  assert.equal(page.delivered.length, 1);
  assert.equal(page.delivered[0].tabId, 8);
  assert.equal(page.activated[0], 8);
  assert.match(page.elements.timeTransferStatus.textContent, /1件/);
  assert.deepEqual(JSON.parse(JSON.stringify(page.permissionChecks)), [{ origins: ['https://accounting-of-ai-git-feature-research-mvp-accounting-of-ai.vercel.app/*'] }]);
});

test('time transfer can restore the bridge on an authenticated research Vercel Preview tab', async () => {
  const page = transferPopup('researchPreview', {
    existingUrl: 'https://accounting-of-ai-git-feature-research-mvp-accounting-of-ai.vercel.app/accounting-of-AI/',
    failuresBeforeSuccess: 1,
  });
  await page.run();
  assert.equal(page.injections.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(page.injections[0])), {
    target: { tabId: 7 },
    files: ['timeRecordProtocol.js', 'timeRecordBridge.js'],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(page.permissionChecks)), [
    { origins: ['https://accounting-of-ai-git-feature-research-mvp-accounting-of-ai.vercel.app/*'] },
    { origins: ['https://accounting-of-ai-git-feature-research-mvp-accounting-of-ai.vercel.app/*'] },
  ]);
  assert.match(page.elements.timeTransferStatus.textContent, /1件/);
});

test('time transfer distinguishes a protected Preview login redirect and keeps finalized time pending', async () => {
  const page = transferPopup('researchPreview', {
    targetStates: [{ url: 'https://vercel.com/sso-api?url=protected-preview', status: 'complete' }],
  });
  await page.run();
  assert.equal(page.delivered.length, 0);
  assert.equal(page.activated[0], 8);
  assert.equal(page.runtimeMessages.some((message) => message.type === 'time-records:ackImported'), false);
  assert.match(page.elements.timeTransferStatus.textContent, /Vercel Previewへのログインが必要/);
  assert.match(page.elements.timeTransferStatus.textContent, /確定済みの利用時間は保持/);
});

test('manual fallback copies only the validated minimal time payload and keeps the source records pending', async () => {
  const page = transferPopup('research');
  await page.copy();
  const copied = JSON.parse(page.clipboardText());
  assert.equal(copied.protocol, 'ai-time-records-preview-v1');
  assert.deepEqual(Object.keys(copied.records[0]).sort(), [
    'durationSeconds', 'endedAt', 'localDate', 'provider', 'recordId', 'sessionId', 'startedAt', 'timeZone',
  ]);
  assert.equal(copied.records[0].recordId, 'session-1:day:2026-11-10');
  assert.equal(copied.records[0].durationSeconds, 60);
  assert.equal(page.runtimeMessages.some((message) => message.type === 'time-records:ackImported'), false);
  assert.match(page.elements.timeTransferStatus.textContent, /元の計測記録は保持/);
  assert.equal(page.elements.timeTransferText.hidden, true);
});

test('time transfer waits for a newly created research tab to reach the exact completed URL before messaging', async () => {
  const page = transferPopup('research', {
    targetStates: [
      { pendingUrl: 'http://localhost:5174/accounting-of-AI/', status: 'loading' },
      { url: 'http://localhost:5174/accounting-of-AI/', status: 'loading' },
      { url: 'http://localhost:5174/accounting-of-AI/', status: 'complete' },
    ],
  });
  await page.run();
  assert.equal(page.delivered.length, 1);
  assert.equal(page.delivered[0].tabId, 8);
  assert.equal(page.injections.length, 0);
  assert.match(page.elements.timeTransferStatus.textContent, /1件/);
});

test('time transfer reinjects the research-local bridge when the receiver disappeared', async () => {
  const page = transferPopup('research', {
    existingUrl: 'http://localhost:5174/accounting-of-AI/',
    failuresBeforeSuccess: 1,
  });
  await page.run();
  assert.equal(page.injections.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(page.injections[0])), {
    target: { tabId: 7 },
    files: ['timeRecordProtocol.js', 'timeRecordBridge.js'],
  });
  assert.equal(page.delivered.length, 2);
  assert.equal(page.activated[0], 7);
  assert.match(page.elements.timeTransferStatus.textContent, /1件/);
});

test('failed bridge recovery keeps finalized records pending and explains how to retry', async () => {
  const page = transferPopup('research', {
    existingUrl: 'http://localhost:5174/accounting-of-AI/',
    alwaysFail: true,
    injectionFailure: 'Cannot access contents of URL. Extension manifest must request permission to access this host.',
  });
  await page.run();
  await page.run();
  assert.equal(page.runtimeMessages.filter((message) => message.type === 'time-records:getFinalized').length, 2);
  assert.equal(page.runtimeMessages.some((message) => message.type === 'time-records:ackImported'), false);
  assert.match(page.elements.timeTransferStatus.textContent, /script-injection/);
  assert.match(page.elements.timeTransferStatus.textContent, /ホスト権限: あり/);
  assert.match(page.elements.timeTransferStatus.textContent, /サイトへのアクセス/);
  assert.match(page.elements.timeTransferStatus.textContent, /確定済みの利用時間は保持/);
  assert.equal(page.elements.timeLedgerTransfer.disabled, false);
});

test('missing effective research host permission is diagnosed before script injection', async () => {
  const page = transferPopup('research', {
    existingUrl: 'http://localhost:5174/accounting-of-AI/',
    alwaysFail: true,
    hostPermission: false,
  });
  await page.run();
  assert.equal(page.injections.length, 0);
  assert.match(page.elements.timeTransferStatus.textContent, /段階: host-permission/);
  assert.match(page.elements.timeTransferStatus.textContent, /URL: http:\/\/localhost:5174\/accounting-of-AI\//);
  assert.match(page.elements.timeTransferStatus.textContent, /ホスト権限: なし/);
});

test('time transfer refuses a destination that is not on the allowlist', async () => {
  const page = transferPopup('unapproved');
  await page.run();
  assert.equal(page.delivered.length, 0);
  assert.equal(page.activated.length, 0);
  assert.match(page.elements.timeTransferStatus.textContent, /許可されていない送信先/);
});

test('popup refreshes live tracking and separates current from finalized seconds', async () => {
  let poll: () => Promise<void>;
  let state = { ok: true, enabled: true, active: true, sessionSeconds: 12, finalizedSeconds: 60, totalSeconds: 72 };
  const listenerElement = () => ({ disabled: false, addEventListener() {} });
  const elements: Record<string, any> = {
    createReceipt: listenerElement(), status: { textContent: '' },
    destination: { value: 'production', disabled: false, addEventListener() {} },
    trackingStart: listenerElement(), trackingStop: listenerElement(),
    trackingStatus: { textContent: '' },
    trackingSessionTime: { textContent: '' }, trackingFinalizedTime: { textContent: '' },
    timeLedgerTransfer: undefined, timeTransferStatus: undefined, version: { textContent: '' },
  };
  const sandbox: any = {
    document: { getElementById: (id: string) => elements[id] },
    chrome: {
      runtime: { getManifest: () => ({ version: '0.5.5' }), sendMessage: async () => state },
      storage: { local: { get: async () => ({}), set: async () => {} } },
      tabs: { query: async () => [], create: async () => {} }, scripting: { executeScript: async () => [] },
    },
    setInterval: (handler: () => Promise<void>) => { poll = handler; return 1; }, clearInterval() {}, addEventListener() {},
    URL, URLSearchParams, Date, Error, Number, Set, console: { error() {} },
  };
  vm.runInNewContext(script, sandbox);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(elements.trackingStatus.textContent, /計測中/);
  assert.equal(elements.trackingSessionTime.textContent, '0分12秒');
  assert.equal(elements.trackingFinalizedTime.textContent, '1分0秒');

  state = { ok: true, enabled: false, active: false, sessionSeconds: 0, finalizedSeconds: 72, totalSeconds: 72 };
  await poll();
  assert.match(elements.trackingStatus.textContent, /停止中/);
  assert.equal(elements.trackingSessionTime.textContent, '0分0秒');
  assert.equal(elements.trackingFinalizedTime.textContent, '1分12秒');
});
