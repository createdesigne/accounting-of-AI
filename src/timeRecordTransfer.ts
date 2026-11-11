export const TIME_RECORD_PROTOCOL = "ai-time-records-preview-v1";
export const TIME_RECORD_WINDOW_SOURCE = "ai-time-record-extension";
export const TIME_RECORD_WINDOW_MESSAGE_TYPE = "AI_TIME_RECORDS_PREVIEW";
export const TIME_RECORD_READY_SOURCE = "ai-time-record-web-app";
export const TIME_RECORD_READY_TYPE = "AI_TIME_RECORDS_PREVIEW_READY";
export const TIME_RECORD_ACK_SOURCE = "ai-time-record-web-app";
export const TIME_RECORD_ACK_TYPE = "AI_TIME_RECORDS_IMPORT_ACK";
export const TIME_RECORD_ACK_RESULT_SOURCE = "ai-time-record-extension";
export const TIME_RECORD_ACK_RESULT_TYPE = "AI_TIME_RECORDS_IMPORT_ACK_RESULT";
export const TIME_RECORD_AUTO_REQUEST_TYPE = "AI_TIME_RECORDS_AUTO_REQUEST";
export const TIME_RECORD_AUTO_RESULT_TYPE = "AI_TIME_RECORDS_AUTO_RESULT";
export const TIME_RECORD_MAX_COUNT = 500;
export const TIME_RECORD_MAX_BYTES = 192 * 1024;

const recordKeys = [
  "recordId",
  "sessionId",
  "provider",
  "localDate",
  "timeZone",
  "startedAt",
  "endedAt",
  "durationSeconds",
] as const;

export type TimeRecordPreview = {
  recordId: string;
  sessionId: string;
  provider: "ChatGPT";
  localDate: string;
  timeZone: string;
  startedAt: number;
  endedAt: number;
  durationSeconds: number;
};

export type TimeRecordPayload = {
  protocol: typeof TIME_RECORD_PROTOCOL;
  requestId: string;
  records: TimeRecordPreview[];
};

type TimeRecordMessageChannel = {
  location: { origin: string };
  setTimeout: (handler: () => void, timeout?: number) => number;
  clearTimeout: (id: number) => void;
  addEventListener: (type: "message", listener: (event: MessageEvent) => void) => void;
  removeEventListener: (type: "message", listener: (event: MessageEvent) => void) => void;
  postMessage: (message: unknown, targetOrigin: string) => void;
};

export function parseTimeRecordPayload(value: unknown): TimeRecordPayload | null {
  if (!isObject(value) || value.protocol !== TIME_RECORD_PROTOCOL
    || !isSafeText(value.requestId, 160) || !Array.isArray(value.records)
    || value.records.length > TIME_RECORD_MAX_COUNT) return null;
  const payloadKeys = Object.keys(value);
  if (payloadKeys.length !== 3
    || payloadKeys.some((key) => !["protocol", "requestId", "records"].includes(key))) return null;
  const seen = new Set<string>();
  const records: TimeRecordPreview[] = [];
  for (const candidate of value.records) {
    const record = parseTimeRecordPreview(candidate);
    if (!record || seen.has(record.recordId)) return null;
    seen.add(record.recordId);
    records.push(record);
  }
  const payload: TimeRecordPayload = {
    protocol: TIME_RECORD_PROTOCOL,
    requestId: value.requestId,
    records,
  };
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > TIME_RECORD_MAX_BYTES) return null;
  return payload;
}

export function createTimeRecordPayload(records: readonly TimeRecordPreview[], requestId: string): TimeRecordPayload {
  const payload = parseTimeRecordPayload({ protocol: TIME_RECORD_PROTOCOL, requestId, records: [...records] });
  if (!payload) throw new Error("利用時間の完了通知データが正しくありません。");
  return payload;
}

export function timeRecordFingerprint(record: TimeRecordPreview) {
  return JSON.stringify([
    record.recordId,
    record.sessionId,
    record.provider,
    record.localDate,
    record.timeZone,
    record.startedAt,
    record.endedAt,
    record.durationSeconds,
  ]);
}

export function mergeTimeRecordPreviews(
  current: TimeRecordPreview[],
  received: TimeRecordPreview[],
) {
  const byId = new Map(current.map((record) => [record.recordId, record]));
  for (const record of received) {
    const existing = byId.get(record.recordId);
    if (existing && timeRecordFingerprint(existing) !== timeRecordFingerprint(record)) {
      throw new Error(`同じ記録IDに異なる内容が届きました: ${record.recordId}`);
    }
    if (!existing) byId.set(record.recordId, record);
  }
  return [...byId.values()].sort((left, right) => (
    left.localDate.localeCompare(right.localDate) || left.recordId.localeCompare(right.recordId)
  ));
}

export function formatTimeRecordDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0 ? `${hours}時間${minutes}分${rest}秒` : `${minutes}分${rest}秒`;
}

export function acknowledgeImportedTimeRecords(
  records: readonly TimeRecordPreview[],
  timeoutMs = 4_000,
): Promise<void> {
  const requestId = `time-import-ack-${crypto.randomUUID()}`;
  const payload = createTimeRecordPayload(records, requestId);
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("拡張機能への取込完了通知がタイムアウトしました。"));
    }, timeoutMs);
    const receiveResult = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin
        || event.data?.source !== TIME_RECORD_ACK_RESULT_SOURCE
        || event.data?.type !== TIME_RECORD_ACK_RESULT_TYPE
        || event.data?.requestId !== requestId) return;
      cleanup();
      if (event.data.ok === true) resolve();
      else reject(new Error(
        typeof event.data.message === "string" && event.data.message
          ? event.data.message
          : "拡張機能へ取込完了を通知できませんでした。",
      ));
    };
    function cleanup() {
      window.clearTimeout(timeout);
      window.removeEventListener("message", receiveResult);
    }
    window.addEventListener("message", receiveResult);
    window.postMessage({
      source: TIME_RECORD_ACK_SOURCE,
      type: TIME_RECORD_ACK_TYPE,
      payload,
    }, window.location.origin);
  });
}

export function requestAutomaticTimeRecords(
  timeoutMs = 4_000,
  channel: TimeRecordMessageChannel = window,
): Promise<TimeRecordPayload> {
  const requestId = `time-auto-import-${crypto.randomUUID()}`;
  return new Promise((resolve, reject) => {
    const timeout = channel.setTimeout(() => {
      cleanup();
      reject(new Error("Chrome拡張機能から利用時間を取得できませんでした。"));
    }, timeoutMs);
    const receiveResult = (event: MessageEvent) => {
      if (event.source !== channel || event.origin !== channel.location.origin
        || event.data?.source !== TIME_RECORD_WINDOW_SOURCE
        || event.data?.type !== TIME_RECORD_AUTO_RESULT_TYPE
        || event.data?.requestId !== requestId) return;
      cleanup();
      if (event.data.ok !== true) {
        reject(new Error(
          typeof event.data.message === "string" && event.data.message
            ? event.data.message
            : "Chrome拡張機能から利用時間を取得できませんでした。",
        ));
        return;
      }
      const payload = parseTimeRecordPayload(event.data.payload);
      if (payload) resolve(payload);
      else reject(new Error("Chrome拡張機能から不正な利用時間データを受信しました。"));
    };
    function cleanup() {
      channel.clearTimeout(timeout);
      channel.removeEventListener("message", receiveResult);
    }
    channel.addEventListener("message", receiveResult);
    channel.postMessage({
      source: TIME_RECORD_READY_SOURCE,
      type: TIME_RECORD_AUTO_REQUEST_TYPE,
      requestId,
    }, channel.location.origin);
  });
}

export function parseTimeRecordPreview(value: unknown): TimeRecordPreview | null {
  if (!isObject(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== recordKeys.length || keys.some((key) => !recordKeys.includes(key as typeof recordKeys[number]))) {
    return null;
  }
  if (!isSafeText(value.recordId, 160) || !isSafeText(value.sessionId, 160)
    || value.provider !== "ChatGPT" || !isCalendarDate(value.localDate)
    || !isSafeText(value.timeZone, 80)
    || !isValidTimeZone(value.timeZone)
    || typeof value.startedAt !== "number" || !Number.isFinite(value.startedAt) || value.startedAt < 0
    || typeof value.endedAt !== "number" || !Number.isFinite(value.endedAt) || value.endedAt < value.startedAt
    || typeof value.durationSeconds !== "number" || !Number.isInteger(value.durationSeconds)
    || value.durationSeconds <= 0) return null;
  return {
    recordId: value.recordId,
    sessionId: value.sessionId,
    provider: value.provider,
    localDate: value.localDate,
    timeZone: value.timeZone,
    startedAt: value.startedAt,
    endedAt: value.endedAt,
    durationSeconds: value.durationSeconds,
  };
}

function isSafeText(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
