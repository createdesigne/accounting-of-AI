import assert from "node:assert/strict";
import test from "node:test";
import { buildWeeklyAnalysisRequest } from "../src/integrations/weeklyAnalysisAdapter.ts";
import { buildWeeklySettlement } from "../src/weeklyAccounting.ts";
import {
  buildConfirmedExtensionRecord,
  buildMeasuredTimeCandidates,
  extensionConversationFingerprint,
  selectUnlinkedMeasuredTimeCandidates,
} from "../src/weeklyExtensionImport.ts";
import {
  importTimeRecords,
  loadTimeAccountingStore,
} from "../src/timeAccountingStore.ts";
import {
  loadWeeklyConversationStore,
  loadWeeklyRecordStore,
  saveExtensionWeeklyRecord,
  WeeklyStoreError,
} from "../src/weeklyStore.ts";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

class SerialLocks {
  private tail = Promise.resolve();
  request<T>(_name: string, _options: { mode: "exclusive" }, callback: () => Promise<T> | T): Promise<T> {
    const next = this.tail.then(callback, callback);
    this.tail = next.then(() => undefined, () => undefined);
    return next;
  }
}

const conversation = {
  aiService: "ChatGPT",
  url: "https://chatgpt.com/c/research-flow",
  capturedAt: "2026/11/16 10:15",
  conversationTitle: "研究設計の壁打ち",
  messages: [
    { role: "user", text: "二つの研究案を比較してください。" },
    { role: "assistant", text: "案Aは速度、案Bは検証可能性を重視します。" },
    { role: "user", text: "根拠を確認して案Bを選びます。" },
  ],
};

async function setup() {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  await importTimeRecords([{
    recordId: "research-session:day:2026-11-16",
    sessionId: "research-session",
    provider: "ChatGPT",
    localDate: "2026-11-16",
    timeZone: "Asia/Tokyo",
    startedAt: Date.parse("2026-11-16T10:00:00+09:00"),
    endedAt: Date.parse("2026-11-16T10:12:00+09:00"),
    durationSeconds: 720,
  }], { storage, locks, now: () => Date.parse("2026-11-16T02:00:00Z") });
  const measurement = buildMeasuredTimeCandidates(loadTimeAccountingStore(storage))[0];
  assert.ok(measurement);
  return { storage, locks, measurement };
}

function confirmed(measurement: Awaited<ReturnType<typeof setup>>["measurement"], overrides: Record<string, unknown> = {}) {
  return buildConfirmedExtensionRecord({
    rawConversation: conversation,
    measurement,
    privacy: "full",
    activityCategory: "壁打ち",
    accountingDisposition: "expense",
    ownThoughts: "比較軸を確認して自分で案Bを選んだ",
    discovery: "比較軸を先に定義すると判断しやすい",
    ...overrides,
  });
}

test("a person-confirmed extension import links conversation, measured time, receipt and weekly accounting", async () => {
  const context = await setup();
  const result = await saveExtensionWeeklyRecord(confirmed(context.measurement), context);
  assert.equal(result.inserted, true);
  const record = loadWeeklyRecordStore(context.storage).records[0];
  const savedConversation = loadWeeklyConversationStore(context.storage).conversations[0];
  assert.equal(record.origin, "extension-import");
  assert.equal(record.timeSource, "measured");
  assert.equal(record.activeSeconds, 720);
  assert.equal(record.sessionId, context.measurement.measurementRecordId);
  assert.equal(record.links.usageId, context.measurement.usageId);
  assert.equal(record.links.conversationId, savedConversation.id);
  assert.match(record.links.thoughtReceiptId, /^weekly-extension:.*:receipt$/);
  assert.equal(savedConversation.source, "extension-import");
  assert.equal(savedConversation.captureScope, "partial");
  const settlement = buildWeeklySettlement([record], new Date(record.startedAt!));
  assert.equal(settlement.totals.recordSeconds, 720);
  assert.equal(settlement.totals.expenseSeconds, 720);
  assert.equal(settlement.trialBalance.isBalanced, true);
});

test("re-sending the same conversation is idempotent and conflicting reuse is rejected", async () => {
  const context = await setup();
  const first = confirmed(context.measurement);
  await saveExtensionWeeklyRecord(first, context);
  const sameWithLaterCapture = confirmed(context.measurement, {
    rawConversation: { ...conversation, capturedAt: "2026/11/16 11:00" },
  });
  const laterDuplicate = await saveExtensionWeeklyRecord(sameWithLaterCapture, context);
  assert.equal(laterDuplicate.deduplicated, true);
  const duplicate = await saveExtensionWeeklyRecord(first, context);
  assert.equal(duplicate.deduplicated, true);
  assert.equal(loadWeeklyRecordStore(context.storage).records.length, 1);

  const anotherConversation = { ...conversation, url: "https://chatgpt.com/c/another" };
  await assert.rejects(
    () => saveExtensionWeeklyRecord(confirmed(context.measurement, { rawConversation: anotherConversation }), context),
    (error: unknown) => error instanceof WeeklyStoreError && error.code === "USAGE_ALREADY_LINKED",
  );
  assert.equal(loadWeeklyRecordStore(context.storage).records.length, 1);
});

test("linked 109 seconds are excluded while an unlinked 19-second measurement remains selectable", async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const context = { storage, locks };
  await importTimeRecords([{
    recordId: "research-session-109:day:2026-11-17",
    sessionId: "research-session-109",
    provider: "ChatGPT",
    localDate: "2026-11-17",
    timeZone: "Asia/Tokyo",
    startedAt: Date.parse("2026-11-17T10:00:00+09:00"),
    endedAt: Date.parse("2026-11-17T10:01:49+09:00"),
    durationSeconds: 109,
  }], context);
  const linked109 = buildMeasuredTimeCandidates(loadTimeAccountingStore(storage))[0];
  await saveExtensionWeeklyRecord(confirmed(linked109), context);
  await importTimeRecords([{
    recordId: "research-session-19:day:2026-11-18",
    sessionId: "research-session-19",
    provider: "ChatGPT",
    localDate: "2026-11-18",
    timeZone: "Asia/Tokyo",
    startedAt: Date.parse("2026-11-18T10:00:00+09:00"),
    endedAt: Date.parse("2026-11-18T10:00:19+09:00"),
    durationSeconds: 19,
  }], context);
  const allMeasurements = buildMeasuredTimeCandidates(loadTimeAccountingStore(storage));
  const available = selectUnlinkedMeasuredTimeCandidates(
    allMeasurements,
    loadWeeklyRecordStore(storage).records,
  );
  assert.equal(allMeasurements.length, 2);
  assert.equal(available.length, 1);
  assert.equal(available[0].measurementRecordId, "research-session-19:day:2026-11-18");
  assert.equal(available[0].activeSeconds, 19);
  assert.equal(available.some((item) => item.measurementRecordId === linked109.measurementRecordId), false);
});

test("time-only never stores conversation text and cannot create an analysis request", async () => {
  const context = await setup();
  await saveExtensionWeeklyRecord(confirmed(context.measurement, { privacy: "time-only" }), context);
  const record = loadWeeklyRecordStore(context.storage).records[0];
  assert.equal(record.privacy, "time-only");
  assert.equal(record.links.conversationId, null);
  assert.equal(loadWeeklyConversationStore(context.storage).conversations.length, 0);
  assert.throws(() => buildWeeklyAnalysisRequest({
    requestId: "blocked",
    requestedAt: "2026-11-16T03:00:00Z",
    consentedAt: "2026-11-16T02:59:00Z",
    externalAnalysisConsent: true,
    record,
    conversation: null,
    task: null,
  }), /full以外/);
});

test("a full imported conversation becomes analyzable only through the existing explicit-consent adapter", async () => {
  const context = await setup();
  await saveExtensionWeeklyRecord(confirmed(context.measurement), context);
  const record = loadWeeklyRecordStore(context.storage).records[0];
  const savedConversation = loadWeeklyConversationStore(context.storage).conversations[0];
  assert.throws(() => buildWeeklyAnalysisRequest({
    requestId: "no-consent",
    requestedAt: "2026-11-16T03:00:00Z",
    consentedAt: "2026-11-16T02:59:00Z",
    externalAnalysisConsent: false,
    record,
    conversation: savedConversation,
    task: null,
  }), /明示的な同意/);
  const request = buildWeeklyAnalysisRequest({
    requestId: "consented",
    requestedAt: "2026-11-16T03:00:00Z",
    consentedAt: "2026-11-16T02:59:00Z",
    externalAnalysisConsent: true,
    record,
    conversation: savedConversation,
    task: null,
  });
  assert.equal(request.recordId, record.id);
  assert.equal(request.conversationId, savedConversation.id);
  assert.equal(request.thoughtReceiptId, record.links.thoughtReceiptId);
  assert.equal(request.messages.length, conversation.messages.length);
});

test("conversation identity ignores transfer time but includes URL and message content", () => {
  assert.equal(
    extensionConversationFingerprint(conversation),
    extensionConversationFingerprint({ ...conversation, capturedAt: "2026/11/17 09:00" }),
  );
  assert.equal(
    extensionConversationFingerprint(conversation),
    extensionConversationFingerprint({ ...conversation, measurementSessionId: "research-session" }),
  );
  assert.notEqual(
    extensionConversationFingerprint(conversation),
    extensionConversationFingerprint({ ...conversation, messages: [...conversation.messages, { role: "user", text: "追記" }] }),
  );
});
