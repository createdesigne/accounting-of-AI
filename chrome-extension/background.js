importScripts("activityTracker.js");

const STORAGE_KEY = "chatgptActiveTimeTrackingV1";
const ALARM_NAME = "chatgpt-active-time-tick";
const tracker = globalThis.ActivityTrackerCore;
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
