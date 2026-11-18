import { parseDraftConversation, type RawConversation } from "./conversationDraft.ts";
import { effectiveTimeMeasurementSeconds, isTimeMeasurementActive } from "./timeAccounting.ts";
import type { TimeAccountingStore } from "./timeAccountingStore.ts";
import type {
  AccountingDisposition,
  ExtensionWeeklyRecordInput,
  WeeklyRecordV1,
  WeeklyAiService,
  WeeklyPrivacy,
} from "./weeklyData.ts";
import type { AnalysisActivityCategory } from "./integrations/analysisContract.ts";

export const EXTENSION_CONVERSATION_STORAGE_BASE_KEY = "aiConversationRaw";

export type MeasuredTimeCandidate = Readonly<{
  measurementRecordId: string;
  sessionId: string;
  usageId: string;
  provider: string;
  localDate: string;
  timeZone: string;
  startedAt: string;
  endedAt: string;
  activeSeconds: number;
}>;

export type ConfirmExtensionImportInput = Readonly<{
  rawConversation: RawConversation;
  measurement: MeasuredTimeCandidate;
  privacy: WeeklyPrivacy;
  taskId?: string | null;
  activityCategory: Exclude<AnalysisActivityCategory, null>;
  accountingDisposition: AccountingDisposition;
  interactionSummary?: string | null;
  ownThoughts?: string | null;
  discovery?: string | null;
}>;

export function extensionConversationStorageKey(pathname = globalThis.location?.pathname ?? "") {
  return pathname.startsWith("/accounting-of-AI/preview/")
    ? `preview-month-ledger:${EXTENSION_CONVERSATION_STORAGE_BASE_KEY}`
    : EXTENSION_CONVERSATION_STORAGE_BASE_KEY;
}

export function loadExtensionConversationDraft(
  storage: Pick<Storage, "getItem"> = window.localStorage,
  storageKey = extensionConversationStorageKey(),
) {
  const raw = storage.getItem(storageKey);
  return raw === null ? null : parseDraftConversation(raw);
}

/**
 * Produces active, finalized measurements that may be linked by the person.
 * No date-based or title-based guess is made because the extension currently
 * has no shared conversation/session identifier.
 */
export function buildMeasuredTimeCandidates(store: TimeAccountingStore): readonly MeasuredTimeCandidate[] {
  const measurements = new Map(store.ledger.measurements.map((item) => [item.sourceEventId, item]));
  const candidates = store.importedRecords.flatMap((imported): MeasuredTimeCandidate[] => {
    const metadata = parseTimeFingerprint(imported.fingerprint);
    const measurement = measurements.get(imported.sourceEventId);
    if (!metadata || !measurement || !isTimeMeasurementActive(measurement)) return [];
    const activeSeconds = effectiveTimeMeasurementSeconds(measurement);
    if (activeSeconds <= 0) return [];
    return [Object.freeze({
      measurementRecordId: imported.recordId,
      sessionId: metadata.sessionId,
      usageId: imported.sourceEventId,
      provider: metadata.provider,
      localDate: metadata.localDate,
      timeZone: metadata.timeZone,
      startedAt: new Date(metadata.startedAt).toISOString(),
      endedAt: new Date(metadata.endedAt).toISOString(),
      activeSeconds,
    })];
  });
  candidates.sort((left, right) => right.endedAt.localeCompare(left.endedAt)
    || left.measurementRecordId.localeCompare(right.measurementRecordId));
  return Object.freeze(candidates);
}

export function selectUnlinkedMeasuredTimeCandidates(
  measurements: readonly MeasuredTimeCandidate[],
  records: readonly WeeklyRecordV1[],
) {
  const linkedMeasurementIds = new Set(records
    .filter((record) => record.timeSource === "measured" && record.sessionId)
    .map((record) => record.sessionId as string));
  return Object.freeze(measurements.filter((item) => !linkedMeasurementIds.has(item.measurementRecordId)));
}

export function buildConfirmedExtensionRecord(input: ConfirmExtensionImportInput): ExtensionWeeklyRecordInput {
  const conversation = normalizeConversation(input.rawConversation);
  const fingerprint = extensionConversationFingerprint(input.rawConversation);
  const id = `weekly-extension:${fingerprint}`;
  const conversationId = `extension-conversation:${fingerprint}`;
  const capturedAt = parseCapturedAt(input.rawConversation.capturedAt) ?? input.measurement.endedAt;
  return Object.freeze({
    id,
    sourceEventId: `chrome-conversation:${fingerprint}`,
    measurementRecordId: input.measurement.measurementRecordId,
    usageId: input.measurement.usageId,
    recordedAt: capturedAt,
    startedAt: input.measurement.startedAt,
    endedAt: input.measurement.endedAt,
    activeSeconds: input.measurement.activeSeconds,
    aiService: mapAiService(input.rawConversation.aiService),
    privacy: input.privacy,
    taskId: input.taskId ?? null,
    activityCategory: input.activityCategory,
    accountingDisposition: input.accountingDisposition,
    selfReflection: normalizeText(input.ownThoughts),
    manualNotes: Object.freeze({
      interactionSummary: normalizeText(input.interactionSummary),
      ownThoughts: normalizeText(input.ownThoughts),
      discovery: normalizeText(input.discovery),
    }),
    conversation: input.privacy === "full" ? Object.freeze({
      id: conversationId,
      title: normalizeText(input.rawConversation.conversationTitle),
      // The shipped extractor intentionally limits the payload to the latest 20 messages.
      captureScope: "partial" as const,
      messages: conversation,
    }) : null,
  });
}

/** Stable import identity. capturedAt is excluded so re-sending the same page is idempotent. */
export function extensionConversationFingerprint(raw: RawConversation) {
  const canonical = JSON.stringify({
    aiService: raw.aiService?.trim() ?? "",
    url: raw.url?.trim() ?? "",
    title: raw.conversationTitle?.trim() ?? "",
    messages: normalizeConversation(raw),
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizeConversation(raw: RawConversation) {
  return Object.freeze((raw.messages ?? []).flatMap((message) => {
    const text = message.text?.trim();
    if (!text) return [];
    const role = message.role === "user" || message.role === "assistant" || message.role === "system"
      ? message.role
      : "unknown" as const;
    return [Object.freeze({ role, text })];
  }));
}

function mapAiService(value: string | undefined): WeeklyAiService {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "chatgpt") return "chatgpt";
  if (normalized === "claude") return "claude";
  if (normalized === "gemini") return "gemini";
  return "other";
}

function parseCapturedAt(value: string | undefined) {
  if (!value) return null;
  const match = /^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/.exec(value.trim());
  if (match) {
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseTimeFingerprint(value: string) {
  try {
    const fields: unknown = JSON.parse(value);
    if (!Array.isArray(fields) || fields.length < 8
      || typeof fields[1] !== "string" || typeof fields[2] !== "string"
      || typeof fields[3] !== "string" || typeof fields[4] !== "string"
      || !Number.isFinite(fields[5]) || !Number.isFinite(fields[6])) return null;
    const startedAt = Number(fields[5]);
    const endedAt = Number(fields[6]);
    if (endedAt <= startedAt) return null;
    return {
      sessionId: fields[1],
      provider: fields[2],
      localDate: fields[3],
      timeZone: fields[4],
      startedAt,
      endedAt,
    };
  } catch {
    return null;
  }
}

function normalizeText(value: string | null | undefined) {
  const text = value?.trim();
  return text ? text : null;
}
