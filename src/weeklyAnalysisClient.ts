import {
  parseWeeklyAnalysisRequestV1,
  parseWeeklyAnalysisResponseV1,
  type WeeklyAnalysisErrorCode,
  type GeminiApiMethod,
  type WeeklyAnalysisRequestV1,
  type WeeklyAnalysisResponseV1,
} from "./integrations/weeklyAnalysisContract.ts";
import { WEEKLY_ANALYSIS_RUBRIC_VERSION } from "./integrations/weeklyAnalysisRubric.ts";
import {
  AI_FETCH_CREDENTIALS,
  AI_FETCH_REDIRECT,
  assertNotDeploymentAuthenticationResponse,
  DeploymentAuthenticationError,
} from "./aiTransport.ts";

const messages = {
  API_KEY_REQUIRED: "AI設定からGemini APIキーを入力してください。",
  INVALID_CREDENTIALS: "AI設定のAPIキーとモデルを確認してください。",
  INVALID_INPUT: "分析対象の会話と同意内容を確認してください。",
  TOO_LARGE: "会話が長すぎます。送信範囲を短くしてください。",
  FORBIDDEN: "この画面からの分析接続が許可されていません。",
  BUSY: "分析が混み合っています。少し待ってから再実行してください。",
  RATE_LIMITED: "Geminiの利用上限に達しました。時間を置いて確認してください。",
  AUTH_ERROR: "Geminiのキーまたは利用権限を確認してください。",
  MODEL_UNAVAILABLE: "設定されたGeminiモデルを利用できません。",
  CONTENT_BLOCKED: "Geminiがこの会話の分析を停止しました。",
  INVALID_OUTPUT: "構造化分析の形式または根拠を確認できませんでした。",
  PROVIDER_ERROR: "分析サービスに接続できませんでした。本人入力と会計データは変更されていません。",
  TIMEOUT: "分析の応答待ちが時間切れになりました。",
  CANCELLED: "分析を中止しました。",
  PREVIEW_AUTH_REQUIRED: "Vercel Previewへのログインが必要です。同じブラウザーでPreviewを開いて認証し、再試行してください。",
} as const;

export type WeeklyAnalysisClientErrorCode = keyof typeof messages;

export class WeeklyAnalysisClientError extends Error {
  readonly code: WeeklyAnalysisClientErrorCode;
  constructor(code: WeeklyAnalysisClientErrorCode) {
    super(messages[code]);
    this.name = "WeeklyAnalysisClientError";
    this.code = code;
  }
}

export function createWeeklyAnalysisClient({
  baseUrl = "",
  apiKey = "",
  model = "gemini-3.5-flash-lite",
  apiMethod = "interactions",
  fetchImpl = fetch,
  timeoutMs = 20_000,
}: {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  apiMethod?: GeminiApiMethod;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
} = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error("Invalid timeout");
  validateBaseUrl(baseUrl);
  return {
    async analyze(input: WeeklyAnalysisRequestV1, { signal }: { signal?: AbortSignal } = {}): Promise<WeeklyAnalysisResponseV1> {
      if (!baseUrl) throw new WeeklyAnalysisClientError("PROVIDER_ERROR");
      if (!apiKey) throw new WeeklyAnalysisClientError("API_KEY_REQUIRED");
      if (!/^[\x21-\x7e]{1,512}$/.test(apiKey) || !/^gemini-[a-zA-Z0-9._-]{1,120}$/.test(model)
        || !["interactions", "generate-content"].includes(apiMethod)) {
        throw new WeeklyAnalysisClientError("INVALID_CREDENTIALS");
      }
      let request: WeeklyAnalysisRequestV1;
      try { request = parseWeeklyAnalysisRequestV1(input); }
      catch { throw new WeeklyAnalysisClientError("INVALID_INPUT"); }
      if (signal?.aborted) throw new WeeklyAnalysisClientError("CANCELLED");
      const controller = new AbortController();
      let timedOut = false;
      const cancel = () => controller.abort();
      signal?.addEventListener("abort", cancel, { once: true });
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      try {
        const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/analyze-weekly`, {
          method: "POST",
          credentials: AI_FETCH_CREDENTIALS,
          redirect: AI_FETCH_REDIRECT,
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "X-Gemini-Model": model,
            "X-Gemini-Api-Method": apiMethod,
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
        assertNotDeploymentAuthenticationResponse(response);
        let value: unknown;
        try { value = await response.json(); }
        catch { throw new WeeklyAnalysisClientError("INVALID_OUTPUT"); }
        if (!response.ok) {
          const code = isObject(value) && isObject(value.error) && typeof value.error.code === "string"
            && Object.prototype.hasOwnProperty.call(messages, value.error.code)
            ? value.error.code as WeeklyAnalysisClientErrorCode
            : "PROVIDER_ERROR";
          throw new WeeklyAnalysisClientError(code);
        }
        try { return parseWeeklyAnalysisResponseV1(value); }
        catch { throw new WeeklyAnalysisClientError("INVALID_OUTPUT"); }
      } catch (error) {
        if (controller.signal.aborted) throw new WeeklyAnalysisClientError(timedOut ? "TIMEOUT" : "CANCELLED");
        if (error instanceof WeeklyAnalysisClientError) throw error;
        if (error instanceof DeploymentAuthenticationError) throw new WeeklyAnalysisClientError("PREVIEW_AUTH_REQUIRED");
        throw new WeeklyAnalysisClientError("PROVIDER_ERROR");
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
      }
    },
  };
}

export function createClientFailureResponse(
  request: WeeklyAnalysisRequestV1,
  error: WeeklyAnalysisClientError,
  model: string,
  now = new Date(),
  apiMethod: GeminiApiMethod = "interactions",
): WeeklyAnalysisResponseV1 {
  const code = mapFailureCode(error.code);
  return parseWeeklyAnalysisResponseV1({
    schemaVersion: 1,
    analysisId: `client-failure:${request.requestId}`,
    requestId: request.requestId,
    recordId: request.recordId,
    conversationId: request.conversationId,
    thoughtReceiptId: request.thoughtReceiptId,
    conversationFingerprint: request.conversationFingerprint,
    origin: "gemini-api",
    analysisStatus: "failed",
    receivedAt: now.toISOString(),
    model,
    apiMethod,
    rubricVersion: WEEKLY_ANALYSIS_RUBRIC_VERSION,
    analyzedAt: now.toISOString(),
    analysis: null,
    unresolvedFields: [],
    error: { code, retryable: ["RATE_LIMITED", "MODEL_UNAVAILABLE", "TIMEOUT", "PROVIDER_ERROR"].includes(code) },
  });
}

function mapFailureCode(code: WeeklyAnalysisClientErrorCode): WeeklyAnalysisErrorCode {
  if (code === "API_KEY_REQUIRED" || code === "INVALID_CREDENTIALS" || code === "AUTH_ERROR" || code === "PREVIEW_AUTH_REQUIRED") return "NOT_AUTHENTICATED";
  if (code === "FORBIDDEN") return "NOT_AUTHORIZED";
  if (code === "BUSY") return "RATE_LIMITED";
  if (code === "CANCELLED") return "PROVIDER_ERROR";
  return code;
}

function validateBaseUrl(baseUrl: string) {
  if (!baseUrl) return;
  const url = new URL(baseUrl, "https://local.invalid");
  if (baseUrl !== baseUrl.trim() || baseUrl.includes("\\") || baseUrl.startsWith("//") || url.username || url.password || url.search || url.hash
    || (!baseUrl.startsWith("/") && !/^https?:\/\//.test(baseUrl))
    || (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)))) {
    throw new Error("Invalid AI server URL");
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
