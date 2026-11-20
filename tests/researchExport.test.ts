import assert from "node:assert/strict";
import test from "node:test";
import { fingerprintConversation } from "../src/integrations/weeklyAnalysisAdapter.ts";
import {
  buildResearchExportBundle,
  ResearchExportError,
  serializeResearchAccountingCsv,
  serializeResearchActivitiesCsv,
  serializeResearchJson,
  serializeResearchReflectionsCsv,
  type ResearchExportSources,
} from "../src/researchExport.ts";
import { buildManualWeeklyRecord } from "../src/weeklyData.ts";

function fixtureSources(): ResearchExportSources {
  const built = buildManualWeeklyRecord({
    id: "activity-1",
    recordedAt: "2026-11-10T01:12:00.000Z",
    startedAt: "2026-11-10T01:00:00.000Z",
    endedAt: "2026-11-10T01:12:00.000Z",
    activeSeconds: 720,
    timeSource: "manual",
    aiService: "gemini",
    privacy: "full",
    taskId: "task-1",
    activityCategory: "壁打ち",
    accountingDisposition: "expense",
    selfReflection: "=HYPERLINK(\"https://example.invalid\")",
    manualNotes: {
      interactionSummary: "本人が書いた概要",
      ownThoughts: "本人が最終判断した",
      discovery: "本人の発見",
    },
    conversation: {
      id: "conversation-1",
      title: "秘密の会話",
      captureScope: "partial",
      messages: [
        { role: "user", text: "会話本文は絶対にエクスポートしない" },
        { role: "assistant", text: "比較案を提示します" },
      ],
    },
  });
  assert.ok(built.conversation);
  const response = {
    schemaVersion: 1 as const,
    analysisId: "analysis-1",
    requestId: "request-1",
    recordId: built.record.id,
    conversationId: built.conversation.id,
    thoughtReceiptId: built.record.links.thoughtReceiptId,
    conversationFingerprint: fingerprintConversation(built.conversation),
    origin: "test-fixture" as const,
    analysisStatus: "complete" as const,
    receivedAt: "2026-11-10T02:00:05.000Z",
    model: "mock-model",
    apiMethod: "generate-content" as const,
    rubricVersion: "research-rubric-v1",
    analyzedAt: "2026-11-10T02:00:04.000Z",
    analysis: {
      activityCategory: "壁打ち" as const,
      accountCandidate: "思考探究費" as const,
      accountingDispositionCandidate: "expense" as const,
      aiRole: "比較役",
      collaborationBehaviors: [{ kind: "comparison" as const, description: "案を比較した" }],
      initiative: 75 as const,
      reasoning: null,
      criticalJudgment: 100 as const,
      thinkingChange: "比較後に判断が変化した",
      discovery: "AIが示した発見候補",
      evidence: [{ target: "critical-judgment" as const, conversationId: built.conversation.id, messageIndex: 0, quote: "会話本文は絶対にエクスポートしない" }],
    },
    error: null,
    unresolvedFields: [],
  };
  return Object.freeze({
    records: Object.freeze({
      schemaVersion: 1 as const,
      records: Object.freeze([built.record]),
      tasks: Object.freeze([Object.freeze({
        schemaVersion: 1 as const,
        id: "task-1",
        title: "=SUM(1,1)",
        goal: "研究設計を決める",
        plannedAiasLevel: 3 as const,
        activityCategory: "壁打ち" as const,
        delegatedToAi: "比較案の提示",
        humanDecision: "採否は本人",
        createdAt: "2026-11-09T00:00:00.000Z",
      })]),
    }),
    conversations: Object.freeze({ schemaVersion: 1 as const, conversations: Object.freeze([built.conversation]) }),
    analyses: Object.freeze({ schemaVersion: 1 as const, entries: Object.freeze([Object.freeze({
      schemaVersion: 1 as const,
      requestId: "request-1",
      recordId: built.record.id,
      conversationId: built.conversation.id,
      thoughtReceiptId: built.record.links.thoughtReceiptId,
      conversationFingerprint: fingerprintConversation(built.conversation),
      requestedAt: "2026-11-10T02:00:00.000Z",
      analysisStatus: "complete" as const,
      response,
    })]) }),
    reviews: Object.freeze({ schemaVersion: 1 as const, reviews: Object.freeze([Object.freeze({
      schemaVersion: 1 as const,
      analysisId: "analysis-1",
      recordId: built.record.id,
      thoughtReceiptId: built.record.links.thoughtReceiptId,
      reviewedAt: "2026-11-10T03:00:00.000Z",
      fields: Object.freeze({
        activityCategory: "文章作成" as const,
        accountCandidate: "成果物利用費" as const,
        accountingDispositionCandidate: "asset" as const,
        aiRole: "本人が修正した役割",
        collaborationSummary: "本人が確認した協働",
        initiative: 50 as const,
        reasoning: 50 as const,
        criticalJudgment: 75 as const,
        thinkingChange: "本人が修正した変化",
        discovery: "本人が修正した発見",
        reviewerNote: "本人確認済み",
      }),
    })]) }),
    reflections: Object.freeze({ schemaVersion: 1 as const, reflections: Object.freeze([Object.freeze({
      schemaVersion: 1 as const,
      weekKey: "2026-11-09",
      weekStart: "2026-11-08T15:00:00.000Z",
      weekEndExclusive: "2026-11-15T15:00:00.000Z",
      discoveryLearning: "週の発見",
      humanJudgment: "本人の判断",
      relationshipReflection: "AIとの関わり",
      nextWeekChallenge: "次の挑戦",
      selectedActivities: Object.freeze([{ recordId: built.record.id, thoughtReceiptId: built.record.links.thoughtReceiptId }]),
      updatedAt: "2026-11-15T10:00:00.000Z",
    })]) }),
    settlements: Object.freeze({ schemaVersion: 1 as const, weeks: Object.freeze([]) }),
  });
}

test("week and all-period exports count an activity once and retain balanced weekly accounting", () => {
  const sources = fixtureSources();
  const week = buildResearchExportBundle(sources, { scope: { kind: "week", anchor: new Date("2026-11-10T12:00:00+09:00") }, includeSensitiveText: false, exportedAt: "2026-11-16T00:00:00Z" });
  const all = buildResearchExportBundle(sources, { scope: { kind: "all" }, includeSensitiveText: false, exportedAt: "2026-11-16T00:00:00Z" });
  assert.equal(week.activities.length, 1);
  assert.equal(week.activities[0].scopeAllocatedSeconds, 720);
  assert.equal(all.activities.length, 1);
  assert.equal(all.activities[0].scopeAllocatedSeconds, 720);
  assert.equal(week.weeklyStatements[0].trialBalance.isBalanced, true);
  const accounting = serializeResearchAccountingCsv(week);
  assert.match(accounting, /"B\/S total"/);
  assert.match(accounting, /"trial balance"/);
});

test("standard output separates AI and human values, preserves null, and excludes sensitive text and conversation bodies", () => {
  const bundle = buildResearchExportBundle(fixtureSources(), { scope: { kind: "all" }, includeSensitiveText: false, exportedAt: "2026-11-16T00:00:00Z" });
  const activity = bundle.activities[0];
  assert.equal(activity.analysis.activityCategory, "壁打ち");
  assert.equal(activity.humanReview?.activityCategory, "文章作成");
  assert.equal(activity.analysis.reasoning, null);
  assert.equal(activity.analysis.criticalJudgment, 100);
  assert.equal(activity.analysis.independence, null);
  assert.equal(activity.analysis.apiMethod, "generate-content");
  assert.equal(activity.humanReview?.reasoning, 50);
  assert.equal(activity.analysis.aiRole, null);
  assert.equal(activity.personAuthored.ownThoughts, null);
  const json = serializeResearchJson(bundle);
  assert.doesNotMatch(json, /会話本文は絶対にエクスポートしない|秘密の会話|週の発見/);
  const csv = serializeResearchActivitiesCsv(bundle);
  assert.match(csv, /"ai_reasoning"/);
  assert.match(csv, /"human_reasoning"/);
  assert.match(csv, /"api_method"/);
  assert.match(csv, /"generate-content"/);
  assert.match(csv, /"analysis_unresolved_fields"/);
  assert.doesNotMatch(csv, /会話本文は絶対にエクスポートしない/);
});

test("research JSON exports person-confirmed accounting history without changing activity or accounting totals", () => {
  const sources = fixtureSources();
  const withHistory: ResearchExportSources = {
    ...sources,
    accountingRevisions: Object.freeze({
      schemaVersion: 1 as const,
      revisions: Object.freeze([
        Object.freeze({
          schemaVersion: 1 as const,
          id: "activity-1:accounting-revision:1",
          recordId: "activity-1",
          changedAt: "2026-11-17T03:00:00.000Z",
          before: Object.freeze({ disposition: "unclassified" as const, account: null }),
          after: Object.freeze({ disposition: "expense" as const, account: "思考探究費" as const }),
        }),
      ]),
    }),
  };
  const beforeRecords = JSON.stringify(withHistory.records);
  const bundle = buildResearchExportBundle(withHistory, {
    scope: { kind: "all" },
    includeSensitiveText: false,
    exportedAt: "2026-11-18T00:00:00Z",
  });

  assert.equal(bundle.activities.length, 1);
  assert.equal(bundle.activities[0].activeSeconds, 720);
  assert.deepEqual(bundle.activities[0].accountingRevisionHistory, [{
    revisionId: "activity-1:accounting-revision:1",
    changedAt: "2026-11-17T03:00:00.000Z",
    changedBy: "person",
    before: { accountingDisposition: "unclassified", accountingAccount: null },
    after: { accountingDisposition: "expense", accountingAccount: "思考探究費" },
  }]);
  assert.equal(bundle.weeklyStatements[0].totals.recordSeconds, 720);
  assert.equal(bundle.weeklyStatements[0].trialBalance.isBalanced, true);
  assert.equal(JSON.stringify(withHistory.records), beforeRecords);

  const json = serializeResearchJson(bundle);
  assert.match(json, /"accountingRevisionHistory"/);
  assert.match(json, /"changedBy": "person"/);
  assert.doesNotMatch(json, /会話本文は絶対にエクスポートしない|秘密の会話/);
});

test("legacy research export sources without accounting history produce an empty history", () => {
  const legacySources = fixtureSources();
  assert.equal("accountingRevisions" in legacySources, false);
  const bundle = buildResearchExportBundle(legacySources, {
    scope: { kind: "all" },
    includeSensitiveText: false,
    exportedAt: "2026-11-18T00:00:00Z",
  });
  assert.deepEqual(bundle.activities[0].accountingRevisionHistory, []);
  assert.match(serializeResearchJson(bundle), /"accountingRevisionHistory": \[\]/);
});

test("rubric v2 export separates independence from legacy critical judgment and gates detailed evidence", () => {
  const sources = fixtureSources();
  const entry = sources.analyses.entries[0];
  assert.ok(entry.response?.analysis);
  const conversationId = sources.conversations.conversations[0].id;
  const metricEvidence = [{ conversationId, messageIndex: 0, utteranceId: `${conversationId}:message:0`, speaker: "user" as const, quote: "会話本文は絶対にエクスポートしない", observedFeature: "本人が出力範囲を制限", source: "observed_behavior" as const }];
  const metric = (score: 50 | 75) => ({ score, status: "confirmed" as const, reason: "会話内行動を確認", rubricLevel: score, evidence: metricEvidence, unconfirmed: [], evidenceSufficiency: "high" as const });
  const v2Analysis = {
    activityCategory: "壁打ち" as const, accountCandidate: "思考探究費" as const, accountingDispositionCandidate: "expense" as const,
    aiRole: "比較役", collaborationBehaviors: [{ kind: "comparison" as const, description: "比較" }],
    initiative: 75 as const, reasoning: 50 as const, independence: 75 as const,
    metricAssessments: { initiative: metric(75), reasoning: metric(50), independence: { ...metric(75), deliberation: metric(75), finalDecision: metric(75) } },
    taskComplexity: { level: "medium" as const, reason: "比較", considerationFactors: "複数案", uncertainty: "あり", reasoningProcess: "比較判断" },
    subjectiveDifficulty: { level: "not_provided" as const, source: "self_report" as const, note: null }, thinkingChange: null, discovery: null, evidence: [],
  };
  const response = { ...entry.response, rubricVersion: "research-thinking-rubric-v2", analysis: v2Analysis };
  const review = { schemaVersion: 2 as const, revisionId: "revision-v2", analysisId: response.analysisId, recordId: response.recordId,
    thoughtReceiptId: response.thoughtReceiptId, rubricVersion: "research-thinking-rubric-v2" as const, reviewedAt: "2026-11-10T03:30:00Z",
    action: "objection" as const, supplement: "本人の補足", objection: "独立性の理由へ異議", excluded: false, exclusionReason: null,
    subjectiveDifficulty: "high" as const, metrics: { initiative: { score: 75 as const, status: "confirmed" as const, reason: "確認" }, reasoning: { score: 50 as const, status: "provisional" as const, reason: "暫定" }, independence: { score: 75 as const, status: "confirmed" as const, reason: "確認" } } };
  const v2Sources = { ...sources, analyses: { ...sources.analyses, entries: [{ ...entry, response }] }, reviewHistoryV2: { schemaVersion: 2 as const, revisions: [review] } };
  const standard = buildResearchExportBundle(v2Sources, { scope: { kind: "all" }, includeSensitiveText: false, exportedAt: "2026-11-16T00:00:00Z" });
  assert.equal(standard.activities[0].analysis.criticalJudgment, null);
  assert.equal(standard.activities[0].analysis.independence, 75);
  assert.equal(standard.activities[0].analysis.metricAssessments?.independence.status, "confirmed");
  assert.equal(standard.activities[0].analysis.metricAssessments?.independence.reason, null);
  assert.deepEqual(standard.activities[0].analysis.metricAssessments?.independence.evidence, []);
  assert.equal(standard.activities[0].analysis.taskComplexity?.level, "medium");
  assert.equal(standard.activities[0].humanReviewV2?.subjectiveDifficulty, "high");
  assert.doesNotMatch(serializeResearchJson(standard), /会話本文は絶対にエクスポートしない|本人の補足|異議/);
  const sensitive = buildResearchExportBundle(v2Sources, { scope: { kind: "all" }, includeSensitiveText: true, exportedAt: "2026-11-16T00:00:00Z" });
  assert.match(serializeResearchJson(sensitive), /observedFeature|本人の補足|独立性の理由へ異議/);
  const csv = serializeResearchActivitiesCsv(sensitive);
  assert.match(csv, /"ai_independence_v2"|"independence_status_v2"|"human_v2_revision_history"/);
});

test("partial analysis status and safe unresolved reasons are retained in JSON and CSV", () => {
  const sources = fixtureSources();
  const entry = sources.analyses.entries[0];
  assert.ok(entry.response?.analysis);
  const partialResponse = {
    ...entry.response,
    analysisStatus: "partial" as const,
    analysis: { ...entry.response.analysis, accountCandidate: null },
    unresolvedFields: [{ field: "analysis.accountCandidate" as const, reason: "missing-evidence" as const }],
  };
  const partialSources = { ...sources, analyses: { ...sources.analyses, entries: [{ ...entry, analysisStatus: "partial" as const, response: partialResponse }] } };
  const bundle = buildResearchExportBundle(partialSources, { scope: { kind: "all" }, includeSensitiveText: false, exportedAt: "2026-11-16T00:00:00Z" });
  assert.equal(bundle.activities[0].analysis.status, "partial");
  assert.equal(bundle.activities[0].analysis.accountCandidate, null);
  assert.deepEqual(bundle.activities[0].analysis.unresolvedFields, [{ field: "analysis.accountCandidate", reason: "missing-evidence" }]);
  assert.match(serializeResearchJson(bundle), /"status": "partial"/);
  const csv = serializeResearchActivitiesCsv(bundle);
  assert.match(csv, /"partial"/);
  assert.match(csv, /missing-evidence/);
});

test("sensitive opt-in includes free text and evidence but CSV neutralizes spreadsheet formulas", () => {
  const bundle = buildResearchExportBundle(fixtureSources(), { scope: { kind: "all" }, includeSensitiveText: true, exportedAt: "2026-11-16T00:00:00Z" });
  const json = serializeResearchJson(bundle);
  assert.match(json, /本人が最終判断した/);
  assert.match(json, /会話本文は絶対にエクスポートしない/);
  assert.match(json, /週の発見/);
  assert.equal(json.includes('"messages"'), false);
  const activities = serializeResearchActivitiesCsv(bundle);
  assert.equal(activities.charCodeAt(0), 0xFEFF);
  assert.match(activities, /"'=SUM\(1,1\)"/);
  assert.match(activities, /"'=HYPERLINK/);
  const reflections = serializeResearchReflectionsCsv(bundle);
  assert.match(reflections, /週の発見/);
});

test("duplicate activity ids and reused measured time are rejected instead of being double-counted", () => {
  const sources = fixtureSources();
  const first = sources.records.records[0];
  const duplicateId = { ...sources, records: { ...sources.records, records: [first, first] } };
  assert.throws(
    () => buildResearchExportBundle(duplicateId, { scope: { kind: "all" }, includeSensitiveText: false }),
    (error: unknown) => error instanceof ResearchExportError && error.code === "DUPLICATE_ID",
  );
  const measured = { ...first, timeSource: "measured" as const, sessionId: "measurement-1" };
  const reused = {
    ...measured,
    id: "activity-2",
    sourceEventId: "event-2",
    links: { ...measured.links, conversationId: null, usageId: "usage-2", thoughtReceiptId: "activity-2:receipt" },
  };
  const duplicateTime = { ...sources, records: { ...sources.records, records: [measured, reused] } };
  assert.throws(
    () => buildResearchExportBundle(duplicateTime, { scope: { kind: "all" }, includeSensitiveText: false }),
    (error: unknown) => error instanceof ResearchExportError && error.code === "DUPLICATE_TIME",
  );
});
