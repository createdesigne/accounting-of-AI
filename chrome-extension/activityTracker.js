(function initializeActivityTracker(global) {
  "use strict";

  const IDLE_LIMIT_MS = 5 * 60 * 1000;
  const SESSION_LIMIT_MS = 20 * 60 * 1000;

  function createState() {
    return {
      version: 3,
      enabled: false,
      session: null,
      current: null,
      records: [],
    };
  }

  function normalizeState(value) {
    if (!value || ![1, 2, 3].includes(value.version) || !Array.isArray(value.records)) return createState();

    if (value.version !== 3) return migrateLegacyState(value);

    const records = value.records.map(normalizeRecord).filter(Boolean);
    const session = normalizeSession(value.session);
    let current = normalizeCurrent(value.current);
    if (!session || current?.sessionId !== session.id) current = null;

    return {
      version: 3,
      enabled: value.enabled === true,
      session,
      current,
      records,
    };
  }

  function migrateLegacyState(value) {
    const records = value.records.map(normalizeRecord).filter(Boolean);
    const legacyCurrent = normalizeLegacyCurrent(value.current);
    if (legacyCurrent) {
      records.push(createMigratedRecord({
        id: legacyCurrent.id,
        provider: "ChatGPT",
        startedAt: legacyCurrent.startedAt,
        endedAt: legacyCurrent.accountedThrough,
        durationSeconds: Math.floor(legacyCurrent.durationMs / 1000),
      }));
    }
    return {
      version: 3,
      enabled: value.enabled === true,
      session: null,
      current: null,
      records,
    };
  }

  function normalizeSession(value) {
    if (!value || typeof value.id !== "string" || !value.id) return null;
    if (!Number.isFinite(value.startedAt) || !Number.isFinite(value.lastActivityAt)
      || value.startedAt < 0 || value.lastActivityAt < value.startedAt || !Array.isArray(value.segments)) return null;
    const segments = value.segments.map(normalizeSegment).filter(Boolean);
    return {
      id: value.id,
      provider: "ChatGPT",
      startedAt: value.startedAt,
      lastActivityAt: value.lastActivityAt,
      segments,
    };
  }

  function normalizeCurrent(value) {
    if (!value || typeof value.id !== "string" || !value.id || typeof value.sessionId !== "string" || !value.sessionId
      || !Number.isInteger(value.tabId) || !Number.isInteger(value.windowId)) return null;
    const numericFields = ["startedAt", "lastActivityAt", "accountedThrough", "durationMs"];
    if (numericFields.some((name) => !Number.isFinite(value[name]) || value[name] < 0)) return null;
    if (value.lastActivityAt < value.startedAt || value.accountedThrough < value.startedAt) return null;
    return {
      id: value.id,
      sessionId: value.sessionId,
      tabId: value.tabId,
      windowId: value.windowId,
      startedAt: value.startedAt,
      lastActivityAt: value.lastActivityAt,
      accountedThrough: value.accountedThrough,
      durationMs: value.durationMs,
    };
  }

  function normalizeLegacyCurrent(value) {
    if (!value || typeof value.id !== "string" || !Number.isInteger(value.tabId)) return null;
    const numericFields = ["startedAt", "lastActivityAt", "accountedThrough", "durationMs"];
    if (numericFields.some((name) => !Number.isFinite(value[name]) || value[name] < 0)) return null;
    return value;
  }

  function normalizeSegment(value) {
    if (!value || typeof value.id !== "string" || !value.id) return null;
    if (!Number.isFinite(value.startedAt) || !Number.isFinite(value.endedAt)
      || !Number.isFinite(value.durationMs) || value.startedAt < 0
      || value.endedAt < value.startedAt || value.durationMs < 0) return null;
    return {
      id: value.id,
      startedAt: value.startedAt,
      endedAt: value.endedAt,
      durationMs: value.durationMs,
      durationSeconds: Math.floor(value.durationMs / 1000),
    };
  }

  function normalizeRecord(value) {
    if (!isLegacyRecord(value)) return null;
    if (!Array.isArray(value.segments)) return createMigratedRecord(value);
    const segments = value.segments.map(normalizeSegment).filter(Boolean);
    return {
      id: value.id,
      sessionId: typeof value.sessionId === "string" && value.sessionId ? value.sessionId : value.id,
      provider: "ChatGPT",
      startedAt: value.startedAt,
      endedAt: value.endedAt,
      finalizedAt: Number.isFinite(value.finalizedAt) ? value.finalizedAt : value.endedAt,
      durationSeconds: value.durationSeconds,
      segments,
    };
  }

  function createMigratedRecord(value) {
    const durationMs = value.durationSeconds * 1000;
    return {
      id: value.id,
      sessionId: value.id,
      provider: "ChatGPT",
      startedAt: value.startedAt,
      endedAt: value.endedAt,
      finalizedAt: value.endedAt,
      durationSeconds: value.durationSeconds,
      segments: [{
        id: value.id,
        startedAt: value.startedAt,
        endedAt: value.endedAt,
        durationMs,
        durationSeconds: value.durationSeconds,
      }],
    };
  }

  function isLegacyRecord(value) {
    return Boolean(value)
      && typeof value.id === "string"
      && value.provider === "ChatGPT"
      && Number.isInteger(value.durationSeconds)
      && value.durationSeconds >= 0
      && Number.isFinite(value.startedAt)
      && Number.isFinite(value.endedAt)
      && value.startedAt >= 0
      && value.endedAt >= value.startedAt;
  }

  function enable(state) {
    state.enabled = true;
    return state;
  }

  function disable(state, now) {
    requireTimestamp(now);
    finishSegment(state, now);
    finalizeSession(state, now);
    state.enabled = false;
    return state;
  }

  function recordActivity(state, { now, tabId, windowId, activityId }) {
    if (!state.enabled) return state;
    requireTimestamp(now);
    if (!Number.isInteger(tabId)) throw new TypeError("tabId must be an integer");
    if (!Number.isInteger(windowId)) throw new TypeError("windowId must be an integer");
    if (typeof activityId !== "string" || !activityId) throw new TypeError("activityId is required");

    expireSession(state, now);

    if (state.current && (state.current.tabId !== tabId || state.current.windowId !== windowId)) {
      finishSegment(state, now);
    }

    if (state.current && now - state.current.lastActivityAt >= IDLE_LIMIT_MS) {
      finishSegment(state, state.current.lastActivityAt + IDLE_LIMIT_MS);
    }

    if (!state.session) {
      state.session = {
        id: activityId,
        provider: "ChatGPT",
        startedAt: now,
        lastActivityAt: now,
        segments: [],
      };
    }

    if (!state.current) {
      state.current = {
        id: activityId,
        sessionId: state.session.id,
        tabId,
        windowId,
        startedAt: now,
        lastActivityAt: now,
        accountedThrough: now,
        durationMs: 0,
      };
      state.session.lastActivityAt = Math.max(state.session.lastActivityAt, now);
      return state;
    }

    advanceCurrent(state.current, now);
    state.current.lastActivityAt = Math.max(state.current.lastActivityAt, now);
    state.session.lastActivityAt = Math.max(state.session.lastActivityAt, now);
    return state;
  }

  function pause(state, now) {
    finishSegment(state, now);
    return state;
  }

  function tick(state, now) {
    requireTimestamp(now);
    if (!state.enabled || !state.session) return state;
    if (expireSession(state, now)) return state;
    if (!state.current) return state;
    const idleDeadline = state.current.lastActivityAt + IDLE_LIMIT_MS;
    if (now >= idleDeadline) finishSegment(state, idleDeadline);
    else advanceCurrent(state.current, now);
    return state;
  }

  function expireSession(state, now) {
    if (!state.session || now - state.session.lastActivityAt < SESSION_LIMIT_MS) return false;
    if (state.current) finishSegment(state, state.current.lastActivityAt + IDLE_LIMIT_MS);
    finalizeSession(state, state.session.lastActivityAt + SESSION_LIMIT_MS);
    return true;
  }

  function advanceCurrent(current, now) {
    requireTimestamp(now);
    const endpoint = Math.min(now, current.lastActivityAt + IDLE_LIMIT_MS);
    if (endpoint <= current.accountedThrough) return;
    current.durationMs += endpoint - current.accountedThrough;
    current.accountedThrough = endpoint;
  }

  function finishSegment(state, now) {
    if (!state.current || !state.session) return;
    if (now < state.current.accountedThrough) trimCurrent(state.current, now);
    else advanceCurrent(state.current, now);
    const current = state.current;
    state.session.segments.push({
      id: current.id,
      startedAt: current.startedAt,
      endedAt: current.accountedThrough,
      durationMs: current.durationMs,
      durationSeconds: Math.floor(current.durationMs / 1000),
    });
    state.current = null;
  }

  function finalizeSession(state, finalizedAt) {
    if (!state.session) return;
    if (state.current) finishSegment(state, finalizedAt);
    const session = state.session;
    const durationMs = session.segments.reduce((total, segment) => total + segment.durationMs, 0);
    const endedAt = session.segments.length
      ? session.segments[session.segments.length - 1].endedAt
      : session.startedAt;
    state.records.push({
      id: session.id,
      sessionId: session.id,
      provider: "ChatGPT",
      startedAt: session.startedAt,
      endedAt,
      finalizedAt,
      durationSeconds: Math.floor(durationMs / 1000),
      segments: session.segments.map((segment) => ({ ...segment })),
    });
    state.session = null;
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

  function sessionDurationMs(state) {
    if (!state.session) return 0;
    const completed = state.session.segments.reduce((total, segment) => total + segment.durationMs, 0);
    return completed + (state.current?.durationMs || 0);
  }

  function summary(state) {
    const currentSeconds = Math.floor(sessionDurationMs(state) / 1000);
    const completedSeconds = state.records.reduce((total, record) => total + record.durationSeconds, 0);
    return {
      enabled: state.enabled,
      active: Boolean(state.current),
      currentActivityId: state.current?.id || null,
      currentSessionId: state.session?.id || null,
      sessionOpen: Boolean(state.session),
      totalSeconds: completedSeconds + currentSeconds,
      recordCount: state.records.length,
    };
  }

  function requireTimestamp(value) {
    if (!Number.isFinite(value) || value < 0) throw new TypeError("timestamp must be a positive number");
  }

  global.ActivityTrackerCore = Object.freeze({
    IDLE_LIMIT_MS,
    SESSION_LIMIT_MS,
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
