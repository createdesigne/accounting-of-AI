(function initializeActivityTracker(global) {
  "use strict";

  const IDLE_LIMIT_MS = 5 * 60 * 1000;
  const SESSION_LIMIT_MS = 20 * 60 * 1000;
  const DATE_SCAN_STEP_MS = 6 * 60 * 60 * 1000;
  const dateFormatterCache = new Map();

  function createState() {
    return {
      version: 4,
      enabled: false,
      session: null,
      current: null,
      records: [],
    };
  }

  function normalizeState(value) {
    if (!value || ![1, 2, 3, 4].includes(value.version) || !Array.isArray(value.records)) return createState();

    if (value.version === 1 || value.version === 2) return migrateLegacyState(value);

    const records = value.records.map(normalizeRecord).filter(Boolean);
    const session = normalizeSession(value.session);
    let current = normalizeCurrent(value.current);
    if (!session || current?.sessionId !== session.id) current = null;

    return {
      version: 4,
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
      version: 4,
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
      timeZone: normalizeTimeZone(value.timeZone),
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
    const record = {
      id: value.id,
      sessionId: typeof value.sessionId === "string" && value.sessionId ? value.sessionId : value.id,
      provider: "ChatGPT",
      timeZone: normalizeTimeZone(value.timeZone),
      startedAt: value.startedAt,
      endedAt: value.endedAt,
      finalizedAt: Number.isFinite(value.finalizedAt) ? value.finalizedAt : value.endedAt,
      durationSeconds: value.durationSeconds,
      segments,
    };
    record.dailyRecords = splitMeasuredSegmentsByDate({
      sessionId: record.sessionId,
      provider: record.provider,
      timeZone: record.timeZone,
      segments: record.segments,
      totalSeconds: record.durationSeconds,
    });
    return record;
  }

  function createMigratedRecord(value) {
    const durationMs = value.durationSeconds * 1000;
    const record = {
      id: value.id,
      sessionId: value.id,
      provider: "ChatGPT",
      timeZone: normalizeTimeZone(value.timeZone),
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
    record.dailyRecords = splitMeasuredSegmentsByDate({
      sessionId: record.sessionId,
      provider: record.provider,
      timeZone: record.timeZone,
      segments: record.segments,
      totalSeconds: record.durationSeconds,
    });
    return record;
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

  function recordActivity(state, { now, tabId, windowId, activityId, timeZone }) {
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
        timeZone: normalizeTimeZone(timeZone),
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
    const durationSeconds = Math.floor(durationMs / 1000);
    const record = {
      id: session.id,
      sessionId: session.id,
      provider: "ChatGPT",
      timeZone: session.timeZone,
      startedAt: session.startedAt,
      endedAt,
      finalizedAt,
      durationSeconds,
      segments: session.segments.map((segment) => ({ ...segment })),
    };
    record.dailyRecords = splitMeasuredSegmentsByDate({
      sessionId: record.sessionId,
      provider: record.provider,
      timeZone: record.timeZone,
      segments: record.segments,
      totalSeconds: record.durationSeconds,
    });
    state.records.push(record);
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

  function splitMeasuredSegmentsByDate({ sessionId, provider = "ChatGPT", timeZone, segments, totalSeconds }) {
    if (typeof sessionId !== "string" || !sessionId) throw new TypeError("sessionId is required");
    if (!Array.isArray(segments)) throw new TypeError("segments must be an array");
    const zone = normalizeTimeZone(timeZone);
    const buckets = new Map();

    for (const segment of segments) {
      if (!segment || typeof segment.id !== "string" || !segment.id
        || !Number.isFinite(segment.startedAt) || !Number.isFinite(segment.endedAt)
        || !Number.isFinite(segment.durationMs) || segment.startedAt < 0
        || segment.endedAt < segment.startedAt || segment.durationMs < 0) continue;
      const slices = splitIntervalAtLocalDates(segment.startedAt, segment.endedAt, zone);
      const allocatedMs = allocateIntegerByWeight(
        Math.floor(segment.durationMs),
        slices.map((slice) => slice.endedAt - slice.startedAt),
      );
      slices.forEach((slice, index) => {
        let bucket = buckets.get(slice.localDate);
        if (!bucket) {
          bucket = {
            id: `${sessionId}:day:${slice.localDate}`,
            recordId: `${sessionId}:day:${slice.localDate}`,
            sessionId,
            provider,
            localDate: slice.localDate,
            timeZone: zone,
            startedAt: slice.startedAt,
            endedAt: slice.endedAt,
            durationMs: 0,
            durationSeconds: 0,
            segments: [],
          };
          buckets.set(slice.localDate, bucket);
        }
        bucket.startedAt = Math.min(bucket.startedAt, slice.startedAt);
        bucket.endedAt = Math.max(bucket.endedAt, slice.endedAt);
        bucket.durationMs += allocatedMs[index];
        bucket.segments.push({
          id: `${segment.id}:day:${slice.localDate}`,
          sourceSegmentId: segment.id,
          startedAt: slice.startedAt,
          endedAt: slice.endedAt,
          durationMs: allocatedMs[index],
        });
      });
    }

    const dailyRecords = [...buckets.values()].sort((left, right) => left.localDate.localeCompare(right.localDate));
    const measuredMs = dailyRecords.reduce((sum, record) => sum + record.durationMs, 0);
    const expectedSeconds = Number.isInteger(totalSeconds) && totalSeconds >= 0
      ? totalSeconds
      : Math.floor(measuredMs / 1000);
    allocateDailySeconds(dailyRecords, expectedSeconds);
    return dailyRecords;
  }

  function splitIntervalAtLocalDates(startedAt, endedAt, timeZone) {
    if (endedAt === startedAt) {
      return [{ localDate: formatLocalDate(startedAt, timeZone), startedAt, endedAt }];
    }
    const slices = [];
    let cursor = startedAt;
    while (cursor < endedAt) {
      const localDate = formatLocalDate(cursor, timeZone);
      const lastIncluded = endedAt - 1;
      let lastSame = cursor;
      let probe = Math.min(lastIncluded, cursor + DATE_SCAN_STEP_MS);
      while (probe < lastIncluded && formatLocalDate(probe, timeZone) === localDate) {
        lastSame = probe;
        probe = Math.min(lastIncluded, probe + DATE_SCAN_STEP_MS);
      }
      if (formatLocalDate(probe, timeZone) === localDate) {
        slices.push({ localDate, startedAt: cursor, endedAt });
        break;
      }

      let low = lastSame;
      let high = probe;
      while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (formatLocalDate(middle, timeZone) === localDate) low = middle;
        else high = middle;
      }
      slices.push({ localDate, startedAt: cursor, endedAt: high });
      cursor = high;
    }
    return slices;
  }

  function allocateIntegerByWeight(total, weights) {
    if (!weights.length) return [];
    const weightTotal = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
    if (weightTotal === 0) return weights.map((_, index) => index === 0 ? total : 0);
    const exact = weights.map((weight) => total * Math.max(0, weight) / weightTotal);
    const allocated = exact.map(Math.floor);
    let remaining = total - allocated.reduce((sum, value) => sum + value, 0);
    const order = exact.map((value, index) => ({ index, remainder: value - allocated[index] }))
      .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
    for (let index = 0; remaining > 0; index++, remaining--) {
      allocated[order[index % order.length].index] += 1;
    }
    return allocated;
  }

  function allocateDailySeconds(records, totalSeconds) {
    for (const record of records) record.durationSeconds = Math.floor(record.durationMs / 1000);
    let remaining = totalSeconds - records.reduce((sum, record) => sum + record.durationSeconds, 0);
    const descendingRemainder = [...records].sort((left, right) => (
      (right.durationMs % 1000) - (left.durationMs % 1000)
      || left.localDate.localeCompare(right.localDate)
    ));
    for (let index = 0; remaining > 0 && descendingRemainder.length; index++, remaining--) {
      descendingRemainder[index % descendingRemainder.length].durationSeconds += 1;
    }
    if (remaining < 0) {
      const descendingSeconds = [...records].sort((left, right) => (
        right.durationSeconds - left.durationSeconds || right.localDate.localeCompare(left.localDate)
      ));
      for (let index = 0; remaining < 0 && descendingSeconds.length; index++) {
        const record = descendingSeconds[index % descendingSeconds.length];
        if (record.durationSeconds > 0) {
          record.durationSeconds -= 1;
          remaining += 1;
        }
      }
    }
  }

  function normalizeTimeZone(value) {
    const fallback = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const candidate = typeof value === "string" && value ? value : fallback;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(0);
      return candidate;
    } catch {
      return fallback;
    }
  }

  function formatLocalDate(timestamp, timeZone) {
    let formatter = dateFormatterCache.get(timeZone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      dateFormatterCache.set(timeZone, formatter);
    }
    const parts = Object.fromEntries(formatter.formatToParts(timestamp).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
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
    splitMeasuredSegmentsByDate,
  });
})(globalThis);
