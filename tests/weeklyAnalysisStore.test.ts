import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildWeeklySettlement } from "../src/weeklyAccounting.ts";
import {
  buildWeeklyAnalysisRequest,
  WeeklyAnalysisAdapterError,
} from "../src/integrations/weeklyAnalysisAdapter.ts";
import { parseWeeklyAnalysisResponseV1 } from "../src/integrations/weeklyAnalysisContract.ts";
import {
  acceptWeeklyAnalysisResponse,
  loadWeeklyAnalysisStore,
  queueWeeklyAnalysisRequest,
  resolveWeeklyAnalysisState,
  WeeklyAnalysisStoreError,
} from "../src/weeklyAnalysisStore.ts";
import {
  loadWeeklyConversationStore,
  loadWeeklyRecordStore,
  saveManualWeeklyRecord,
  saveWeeklyTask,
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

async function setupFullRecord() {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  await saveWeeklyTask({
    id: "task-1",
    title: "固定テスト課題",
    goal: "安全な接続契約を確認する",
    plannedAiasLevel: 3,
    activityCategory: "壁打ち",
    delegatedToAi: "論点を整理する",
    humanDecision: null,
    createdAt: "2026-11-10T00:00:00.000Z",
  }, { storage, locks });
  await saveManualWeeklyRecord({
    id: "record-1",
    recordedAt: "2026-11-10T01:00:00.000Z",
    activeSeconds: 720,
    aiService: "gemini",
    privacy: "full",
    taskId: "task-1",
    activityCategory: "壁打ち",
    accountingDisposition: "expense",
    selfReflection: "最後は自分で対象範囲を決めた",
    manualNotes: {
      interactionSummary: "二つの案を比較した",
      ownThoughts: "根拠を確認して案Bを選んだ",
      discovery: "比較軸を先に決めると整理しやすい",
    },
    conversation: {
      id: "conversation-1",
      title: "固定テスト会話",
      captureScope: "full",
      messages: [
        { role: "user", text: "案Aと案Bを比較して、違いを整理してください。" },
        { role: "assistant", text: "案Aは速さ、案Bは検証可能性を重視します。" },
        { role: "user", text: "根拠を確認したうえで、今回は案Bを選びます。" },
      ],
    },
  }, { storage, locks });
  const recordStore = loadWeeklyRecordStore(storage);
  const conversationStore = loadWeeklyConversationStore(storage);
  const record = recordStore.records[0];
  const task = recordStore.tasks[0];
  const conversation = conversationStore.conversations[0];
  const request = buildWeeklyAnalysisRequest({
    requestId: "request-1",
    requestedAt: "2026-11-10T02:00:00.000Z",
    consentedAt: "2026-11-10T01:59:00.000Z",
    externalAnalysisConsent: true,
    record,
    conversation,
    task,
  });
  return { storage, locks, record, task, conversation, request };
}

function fixtureResponse(request: Awaited<ReturnType<typeof setupFullRecord>>["request"]) {
  const parsed = parseWeeklyAnalysisResponseV1(JSON.parse(readFileSync(
    new URL("./fixtures/weekly-analysis-response.fixture.json", import.meta.url),
    "utf8",
  )));
  assert.ok(parsed.analysis);
  assert.equal(parsed.requestId, request.requestId);
  assert.equal(parsed.recordId, request.recordId);
  assert.equal(parsed.conversationId, request.conversationId);
  assert.equal(parsed.thoughtReceiptId, request.thoughtReceiptId);
  assert.equal(parsed.conversationFingerprint, request.conversationFingerprint);
  return { ...parsed, analysis: parsed.analysis };
}

test("a fixed test response is linked, saved separately, and survives reload", async () => {
  const context = await setupFullRecord();
  const weeklyBefore = JSON.stringify(loadWeeklyRecordStore(context.storage));
  const manualBefore = loadWeeklyRecordStore(context.storage).records[0].manualNotes;
  assert.equal(resolveWeeklyAnalysisState(context.record, loadWeeklyAnalysisStore(context.storage), context.conversation).analysisStatus, "not-connected");
  await queueWeeklyAnalysisRequest(context.request, context);
  assert.equal(resolveWeeklyAnalysisState(context.record, loadWeeklyAnalysisStore(context.storage), context.conversation).analysisStatus, "pending");
  const saved = await acceptWeeklyAnalysisResponse(fixtureResponse(context.request), context);

  assert.equal(saved.inserted, true);
  assert.equal(saved.entry.recordId, context.record.id);
  assert.equal(saved.entry.conversationId, context.conversation.id);
  assert.equal(saved.entry.thoughtReceiptId, context.record.links.thoughtReceiptId);
  assert.equal(saved.entry.response?.origin, "test-fixture");
  assert.equal(loadWeeklyAnalysisStore(context.storage).entries.length, 1);
  assert.equal(resolveWeeklyAnalysisState(context.record, loadWeeklyAnalysisStore(context.storage), context.conversation).analysisStatus, "complete");
  assert.deepEqual(loadWeeklyRecordStore(context.storage).records[0].manualNotes, manualBefore);
  assert.equal(JSON.stringify(loadWeeklyRecordStore(context.storage)), weeklyBefore);
  const editedConversation = {
    ...context.conversation,
    messages: [...context.conversation.messages, { role: "user" as const, text: "編集後の追記" }],
  };
  assert.equal(resolveWeeklyAnalysisState(context.record, loadWeeklyAnalysisStore(context.storage), editedConversation).analysisStatus, "not-connected");
  assert.equal(resolveWeeklyAnalysisState(
    { ...context.record, analysisStatus: "not-applicable" },
    loadWeeklyAnalysisStore(context.storage),
    context.conversation,
  ).analysisStatus, "not-applicable");
});

test("the same response is idempotent and conflicting duplicates are rejected", async () => {
  const context = await setupFullRecord();
  const response = fixtureResponse(context.request);
  await queueWeeklyAnalysisRequest(context.request, context);
  await acceptWeeklyAnalysisResponse(response, context);
  const duplicate = await acceptWeeklyAnalysisResponse(response, context);
  assert.equal(duplicate.deduplicated, true);
  assert.equal(loadWeeklyAnalysisStore(context.storage).entries.length, 1);

  await assert.rejects(
    () => acceptWeeklyAnalysisResponse({ ...response, receivedAt: "2026-11-10T02:00:06.000Z" }, context),
    (error: unknown) => error instanceof WeeklyAnalysisStoreError && error.code === "DUPLICATE_CONFLICT",
  );
});

test("invalid, incomplete, mismatched, and unsupported evidence responses are rejected", async () => {
  const context = await setupFullRecord();
  const response = fixtureResponse(context.request);
  await queueWeeklyAnalysisRequest(context.request, context);
  assert.throws(() => parseWeeklyAnalysisResponseV1({}), /Unexpected|schema|object/i);
  assert.throws(
    () => parseWeeklyAnalysisResponseV1({ ...response, analysis: null }),
    /requires analysis/i,
  );
  await assert.rejects(
    () => acceptWeeklyAnalysisResponse({ ...response, recordId: "another-record" }, context),
    (error: unknown) => error instanceof WeeklyAnalysisStoreError && error.code === "LINK_MISMATCH",
  );
  await assert.rejects(
    () => acceptWeeklyAnalysisResponse({
      ...response,
      analysis: {
        ...response.analysis,
        evidence: [{ ...response.analysis.evidence[0], quote: "会話に存在しない引用" }],
      },
    }, context),
    (error: unknown) => error instanceof WeeklyAnalysisAdapterError && error.code === "EVIDENCE_MISMATCH",
  );
  assert.equal(loadWeeklyAnalysisStore(context.storage).entries[0].analysisStatus, "pending");
});

test("explicit consent and full content are mandatory, and Level 1 is excluded", async () => {
  const context = await setupFullRecord();
  assert.throws(
    () => buildWeeklyAnalysisRequest({
      ...context,
      requestId: "no-consent",
      requestedAt: "2026-11-10T02:00:00.000Z",
      consentedAt: "2026-11-10T01:59:00.000Z",
      externalAnalysisConsent: false,
    }),
    (error: unknown) => error instanceof WeeklyAnalysisAdapterError && error.code === "CONSENT_REQUIRED",
  );

  const timeOnly = {
    ...context.record,
    privacy: "time-only" as const,
    links: { ...context.record.links, conversationId: null },
  };
  assert.throws(
    () => buildWeeklyAnalysisRequest({
      requestId: "time-only",
      requestedAt: "2026-11-10T02:00:00.000Z",
      consentedAt: "2026-11-10T01:59:00.000Z",
      externalAnalysisConsent: true,
      record: timeOnly,
      conversation: null,
      task: context.task,
    }),
    (error: unknown) => error instanceof WeeklyAnalysisAdapterError && error.code === "CONTENT_NOT_AVAILABLE",
  );

  const levelOne = { ...context.task, plannedAiasLevel: 1 as const };
  assert.throws(
    () => buildWeeklyAnalysisRequest({
      requestId: "level-one",
      requestedAt: "2026-11-10T02:00:00.000Z",
      consentedAt: "2026-11-10T01:59:00.000Z",
      externalAnalysisConsent: true,
      record: context.record,
      conversation: context.conversation,
      task: levelOne,
    }),
    (error: unknown) => error instanceof WeeklyAnalysisAdapterError && error.code === "NOT_APPLICABLE",
  );
});

test("a failed analysis is retained without changing accounting", async () => {
  const context = await setupFullRecord();
  const settlementBefore = buildWeeklySettlement(loadWeeklyRecordStore(context.storage).records, new Date("2026-11-10T03:00:00.000Z"));
  await queueWeeklyAnalysisRequest(context.request, context);
  await acceptWeeklyAnalysisResponse({
    schemaVersion: 1,
    analysisId: "fixture-failure-1",
    requestId: context.request.requestId,
    recordId: context.request.recordId,
    conversationId: context.request.conversationId,
    thoughtReceiptId: context.request.thoughtReceiptId,
    conversationFingerprint: context.request.conversationFingerprint,
    origin: "test-fixture",
    analysisStatus: "failed",
    receivedAt: "2026-11-10T02:00:05.000Z",
    analysis: null,
    error: { code: "TIMEOUT", retryable: true },
  }, context);
  const settlementAfter = buildWeeklySettlement(loadWeeklyRecordStore(context.storage).records, new Date("2026-11-10T03:00:00.000Z"));
  assert.deepEqual(settlementAfter, settlementBefore);
  assert.equal(resolveWeeklyAnalysisState(context.record, loadWeeklyAnalysisStore(context.storage), context.conversation).analysisStatus, "failed");
});
