(function initializeTimeRecordProtocol(global) {
  "use strict";

  const PROTOCOL = "ai-time-records-preview-v1";
  const WINDOW_SOURCE = "ai-time-record-extension";
  const WINDOW_MESSAGE_TYPE = "AI_TIME_RECORDS_PREVIEW";
  const WINDOW_READY_SOURCE = "ai-time-record-web-app";
  const WINDOW_READY_TYPE = "AI_TIME_RECORDS_PREVIEW_READY";
  const WINDOW_ACK_SOURCE = "ai-time-record-web-app";
  const WINDOW_ACK_TYPE = "AI_TIME_RECORDS_IMPORT_ACK";
  const WINDOW_ACK_RESULT_SOURCE = "ai-time-record-extension";
  const WINDOW_ACK_RESULT_TYPE = "AI_TIME_RECORDS_IMPORT_ACK_RESULT";
  const MAX_RECORDS = 500;
  const MAX_PAYLOAD_BYTES = 192 * 1024;
  const MAX_ID_LENGTH = 160;
  const MAX_TIME_ZONE_LENGTH = 80;
  const ALLOWED_KEYS = Object.freeze([
    "recordId",
    "sessionId",
    "provider",
    "localDate",
    "timeZone",
    "startedAt",
    "endedAt",
    "durationSeconds",
  ]);
  const DESTINATIONS = Object.freeze({
    production: "https://createdesigne.github.io/accounting-of-AI/",
    preview: "https://createdesigne.github.io/accounting-of-AI/preview/month-ledger/",
    local: "http://localhost:5173/accounting-of-AI/",
  });

  function isAllowedAppUrl(value) {
    try {
      const url = new URL(value);
      if (url.username || url.password) return false;
      if (url.origin === "https://createdesigne.github.io") {
        return url.pathname.startsWith("/accounting-of-AI/");
      }
      return url.origin === "http://localhost:5173"
        && url.pathname.startsWith("/accounting-of-AI/");
    } catch {
      return false;
    }
  }

  function isDestinationUrl(value, destination) {
    const base = DESTINATIONS[destination];
    if (!base || !isAllowedAppUrl(value)) return false;
    try {
      const url = new URL(value);
      const expected = new URL(base);
      if (url.origin !== expected.origin) return false;
      if (destination === "production") return url.pathname === expected.pathname;
      return url.pathname.startsWith(expected.pathname);
    } catch {
      return false;
    }
  }

  function destinationForUrl(value) {
    if (isDestinationUrl(value, "preview")) return "preview";
    if (isDestinationUrl(value, "local")) return "local";
    if (isDestinationUrl(value, "production")) return "production";
    return null;
  }

  function createPayload(sourceRecords, requestId) {
    if (!Array.isArray(sourceRecords)) throw new TypeError("records must be an array");
    if (!isSafeText(requestId, MAX_ID_LENGTH)) throw new TypeError("requestId is invalid");
    const records = [];
    const seen = new Set();
    for (const source of sourceRecords) {
      const record = projectRecord(source);
      if (!record) throw new TypeError("time record is invalid");
      if (seen.has(record.recordId)) continue;
      seen.add(record.recordId);
      records.push(record);
    }
    const payload = { protocol: PROTOCOL, requestId, records };
    const validation = validatePayload(payload);
    if (!validation.ok) throw new RangeError(validation.error);
    return payload;
  }

  function validatePayload(value) {
    if (!isPlainObject(value) || value.protocol !== PROTOCOL
      || !isSafeText(value.requestId, MAX_ID_LENGTH) || !Array.isArray(value.records)) {
      return { ok: false, error: "連携メッセージの形式が正しくありません。" };
    }
    const payloadKeys = Object.keys(value);
    if (payloadKeys.length !== 3
      || payloadKeys.some((key) => !["protocol", "requestId", "records"].includes(key))) {
      return { ok: false, error: "連携メッセージに許可されていない項目があります。" };
    }
    if (value.records.length > MAX_RECORDS) {
      return { ok: false, error: `一度に連携できる記録は${MAX_RECORDS}件までです。` };
    }
    const seen = new Set();
    for (const record of value.records) {
      if (!isValidRecord(record)) return { ok: false, error: "利用時間の記録形式が正しくありません。" };
      if (seen.has(record.recordId)) return { ok: false, error: "同じ記録IDが重複しています。" };
      seen.add(record.recordId);
    }
    if (payloadBytes(value) > MAX_PAYLOAD_BYTES) {
      return { ok: false, error: "連携データが大きすぎます。期間を分けてお試しください。" };
    }
    return { ok: true };
  }

  function projectRecord(source) {
    if (!isPlainObject(source)) return null;
    const record = {
      recordId: source.recordId,
      sessionId: source.sessionId,
      provider: source.provider,
      localDate: source.localDate,
      timeZone: source.timeZone,
      startedAt: source.startedAt,
      endedAt: source.endedAt,
      durationSeconds: source.durationSeconds,
    };
    return isValidRecord(record) ? record : null;
  }

  function isValidRecord(value) {
    if (!isPlainObject(value)) return false;
    const keys = Object.keys(value);
    if (keys.length !== ALLOWED_KEYS.length || keys.some((key) => !ALLOWED_KEYS.includes(key))) return false;
    if (!isSafeText(value.recordId, MAX_ID_LENGTH) || !isSafeText(value.sessionId, MAX_ID_LENGTH)) return false;
    if (value.provider !== "ChatGPT" || !isCalendarDate(value.localDate)) return false;
    if (!isSafeText(value.timeZone, MAX_TIME_ZONE_LENGTH) || !isValidTimeZone(value.timeZone)) return false;
    if (!Number.isFinite(value.startedAt) || !Number.isFinite(value.endedAt)
      || value.startedAt < 0 || value.endedAt < value.startedAt) return false;
    return Number.isInteger(value.durationSeconds) && value.durationSeconds > 0;
  }

  function recordFingerprint(record) {
    const projected = projectRecord(record);
    if (!projected) throw new TypeError("time record is invalid");
    return JSON.stringify([
      projected.recordId,
      projected.sessionId,
      projected.provider,
      projected.localDate,
      projected.timeZone,
      projected.startedAt,
      projected.endedAt,
      projected.durationSeconds,
    ]);
  }

  function isSafeText(value, maximumLength) {
    return typeof value === "string" && value.length > 0 && value.length <= maximumLength
      && !/[\u0000-\u001f\u007f]/.test(value);
  }

  function isCalendarDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function isValidTimeZone(value) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
      return true;
    } catch {
      return false;
    }
  }

  function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === null || Object.getPrototypeOf(prototype) === null;
  }

  function payloadBytes(value) {
    const text = JSON.stringify(value);
    if (typeof TextEncoder === "function") return new TextEncoder().encode(text).byteLength;
    return unescape(encodeURIComponent(text)).length;
  }

  global.TimeRecordProtocol = Object.freeze({
    PROTOCOL,
    WINDOW_SOURCE,
    WINDOW_MESSAGE_TYPE,
    WINDOW_READY_SOURCE,
    WINDOW_READY_TYPE,
    WINDOW_ACK_SOURCE,
    WINDOW_ACK_TYPE,
    WINDOW_ACK_RESULT_SOURCE,
    WINDOW_ACK_RESULT_TYPE,
    MAX_RECORDS,
    MAX_PAYLOAD_BYTES,
    DESTINATIONS,
    ALLOWED_KEYS,
    isAllowedAppUrl,
    isDestinationUrl,
    destinationForUrl,
    createPayload,
    validatePayload,
    recordFingerprint,
  });
})(globalThis);
