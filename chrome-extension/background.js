importScripts("activityTracker.js", "timeRecordProtocol.js");

const STORAGE_KEY = "chatgptActiveTimeTrackingV1";
const IMPORT_STATUS_KEY = "chatgptTimeAccountingImportsV1";
const ALARM_NAME = "chatgpt-active-time-tick";
const tracker = globalThis.ActivityTrackerCore;
const timeRecordProtocol = globalThis.TimeRecordProtocol;
let statePromise;
let workQueue = Promise.resolve();

ensureAlarm();

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  enqueue(async () => {
    const state = await loadState();
    // Never bridge measured time across a browser restart. The logical session
    // may remain open for up to 20 minutes, but its active segment ends at the
    // last instant that was already persisted before Chrome stopped.
    if (state.current) tracker.pause(state, state.current.accountedThrough);
    tracker.tick(state, Date.now());
    await saveState(state);
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  enqueue(async () => {
    const state = await loadState();
    await reconcileCurrentEnvironment(state, Date.now());
    await saveState(state);
  });
});

chrome.tabs.onActivated.addListener(() => {
  const occurredAt = Date.now();
  enqueue(() => pauseAndSave(occurredAt));
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (!tab.active || (!changeInfo.url && changeInfo.status !== "loading")) return;
  if (!isChatGptUrl(tab.url || changeInfo.url || "")) {
    const occurredAt = Date.now();
    enqueue(() => pauseAndSave(occurredAt));
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const occurredAt = Date.now();
  enqueue(async () => {
    const state = await loadState();
    if (state.current?.tabId !== tabId) return;
    tracker.pause(state, occurredAt);
    await saveState(state);
  });
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  const occurredAt = Date.now();
  enqueue(async () => {
    const state = await loadState();
    if (!state.current) return;
    if (windowId === chrome.windows.WINDOW_ID_NONE || state.current.windowId !== windowId) {
      tracker.pause(state, occurredAt);
    } else {
      // The same Chrome window regained focus. If a preceding NONE event was
      // delayed or missed, close at the last already-accounted instant so time
      // spent in another Windows application cannot be filled in retroactively.
      tracker.pause(state, state.current.accountedThrough);
    }
    await saveState(state);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const receivedAt = Date.now();
  if (message?.type === "tracking:activity") {
    enqueue(async () => {
      await handleActivity(sender, receivedAt);
    });
    return false;
  }

  if (message?.type === "tracking:pageInactive") {
    enqueue(() => pauseAndSave(receivedAt));
    return false;
  }

  if (message?.type === "time-records:getFinalized") {
    enqueue(async () => {
      const destination = requireDestination(message.destination);
      const state = await loadState();
      await reconcileCurrentEnvironment(state, receivedAt);
      await saveState(state);
      const importStatus = await loadImportStatus();
      const payload = timeRecordProtocol.createPayload(
        getPendingDailyRecords(state, importStatus, destination),
        `time-transfer-${crypto.randomUUID()}`,
      );
      sendResponse({ ok: true, payload });
    }).catch((error) => {
      console.error("Time-record transfer failed", error);
      sendResponse({
        ok: false,
        message: error instanceof Error ? error.message : "利用時間を準備できませんでした。",
      });
    });
    return true;
  }

  if (message?.type === "time-records:ackImported") {
    enqueue(async () => {
      const destination = requireDestination(message.destination);
      const validation = timeRecordProtocol.validatePayload(message.payload);
      if (!validation.ok) throw new Error(validation.error);
      const state = await loadState();
      const finalized = new Map(getFinalizedDailyRecords(state).map((record) => [record.recordId, record]));
      const importStatus = await loadImportStatus();
      const next = normalizeImportStatus(importStatus);
      for (const record of message.payload.records) {
        const source = finalized.get(record.recordId);
        if (!source || timeRecordProtocol.recordFingerprint(source) !== timeRecordProtocol.recordFingerprint(record)) {
          throw new Error(`保存済み記録と拡張機能の記録が一致しません: ${record.recordId}`);
        }
        next.destinations[destination][record.recordId] = {
          fingerprint: timeRecordProtocol.recordFingerprint(record),
          importedAt: receivedAt,
        };
      }
      await chrome.storage.local.set({ [IMPORT_STATUS_KEY]: next });
      sendResponse({ ok: true, acknowledgedCount: message.payload.records.length });
    }).catch((error) => {
      console.error("Time-record acknowledgement failed", error);
      sendResponse({
        ok: false,
        message: error instanceof Error ? error.message : "取込完了を記録できませんでした。",
      });
    });
    return true;
  }

  if (message?.type === "tracking:get" || message?.type === "tracking:setEnabled") {
    enqueue(async () => {
      const state = await loadState();
      if (message.type === "tracking:setEnabled") {
        if (message.enabled === true) {
          tracker.enable(state);
          await startFromActiveChatGpt(state, receivedAt);
        }
        else {
          await reconcileCurrentEnvironment(state, receivedAt);
          tracker.disable(state, receivedAt);
        }
      } else {
        await reconcileCurrentEnvironment(state, receivedAt);
      }
      await saveState(state);
      sendResponse({ ok: true, ...tracker.summary(state) });
    }).catch((error) => {
      console.error("Active-time tracking failed", error);
      sendResponse({ ok: false, message: "計測状態を更新できませんでした。" });
    });
    return true;
  }

  return false;
});

async function handleActivity(sender, occurredAt) {
  const state = await loadState();
  if (!state.enabled) return;
  const senderTab = sender.tab;
  if (!senderTab?.id || !isChatGptUrl(senderTab.url || "")) return;

  const [tab, window] = await Promise.all([
    chrome.tabs.get(senderTab.id).catch(() => null),
    chrome.windows.get(senderTab.windowId).catch(() => null),
  ]);
  const lastFocused = await chrome.windows.getLastFocused().catch(() => null);
  if (!tab?.active || !window?.focused || !lastFocused?.focused
    || lastFocused.id !== senderTab.windowId || !isChatGptUrl(tab.url || "")) {
    tracker.pause(state, occurredAt);
    await saveState(state);
    return;
  }

  tracker.recordActivity(state, {
    now: occurredAt,
    tabId: tab.id,
    windowId: senderTab.windowId,
    activityId: createActivityId(),
    timeZone: getLocalTimeZone(),
  });
  await saveState(state);
}

async function startFromActiveChatGpt(state, occurredAt) {
  const lastFocused = await chrome.windows.getLastFocused().catch(() => null);
  if (!lastFocused?.focused || !Number.isInteger(lastFocused.id)) return;
  const [tab] = await chrome.tabs.query({ active: true, windowId: lastFocused.id });
  if (!tab?.id || !isChatGptUrl(tab.url || "")) return;
  tracker.recordActivity(state, {
    now: occurredAt,
    tabId: tab.id,
    windowId: lastFocused.id,
    activityId: createActivityId(),
    timeZone: getLocalTimeZone(),
  });
}

function isChatGptUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "chatgpt.com" || url.hostname === "chat.openai.com");
  } catch {
    return false;
  }
}

function createActivityId() {
  return `chatgpt-${crypto.randomUUID()}`;
}

function getLocalTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function getFinalizedDailyRecords(state) {
  return state.records.flatMap((record) => (
    Array.isArray(record.dailyRecords) ? record.dailyRecords : []
  )).filter((record) => record.durationSeconds > 0);
}

function getPendingDailyRecords(state, importStatus, destination) {
  const imported = importStatus.destinations[destination];
  return getFinalizedDailyRecords(state).filter((record) => (
    imported[record.recordId]?.fingerprint !== timeRecordProtocol.recordFingerprint(record)
  ));
}

function requireDestination(value) {
  if (value === "production" || value === "preview" || value === "local") return value;
  throw new Error("許可されていない送信先です。");
}

async function loadImportStatus() {
  const stored = await chrome.storage.local.get(IMPORT_STATUS_KEY);
  return normalizeImportStatus(stored[IMPORT_STATUS_KEY]);
}

function normalizeImportStatus(value) {
  const normalized = {
    version: 1,
    destinations: {
      production: Object.create(null),
      preview: Object.create(null),
      local: Object.create(null),
    },
  };
  if (!value || value.version !== 1 || !value.destinations) return normalized;
  for (const destination of ["production", "preview", "local"]) {
    const records = value.destinations[destination];
    if (!records || typeof records !== "object" || Array.isArray(records)) continue;
    for (const [recordId, status] of Object.entries(records)) {
      if (typeof recordId !== "string" || !status || typeof status.fingerprint !== "string"
        || !Number.isFinite(status.importedAt) || status.importedAt < 0) continue;
      normalized.destinations[destination][recordId] = {
        fingerprint: status.fingerprint,
        importedAt: status.importedAt,
      };
    }
  }
  return normalized;
}

async function ensureAlarm() {
  try {
    const alarm = await chrome.alarms.get(ALARM_NAME);
    if (!alarm) await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });
  } catch (error) {
    console.error("Active-time alarm setup failed", error);
  }
}

function enqueue(task) {
  const result = workQueue.then(task, task);
  workQueue = result.catch(() => {});
  return result;
}

async function loadState() {
  if (!statePromise) {
    statePromise = chrome.storage.local.get(STORAGE_KEY)
      .then((stored) => tracker.normalizeState(stored[STORAGE_KEY]));
  }
  return statePromise;
}

async function saveState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

async function pauseAndSave(now) {
  const state = await loadState();
  tracker.pause(state, now);
  tracker.tick(state, now);
  await saveState(state);
}

async function reconcileCurrentEnvironment(state, now) {
  if (!state.current) {
    tracker.tick(state, now);
    return;
  }
  const current = state.current;
  const [tab, window, lastFocused] = await Promise.all([
    chrome.tabs.get(current.tabId).catch(() => null),
    chrome.windows.get(current.windowId).catch(() => null),
    chrome.windows.getLastFocused().catch(() => null),
  ]);
  const isEligible = Boolean(
    tab?.active
    && tab.windowId === current.windowId
    && isChatGptUrl(tab.url || "")
    && window?.focused
    && lastFocused?.focused
    && lastFocused.id === current.windowId,
  );
  if (isEligible) tracker.tick(state, now);
  else {
    tracker.pause(state, current.accountedThrough);
    tracker.tick(state, now);
  }
}
