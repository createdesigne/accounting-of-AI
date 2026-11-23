import { useState } from "react";
import { useAiSettings } from "../AiSettings.tsx";
import { createAiClient } from "../aiClient.ts";
import type { GeminiApiMethod, WeeklyAnalysisRequestV1 } from "../integrations/weeklyAnalysisContract.ts";
import { createWeeklyAnalysisClient } from "../weeklyAnalysisClient.ts";
import {
  AI_FETCH_CREDENTIALS,
  AI_FETCH_REDIRECT,
  assertNotDeploymentAuthenticationResponse,
  DeploymentAuthenticationError,
} from "../aiTransport.ts";

const methods: readonly GeminiApiMethod[] = ["interactions", "generate-content"];
type CheckKind = "text" | "minimal-json" | "weekly-analysis";
type CheckResult = Readonly<{ status: "idle" | "running" | "success" | "failed"; detail: string }>;
type Results = Record<CheckKind, Record<GeminiApiMethod, CheckResult>>;
const idle = (): CheckResult => ({ status: "idle", detail: "未実行" });
const initialResults = (): Results => ({
  text: { interactions: idle(), "generate-content": idle() },
  "minimal-json": { interactions: idle(), "generate-content": idle() },
  "weekly-analysis": { interactions: idle(), "generate-content": idle() },
});

export function GeminiConnectionDiagnostics() {
  const { credentials } = useAiSettings();
  const [results, setResults] = useState<Results>(initialResults);
  const [running, setRunning] = useState<CheckKind | null>(null);
  const baseUrl = import.meta.env.VITE_AI_SERVER_URL?.trim() || "/api/ai";

  async function run(kind: CheckKind) {
    if (!credentials.apiKey || running) return;
    setRunning(kind);
    setResults(current => ({ ...current, [kind]: { interactions: { status: "running", detail: "実行中" }, "generate-content": { status: "running", detail: "実行中" } } }));
    const request = kind === "weekly-analysis" ? fakeAnalysisRequest() : null;
    const pairs = await Promise.all(methods.map(async method => [method, await execute(kind, method, request)] as const));
    setResults(current => ({ ...current, [kind]: Object.fromEntries(pairs) as Results[CheckKind] }));
    setRunning(null);
  }

  async function execute(kind: CheckKind, apiMethod: GeminiApiMethod, request: WeeklyAnalysisRequestV1 | null): Promise<CheckResult> {
    try {
      if (kind === "text") {
        await createAiClient({ baseUrl, ...credentials, apiMethod }).rewrite({
          text: "これは接続診断用の架空の文章です。",
          instruction: "意味を変えずに一文として整えてください。",
        });
        return { status: "success", detail: "通常文章生成に成功" };
      }
      if (kind === "minimal-json") {
        const response = await fetch(`${baseUrl.replace(/\/$/, "")}/test-structured`, {
          method: "POST", credentials: AI_FETCH_CREDENTIALS, redirect: AI_FETCH_REDIRECT, cache: "no-store",
          headers: {
            "Content-Type": "application/json", Authorization: `Bearer ${credentials.apiKey}`,
            "X-Gemini-Model": credentials.model, "X-Gemini-Api-Method": apiMethod,
          },
          body: JSON.stringify({ schemaVersion: 1 }),
        });
        assertNotDeploymentAuthenticationResponse(response);
        const value: unknown = await response.json();
        if (!response.ok) {
          const code = errorCode(value);
          throw new Error(response.status === 401
            ? `Gemini認証エラー: ${code}（HTTP 401、Vercel Preview認証とは別）`
            : `${code}（HTTP ${response.status}）`);
        }
        if (!isObject(value) || value.status !== "complete" || value.apiMethod !== apiMethod || value.model !== credentials.model) {
          throw new Error("INVALID_OUTPUT");
        }
        return { status: "success", detail: "最小JSON Schemaに成功" };
      }
      if (!request) throw new Error("INVALID_INPUT");
      const response = await createWeeklyAnalysisClient({ baseUrl, ...credentials, apiMethod }).analyze(request);
      if (response.analysisStatus === "failed") {
        const status = response.error?.providerHttpStatus ? ` HTTP ${response.error.providerHttpStatus}` : "";
        throw new Error(`${response.error?.code ?? "PROVIDER_ERROR"}${status}`);
      }
      return { status: "success", detail: response.analysisStatus === "partial" ? `研究分析に成功（一部未評価 ${response.unresolvedFields?.length ?? 0}項目）` : "架空会話の研究分析に成功" };
    } catch (error) {
      const detail = error instanceof DeploymentAuthenticationError
        ? "Vercel Preview認証が必要です。Previewを同じブラウザーで開いて認証後、再試行してください。"
        : error instanceof Error && error.message ? error.message : "PROVIDER_ERROR";
      return { status: "failed", detail: `失敗: ${detail.slice(0, 96)}` };
    }
  }

  return <section className="weekly-api-diagnostics" aria-labelledby="weekly-api-diagnostics-heading">
    <h4 id="weekly-api-diagnostics-heading">API方式の比較診断</h4>
    <p>同じモデル・同じ架空入力をInteractionsとGenerateContentへ別々に送ります。各操作は2回のAPI利用になります。結果は保存せず、自動切替もしません。</p>
    {([
      ["text", "通常文章生成"], ["minimal-json", "最小JSON構造化出力"], ["weekly-analysis", "研究用構造化分析（架空会話）"],
    ] as const).map(([kind, label]) => <div className="weekly-api-diagnostic-row" key={kind}>
      <div><strong>{label}</strong><button type="button" className="secondary-action" disabled={!credentials.apiKey || running !== null} onClick={() => void run(kind)}>{results[kind].interactions.status === "idle" && results[kind]["generate-content"].status === "idle" ? "比較する" : "明示的に再試行"}</button></div>
      <dl>{methods.map(method => <div key={method}><dt>{method === "interactions" ? "Interactions" : "GenerateContent"}</dt><dd data-status={results[kind][method].status}>{results[kind][method].detail}</dd></div>)}</dl>
    </div>)}
    {!credentials.apiKey && <p className="weekly-muted">先に「Gemini APIを設定」でキー・モデル・週次分析方式を設定してください。</p>}
  </section>;
}

function fakeAnalysisRequest(): WeeklyAnalysisRequestV1 {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    requestId: `diagnostic-${Date.now()}`,
    recordId: "diagnostic-record",
    conversationId: "diagnostic-conversation",
    thoughtReceiptId: "diagnostic-receipt",
    conversationFingerprint: "diagnostic-fingerprint-v1",
    requestedAt: now,
    consent: { externalAnalysisAllowed: true, privacy: "full", captureScope: "full", consentedAt: now },
    taskContext: { taskId: null, plannedAiasLevel: null, activityCategory: null, expectedAiRole: null },
    messages: [
      { role: "user", text: "案Aと案Bを比較し、根拠を確認してから自分で決めます。" },
      { role: "assistant", text: "比較軸を整理します。" },
    ],
  };
}

function isObject(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function errorCode(value: unknown) { return isObject(value) && isObject(value.error) && typeof value.error.code === "string" ? value.error.code : "PROVIDER_ERROR"; }
