(function initializeActivityTracker(global) {
  "use strict";

  const IDLE_LIMIT_MS = 5 * 60 * 1000;

  function createState() {
    return {
      version: 2,
      enabled: false,
      current: null,
      records: [],
    };
  }

  function normalizeState(value) {
    if (!value || (value.version !== 1 && value.version !== 2) || !Array.isArray(value.records)) return createState();
    const records = value.records.filter(isRecord);
    const current = normalizeCurrent(value.current);
    if (!current && isLegacyCurrent(value.current)) {
      records.push({
        id: value.current.id,
        provider: "ChatGPT",
        startedAt: value.current.startedAt,
        endedAt: value.current.accountedThrough,
        durationSeconds: Math.floor(value.current.durationMs / 1000),
      });
    }
    return {
      version: 2,
      enabled: value.enabled === true,
      current,
      records,
    };
  }

  function normalizeCurrent(value) {
    if (!value || typeof value.id !== "string" || !Number.isInteger(value.tabId) || !Number.isInteger(value.windowId)) return null;
    const numericFields = ["startedAt", "lastActivityAt", "accountedThrough", "durationMs"];
    if (numericFields.some((name) => !Number.isFinite(value[name]) || value[name] < 0)) return null;
    return {
      id: value.id,
      tabId: value.tabId,
      windowId: value.windowId,
      startedAt: value.startedAt,
      lastActivityAt: value.lastActivityAt,
      accountedThrough: value.accountedThrough,
      durationMs: value.durationMs,
    };
  }

  function isLegacyCurrent(value) {
    if (!value || typeof value.id !== "string" || !Number.isInteger(value.tabId)) return false;
    return ["startedAt", "lastActivityAt", "accountedThrough", "durationMs"]
      .every((name) => Number.isFinite(value[name]) && value[name] >= 0);
  }

  function isRecord(value) {
    return Boolean(value)
      && typeof value.id === "string"
      && value.provider === "ChatGPT"
      && Number.isInteger(value.durationSeconds)
      && value.durationSeconds >= 0
      && Number.isFinite(value.startedAt)
      && Number.isFinite(value.endedAt);
  }

  function enable(state) {
    state.enabled = true;
    return state;
  }

  function disable(state, now) {
    finishCurrent(state, now);
    state.enabled = false;
    return state;
  }

  function recordActivity(state, { now, tabId, windowId, activityId }) {
    if (!state.enabled) return state;
    requireTimestamp(now);
    if (!Number.isInteger(tabId)) throw new TypeError("tabId must be an integer");
    if (!Number.isInteger(windowId)) throw new TypeError("windowId must be an integer");

    if (state.current && (state.current.tabId !== tabId || state.current.windowId !== windowId)) {
      finishCurrent(state, now);
    }

    if (state.current && now - state.current.lastActivityAt > IDLE_LIMIT_MS) {
      finishCurrent(state, state.current.lastActivityAt + IDLE_LIMIT_MS);
    }

    if (!state.current) {
      if (typeof activityId !== "string" || !activityId) throw new TypeError("activityId is required");
      state.current = {
        id: activityId,
        tabId,
        windowId,
        startedAt: now,
        lastActivityAt: now,
        accountedThrough: now,
        durationMs: 0,
      };
      return state;
    }

    advanceCurrent(state.current, now);
    state.current.lastActivityAt = Math.max(state.current.lastActivityAt, now);
    return state;
  }

  function pause(state, now) {
    finishCurrent(state, now);
    return state;
  }

  function tick(state, now) {
    if (!state.enabled || !state.current) return state;
    const idleDeadline = state.current.lastActivityAt + IDLE_LIMIT_MS;
    if (now >= idleDeadline) finishCurrent(state, idleDeadline);
    else advanceCurrent(state.current, now);
    return state;
  }

  function advanceCurrent(current, now) {
    requireTimestamp(now);
    const endpoint = Math.min(now, current.lastActivityAt + IDLE_LIMIT_MS);
    if (endpoint <= current.accountedThrough) return;
    current.durationMs += endpoint - current.accountedThrough;
    current.accountedThrough = endpoint;
  }

  function finishCurrent(state, now) {
    if (!state.current) return;
    if (now < state.current.accountedThrough) trimCurrent(state.current, now);
    else advanceCurrent(state.current, now);
    const current = state.current;
    state.records.push({
      id: current.id,
      provider: "ChatGPT",
      startedAt: current.startedAt,
      endedAt: current.accountedThrough,
      durationSeconds: Math.floor(current.durationMs / 1000),
    });
    state.current = null;
  }

  function trimCurrent(current, now) {
    requireTimestamp(now);
    const endpoint = Math.max(current.startedAt, now);
    const overcountedMs = current.accountedThrough - endpoint;
    if (overcountedMs <= 0) return;
    current.durationMs = Math.max(0, current.durationMs - overcountedMs);
    current.accountedThrough = endpoint;
  }

  function summary(state) {
    const currentSeconds = state.current ? Math.floor(state.current.durationMs / 1000) : 0;
    const completedSeconds = state.records.reduce((total, record) => total + record.durationSeconds, 0);
    return {
      enabled: state.enabled,
      active: Boolean(state.current),
      currentActivityId: state.current?.id || null,
      totalSeconds: completedSeconds + currentSeconds,
      recordCount: state.records.length,
    };
  }

  function requireTimestamp(value) {
    if (!Number.isFinite(value) || value < 0) throw new TypeError("timestamp must be a positive number");
  }

  global.ActivityTrackerCore = Object.freeze({
    IDLE_LIMIT_MS,
    createState,
    normalizeState,
    enable,
    disable,
    recordActivity,
    pause,
    tick,
    summary,
  });
})(globalThis);
