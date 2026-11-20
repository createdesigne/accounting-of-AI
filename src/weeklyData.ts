import {
  createNotConnectedAnalysis,
  parseThoughtAnalysisV1,
  type AnalysisActivityCategory,
  type AnalysisStatus,
  type ThoughtAnalysisV1,
} from "./integrations/analysisContract.ts";
import { isWeeklyExpenseAccount, type WeeklyExpenseAccount } from "./weeklyAccountingTypes.ts";

export const WEEKLY_RECORD_SCHEMA_VERSION = 1 as const;

export type WeeklyTimeSource = "measured" | "manual" | "adjusted" | "unknown";
export type WeeklyAiService = "chatgpt" | "claude" | "gemini" | "other";
export type WeeklyPrivacy = "full" | "time-only";
export type WeeklyPrivacyChoice = WeeklyPrivacy | "off";
export type AccountingDisposition = "expense" | "asset" | "work-in-progress" | "unclassified";
export type ActivityCategorySource = "user-input" | "ai-analysis" | "unclassified";
export type WeeklyRecordOrigin = "user-input" | "extension-import";

export type WeeklyRecordLinksV1 = Readonly<{
  conversationId: string | null;
  usageId: string;
  thoughtReceiptId: string;
}>;

export type WeeklyManualNotesV1 = Readonly<{
  interactionSummary: string | null;
  ownThoughts: string | null;
  discovery: string | null;
}>;

export type WeeklyRecordV1 = Readonly<{
  schemaVersion: 1;
  id: string;
  /** Stable import-event ID. A repeated value must not create another record. */
  sourceEventId: string | null;
  origin: WeeklyRecordOrigin;
  sessionId: string | null;
  recordedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  activeSeconds: number;
  timeSource: WeeklyTimeSource;
  aiService: WeeklyAiService;
  privacy: WeeklyPrivacy;
  taskId: string | null;
  activityCategory: AnalysisActivityCategory;
  activityCategorySource: ActivityCategorySource;
  accountingDisposition: AccountingDisposition;
  /** Person-confirmed expense account. Missing on legacy records and null outside expense. */
  accountingAccount?: WeeklyExpenseAccount | null;
  analysisStatus: AnalysisStatus;
  analysis: ThoughtAnalysisV1;
  selfReflection: string | null;
  /** User-authored fields. They are never populated by an AI analysis. */
  manualNotes: WeeklyManualNotesV1 | null;
  links: WeeklyRecordLinksV1;
}>;

export type TaskV1 = Readonly<{
  schemaVersion: 1;
  id: string;
  title: string;
  goal: string | null;
  plannedAiasLevel: 1 | 2 | 3 | 4 | 5 | null;
  activityCategory: AnalysisActivityCategory;
  delegatedToAi: string | null;
  humanDecision: string | null;
  createdAt: string;
}>;

export type WeeklyTaskInput = Readonly<{
  id: string;
  title: string;
  goal?: string | null;
  plannedAiasLevel: 1 | 2 | 3 | 4 | 5 | null;
  activityCategory: AnalysisActivityCategory;
  delegatedToAi?: string | null;
  humanDecision?: string | null;
  createdAt: string;
}>;

export type ConversationMessageV1 = Readonly<{
  role: "user" | "assistant" | "system" | "unknown";
  text: string;
}>;

/** Stored only for records whose privacy is `full`. */
export type WeeklyConversationContentV1 = Readonly<{
  schemaVersion: 1;
  id: string;
  recordId: string;
  title: string | null;
  captureScope: "full" | "partial" | "unknown";
  messages: readonly ConversationMessageV1[];
  source: WeeklyRecordOrigin;
}>;

export type ManualWeeklyRecordInput = Readonly<{
  id: string;
  sourceEventId?: string | null;
  sessionId?: string | null;
  recordedAt: string;
  startedAt?: string | null;
  endedAt?: string | null;
  activeSeconds: number;
  timeSource?: "manual" | "adjusted";
  aiService: WeeklyAiService;
  privacy: WeeklyPrivacyChoice;
  taskId?: string | null;
  activityCategory: AnalysisActivityCategory;
  accountingDisposition: AccountingDisposition;
  accountingAccount?: WeeklyExpenseAccount | null;
  selfReflection?: string | null;
  /** False only for an activity configured before starting as no-AI use. */
  analysisApplicable?: boolean;
  manualNotes?: Readonly<{
    interactionSummary?: string | null;
    ownThoughts?: string | null;
    discovery?: string | null;
  }> | null;
  conversation?: Readonly<{
    id: string;
    title?: string | null;
    captureScope?: "full" | "partial" | "unknown";
    messages: readonly ConversationMessageV1[];
  }> | null;
}>;

/** A measured activity confirmed by the person after an extension import. */
export type ExtensionWeeklyRecordInput = Readonly<{
  id: string;
  sourceEventId: string;
  /** The finalized Chrome time-record id selected by the person. */
  measurementRecordId: string;
  usageId: string;
  recordedAt: string;
  startedAt: string;
  endedAt: string;
  activeSeconds: number;
  aiService: WeeklyAiService;
  privacy: WeeklyPrivacy;
  taskId?: string | null;
  activityCategory: AnalysisActivityCategory;
  accountingDisposition: AccountingDisposition;
  accountingAccount?: WeeklyExpenseAccount | null;
  selfReflection?: string | null;
  manualNotes?: ManualWeeklyRecordInput["manualNotes"];
  conversation?: NonNullable<ManualWeeklyRecordInput["conversation"]> | null;
}>;

export type BuiltManualWeeklyRecord = Readonly<{
  record: WeeklyRecordV1;
  conversation: WeeklyConversationContentV1 | null;
}>;

export class WeeklyDataValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeeklyDataValidationError";
  }
}

export function buildManualWeeklyRecord(input: ManualWeeklyRecordInput): BuiltManualWeeklyRecord {
  requireIdentifier(input.id, "id");
  requireOptionalIdentifier(input.sourceEventId, "sourceEventId");
  requireOptionalIdentifier(input.sessionId, "sessionId");
  requireOptionalIdentifier(input.taskId, "taskId");
  requireTimestamp(input.recordedAt, "recordedAt");
  requireOptionalTimestamp(input.startedAt, "startedAt");
  requireOptionalTimestamp(input.endedAt, "endedAt");
  requireSeconds(input.activeSeconds);
  if (!isOneOf(input.timeSource ?? "manual", ["manual", "adjusted"])) invalid("timeSource is invalid.");
  if (!isOneOf(input.aiService, ["chatgpt", "claude", "gemini", "other"])) invalid("aiService is invalid.");
  if (!isOneOf(input.privacy, ["full", "time-only", "off"])) invalid("privacy is invalid.");
  if (!isActivityCategory(input.activityCategory)) invalid("activityCategory is invalid.");
  if (!isOneOf(input.accountingDisposition, ["expense", "asset", "work-in-progress", "unclassified"])) {
    invalid("accountingDisposition is invalid.");
  }
  if (input.accountingDisposition === "expense" && input.activityCategory === null) {
    invalid("An expense record requires an activity category.");
  }
  if (input.privacy === "off") {
    throw new WeeklyDataValidationError("off records must not be built for persistent storage.");
  }
  if (input.startedAt && input.endedAt
    && new Date(input.endedAt).getTime() <= new Date(input.startedAt).getTime()) {
    throw new WeeklyDataValidationError("endedAt must be after startedAt.");
  }
  const accountingAccount = normalizeAccountingAccount(
    input.accountingDisposition,
    input.activityCategory,
    input.accountingAccount,
  );
  requireNullableText(input.selfReflection, "selfReflection");

  const conversationId = input.privacy === "full" && input.conversation
    ? requireIdentifier(input.conversation.id, "conversation.id")
    : null;
  const analysis = input.analysisApplicable === false
    ? Object.freeze({ ...createNotConnectedAnalysis(input.id), analysisStatus: "not-applicable" as const })
    : createNotConnectedAnalysis(input.id);
  const record: WeeklyRecordV1 = Object.freeze({
    schemaVersion: WEEKLY_RECORD_SCHEMA_VERSION,
    id: input.id,
    sourceEventId: input.sourceEventId ?? null,
    origin: "user-input",
    sessionId: input.sessionId ?? null,
    recordedAt: new Date(input.recordedAt).toISOString(),
    startedAt: input.startedAt ? new Date(input.startedAt).toISOString() : null,
    endedAt: input.endedAt ? new Date(input.endedAt).toISOString() : null,
    activeSeconds: input.activeSeconds,
    timeSource: input.timeSource ?? "manual",
    aiService: input.aiService,
    privacy: input.privacy,
    taskId: input.taskId ?? null,
    activityCategory: input.activityCategory,
    activityCategorySource: input.activityCategory === null ? "unclassified" : "user-input",
    accountingDisposition: input.accountingDisposition,
    accountingAccount,
    analysisStatus: analysis.analysisStatus,
    analysis,
    selfReflection: normalizeNullableText(input.selfReflection),
    manualNotes: input.manualNotes ? Object.freeze({
      interactionSummary: normalizeNullableText(input.manualNotes.interactionSummary),
      ownThoughts: normalizeNullableText(input.manualNotes.ownThoughts),
      discovery: normalizeNullableText(input.manualNotes.discovery),
    }) : null,
    links: Object.freeze({
      conversationId,
      usageId: `${input.id}:usage`,
      thoughtReceiptId: `${input.id}:receipt`,
    }),
  });
  const conversation = conversationId && input.conversation
    ? freezeConversation({
      schemaVersion: WEEKLY_RECORD_SCHEMA_VERSION,
      id: conversationId,
      recordId: input.id,
      title: normalizeNullableText(input.conversation.title),
      captureScope: input.conversation.captureScope ?? "unknown",
      messages: input.conversation.messages,
      source: "user-input",
    })
    : null;
  return Object.freeze({ record, conversation });
}

export function buildExtensionWeeklyRecord(input: ExtensionWeeklyRecordInput): BuiltManualWeeklyRecord {
  requireIdentifier(input.id, "id");
  requireIdentifier(input.sourceEventId, "sourceEventId");
  requireIdentifier(input.measurementRecordId, "measurementRecordId");
  requireIdentifier(input.usageId, "usageId");
  requireOptionalIdentifier(input.taskId, "taskId");
  requireTimestamp(input.recordedAt, "recordedAt");
  requireTimestamp(input.startedAt, "startedAt");
  requireTimestamp(input.endedAt, "endedAt");
  requireSeconds(input.activeSeconds);
  if (input.activeSeconds === 0) invalid("A measured extension activity requires positive seconds.");
  if (new Date(input.endedAt).getTime() <= new Date(input.startedAt).getTime()) {
    invalid("endedAt must be after startedAt.");
  }
  if (!isOneOf(input.aiService, ["chatgpt", "claude", "gemini", "other"])) invalid("aiService is invalid.");
  if (!isOneOf(input.privacy, ["full", "time-only"])) invalid("privacy is invalid.");
  if (!isActivityCategory(input.activityCategory)) invalid("activityCategory is invalid.");
  if (!isOneOf(input.accountingDisposition, ["expense", "asset", "work-in-progress", "unclassified"])) {
    invalid("accountingDisposition is invalid.");
  }
  if (input.accountingDisposition === "expense" && input.activityCategory === null) {
    invalid("An expense record requires an activity category.");
  }
  const accountingAccount = normalizeAccountingAccount(
    input.accountingDisposition,
    input.activityCategory,
    input.accountingAccount,
  );
  if (input.privacy === "full" && !input.conversation) {
    invalid("A full extension import requires conversation content.");
  }
  requireNullableText(input.selfReflection, "selfReflection");

  const conversationId = input.privacy === "full" && input.conversation
    ? requireIdentifier(input.conversation.id, "conversation.id")
    : null;
  const analysis = createNotConnectedAnalysis(input.id);
  const record: WeeklyRecordV1 = Object.freeze({
    schemaVersion: WEEKLY_RECORD_SCHEMA_VERSION,
    id: input.id,
    sourceEventId: input.sourceEventId,
    origin: "extension-import",
    sessionId: input.measurementRecordId,
    recordedAt: new Date(input.recordedAt).toISOString(),
    startedAt: new Date(input.startedAt).toISOString(),
    endedAt: new Date(input.endedAt).toISOString(),
    activeSeconds: input.activeSeconds,
    timeSource: "measured",
    aiService: input.aiService,
    privacy: input.privacy,
    taskId: input.taskId ?? null,
    activityCategory: input.activityCategory,
    activityCategorySource: input.activityCategory === null ? "unclassified" : "user-input",
    accountingDisposition: input.accountingDisposition,
    accountingAccount,
    analysisStatus: analysis.analysisStatus,
    analysis,
    selfReflection: normalizeNullableText(input.selfReflection),
    manualNotes: input.manualNotes ? Object.freeze({
      interactionSummary: normalizeNullableText(input.manualNotes.interactionSummary),
      ownThoughts: normalizeNullableText(input.manualNotes.ownThoughts),
      discovery: normalizeNullableText(input.manualNotes.discovery),
    }) : null,
    links: Object.freeze({
      conversationId,
      usageId: input.usageId,
      thoughtReceiptId: `${input.id}:receipt`,
    }),
  });
  const conversation = conversationId && input.conversation
    ? freezeConversation({
      schemaVersion: WEEKLY_RECORD_SCHEMA_VERSION,
      id: conversationId,
      recordId: input.id,
      title: normalizeNullableText(input.conversation.title),
      captureScope: input.conversation.captureScope ?? "unknown",
      messages: input.conversation.messages,
      source: "extension-import",
    })
    : null;
  return Object.freeze({ record, conversation });
}

export function buildWeeklyTask(input: WeeklyTaskInput): TaskV1 {
  requireIdentifier(input.id, "task.id");
  requireTimestamp(input.createdAt, "task.createdAt");
  if (!input.title.trim()) invalid("task.title is required.");
  if (input.plannedAiasLevel !== null && ![1, 2, 3, 4, 5].includes(input.plannedAiasLevel)) {
    invalid("task.plannedAiasLevel is invalid.");
  }
  if (!isActivityCategory(input.activityCategory)) invalid("task.activityCategory is invalid.");
  requireNullableText(input.goal, "task.goal");
  requireNullableText(input.delegatedToAi, "task.delegatedToAi");
  requireNullableText(input.humanDecision, "task.humanDecision");
  return Object.freeze({
    schemaVersion: WEEKLY_RECORD_SCHEMA_VERSION,
    id: input.id,
    title: input.title.trim(),
    goal: normalizeNullableText(input.goal),
    plannedAiasLevel: input.plannedAiasLevel,
    activityCategory: input.activityCategory,
    delegatedToAi: normalizeNullableText(input.delegatedToAi),
    humanDecision: normalizeNullableText(input.humanDecision),
    createdAt: new Date(input.createdAt).toISOString(),
  });
}

export function parseWeeklyRecord(value: unknown): WeeklyRecordV1 {
  if (!isObject(value) || value.schemaVersion !== 1) invalid("Weekly record schema is not supported.");
  requireIdentifier(value.id, "id");
  requireOptionalIdentifier(value.sourceEventId, "sourceEventId");
  requireOptionalIdentifier(value.sessionId, "sessionId");
  if (value.origin !== "user-input" && value.origin !== "extension-import") invalid("origin is invalid.");
  requireTimestamp(value.recordedAt, "recordedAt");
  requireOptionalTimestamp(value.startedAt, "startedAt");
  requireOptionalTimestamp(value.endedAt, "endedAt");
  requireSeconds(value.activeSeconds);
  if (!isOneOf(value.timeSource, ["measured", "manual", "adjusted", "unknown"])) invalid("timeSource is invalid.");
  if (!isOneOf(value.aiService, ["chatgpt", "claude", "gemini", "other"])) invalid("aiService is invalid.");
  if (!isOneOf(value.privacy, ["full", "time-only"])) invalid("privacy is invalid.");
  requireOptionalIdentifier(value.taskId, "taskId");
  if (!isActivityCategory(value.activityCategory)) invalid("activityCategory is invalid.");
  if (!isOneOf(value.activityCategorySource, ["user-input", "ai-analysis", "unclassified"])) invalid("activityCategorySource is invalid.");
  if (!isOneOf(value.accountingDisposition, ["expense", "asset", "work-in-progress", "unclassified"])) invalid("accountingDisposition is invalid.");
  const accountingAccount = normalizeAccountingAccount(
    value.accountingDisposition,
    value.activityCategory,
    value.accountingAccount as WeeklyExpenseAccount | null | undefined,
  );
  if (!isOneOf(value.analysisStatus, ["not-connected", "pending", "complete", "failed", "not-applicable"])) invalid("analysisStatus is invalid.");
  requireNullableText(value.selfReflection, "selfReflection");
  const manualNotes = parseManualNotes(value.manualNotes);
  let analysis: ThoughtAnalysisV1;
  try { analysis = parseThoughtAnalysisV1(value.analysis); } catch { return invalid("analysis is invalid."); }
  if (analysis.recordId !== value.id || analysis.analysisStatus !== value.analysisStatus) invalid("analysis link is invalid.");
  if (!isObject(value.links)) invalid("links are invalid.");
  requireOptionalIdentifier(value.links.conversationId, "links.conversationId");
  requireIdentifier(value.links.usageId, "links.usageId");
  requireIdentifier(value.links.thoughtReceiptId, "links.thoughtReceiptId");
  return Object.freeze({
    ...(value as unknown as WeeklyRecordV1),
    accountingAccount,
    manualNotes,
  });
}

export function withWeeklyRecordAccounting(
  record: WeeklyRecordV1,
  accountingDisposition: AccountingDisposition,
  accountingAccount: WeeklyExpenseAccount | null,
): WeeklyRecordV1 {
  return parseWeeklyRecord({ ...record, accountingDisposition, accountingAccount });
}

export function defaultExpenseAccountForCategory(
  category: AnalysisActivityCategory,
): WeeklyExpenseAccount | null {
  if (category === null) return null;
  return ({
    "相談": "相談活動費",
    "壁打ち": "思考探究費",
    "文章作成": "成果物利用費",
    "情報収集": "情報収集費",
    "学習": "学習活動費",
    "その他": "その他AI利用費",
  } as const)[category];
}

export function parseConversationContent(value: unknown): WeeklyConversationContentV1 {
  if (!isObject(value) || value.schemaVersion !== 1) invalid("Conversation schema is not supported.");
  requireIdentifier(value.id, "conversation.id");
  requireIdentifier(value.recordId, "conversation.recordId");
  requireNullableText(value.title, "conversation.title");
  if (!isOneOf(value.captureScope, ["full", "partial", "unknown"])) invalid("captureScope is invalid.");
  if (!isOneOf(value.source, ["user-input", "extension-import"])) invalid("conversation source is invalid.");
  if (!Array.isArray(value.messages)) invalid("messages must be an array.");
  return freezeConversation(value as unknown as WeeklyConversationContentV1);
}

function freezeConversation(value: WeeklyConversationContentV1): WeeklyConversationContentV1 {
  const messages = value.messages.map((message) => {
    if (!isObject(message) || !isOneOf(message.role, ["user", "assistant", "system", "unknown"])
      || typeof message.text !== "string") invalid("A conversation message is invalid.");
    return Object.freeze({ role: message.role, text: message.text });
  });
  return Object.freeze({ ...value, messages: Object.freeze(messages) });
}

function parseManualNotes(value: unknown): WeeklyManualNotesV1 | null {
  if (value === undefined || value === null) return null;
  if (!isObject(value)) invalid("manualNotes is invalid.");
  requireNullableText(value.interactionSummary, "manualNotes.interactionSummary");
  requireNullableText(value.ownThoughts, "manualNotes.ownThoughts");
  requireNullableText(value.discovery, "manualNotes.discovery");
  return Object.freeze({
    interactionSummary: normalizeNullableText(value.interactionSummary as string | null | undefined),
    ownThoughts: normalizeNullableText(value.ownThoughts as string | null | undefined),
    discovery: normalizeNullableText(value.discovery as string | null | undefined),
  });
}

function isActivityCategory(value: unknown): value is AnalysisActivityCategory {
  return value === null || isOneOf(value, ["相談", "壁打ち", "文章作成", "情報収集", "学習", "その他"]);
}

function normalizeAccountingAccount(
  disposition: AccountingDisposition,
  category: AnalysisActivityCategory,
  account: WeeklyExpenseAccount | null | undefined,
): WeeklyExpenseAccount | null {
  if (disposition !== "expense") {
    if (account !== undefined && account !== null) invalid("Only an expense record may have an expense account.");
    return null;
  }
  if (account !== undefined && account !== null) {
    if (!isWeeklyExpenseAccount(account)) invalid("accountingAccount is invalid.");
    return account;
  }
  const fallback = defaultExpenseAccountForCategory(category);
  if (fallback === null) invalid("An expense record requires an expense account.");
  return fallback;
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function requireSeconds(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid("activeSeconds must be a non-negative integer.");
}

function requireTimestamp(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !value.trim() || Number.isNaN(new Date(value).getTime())) invalid(`${field} is invalid.`);
}

function requireOptionalTimestamp(value: unknown, field: string): void {
  if (value !== undefined && value !== null) requireTimestamp(value, field);
}

function requireIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200) invalid(`${field} is invalid.`);
  return value;
}

function requireOptionalIdentifier(value: unknown, field: string): void {
  if (value !== undefined && value !== null) requireIdentifier(value, field);
}

function requireNullableText(value: unknown, field: string): void {
  if (value !== undefined && value !== null && typeof value !== "string") invalid(`${field} is invalid.`);
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalid(message: string): never {
  throw new WeeklyDataValidationError(message);
}
