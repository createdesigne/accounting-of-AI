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
import {
  loadWeeklyAnalysisReviewStore,
  saveWeeklyAnalysisReview,
  WEEKLY_ANALYSIS_REVIEWS_STORAGE_KEY,
  WeeklyAnalysisReviewStoreError,
} from "../src/weeklyAnalysisReviewStore.ts";

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

test("a partial analysis survives reload, permits human review, and leaves accounting unchanged", async () => {
  const context = await setupFullRecord();
  const complete = fixtureResponse(context.request);
  assert.ok(complete.analysis);
  const partial = parseWeeklyAnalysisResponseV1({
    ...complete,
    analysisStatus: "partial",
    analysis: { ...complete.analysis, accountCandidate: null },
    unresolvedFields: [{ field: "analysis.accountCandidate", reason: "missing-evidence" }],
  });
  const settlementBefore = buildWeeklySettlement(loadWeeklyRecordStore(context.storage).records, new Date("2026-11-10T03:00:00.000Z"));
  await queueWeeklyAnalysisRequest(context.request, context);
  await acceptWeeklyAnalysisResponse(partial, context);
  const reloaded = loadWeeklyAnalysisStore(context.storage);
  assert.equal(resolveWeeklyAnalysisState(context.record, reloaded, context.conversation).analysisStatus, "partial");
  assert.equal(reloaded.entries[0].response?.analysis?.accountCandidate, null);
  assert.deepEqual(reloaded.entries[0].response?.unresolvedFields, [{ field: "analysis.accountCandidate", reason: "missing-evidence" }]);
  await saveWeeklyAnalysisReview({
    schemaVersion: 1,
    analysisId: partial.analysisId,
    recordId: context.record.id,
    thoughtReceiptId: context.record.links.thoughtReceiptId,
    reviewedAt: "2026-11-10T03:00:00.000Z",
    fields: {
      activityCategory: "壁打ち", accountCandidate: "思考探究費", accountingDispositionCandidate: "expense",
      aiRole: null, collaborationSummary: null, initiative: 75, reasoning: 75,
      criticalJudgment: 50, thinkingChange: null, discovery: null,
      reviewerNote: "勘定科目は本人が会話と活動内容を確認して分類",
    },
  }, context);
  assert.equal(loadWeeklyAnalysisReviewStore(context.storage).reviews[0].fields.accountCandidate, "思考探究費");
  assert.deepEqual(buildWeeklySettlement(loadWeeklyRecordStore(context.storage).records, new Date("2026-11-10T03:00:00.000Z")), settlementBefore);
});

test("a person's corrections are saved separately without overwriting AI output, notes, or accounting", async () => {
  const context = await setupFullRecord();
  const response = fixtureResponse(context.request);
  await queueWeeklyAnalysisRequest(context.request, context);
  await acceptWeeklyAnalysisResponse(response, context);
  const weeklyBefore = JSON.stringify(loadWeeklyRecordStore(context.storage));
  const analysisBefore = JSON.stringify(loadWeeklyAnalysisStore(context.storage));
  const settlementBefore = buildWeeklySettlement(loadWeeklyRecordStore(context.storage).records, new Date("2026-11-10T03:00:00.000Z"));
  const saved = await saveWeeklyAnalysisReview({
    schemaVersion: 1,
    analysisId: response.analysisId,
    recordId: context.record.id,
    thoughtReceiptId: context.record.links.thoughtReceiptId,
    reviewedAt: "2026-11-10T03:00:00.000Z",
    fields: {
      activityCategory: "相談",
      accountCandidate: "相談活動費",
      accountingDispositionCandidate: "expense",
      aiRole: "本人が確認した整理役",
      collaborationSummary: "AIが比較軸を提示し、本人が採否を決めた",
      initiative: 50,
      reasoning: 75,
      criticalJudgment: 75,
      thinkingChange: "本人が確認した変化",
      discovery: "本人が確認した学び",
      reviewerNote: "会話を再確認して批判的判断を修正",
    },
  }, context);
  assert.equal(saved.reviews.length, 1);
  assert.equal(loadWeeklyAnalysisReviewStore(context.storage).reviews[0].fields.criticalJudgment, 75);
  assert.equal(JSON.stringify(loadWeeklyAnalysisStore(context.storage)), analysisBefore);
  assert.equal(JSON.stringify(loadWeeklyRecordStore(context.storage)), weeklyBefore);
  assert.deepEqual(buildWeeklySettlement(loadWeeklyRecordStore(context.storage).records, new Date("2026-11-10T03:00:00.000Z")), settlementBefore);
  assert.notEqual(context.storage.getItem(WEEKLY_ANALYSIS_REVIEWS_STORAGE_KEY), null);
});

test("a review cannot be attached to another activity or an unknown analysis", async () => {
  const context = await setupFullRecord();
  const response = fixtureResponse(context.request);
  await queueWeeklyAnalysisRequest(context.request, context);
  await acceptWeeklyAnalysisResponse(response, context);
  await assert.rejects(() => saveWeeklyAnalysisReview({
    schemaVersion: 1,
    analysisId: "unknown-analysis",
    recordId: "another-record",
    thoughtReceiptId: context.record.links.thoughtReceiptId,
    reviewedAt: "2026-11-10T03:00:00.000Z",
    fields: {
      activityCategory: null, accountCandidate: null, accountingDispositionCandidate: null,
      aiRole: null, collaborationSummary: null, initiative: null, reasoning: null,
      criticalJudgment: null, thinkingChange: null, discovery: null, reviewerNote: null,
    },
  }, context), (error: unknown) => error instanceof WeeklyAnalysisReviewStoreError && error.code === "LINK_MISMATCH");
});
