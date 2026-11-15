import { useEffect, useState, type FormEvent } from "react";
import { useAiSettings } from "../AiSettings.tsx";
import { buildWeeklyAnalysisRequest } from "../integrations/weeklyAnalysisAdapter.ts";
import type { AnalysisActivityCategory, AnalysisScore } from "../integrations/analysisContract.ts";
import type {
  WeeklyAnalysisAccountCandidate,
  WeeklyAnalysisDispositionCandidate,
} from "../integrations/weeklyAnalysisContract.ts";
import { WEEKLY_ANALYSIS_RUBRIC_VERSION } from "../integrations/weeklyAnalysisRubric.ts";
import type { TaskV1, WeeklyConversationContentV1, WeeklyRecordV1 } from "../weeklyData.ts";
import {
  acceptWeeklyAnalysisResponse,
  queueWeeklyAnalysisRequest,
  type WeeklyAnalysisDisplayState,
} from "../weeklyAnalysisStore.ts";
import {
  createClientFailureResponse,
  createWeeklyAnalysisClient,
  WeeklyAnalysisClientError,
} from "../weeklyAnalysisClient.ts";
import {
  saveWeeklyAnalysisReview,
  type WeeklyAnalysisReviewFieldsV1,
  type WeeklyAnalysisReviewV1,
} from "../weeklyAnalysisReviewStore.ts";

const categories = ["相談", "壁打ち", "文章作成", "情報収集", "学習", "その他"] as const;
const accounts = ["相談活動費", "思考探究費", "成果物利用費", "情報収集費", "学習活動費", "その他AI利用費"] as const;

type Props = Readonly<{
  record: WeeklyRecordV1;
  task: TaskV1 | null;
  conversation: WeeklyConversationContentV1 | null;
  state: WeeklyAnalysisDisplayState;
  noAi: boolean;
  review: WeeklyAnalysisReviewV1 | null;
  onChanged: () => void;
}>;

export function WeeklyAnalysisPanel({ record, task, conversation, state, noAi, review, onChanged }: Props) {
  const { credentials } = useAiSettings();
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const response = state.response;
  const analysis = response?.analysis ?? null;
  const [draft, setDraft] = useState<WeeklyAnalysisReviewFieldsV1>(() => reviewFields(review, analysis));

  useEffect(() => {
    setDraft(reviewFields(review, analysis));
  }, [review, response?.analysisId]);

  if (noAi || state.analysisStatus === "not-applicable") {
    return <div className="weekly-analysis-state compact not-applicable"><strong>AI分析：対象外</strong><span>Level 1として事前設定されたAI不使用課題です。</span></div>;
  }

  const unavailable = record.privacy !== "full" || !conversation;
  const pending = state.analysisStatus === "pending";
  const sourceLabel = response?.origin === "test-fixture"
    ? "テスト用分析（実際のGemini分析ではありません）"
    : "Gemini構造化分析";

  async function analyze() {
    setMessage("");
    if (!consented) { setMessage("会話本文の外部送信に同意してから実行してください。"); return; }
    if (!conversation || unavailable) { setMessage("fullで保存された会話本文がないため分析できません。"); return; }
    const now = new Date();
    const requestId = createId("analysis-request");
    let request: ReturnType<typeof buildWeeklyAnalysisRequest> | null = null;
    let queued = false;
    setBusy(true);
    try {
      request = buildWeeklyAnalysisRequest({
        requestId,
        requestedAt: now.toISOString(),
        consentedAt: now.toISOString(),
        externalAnalysisConsent: true,
        record,
        conversation,
        task,
      });
      await queueWeeklyAnalysisRequest(request);
      queued = true;
      onChanged();
      const baseUrl = import.meta.env.VITE_AI_SERVER_URL?.trim() || "/api/ai";
      const result = await createWeeklyAnalysisClient({ baseUrl, ...credentials }).analyze(request);
      await acceptWeeklyAnalysisResponse(result);
      setConsented(false);
      setMessage(result.analysisStatus === "complete" ? "分析結果を受信しました。本人入力と会計データは変更していません。" : "分析に失敗しました。手入力と週次決算はそのまま利用できます。");
    } catch (error) {
      if (request && queued) {
        const clientError = error instanceof WeeklyAnalysisClientError
          ? error
          : new WeeklyAnalysisClientError("INVALID_OUTPUT");
        try { await acceptWeeklyAnalysisResponse(createClientFailureResponse(request, clientError, credentials.model)); }
        catch { /* Keep the original error and never mutate the weekly record. */ }
      }
      setMessage(error instanceof Error ? error.message : "分析を実行できませんでした。本人入力と会計データは変更していません。");
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  async function saveReview(event: FormEvent) {
    event.preventDefault();
    if (!response?.analysis || response.analysisStatus !== "complete") return;
    setBusy(true);
    setMessage("");
    try {
      await saveWeeklyAnalysisReview({
        schemaVersion: 1,
        analysisId: response.analysisId,
        recordId: record.id,
        thoughtReceiptId: record.links.thoughtReceiptId,
        reviewedAt: new Date().toISOString(),
        fields: draft,
      });
      setMessage("本人の確認・修正内容をAI分析とは別に保存しました。");
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "本人確認内容を保存できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  return <div className={`weekly-analysis-state compact${state.analysisStatus === "complete" ? " complete" : state.analysisStatus === "failed" ? " failed" : ""}${response?.origin === "test-fixture" ? " fixture" : ""}`}>
    <strong>思考レシート分析：{statusLabel(state.analysisStatus)}</strong>
    <span>思考レシートID：{record.links.thoughtReceiptId}</span>
    <span>AIAS Levelは活動前の役割設定です。以下はAIAS公式評価ではなく、会話内の行動を対象にした研究独自分析です。</span>
    <span>適用する評価基準：{WEEKLY_ANALYSIS_RUBRIC_VERSION}</span>

    {state.analysisStatus === "not-connected" && <span>評価値：— / — / —（根拠不足はnullであり、0点ではありません）</span>}
    {pending && <span>分析待ちです。本人入力と会計データは変更しません。</span>}
    {unavailable ? <p className="weekly-analysis-warning">保存範囲がfullの会話本文がないため、外部分析は実行できません。</p> : <>
      <label className="weekly-analysis-consent"><input type="checkbox" checked={consented} disabled={busy || pending} onChange={(event) => setConsented(event.target.checked)} />
        <span>この活動の保存済み会話本文を、設定中のGeminiモデルへ今回だけ送信することに同意します。</span>
      </label>
      <button className="secondary-action weekly-analysis-run" type="button" disabled={busy || pending || !consented || !credentials.apiKey} onClick={() => void analyze()}>
        {busy ? "処理中…" : state.analysisStatus === "complete" ? "Geminiで再分析" : "Geminiで構造化分析"}
      </button>
      {!credentials.apiKey && <span>実行前に画面上部のAI設定でAPIキーを設定してください。キーは保存されません。</span>}
    </>}

    {state.analysisStatus === "failed" && <span>{sourceLabel}：{response?.error?.code ?? "INVALID_OUTPUT"}。手入力の記録・仕訳・決算は利用できます。</span>}
    {analysis && response && <>
      <div className="weekly-analysis-metadata">
        <b>{sourceLabel}</b>
        <span>モデル：{response.model ?? "旧テスト形式"}</span>
        <span>基準版：{response.rubricVersion ?? "legacy-v1"}</span>
        <span>分析日時：{formatDateTime(response.analyzedAt ?? response.receivedAt)}</span>
      </div>
      <dl className="weekly-analysis-details">
        <Row label="活動テーマ候補" value={analysis.activityCategory ?? "判定不可"} />
        <Row label="勘定科目候補" value={analysis.accountCandidate ?? "判定不可"} />
        <Row label="会計区分候補" value={dispositionLabel(analysis.accountingDispositionCandidate)} />
        <Row label="実際のAIの役割" value={analysis.aiRole ?? "判定不可"} />
        <Row label="協働行動" value={analysis.collaborationBehaviors?.map((item) => item.description).join("／") || "判定不可"} />
        <Row label="研究指標" value={`自発性 ${scoreLabel(analysis.initiative)}／論理性 ${scoreLabel(analysis.reasoning)}／批判的判断 ${scoreLabel(analysis.criticalJudgment)}`} />
        <Row label="思考の変化" value={analysis.thinkingChange ?? "判定不可"} />
        <Row label="発見・学び" value={analysis.discovery ?? "判定不可"} />
      </dl>
      <p className="weekly-analysis-advisory">活動テーマ・勘定科目・会計区分は候補です。保存済み活動、利用時間、仕訳、週次決算には自動反映しません。</p>
      {analysis.evidence.length > 0 && <div className="weekly-analysis-evidence"><b>分析根拠となる会話箇所</b><ul>{analysis.evidence.map((evidence, index) => <li key={`${evidence.target}:${evidence.messageIndex}:${index}`}>会話 {evidence.messageIndex + 1}：「{evidence.quote}」</li>)}</ul></div>}

      <details className="weekly-analysis-review" open={!!review}>
        <summary>本人が確認・修正する</summary>
        <form onSubmit={saveReview}>
          <div className="weekly-form-grid">
            <label>確認後の活動テーマ<select value={draft.activityCategory ?? ""} onChange={(event) => setDraft({ ...draft, activityCategory: nullableCategory(event.target.value) })}><option value="">判定不可</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>確認後の勘定科目候補<select value={draft.accountCandidate ?? ""} onChange={(event) => setDraft({ ...draft, accountCandidate: nullableAccount(event.target.value) })}><option value="">判定不可</option>{accounts.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>確認後の会計区分候補<select value={draft.accountingDispositionCandidate ?? ""} onChange={(event) => setDraft({ ...draft, accountingDispositionCandidate: nullableDisposition(event.target.value) })}><option value="">判定不可</option><option value="expense">費用</option><option value="asset">成果物資産</option><option value="work-in-progress">仕掛成果物</option><option value="unclassified">未分類</option></select></label>
            <label>実際のAIの役割<input value={draft.aiRole ?? ""} onChange={(event) => setDraft({ ...draft, aiRole: event.target.value || null })} /></label>
          </div>
          <label>協働行動<textarea value={draft.collaborationSummary ?? ""} onChange={(event) => setDraft({ ...draft, collaborationSummary: event.target.value || null })} /></label>
          <div className="weekly-form-grid">
            <ScoreSelect label="自発性" value={draft.initiative} onChange={(value) => setDraft({ ...draft, initiative: value })} />
            <ScoreSelect label="論理性" value={draft.reasoning} onChange={(value) => setDraft({ ...draft, reasoning: value })} />
            <ScoreSelect label="批判的判断" value={draft.criticalJudgment} onChange={(value) => setDraft({ ...draft, criticalJudgment: value })} />
          </div>
          <label>思考の変化<textarea value={draft.thinkingChange ?? ""} onChange={(event) => setDraft({ ...draft, thinkingChange: event.target.value || null })} /></label>
          <label>発見・学び<textarea value={draft.discovery ?? ""} onChange={(event) => setDraft({ ...draft, discovery: event.target.value || null })} /></label>
          <label>本人確認メモ<textarea value={draft.reviewerNote ?? ""} onChange={(event) => setDraft({ ...draft, reviewerNote: event.target.value || null })} placeholder="AI分析を修正した理由や、確認した根拠" /></label>
          <button className="secondary-action" type="submit" disabled={busy}>本人の確認内容を別保存</button>
        </form>
      </details>
      {review && <p className="weekly-analysis-reviewed">本人確認済み：{formatDateTime(review.reviewedAt)}。AIの元結果は上に保持されています。</p>}
    </>}
    {message && <p className="weekly-form-message" role="status">{message}</p>}
  </div>;
}

function Row({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function ScoreSelect({ label, value, onChange }: { label: string; value: AnalysisScore; onChange: (value: AnalysisScore) => void }) {
  return <label>{label}<select value={value ?? ""} onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value) as Exclude<AnalysisScore, null>)}><option value="">根拠不足（null）</option>{[0, 25, 50, 75, 100].map((score) => <option key={score} value={score}>{score}</option>)}</select></label>;
}
function reviewFields(review: WeeklyAnalysisReviewV1 | null, analysis: NonNullable<WeeklyAnalysisDisplayState["response"]>["analysis"]): WeeklyAnalysisReviewFieldsV1 {
  if (review) return review.fields;
  return Object.freeze({
    activityCategory: analysis?.activityCategory ?? null,
    accountCandidate: analysis?.accountCandidate ?? null,
    accountingDispositionCandidate: analysis?.accountingDispositionCandidate ?? null,
    aiRole: analysis?.aiRole ?? null,
    collaborationSummary: analysis?.collaborationBehaviors?.map((item) => item.description).join("\n") || null,
    initiative: analysis?.initiative ?? null,
    reasoning: analysis?.reasoning ?? null,
    criticalJudgment: analysis?.criticalJudgment ?? null,
    thinkingChange: analysis?.thinkingChange ?? null,
    discovery: analysis?.discovery ?? null,
    reviewerNote: null,
  });
}
function statusLabel(value: WeeklyAnalysisDisplayState["analysisStatus"]) { return ({ "not-connected": "未接続・未評価", pending: "分析待ち", complete: "分析完了", failed: "分析失敗", "not-applicable": "対象外" } as const)[value]; }
function scoreLabel(value: AnalysisScore) { return value === null ? "評価不可" : String(value); }
function dispositionLabel(value: WeeklyAnalysisDispositionCandidate | undefined) { return value === null || value === undefined ? "判定不可" : ({ expense: "費用", asset: "成果物資産", "work-in-progress": "仕掛成果物", unclassified: "未分類" } as const)[value]; }
function nullableCategory(value: string): AnalysisActivityCategory { return value === "" ? null : value as Exclude<AnalysisActivityCategory, null>; }
function nullableAccount(value: string): WeeklyAnalysisAccountCandidate { return value === "" ? null : value as Exclude<WeeklyAnalysisAccountCandidate, null>; }
function nullableDisposition(value: string): WeeklyAnalysisDispositionCandidate { return value === "" ? null : value as Exclude<WeeklyAnalysisDispositionCandidate, null>; }
function createId(prefix: string) { return `${prefix}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`; }
function formatDateTime(value: string) { return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
