import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAiServer } from "../server/app.mjs";
import { createGeminiProvider, WEEKLY_ANALYSIS_SYSTEM_INSTRUCTION } from "../server/gemini.mjs";
import {
  parseGeminiAnalysisPayload,
  parseWeeklyAnalysisRequest,
  WEEKLY_ANALYSIS_RUBRIC_VERSION,
} from "../server/weekly-analysis-contract.mjs";
import {
  createClientFailureResponse,
  createWeeklyAnalysisClient,
  WeeklyAnalysisClientError,
} from "../src/weeklyAnalysisClient.ts";
import { parseWeeklyAnalysisResponseV1 } from "../src/integrations/weeklyAnalysisContract.ts";

const testKey = "weekly-test-key-not-real";
const model = "gemini-weekly-test";
const quote = "案Aと案Bを比較し、根拠を確認してから案Bを選びます。";
const request = {
  schemaVersion: 1 as const,
  requestId: "request-weekly-1",
  recordId: "record-weekly-1",
  conversationId: "conversation-weekly-1",
  thoughtReceiptId: "record-weekly-1:receipt",
  conversationFingerprint: "fnv1a32:12345678",
  requestedAt: "2026-11-16T01:00:00.000Z",
  consent: {
    externalAnalysisAllowed: true as const,
    privacy: "full" as const,
    captureScope: "full" as const,
    consentedAt: "2026-11-16T00:59:00.000Z",
  },
  taskContext: {
    taskId: "task-weekly-1",
    plannedAiasLevel: 3 as const,
    activityCategory: "壁打ち" as const,
    expectedAiRole: "比較軸を整理する",
  },
  messages: [
    { role: "user" as const, text: quote },
    { role: "assistant" as const, text: "比較軸を整理します。" },
  ],
};

const evidenceTargets = [
  "activity-category", "account-candidate", "accounting-disposition", "ai-role",
  "collaboration-behavior", "initiative", "reasoning", "critical-judgment",
  "thinking-change", "discovery",
] as const;

const analysis = {
  activityCategory: "壁打ち",
  accountCandidate: "思考探究費",
  accountingDispositionCandidate: "expense",
  aiRole: "比較軸を示す整理役",
  collaborationBehaviors: [{ kind: "comparison", description: "AIが比較軸を提示し、本人が選択した" }],
  initiative: 75,
  reasoning: 75,
  criticalJudgment: 50,
  thinkingChange: "比較後に根拠確認を優先した",
  discovery: "比較軸と根拠確認を分けると判断しやすい",
  evidence: evidenceTargets.map((target) => ({
    target,
    conversationId: request.conversationId,
    messageIndex: 0,
    quote,
  })),
};

function interaction(payload: unknown) {
  return {
    id: "weekly-analysis-test-1",
    status: "completed",
    steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(payload) }] }],
  };
}

async function start(provider: ReturnType<typeof createGeminiProvider>) {
  const server = createAiServer({ provider });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/api/ai`,
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }),
  };
}

test("weekly analysis uses a separate endpoint and returns linked structured data with model metadata", async () => {
  let calls = 0;
  const provider = createGeminiProvider({ apiKey: testKey, model, fetchImpl: async (url, options) => {
    calls += 1;
    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/interactions");
    const headers = new Headers(options?.headers);
    assert.equal(headers.get("x-goog-api-key"), testKey);
    const body = JSON.parse(String(options?.body));
    assert.equal(body.model, model);
    assert.equal(body.store, false);
    assert.equal(body.input, JSON.stringify(request));
    assert.equal(body.generation_config.max_output_tokens, 4096);
    assert.match(body.system_instruction, /AIAS公式評価でも/);
    assert.match(body.system_instruction, new RegExp(WEEKLY_ANALYSIS_RUBRIC_VERSION));
    assert.ok(!String(options?.body).includes(testKey));
    return Response.json(interaction(analysis));
  }});
  const app = await start(provider);
  try {
    const result = await createWeeklyAnalysisClient({ baseUrl: app.baseUrl, apiKey: testKey, model }).analyze(request);
    assert.equal(result.analysisStatus, "complete");
    assert.equal(result.recordId, request.recordId);
    assert.equal(result.conversationId, request.conversationId);
    assert.equal(result.thoughtReceiptId, request.thoughtReceiptId);
    assert.equal(result.model, model);
    assert.equal(result.rubricVersion, WEEKLY_ANALYSIS_RUBRIC_VERSION);
    assert.equal(result.analysis?.accountCandidate, "思考探究費");
    assert.equal(result.analysis?.accountingDispositionCandidate, "expense");
    assert.equal(result.analysis?.initiative, 75);
    assert.equal(calls, 1);
  } finally { await app.close(); }
});

test("consent is mandatory and AIAS Level 1 is never sent for analysis", async () => {
  assert.equal(parseWeeklyAnalysisRequest({ ...request, consent: { ...request.consent, externalAnalysisAllowed: false } }), null);
  assert.equal(parseWeeklyAnalysisRequest({ ...request, taskContext: { ...request.taskContext, plannedAiasLevel: 1 } }), null);
  let calls = 0;
  const app = await start(createGeminiProvider({ apiKey: testKey, model, fetchImpl: async () => { calls += 1; return Response.json(interaction(analysis)); } }));
  try {
    const response = await fetch(`${app.baseUrl}/analyze-weekly`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${testKey}`, "X-Gemini-Model": model },
      body: JSON.stringify({ ...request, consent: { ...request.consent, externalAnalysisAllowed: false } }),
    });
    assert.equal(response.status, 400);
    assert.equal(calls, 0);
  } finally { await app.close(); }
});

test("invalid JSON, unsupported evidence, and missing evidence become safe failed responses", async () => {
  for (const payload of [
    "not-json",
    { ...analysis, evidence: analysis.evidence.map((row) => row.target === "initiative" ? { ...row, quote: "存在しない引用" } : row) },
    { ...analysis, evidence: analysis.evidence.filter((row) => row.target !== "initiative") },
  ]) {
    const content = payload === "not-json"
      ? { id: "bad", status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: payload }] }] }
      : interaction(payload);
    const app = await start(createGeminiProvider({ apiKey: testKey, model, fetchImpl: async () => Response.json(content) }));
    try {
      const result = await createWeeklyAnalysisClient({ baseUrl: app.baseUrl, apiKey: testKey, model }).analyze(request);
      assert.equal(result.analysisStatus, "failed");
      assert.equal(result.error?.code, "INVALID_OUTPUT");
      assert.equal(result.analysis, null);
    } finally { await app.close(); }
  }
});

test("network failure is normalized without inventing scores or changing the request", async () => {
  const before = JSON.stringify(request);
  const client = createWeeklyAnalysisClient({ baseUrl: "/api/ai", apiKey: testKey, model, fetchImpl: async () => { throw new Error("offline"); } });
  let failure: WeeklyAnalysisClientError | null = null;
  try { await client.analyze(request); }
  catch (error) { failure = error as WeeklyAnalysisClientError; }
  assert.ok(failure instanceof WeeklyAnalysisClientError);
  assert.equal(failure.code, "PROVIDER_ERROR");
  const response = createClientFailureResponse(request, failure, model, new Date("2026-11-16T01:01:00.000Z"));
  assert.equal(response.analysisStatus, "failed");
  assert.equal(response.analysis, null);
  assert.equal(response.error?.code, "PROVIDER_ERROR");
  assert.equal(JSON.stringify(request), before);
});

test("rubric rejects unsupported scores and does not convert insufficient evidence to zero", () => {
  assert.throws(() => parseGeminiAnalysisPayload({ ...analysis, initiative: 60 }), /INVALID_OUTPUT/);
  const insufficient = parseGeminiAnalysisPayload({
    activityCategory: null,
    accountCandidate: null,
    accountingDispositionCandidate: null,
    aiRole: null,
    collaborationBehaviors: [],
    initiative: null,
    reasoning: null,
    criticalJudgment: null,
    thinkingChange: null,
    discovery: null,
    evidence: [],
  });
  assert.equal(insufficient.initiative, null);
  assert.equal(insufficient.reasoning, null);
  assert.equal(insufficient.criticalJudgment, null);
  assert.equal(WEEKLY_ANALYSIS_SYSTEM_INSTRUCTION.includes("必ずnull"), true);
});

test("legacy stored Gemini responses remain readable while new metadata stays optional only as a complete set", () => {
  const legacy = parseWeeklyAnalysisResponseV1({
    schemaVersion: 1,
    analysisId: "legacy-analysis",
    requestId: request.requestId,
    recordId: request.recordId,
    conversationId: request.conversationId,
    thoughtReceiptId: request.thoughtReceiptId,
    conversationFingerprint: request.conversationFingerprint,
    origin: "gemini-api",
    analysisStatus: "complete",
    receivedAt: "2026-11-16T01:01:00.000Z",
    analysis: {
      activityCategory: "壁打ち", aiRole: "整理役", initiative: null, reasoning: null,
      criticalJudgment: null, thinkingChange: null, discovery: null, evidence: [],
    },
    error: null,
  });
  assert.equal(legacy.model, undefined);
  assert.throws(() => parseWeeklyAnalysisResponseV1({ ...legacy, model }), /metadata/i);
});
