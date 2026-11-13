import {
  parseWeeklyAnalysisRequestV1,
  type WeeklyAnalysisRequestV1,
  type WeeklyAnalysisResponseV1,
} from "./weeklyAnalysisContract.ts";
import type {
  TaskV1,
  WeeklyConversationContentV1,
  WeeklyRecordV1,
} from "../weeklyData.ts";

export type BuildWeeklyAnalysisRequestInput = Readonly<{
  requestId: string;
  requestedAt: string;
  consentedAt: string;
  externalAnalysisConsent: boolean;
  record: WeeklyRecordV1;
  conversation: WeeklyConversationContentV1 | null;
  task: TaskV1 | null;
}>;

export class WeeklyAnalysisAdapterError extends Error {
  readonly code:
    | "CONSENT_REQUIRED"
    | "CONTENT_NOT_AVAILABLE"
    | "NOT_APPLICABLE"
    | "LINK_MISMATCH"
    | "STALE_CONVERSATION"
    | "EVIDENCE_MISMATCH";

  constructor(code: WeeklyAnalysisAdapterError["code"], message: string) {
    super(message);
    this.name = "WeeklyAnalysisAdapterError";
    this.code = code;
  }
}

/**
 * Builds a transport value only. This function never performs an HTTP request.
 * Manual notes and accounting data are deliberately not included.
 */
export function buildWeeklyAnalysisRequest(
  input: BuildWeeklyAnalysisRequestInput,
): WeeklyAnalysisRequestV1 {
  const { record, conversation, task } = input;
  if (!input.externalAnalysisConsent) {
    throw new WeeklyAnalysisAdapterError("CONSENT_REQUIRED", "外部AIへの送信には明示的な同意が必要です。");
  }
  if (record.analysisStatus === "not-applicable" || task?.plannedAiasLevel === 1) {
    throw new WeeklyAnalysisAdapterError("NOT_APPLICABLE", "AI不使用の活動は分析対象外です。");
  }
  if (record.privacy !== "full" || !conversation) {
    throw new WeeklyAnalysisAdapterError("CONTENT_NOT_AVAILABLE", "full以外の記録は会話本文を送信できません。");
  }
  assertRecordConversationLinks(record, conversation);
  if ((record.taskId === null) !== (task === null) || (task && task.id !== record.taskId)) {
    throw new WeeklyAnalysisAdapterError("LINK_MISMATCH", "課題と活動記録の関連付けが一致しません。");
  }
  return parseWeeklyAnalysisRequestV1({
    schemaVersion: 1,
    requestId: input.requestId,
    recordId: record.id,
    conversationId: conversation.id,
    thoughtReceiptId: record.links.thoughtReceiptId,
    conversationFingerprint: fingerprintConversation(conversation),
    requestedAt: input.requestedAt,
    consent: {
      externalAnalysisAllowed: true,
      privacy: "full",
      captureScope: conversation.captureScope,
      consentedAt: input.consentedAt,
    },
    taskContext: {
      taskId: task?.id ?? null,
      plannedAiasLevel: task?.plannedAiasLevel ?? null,
      activityCategory: record.activityCategory,
      expectedAiRole: task?.delegatedToAi ?? null,
    },
    messages: conversation.messages.map((message) => ({ role: message.role, text: message.text })),
  });
}

export function assertWeeklyAnalysisResponseLinks(
  response: WeeklyAnalysisResponseV1,
  record: WeeklyRecordV1,
  conversation: WeeklyConversationContentV1,
) {
  assertRecordConversationLinks(record, conversation);
  if (response.recordId !== record.id
    || response.conversationId !== conversation.id
    || response.thoughtReceiptId !== record.links.thoughtReceiptId) {
    throw new WeeklyAnalysisAdapterError("LINK_MISMATCH", "分析結果の活動・会話・思考レシートIDが一致しません。");
  }
  if (response.conversationFingerprint !== fingerprintConversation(conversation)) {
    throw new WeeklyAnalysisAdapterError("STALE_CONVERSATION", "分析後に会話内容が変更されています。");
  }
  for (const evidence of response.analysis?.evidence ?? []) {
    const message = conversation.messages[evidence.messageIndex];
    if (evidence.conversationId !== conversation.id || !message || !message.text.includes(evidence.quote)) {
      throw new WeeklyAnalysisAdapterError("EVIDENCE_MISMATCH", "分析根拠の会話箇所を確認できません。");
    }
  }
}

/** A revision marker, not a cryptographic proof or an authentication mechanism. */
export function fingerprintConversation(conversation: WeeklyConversationContentV1): string {
  const canonical = JSON.stringify({
    id: conversation.id,
    recordId: conversation.recordId,
    captureScope: conversation.captureScope,
    messages: conversation.messages.map(({ role, text }) => ({ role, text })),
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function assertRecordConversationLinks(
  record: WeeklyRecordV1,
  conversation: WeeklyConversationContentV1,
) {
  if (record.privacy !== "full" || record.links.conversationId !== conversation.id
    || conversation.recordId !== record.id) {
    throw new WeeklyAnalysisAdapterError("LINK_MISMATCH", "活動記録と会話の関連付けが一致しません。");
  }
}
