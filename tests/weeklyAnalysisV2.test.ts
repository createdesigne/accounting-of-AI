import assert from "node:assert/strict";
import test from "node:test";
import { createWeeklySuccessResponse, linkGeminiAnalysisCandidateWithPartial, WEEKLY_ANALYSIS_RUBRIC_VERSION } from "../server/weekly-analysis-contract.mjs";
import { buildWeeklyAnalysisRequest } from "../src/integrations/weeklyAnalysisAdapter.ts";
import { buildWeeklySettlement } from "../src/weeklyAccounting.ts";
import { acceptWeeklyAnalysisResponse, queueWeeklyAnalysisRequest } from "../src/weeklyAnalysisStore.ts";
import {
  appendWeeklyAnalysisReviewRevisionV2,
  loadWeeklyAnalysisReviewHistoryV2,
  WEEKLY_ANALYSIS_REVIEW_V2_STORAGE_KEY,
  WeeklyAnalysisReviewV2Error,
} from "../src/weeklyAnalysisReviewV2Store.ts";
import { loadWeeklyConversationStore, loadWeeklyRecordStore, saveManualWeeklyRecord, saveWeeklyTask } from "../src/weeklyStore.ts";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
class SerialLocks {
  private tail = Promise.resolve();
  request<T>(_name: string, _options: { mode: "exclusive" }, callback: () => Promise<T> | T): Promise<T> {
    const next = this.tail.then(callback, callback); this.tail = next.then(() => undefined, () => undefined); return next;
  }
}

const quote = "根拠を確認して案Bを選びます。";
const metricEvidence = [{ messageIndex: 0, quote, observedFeature: "本人が根拠確認と選択を明示した", source: "observed_behavior" }];
const metric = (score: 0 | 25 | 50 | 75 | 100 | null, status = score === null ? "hold" : "confirmed") => ({
  score, status, reason: score === null ? "文脈不足で評価保留" : "本人発言から観察した",
  rubricLevel: score, evidence: score === null ? [] : metricEvidence, unconfirmed: score === null ? ["前後文脈"] : [], evidenceSufficiency: score === null ? "low" : "high",
});
const candidate = {
  activityCategory: "壁打ち", accountCandidate: "思考探究費", accountingDispositionCandidate: "expense",
  aiRole: "比較役", collaborationBehaviors: [{ kind: "comparison", description: "案を比較" }],
  initiative: 75, reasoning: 50, independence: 75,
  metricAssessments: { initiative: metric(75), reasoning: metric(50), independence: { ...metric(75), deliberation: metric(75), finalDecision: metric(75) } },
  taskComplexity: { level: "medium", reason: "比較が必要", considerationFactors: "二案", uncertainty: "一部あり", reasoningProcess: "比較判断" },
  thinkingChange: null, discovery: null,
  evidence: ["activity-category", "account-candidate", "accounting-disposition", "ai-role", "collaboration-behavior"].map(target => ({ target, messageIndex: 0, quote })),
};

async function setup() {
  const storage = new MemoryStorage(); const locks = new SerialLocks();
  await saveWeeklyTask({ id: "task-v2", title: "v2", goal: null, plannedAiasLevel: 3, activityCategory: "壁打ち", delegatedToAi: null, humanDecision: null, createdAt: "2026-11-17T00:00:00Z" }, { storage, locks });
  await saveManualWeeklyRecord({ id: "record-v2", recordedAt: "2026-11-17T01:00:00Z", activeSeconds: 28, aiService: "gemini", privacy: "full", taskId: "task-v2", activityCategory: "壁打ち", accountingDisposition: "expense", selfReflection: null, manualNotes: null,
    conversation: { id: "conversation-v2", title: "v2", captureScope: "full", messages: [{ role: "user", text: quote }] } }, { storage, locks });
  const records = loadWeeklyRecordStore(storage); const conversations = loadWeeklyConversationStore(storage);
  const record = records.records[0]; const conversation = conversations.conversations[0]; const task = records.tasks[0];
  const request = buildWeeklyAnalysisRequest({ requestId: "request-v2", requestedAt: "2026-11-17T02:00:00Z", consentedAt: "2026-11-17T01:59:00Z", externalAnalysisConsent: true, record, conversation, task });
  const linked = linkGeminiAnalysisCandidateWithPartial(request, candidate);
  assert.equal(linked.unresolvedFields.length, 0);
  const response = createWeeklySuccessResponse(request, linked.analysis, { model: "gemini-test-v2", analysisId: "analysis-v2", now: new Date("2026-11-17T02:00:01Z") });
  await queueWeeklyAnalysisRequest(request, { storage, locks }); await acceptWeeklyAnalysisResponse(response, { storage, locks });
  return { storage, locks, record, response };
}

function revision(context: Awaited<ReturnType<typeof setup>>, overrides: Record<string, unknown> = {}) {
  return { schemaVersion: 2, revisionId: `revision-${context.storage.values.size}-${Date.now()}`, analysisId: context.response.analysisId,
    recordId: context.record.id, thoughtReceiptId: context.record.links.thoughtReceiptId, rubricVersion: WEEKLY_ANALYSIS_RUBRIC_VERSION,
    reviewedAt: "2026-11-17T03:00:00Z", action: "supplement", supplement: "本人による追加説明", objection: null,
    excluded: false, exclusionReason: null, subjectiveDifficulty: "high",
    metrics: { initiative: { score: 75, status: "confirmed", reason: "確認" }, reasoning: { score: 50, status: "provisional", reason: "暫定" }, independence: { score: 75, status: "confirmed", reason: "確認" } }, ...overrides };
}

test("v2 review appends supplement, objection, exclusion, and reassessment without changing 28 seconds or accounting", async () => {
  const context = await setup();
  const recordsBefore = JSON.stringify(loadWeeklyRecordStore(context.storage));
  const settlementBefore = buildWeeklySettlement(loadWeeklyRecordStore(context.storage).records, new Date("2026-11-17T03:00:00Z"));
  const actions = ["supplement", "objection", "exclusion", "reassessment"] as const;
  for (const [index, action] of actions.entries()) await appendWeeklyAnalysisReviewRevisionV2(revision(context, {
    revisionId: `revision-${index}`, reviewedAt: `2026-11-17T03:0${index}:00Z`, action,
    excluded: action === "exclusion", exclusionReason: action === "exclusion" ? "研究比較から除外" : null,
  }), { storage: context.storage, locks: context.locks });
  const loaded = loadWeeklyAnalysisReviewHistoryV2(context.storage);
  assert.deepEqual(loaded.revisions.map(row => row.action), actions);
  assert.equal(loadWeeklyRecordStore(context.storage).records[0].activeSeconds, 28);
  assert.equal(JSON.stringify(loadWeeklyRecordStore(context.storage)), recordsBefore);
  assert.deepEqual(buildWeeklySettlement(loadWeeklyRecordStore(context.storage).records, new Date("2026-11-17T03:00:00Z")), settlementBefore);
  assert.notEqual(context.storage.getItem(WEEKLY_ANALYSIS_REVIEW_V2_STORAGE_KEY), null);
});

test("v2 review rejects score/status mismatch and another activity link", async () => {
  const context = await setup();
  await assert.rejects(() => appendWeeklyAnalysisReviewRevisionV2(revision(context, { metrics: { initiative: { score: 0, status: "hold", reason: "invalid" }, reasoning: { score: 50, status: "confirmed", reason: "ok" }, independence: { score: 75, status: "confirmed", reason: "ok" } } }), { storage: context.storage, locks: context.locks }), (error: unknown) => error instanceof WeeklyAnalysisReviewV2Error && error.code === "INVALID");
  await assert.rejects(() => appendWeeklyAnalysisReviewRevisionV2(revision(context, { revisionId: "wrong-link", recordId: "other" }), { storage: context.storage, locks: context.locks }), (error: unknown) => error instanceof WeeklyAnalysisReviewV2Error && error.code === "LINK_MISMATCH");
});
