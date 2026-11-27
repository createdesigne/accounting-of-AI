import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createAiServer } from "../server/app.mjs";
import {
  createGeminiProvider,
  createWeeklyAnalysisResponseSchema,
  WEEKLY_ANALYSIS_SYSTEM_INSTRUCTION,
} from "../server/gemini.mjs";
import {
  parseGeminiAnalysisPayload,
  parseGeminiAnalysisCandidate,
  linkGeminiAnalysisCandidate,
  linkGeminiAnalysisCandidateWithPartial,
  createWeeklySuccessResponse,
  parseWeeklyAnalysisRequest,
  WEEKLY_ANALYSIS_PROVIDER_API_VERSION,
  WEEKLY_ANALYSIS_PROVIDER_SDK_VERSION,
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
  "collaboration-behavior", "thinking-change", "discovery",
] as const;

const metricEvidenceCandidate = [{ messageIndex: 0, quote, observedFeature: "本人が比較と根拠確認を明示した", source: "observed_behavior" }];
const metricAssessment = (score: 0 | 25 | 50 | 75 | 100 | null, status: "confirmed" | "provisional" | "hold" | "not_applicable" = score === null ? "hold" : "confirmed") => ({
  score, status, reason: score === null ? "文脈が不足しているため評価保留" : "会話内の比較と判断理由を確認した",
  rubricLevel: score, evidence: score === null ? [] : metricEvidenceCandidate, unconfirmed: score === null ? ["前後文脈"] : [], evidenceSufficiency: score === null ? "low" : "high",
});
const candidateAnalysis = {
  activityCategory: "壁打ち",
  accountCandidate: "思考探究費",
  accountingDispositionCandidate: "expense",
  aiRole: "比較軸を示す整理役",
  collaborationBehaviors: [{ kind: "comparison", description: "AIが比較軸を提示し、本人が選択した" }],
  initiative: 75,
  reasoning: 75,
  independence: 50,
  metricAssessments: {
    initiative: metricAssessment(75), reasoning: metricAssessment(75),
    independence: { ...metricAssessment(50), deliberation: metricAssessment(75), finalDecision: metricAssessment(50) },
  },
  taskComplexity: { level: "medium", reason: "比較判断が必要", considerationFactors: "複数案", uncertainty: "一部不明", reasoningProcess: "比較と根拠確認" },
  thinkingChange: "比較後に根拠確認を優先した",
  discovery: "比較軸と根拠確認を分けると判断しやすい",
  evidence: evidenceTargets.map((target) => ({ target, messageIndex: 0, quote })),
};
const linkedMetric = (value: ReturnType<typeof metricAssessment>) => ({ ...value, evidence: value.evidence.map(row => ({ ...row, conversationId: request.conversationId, utteranceId: `${request.conversationId}:message:0`, speaker: "user" })) });
const analysis = {
  ...candidateAnalysis,
  subjectiveDifficulty: { level: "not_provided", source: "self_report", note: null },
  metricAssessments: {
    initiative: linkedMetric(candidateAnalysis.metricAssessments.initiative),
    reasoning: linkedMetric(candidateAnalysis.metricAssessments.reasoning),
    independence: { ...linkedMetric(candidateAnalysis.metricAssessments.independence), deliberation: linkedMetric(candidateAnalysis.metricAssessments.independence.deliberation), finalDecision: linkedMetric(candidateAnalysis.metricAssessments.independence.finalDecision) },
  },
  evidence: candidateAnalysis.evidence.map(row => ({ ...row, conversationId: request.conversationId })),
};

test("reported Gemini SDK version matches the installed server dependency", () => {
  const serverPackage = JSON.parse(readFileSync(new URL("../server/package.json", import.meta.url), "utf8"));
  assert.equal(WEEKLY_ANALYSIS_PROVIDER_SDK_VERSION, `@google/genai@${serverPackage.dependencies["@google/genai"]}`);
});

function interaction(payload: unknown) {
  return {
    id: "weekly-analysis-test-1",
    status: "completed",
    steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(payload) }] }],
  };
}

function generateContent(payload: unknown) {
  return {
    responseId: "weekly-generate-content-test-1",
    candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: JSON.stringify(payload) }] } }],
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
    assert.equal(body.generation_config.max_output_tokens, 8192);
    assert.equal(body.response_format.type, "text");
    assert.equal(body.response_format.mime_type, "application/json");
    assert.equal(body.response_format.schema.additionalProperties, false);
    assert.deepEqual(body.response_format.schema.required, [
      "activityCategory", "accountCandidate", "accountingDispositionCandidate", "aiRole",
      "collaborationBehaviors", "initiative", "reasoning", "independence", "metricAssessments",
      "taskComplexity", "thinkingChange", "discovery", "evidence",
    ]);
    assert.deepEqual(body.response_format.schema.properties.initiative, {
      type: ["integer", "null"], enum: [0, 25, 50, 75, 100, null],
    });
    assert.equal(body.response_format.schema.properties.evidence.maxItems, undefined);
    assert.equal(body.response_format.schema.properties.evidence.items.properties.conversationId, undefined);
    assert.deepEqual(body.response_format.schema.properties.evidence.items.required, ["target", "messageIndex", "quote"]);
    assert.match(body.system_instruction, /AIAS公式評価/);
    assert.match(body.system_instruction, new RegExp(WEEKLY_ANALYSIS_RUBRIC_VERSION));
    assert.ok(!String(options?.body).includes(testKey));
    return Response.json(interaction(candidateAnalysis));
  }});
  const app = await start(provider);
  try {
    const result = await createWeeklyAnalysisClient({ baseUrl: app.baseUrl, apiKey: testKey, model }).analyze(request);
    assert.equal(result.analysisStatus, "complete");
    assert.equal(result.recordId, request.recordId);
    assert.equal(result.conversationId, request.conversationId);
    assert.equal(result.thoughtReceiptId, request.thoughtReceiptId);
    assert.equal(result.model, model);
    assert.equal(result.apiMethod, "interactions");
    assert.equal(result.rubricVersion, WEEKLY_ANALYSIS_RUBRIC_VERSION);
    assert.equal(result.analysis?.accountCandidate, "思考探究費");
    assert.equal(result.analysis?.accountingDispositionCandidate, "expense");
    assert.equal(result.analysis?.initiative, 75);
    assert.equal(calls, 1);
  } finally { await app.close(); }
});

test("GenerateContent analysis uses responseJsonSchema without silently switching API methods", async () => {
  let calls = 0;
  const provider = createGeminiProvider({ apiKey: testKey, model, apiMethod: "generate-content", fetchImpl: async (url, options) => {
    calls += 1;
    assert.equal(url, `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`);
    const body = JSON.parse(String(options?.body));
    assert.equal(body.contents[0].parts[0].text, JSON.stringify(request));
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.equal(body.generationConfig.responseJsonSchema.additionalProperties, false);
    assert.deepEqual(body.generationConfig.responseJsonSchema.required, createWeeklyAnalysisResponseSchema().required);
    assert.equal(body.generationConfig.maxOutputTokens, 8192);
    assert.match(body.systemInstruction.parts[0].text, /AIAS公式評価/);
    assert.equal(String(options?.body).includes(testKey), false);
    return Response.json(generateContent(candidateAnalysis));
  }});
  const app = await start(provider);
  try {
    const result = await createWeeklyAnalysisClient({
      baseUrl: app.baseUrl, apiKey: testKey, model, apiMethod: "generate-content",
    }).analyze(request);
    assert.equal(result.analysisStatus, "complete");
    assert.equal(result.apiMethod, "generate-content");
    assert.equal(result.model, model);
    assert.equal(result.rubricVersion, WEEKLY_ANALYSIS_RUBRIC_VERSION);
    assert.equal(result.analysis && "independence" in result.analysis ? result.analysis.independence : null, 50);
    assert.equal(calls, 1);
  } finally { await app.close(); }
});

test("minimal structured diagnostic compares both API methods with the same model and fixed input", async () => {
  const prompts: string[] = [];
  const server = createAiServer({ providerFactory: ({ apiKey, model: selectedModel, apiMethod }) => {
    assert.equal(apiKey, testKey);
    assert.equal(selectedModel, model);
    return createGeminiProvider({ apiKey, model: selectedModel, apiMethod, fetchImpl: async (url, options) => {
      const body = JSON.parse(String(options?.body));
      if (url.endsWith("/interactions")) {
        prompts.push(body.input);
        return Response.json(interaction({ ok: true }));
      }
      prompts.push(body.contents[0].parts[0].text);
      return Response.json(generateContent({ ok: true }));
    }});
  }});
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/ai`;
  try {
    for (const apiMethod of ["interactions", "generate-content"] as const) {
      const response = await fetch(`${baseUrl}/test-structured`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json", Authorization: `Bearer ${testKey}`,
          "X-Gemini-Model": model, "X-Gemini-Api-Method": apiMethod,
        },
        body: JSON.stringify({ schemaVersion: 1 }),
      });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.apiMethod, apiMethod);
      assert.equal(result.model, model);
      assert.equal(result.status, "complete");
    }
    assert.equal(prompts.length, 2);
    assert.equal(prompts[0], prompts[1]);
  } finally {
    await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
  }
});

test("consent is mandatory and AIAS Level 1 is never sent for analysis", async () => {
  assert.equal(parseWeeklyAnalysisRequest({ ...request, consent: { ...request.consent, externalAnalysisAllowed: false } }), null);
  assert.equal(parseWeeklyAnalysisRequest({ ...request, taskContext: { ...request.taskContext, plannedAiasLevel: 1 } }), null);
  let calls = 0;
  const app = await start(createGeminiProvider({ apiKey: testKey, model, fetchImpl: async () => { calls += 1; return Response.json(interaction(candidateAnalysis)); } }));
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

test("short and long conversations use the same validated weekly analysis path", async () => {
  const longMessages = [
    ...request.messages,
    ...Array.from({ length: 118 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      text: `${index + 1}番目の検討記録です。${"比較条件と判断理由を確認します。".repeat(10)}`,
    })),
  ];
  const longRequest = {
    ...request,
    requestId: "request-weekly-long-1",
    recordId: "record-weekly-long-1",
    conversationId: "conversation-weekly-long-1",
    thoughtReceiptId: "record-weekly-long-1:receipt",
    conversationFingerprint: "fnv1a32:87654321",
    messages: longMessages,
  };
  const sentMessageCounts: number[] = [];
  const app = await start(createGeminiProvider({ apiKey: testKey, model, fetchImpl: async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { input: string };
    sentMessageCounts.push((JSON.parse(body.input) as typeof request).messages.length);
    return Response.json(interaction(candidateAnalysis));
  } }));
  try {
    const client = createWeeklyAnalysisClient({ baseUrl: app.baseUrl, apiKey: testKey, model });
    const shortResult = await client.analyze(request);
    const longResult = await client.analyze(longRequest);
    assert.equal(shortResult.analysisStatus, "complete");
    assert.equal(longResult.analysisStatus, "complete");
    assert.equal(longResult.conversationId, longRequest.conversationId);
    assert.deepEqual(sentMessageCounts, [2, 120]);
  } finally { await app.close(); }
});

test("invalid JSON remains a safe failed response", async () => {
  const content = { id: "bad", status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "not-json" }] }] };
  const app = await start(createGeminiProvider({ apiKey: testKey, model, fetchImpl: async () => Response.json(content) }));
  try {
    const result = await createWeeklyAnalysisClient({ baseUrl: app.baseUrl, apiKey: testKey, model }).analyze(request);
    assert.equal(result.analysisStatus, "failed");
    assert.equal(result.error?.code, "INVALID_OUTPUT");
    assert.equal(result.error?.diagnosticStage, "json-parse");
    assert.equal(result.analysis, null);
  } finally { await app.close(); }
});

test("missing or invalid evidence nulls only the affected field and returns a partial result", async () => {
  for (const [evidence, reason] of [
    [candidateAnalysis.evidence.filter((row) => row.target !== "account-candidate"), "missing-evidence"],
    [candidateAnalysis.evidence.map((row) => row.target === "account-candidate" ? { ...row, quote: "存在しない引用" } : row), "invalid-evidence"],
  ] as const) {
    const app = await start(createGeminiProvider({ apiKey: testKey, model, fetchImpl: async () => Response.json(interaction({ ...candidateAnalysis, evidence })) }));
    try {
      const result = await createWeeklyAnalysisClient({ baseUrl: app.baseUrl, apiKey: testKey, model }).analyze(request);
      assert.equal(result.analysisStatus, "partial");
      assert.equal(result.error, null);
      assert.equal(result.analysis?.accountCandidate, null);
      assert.equal(result.analysis?.initiative, 75);
      assert.deepEqual(result.unresolvedFields, [{ field: "analysis.accountCandidate", reason }]);
      assert.equal(result.analysis?.evidence.some((row) => row.target === "account-candidate"), false);
    } finally { await app.close(); }
  }
});

test("GenerateContent turns a scored metric without evidence into a partial hold", async () => {
  const missingMetricEvidence = {
    ...candidateAnalysis,
    metricAssessments: {
      ...candidateAnalysis.metricAssessments,
      initiative: { ...candidateAnalysis.metricAssessments.initiative, evidence: [] },
    },
  };
  const app = await start(createGeminiProvider({
    apiKey: testKey, model, apiMethod: "generate-content",
    fetchImpl: async () => Response.json(generateContent(missingMetricEvidence)),
  }));
  try {
    const result = await createWeeklyAnalysisClient({ baseUrl: app.baseUrl, apiKey: testKey, model, apiMethod: "generate-content" }).analyze(request);
    assert.equal(result.analysisStatus, "partial");
    assert.equal(result.error, null);
    assert.equal(result.analysis?.initiative, null);
    assert.equal(result.analysis?.metricAssessments.initiative.status, "hold");
    assert.equal(result.analysis?.metricAssessments.reasoning.score, 75);
    assert.deepEqual(result.unresolvedFields, [{ field: "analysis.initiative", reason: "missing-evidence" }]);
  } finally { await app.close(); }
});

test("self-report evidence attributed to an assistant is held without weakening quote matching", () => {
  const assistantQuote = request.messages[1].text;
  const result = linkGeminiAnalysisCandidateWithPartial(request, {
    ...candidateAnalysis,
    metricAssessments: {
      ...candidateAnalysis.metricAssessments,
      initiative: {
        ...candidateAnalysis.metricAssessments.initiative,
        evidence: [{ messageIndex: 1, quote: assistantQuote, observedFeature: "自己申告として扱えない発言", source: "self_report" }],
      },
    },
  });
  assert.equal(result.analysis.initiative, null);
  assert.equal(result.analysis.metricAssessments.initiative.status, "hold");
  assert.deepEqual(result.unresolvedFields, [{ field: "analysis.initiative", reason: "invalid-evidence" }]);
});

test("twelve unsupported evidence fields remain a partial analysis instead of failing", async () => {
  const invalidQuote = "この引用は実際の会話に存在しません";
  const corruptQuotes = <T extends { quote: string }>(rows: readonly T[]) =>
    rows.map(row => ({ ...row, quote: invalidQuote }));
  const invalidateMetric = <T extends { evidence: readonly { quote: string }[] }>(metric: T) =>
    ({ ...metric, evidence: corruptQuotes(metric.evidence) });
  const invalidAnalysis = {
    ...candidateAnalysis,
    evidence: corruptQuotes(candidateAnalysis.evidence),
    metricAssessments: {
      initiative: invalidateMetric(candidateAnalysis.metricAssessments.initiative),
      reasoning: invalidateMetric(candidateAnalysis.metricAssessments.reasoning),
      independence: {
        ...invalidateMetric(candidateAnalysis.metricAssessments.independence),
        deliberation: invalidateMetric(candidateAnalysis.metricAssessments.independence.deliberation),
        finalDecision: invalidateMetric(candidateAnalysis.metricAssessments.independence.finalDecision),
      },
    },
  };
  const linked = linkGeminiAnalysisCandidateWithPartial(request, invalidAnalysis);
  assert.equal(linked.unresolvedFields.length, 12);
  assert.equal(linked.analysis.initiative, null);
  assert.equal(linked.analysis.reasoning, null);
  assert.equal(linked.analysis.independence, null);
  assert.equal(linked.analysis.evidence.length, 0);
  const response = createWeeklySuccessResponse(request, linked.analysis, {
    model, apiMethod: "interactions", analysisId: "analysis-12-held-metrics",
    now: new Date("2026-11-26T02:00:00.000Z"), unresolvedFields: linked.unresolvedFields,
  });
  assert.equal(response.analysisStatus, "partial");
  assert.equal(parseWeeklyAnalysisResponseV1(response).unresolvedFields.length, 12);
  const app = await start(createGeminiProvider({ apiKey: testKey, model, fetchImpl: async () =>
    Response.json(interaction(invalidAnalysis)) }));
  try {
    const result = await createWeeklyAnalysisClient({ baseUrl: app.baseUrl, apiKey: testKey, model }).analyze(request);
    assert.equal(result.analysisStatus, "partial");
    assert.equal(result.error, null);
    assert.equal(result.unresolvedFields.length, 12);
    assert.equal(result.analysis?.initiative, null);
    assert.equal(result.analysis?.metricAssessments.independence.finalDecision.status, "hold");
  } finally { await app.close(); }
});

test("structured schema keeps null distinct from zero and constrains linked evidence IDs", () => {
  const schema = createWeeklyAnalysisResponseSchema();
  assert.deepEqual(schema.properties.reasoning, {
    type: ["integer", "null"], enum: [0, 25, 50, 75, 100, null],
  });
  assert.deepEqual(schema.properties.activityCategory.type, ["string", "null"]);
  assert.equal(schema.properties.activityCategory.enum.at(-1), null);
  assert.equal(schema.properties.evidence.items.properties.conversationId, undefined);
  assert.equal(schema.properties.evidence.items.additionalProperties, false);
  assert.equal(schema.properties.collaborationBehaviors.maxItems, undefined);
  assert.equal(schema.properties.evidence.maxItems, undefined);
});

test("provider candidate excludes app metadata and linking attaches the conversation ID", () => {
  const candidate = parseGeminiAnalysisCandidate(candidateAnalysis);
  assert.equal(Object.hasOwn(candidate.evidence[0], "conversationId"), false);
  const linked = linkGeminiAnalysisCandidate(request, candidate);
  assert.equal(linked.evidence[0].conversationId, request.conversationId);
  assert.equal(Object.hasOwn(linked, "analysisId"), false);
  assert.equal(Object.hasOwn(linked, "analyzedAt"), false);
  assert.equal(Object.hasOwn(linked, "rubricVersion"), false);
});

test("candidate validation reports safe field paths and individual rules", () => {
  const cases = [
    [{ ...candidateAnalysis, reasoning: 60 }, "analysis.reasoning", "enum"],
    [{ ...candidateAnalysis, activityCategory: "unsupported" }, "analysis.activityCategory", "enum"],
    [{ ...candidateAnalysis, evidence: null }, "analysis.evidence", "type"],
    [Object.fromEntries(Object.entries(candidateAnalysis).filter(([key]) => key !== "initiative")), "analysis.initiative", "required"],
    [{ ...candidateAnalysis, collaborationBehaviors: [{ kind: "comparison", description: "" }] }, "analysis.collaborationBehaviors[0].description", "non-empty"],
  ] as const;
  for (const [value, field, rule] of cases) {
    assert.throws(() => parseGeminiAnalysisCandidate(value), (error: unknown) => {
      assert.equal((error as { validationField?: string }).validationField, field);
      assert.equal((error as { validationRule?: string }).validationRule, rule);
      assert.equal(JSON.stringify(error).includes(quote), false);
      return true;
    });
  }
  const candidateWithoutMetricEvidence = parseGeminiAnalysisCandidate({
    ...candidateAnalysis,
    metricAssessments: { ...candidateAnalysis.metricAssessments, initiative: { ...candidateAnalysis.metricAssessments.initiative, evidence: [] } },
  });
  assert.equal(candidateWithoutMetricEvidence.metricAssessments.initiative.evidence.length, 0);
  assert.throws(
    () => parseGeminiAnalysisPayload({ ...analysis, metricAssessments: { ...analysis.metricAssessments, initiative: { ...analysis.metricAssessments.initiative, evidence: [] } } }),
    (error: unknown) => {
      assert.equal((error as { validationField?: string }).validationField, "analysis.metricAssessments.initiative");
      assert.equal((error as { validationRule?: string }).validationRule, "evidence-required");
      return true;
    },
  );
  const hold = metricAssessment(null);
  const insufficient = parseGeminiAnalysisCandidate({ ...candidateAnalysis, activityCategory: null, accountCandidate: null, accountingDispositionCandidate: null, aiRole: null,
    collaborationBehaviors: [], initiative: null, reasoning: null, independence: null,
    metricAssessments: { initiative: hold, reasoning: hold, independence: { ...hold, deliberation: hold, finalDecision: hold } },
    thinkingChange: null, discovery: null, evidence: [] });
  assert.equal(insufficient.initiative, null);
});

test("invalid metric evidence is isolated as hold without inventing a score", () => {
  for (const [messageIndex, evidenceQuote] of [[99, quote], [0, "not present"]] as const) {
    const value = { ...candidateAnalysis, metricAssessments: { ...candidateAnalysis.metricAssessments,
      initiative: { ...candidateAnalysis.metricAssessments.initiative, evidence: [{ ...metricEvidenceCandidate[0], messageIndex, quote: evidenceQuote }] },
    } };
    const result = linkGeminiAnalysisCandidateWithPartial(request, value);
    assert.equal(result.analysis.initiative, null);
    assert.equal(result.analysis.metricAssessments.initiative.status, "hold");
    assert.deepEqual(result.unresolvedFields, [{ field: "analysis.initiative", reason: "invalid-evidence" }]);
  }
});

test("independence deliberation and final decision can be held independently", () => {
  const badStage = { ...candidateAnalysis.metricAssessments.independence.deliberation, evidence: [{ ...metricEvidenceCandidate[0], quote: "存在しない検討発言" }] };
  const result = linkGeminiAnalysisCandidateWithPartial(request, {
    ...candidateAnalysis,
    metricAssessments: { ...candidateAnalysis.metricAssessments, independence: { ...candidateAnalysis.metricAssessments.independence, deliberation: badStage } },
  });
  assert.equal(result.analysis.independence, 50);
  assert.equal(result.analysis.metricAssessments.independence.status, "confirmed");
  assert.equal(result.analysis.metricAssessments.independence.deliberation.status, "hold");
  assert.equal(result.analysis.metricAssessments.independence.deliberation.score, null);
  assert.equal(result.analysis.metricAssessments.independence.finalDecision.score, 50);
  assert.deepEqual(result.unresolvedFields, [{ field: "analysis.metricAssessments.independence.deliberation", reason: "invalid-evidence" }]);
});

test("truncated and changed interaction envelopes fail without parsing or inventing analysis", async () => {
  for (const [content, diagnosticStage] of [
    [{ id: "cut", status: "incomplete", steps: [] }, "output-truncated"],
    [{ id: "changed", status: "completed", output_text: 42 }, "interaction-envelope"],
  ]) {
    const app = await start(createGeminiProvider({ apiKey: testKey, model, fetchImpl: async () => Response.json(content) }));
    try {
      const result = await createWeeklyAnalysisClient({ baseUrl: app.baseUrl, apiKey: testKey, model }).analyze(request);
      assert.equal(result.analysisStatus, "failed");
      assert.equal(result.analysis, null);
      assert.equal(result.error?.code, "INVALID_OUTPUT");
      assert.equal(result.error?.diagnosticStage, diagnosticStage);
    } finally { await app.close(); }
  }
});

test("privacy-safe diagnostics reject unknown stages and contain no request content", async () => {
  const app = await start(createGeminiProvider({ apiKey: testKey, model, fetchImpl: async () => Response.json({
    id: "bad-json", status: "completed", output_text: "not-json",
  }) }));
  try {
    const result = await createWeeklyAnalysisClient({ baseUrl: app.baseUrl, apiKey: testKey, model }).analyze(request);
    assert.deepEqual(result.error, {
      code: "INVALID_OUTPUT", retryable: false, diagnosticStage: "json-parse", timedOut: false,
      providerApiVersion: WEEKLY_ANALYSIS_PROVIDER_API_VERSION,
      providerSdkVersion: WEEKLY_ANALYSIS_PROVIDER_SDK_VERSION,
    });
    const serialized = JSON.stringify(result.error);
    assert.equal(serialized.includes(testKey), false);
    assert.equal(serialized.includes(quote), false);
  } finally { await app.close(); }
  assert.throws(() => parseWeeklyAnalysisResponseV1({
    schemaVersion: 1, analysisId: "failure", requestId: request.requestId,
    recordId: request.recordId, conversationId: request.conversationId,
    thoughtReceiptId: request.thoughtReceiptId, conversationFingerprint: request.conversationFingerprint,
    origin: "gemini-api", analysisStatus: "failed", receivedAt: request.requestedAt,
    model, rubricVersion: WEEKLY_ANALYSIS_RUBRIC_VERSION, analyzedAt: request.requestedAt,
    analysis: null, error: { code: "INVALID_OUTPUT", retryable: false, diagnosticStage: "raw-body" },
  }), /invalid/i);
});

test("upstream HTTP diagnostics expose only status and machine error type", async () => {
  const upstreamMessage = `never expose ${testKey} or ${quote}`;
  for (const [status, providerErrorCode, expectedCode, timedOut] of [
    [400, "invalid_request", "PROVIDER_ERROR", false],
    [401, "authentication", "NOT_AUTHENTICATED", false],
    [403, "permission_denied", "NOT_AUTHENTICATED", false],
    [429, "quota_exceeded", "RATE_LIMITED", false],
    [503, "service_unavailable", "PROVIDER_ERROR", false],
    [504, "deadline_exceeded", "TIMEOUT", true],
  ] as const) {
    const app = await start(createGeminiProvider({ apiKey: testKey, model, fetchImpl: async () => Response.json({
      error: { code: providerErrorCode, message: upstreamMessage },
    }, { status }) }));
    try {
      const result = await createWeeklyAnalysisClient({ baseUrl: app.baseUrl, apiKey: testKey, model }).analyze(request);
      assert.equal(result.analysisStatus, "failed");
      assert.equal(result.error?.code, expectedCode);
      assert.equal(result.error?.providerHttpStatus, status);
      assert.equal(result.error?.providerErrorCode, providerErrorCode);
      assert.equal(result.error?.diagnosticStage, "provider-response");
      assert.equal(result.error?.timedOut, timedOut);
      assert.equal(result.error?.providerApiVersion, WEEKLY_ANALYSIS_PROVIDER_API_VERSION);
      assert.equal(result.error?.providerSdkVersion, WEEKLY_ANALYSIS_PROVIDER_SDK_VERSION);
      const serialized = JSON.stringify(result);
      assert.equal(serialized.includes(upstreamMessage), false);
      assert.equal(serialized.includes(testKey), false);
      assert.equal(serialized.includes(quote), false);
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
  const linkedHold = { ...linkedMetric(metricAssessment(null)) };
  const insufficient = parseGeminiAnalysisPayload({ ...analysis, activityCategory: null, accountCandidate: null, accountingDispositionCandidate: null, aiRole: null,
    collaborationBehaviors: [], initiative: null, reasoning: null, independence: null,
    metricAssessments: { initiative: linkedHold, reasoning: linkedHold, independence: { ...linkedHold, deliberation: linkedHold, finalDecision: linkedHold } },
    thinkingChange: null, discovery: null, evidence: [] });
  assert.equal(insufficient.initiative, null);
  assert.equal(insufficient.reasoning, null);
  assert.equal(insufficient.independence, null);
  assert.equal(WEEKLY_ANALYSIS_SYSTEM_INSTRUCTION.includes("証拠不足は0にせずhold"), true);
});

test("confirmed rubric v2 cases keep context, delegation, disagreement, hold, exclusion, and complexity distinct", () => {
  const hold = metricAssessment(null, "hold");
  const notApplicable = { ...metricAssessment(null, "not_applicable"), reason: "校正では思考判断を課題目的に必要としない" };
  const zeroDelegation = { ...metricAssessment(0), reason: "本人が判断を全てAIへ任せると明示した" };
  const reasonedAgreement = { ...metricAssessment(75), reason: "AI案に一致したからではなく、自分の基準と理由を示した" };
  const reasonedObjection = { ...metricAssessment(75), reason: "自分の基準からAI案へ理由ある反論をした" };
  const independentButWeakReasoning = { ...metricAssessment(25), reason: "本人主導だが重要な期限を見落とした" };
  const deliberateHold = { ...metricAssessment(100), reason: "自分の目的と基準から意図的に判断を保留した" };
  const variants = [
    { ...candidateAnalysis, metricAssessments: { ...candidateAnalysis.metricAssessments, initiative: { ...candidateAnalysis.metricAssessments.initiative, evidence: [{ ...metricEvidenceCandidate[0], quote: "案B" }] } } },
    { ...candidateAnalysis, initiative: null, metricAssessments: { ...candidateAnalysis.metricAssessments, initiative: hold } },
    { ...candidateAnalysis, independence: 0, metricAssessments: { ...candidateAnalysis.metricAssessments, independence: { ...zeroDelegation, deliberation: zeroDelegation, finalDecision: zeroDelegation } } },
    { ...candidateAnalysis, independence: 75, metricAssessments: { ...candidateAnalysis.metricAssessments, independence: { ...reasonedAgreement, deliberation: reasonedAgreement, finalDecision: reasonedAgreement } } },
    { ...candidateAnalysis, independence: 75, metricAssessments: { ...candidateAnalysis.metricAssessments, independence: { ...reasonedObjection, deliberation: reasonedObjection, finalDecision: reasonedObjection } } },
    { ...candidateAnalysis, reasoning: 25, independence: 75, metricAssessments: { ...candidateAnalysis.metricAssessments, reasoning: independentButWeakReasoning, independence: { ...reasonedAgreement, deliberation: reasonedAgreement, finalDecision: reasonedAgreement } } },
    { ...candidateAnalysis, independence: 100, metricAssessments: { ...candidateAnalysis.metricAssessments, independence: { ...deliberateHold, deliberation: reasonedAgreement, finalDecision: deliberateHold } } },
    { ...candidateAnalysis, initiative: null, reasoning: null, independence: null, metricAssessments: { initiative: notApplicable, reasoning: notApplicable, independence: { ...notApplicable, deliberation: notApplicable, finalDecision: notApplicable } } },
    { ...candidateAnalysis, taskComplexity: { ...candidateAnalysis.taskComplexity, level: "low", reason: "単純な条件確認" } },
    { ...candidateAnalysis, taskComplexity: { ...candidateAnalysis.taskComplexity, level: "high", reason: "多数の相互依存要素と不確実性" } },
  ];
  for (const value of variants) assert.doesNotThrow(() => parseGeminiAnalysisCandidate(value));
  assert.match(WEEKLY_ANALYSIS_SYSTEM_INSTRUCTION, /短文や選択肢の1文字回答だけで低得点にせず/);
  assert.match(WEEKLY_ANALYSIS_SYSTEM_INSTRUCTION, /deliberation（検討過程）とfinalDecision/);
  assert.match(WEEKLY_ANALYSIS_SYSTEM_INSTRUCTION, /AI案への一致\/不一致自体は根拠にしません/);
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
