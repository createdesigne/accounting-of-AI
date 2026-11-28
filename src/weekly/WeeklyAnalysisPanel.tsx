import { useEffect, useState, type FormEvent } from "react";
import { AiSettingsButton, hasWeeklyAnalysisCredential, useAiSettings } from "../AiSettings.tsx";
import { buildWeeklyAnalysisRequest } from "../integrations/weeklyAnalysisAdapter.ts";
import type { AnalysisActivityCategory, AnalysisScore } from "../integrations/analysisContract.ts";
import {
  WeeklyAnalysisAccountCandidate,
  WeeklyAnalysisDiagnosticStage,
  WeeklyAnalysisDispositionCandidate,
  WeeklyAnalysisEvidenceV1,
  WeeklyAnalysisMetricAssessmentV2,
  WeeklyAnalysisValidationRule,
  isWeeklyAnalysisPayloadV2,
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
import {
  appendWeeklyAnalysisReviewRevisionV2,
  loadWeeklyAnalysisReviewHistoryV2,
  revisionsForAnalysis,
} from "../weeklyAnalysisReviewV2Store.ts";

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
  const analysisV2 = analysis && isWeeklyAnalysisPayloadV2(analysis) ? analysis : null;
  const legacyAnalysis = analysis && !isWeeklyAnalysisPayloadV2(analysis) ? analysis : null;
  const [reviewHistoryVersion, setReviewHistoryVersion] = useState(0);
  const v2Revisions = (() => {
    void reviewHistoryVersion;
    try { return revisionsForAnalysis(loadWeeklyAnalysisReviewHistoryV2(), response?.analysisId); } catch { return []; }
  })();
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
      setMessage(result.analysisStatus === "complete"
        ? "分析結果を受信しました。本人入力と会計データは変更していません。"
        : result.analysisStatus === "partial"
          ? "分析結果を一部受信しました。根拠不足の項目は点数なしで保留しています。本人入力と会計データは変更していません。"
          : "分析に失敗しました。手入力と週次決算はそのまま利用できます。");
    } catch (error) {
      if (request && queued) {
        const clientError = error instanceof WeeklyAnalysisClientError
          ? error
          : new WeeklyAnalysisClientError("INVALID_OUTPUT");
        const failureModel = credentials.authMode === "participant" ? "gemini-not-invoked" : credentials.model;
        try { await acceptWeeklyAnalysisResponse(createClientFailureResponse(request, clientError, failureModel, new Date(), credentials.apiMethod)); }
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
    if (!response?.analysis || !["complete", "partial"].includes(response.analysisStatus)) return;
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

  const heading = analysisHeading(state.analysisStatus);
  const hasPriorReflection = Boolean(record.manualNotes?.interactionSummary || record.manualNotes?.ownThoughts || record.manualNotes?.discovery || record.selfReflection);

  return <div className={`weekly-analysis-state compact${state.analysisStatus === "complete" ? " complete" : state.analysisStatus === "partial" ? " partial" : state.analysisStatus === "failed" ? " failed" : ""}${response?.origin === "test-fixture" ? " fixture" : ""}`}>
    <header className="weekly-analysis-heading"><p className="eyebrow">Gemini分析・任意</p><h3>{heading}</h3><p>分析しなくても、本人の記録・会計・週次決算は利用できます。</p></header>
    {response?.origin === "test-fixture" && <p className="weekly-analysis-fixture-label">テスト用分析です。実際のGemini分析結果ではありません。</p>}
    <div className="weekly-analysis-guide" aria-label="3つの思考指標">
      <article><strong>自発性</strong><span>本人から問い・仮説・アイデアを出したか</span></article>
      <article><strong>論理性</strong><span>理由や条件を整理し、筋道を立てたか</span></article>
      <article><strong>独立性</strong><span>方向性や最終判断を本人が担ったか</span></article>
    </div>
    <details className="weekly-analysis-method">
      <summary>評価方法を見る</summary>
      <p>AIAS Levelは活動前に設定したAIの役割であり、能力の点数ではありません。この分析は、会話から観察できる行動を研究用ルーブリックで整理します。</p>
      <p>未評価は根拠不足による点数なし、0点は「本人が考えず全面委任した」などの明確な根拠がある場合です。</p>
      <span>適用する評価基準：{WEEKLY_ANALYSIS_RUBRIC_VERSION}</span>
    </details>
    {hasPriorReflection && <details className="weekly-analysis-prior"><summary>本人の事前記録を見る</summary><dl><Row label="やり取りの概要" value={record.manualNotes?.interactionSummary ?? "未入力"} /><Row label="考えたこと・判断したこと" value={record.manualNotes?.ownThoughts ?? record.selfReflection ?? "未入力"} /><Row label="発見・学び" value={record.manualNotes?.discovery ?? "未入力"} /></dl></details>}
    {pending && <span>分析待ちです。本人入力と会計データは変更しません。</span>}
    {unavailable ? <p className="weekly-analysis-warning">この活動は「時間のみ保存」のため会話本文がなく、Gemini分析を実行できません。本人の記録と会計はそのまま利用できます。</p> : !hasWeeklyAnalysisCredential(credentials) ? <div className="weekly-analysis-settings-needed"><p>Gemini分析を使うにはAI設定が必要です。自分のAPIキーまたは研究参加者コードを設定し、この画面へ戻って送信へ同意してください。接続情報は保存されません。</p><AiSettingsButton label="AI設定を開く" /></div> : <>
      <label className="weekly-analysis-consent"><input type="checkbox" checked={consented} disabled={busy || pending} onChange={(event) => setConsented(event.target.checked)} />
        <span>この活動の保存済み会話本文をGeminiへ今回だけ送信することに同意します。</span>
      </label>
      <button className="primary-action weekly-analysis-run" type="button" disabled={busy || pending || !consented} onClick={() => void analyze()}>
        {busy ? "分析中…" : state.analysisStatus === "failed" && response?.error?.retryable ? "Geminiで再試行する" : ["complete", "partial"].includes(state.analysisStatus) ? "Geminiで再分析する" : "Geminiで分析する"}
      </button>
    </>}

    {state.analysisStatus === "failed" && <>
      <span>{sourceLabel}に失敗しました。手入力の記録・仕訳・決算は引き続き利用できます。</span>
      <details className="weekly-analysis-technical error-details">
        <summary>エラーの詳細を見る</summary>
        <span>アプリ内エラー種別：{response?.error?.code ?? "INVALID_OUTPUT"}</span>
        {response?.error?.diagnosticStage && <span>失敗した段階：{diagnosticStageLabel(response.error.diagnosticStage)}（APIキー・会話本文は含みません）</span>}
        {response?.error?.providerHttpStatus && <span>Gemini HTTPステータス：{response.error.providerHttpStatus}</span>}
        {response?.error?.providerErrorCode && <span>Geminiエラー種別：{response.error.providerErrorCode}</span>}
        {typeof response?.error?.timedOut === "boolean" && <span>タイムアウト：{response.error.timedOut ? "発生" : "未発生"}</span>}
        {response?.error?.validationField && <span>検証フィールド：{response.error.validationField}</span>}
        {response?.error?.validationRule && <span>違反条件：{validationRuleLabel(response.error.validationRule)}</span>}
      </details>
    </>}
    {state.analysisStatus === "partial" && response && <div className="weekly-analysis-partial" role="status">
      <strong>一部未評価</strong>
      <span>根拠を確認できた項目だけを保存しました。次の項目は点数なしで保留し、本人による分類・会計処理には影響しません。</span>
      <ul>{(response.unresolvedFields ?? []).map(item => <li key={item.field}>{unresolvedFieldLabel(item.field)}：{partialReasonLabel(item.reason)}</li>)}</ul>
    </div>}
    {analysis && response && <>
      <div className="weekly-analysis-metrics" aria-label="研究指標と評価根拠">
        {analysisV2 ? <>
          <MetricEvidenceV2 label="自発性" assessment={analysisV2.metricAssessments.initiative} />
          <MetricEvidenceV2 label="論理性" assessment={analysisV2.metricAssessments.reasoning} />
          <MetricEvidenceV2 label="独立性" assessment={analysisV2.metricAssessments.independence} />
        </> : <>
          <MetricEvidence label="自発性" score={legacyAnalysis?.initiative ?? null} target="initiative" evidence={legacyAnalysis?.evidence ?? []} />
          <MetricEvidence label="論理性" score={legacyAnalysis?.reasoning ?? null} target="reasoning" evidence={legacyAnalysis?.evidence ?? []} />
          <MetricEvidence label="批判的判断（旧v1。独立性へ変換しません）" score={legacyAnalysis?.criticalJudgment ?? null} target="critical-judgment" evidence={legacyAnalysis?.evidence ?? []} />
        </>}
      </div>
      {analysisV2 && <details className="weekly-analysis-supporting"><summary>独立性の検討過程と最終判断を見る</summary><div className="weekly-analysis-submetrics"><MetricEvidenceV2 label="検討過程" assessment={analysisV2.metricAssessments.independence.deliberation} compact /><MetricEvidenceV2 label="最終判断・意図的保留" assessment={analysisV2.metricAssessments.independence.finalDecision} compact /></div></details>}
      <details className="weekly-analysis-supporting"><summary>活動テーマ・AIの役割などを見る</summary><dl className="weekly-analysis-details">
        <Row label="活動テーマ候補" value={analysis.activityCategory ?? "判定不可"} />
        <Row label="勘定科目候補" value={analysis.accountCandidate ?? "判定不可"} />
        <Row label="会計区分候補" value={dispositionLabel(analysis.accountingDispositionCandidate)} />
        <Row label="実際のAIの役割" value={analysis.aiRole ?? "判定不可"} />
        <Row label="協働行動" value={analysis.collaborationBehaviors?.map((item) => item.description).join("／") || "判定不可"} />
        <Row label="思考の変化" value={analysis.thinkingChange ?? "判定不可"} />
        <Row label="発見・学び" value={analysis.discovery ?? "判定不可"} />
        {analysisV2 && <><Row label="課題の複雑さ" value={complexityLabel(analysisV2.taskComplexity.level)} /><Row label="複雑さの理由" value={analysisV2.taskComplexity.reason} /><Row label="検討要素と相互関係" value={analysisV2.taskComplexity.considerationFactors} /><Row label="不確実性" value={analysisV2.taskComplexity.uncertainty} /><Row label="必要な思考過程" value={analysisV2.taskComplexity.reasoningProcess} /><Row label="本人の主観的難しさ" value="未提供（AIは推測しません）" /></>}
      </dl>{analysis.evidence.length > 0 && <div className="weekly-analysis-evidence"><b>分析根拠となる会話箇所</b><ul>{analysis.evidence.map((evidence, index) => <li key={`${evidence.target}:${evidence.messageIndex}:${index}`}>会話 {evidence.messageIndex + 1}：「{evidence.quote}」</li>)}</ul></div>}</details>
      <p className="weekly-analysis-advisory">活動テーマ・勘定科目・会計区分は候補です。保存済み活動、利用時間、仕訳、週次決算には自動反映しません。</p>

      {!analysisV2 && <details className="weekly-analysis-review" open={!!review}>
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
      </details>}
      {!analysisV2 && review && <p className="weekly-analysis-reviewed">本人確認済み：{formatDateTime(review.reviewedAt)}。AIの元結果は上に保持されています。</p>}
      {analysisV2 && <V2ReviewForm key={response.analysisId} analysisId={response.analysisId} record={record} analysis={analysisV2} revisions={v2Revisions} busy={busy} setBusy={setBusy} setMessage={setMessage} onSaved={() => { setReviewHistoryVersion(value => value + 1); onChanged(); }} />}
    </>}
    {message && <p className="weekly-form-message" role="status">{message}</p>}
  </div>;
}

function MetricEvidenceV2({ label, assessment, compact = false }: { label: string; assessment: WeeklyAnalysisMetricAssessmentV2; compact?: boolean }) {
  return <article className={`${compact ? "compact " : ""}metric-${assessment.status}`}>
    <header><strong>{label}</strong><span><b>{scoreLabel(assessment.score)}</b><em>{metricStatusLabel(assessment.status)}</em></span></header>
    <p><b>評価理由</b><br />{assessment.reason}</p>
    <p className="weekly-metric-basis">基準：{assessment.rubricLevel === null ? "該当なし" : `${assessment.rubricLevel}点`} ／ 証拠充足度：{sufficiencyLabel(assessment.evidenceSufficiency)}</p>
    {assessment.evidence.map((item, index) => <p className="weekly-metric-evidence" key={`${item.utteranceId}:${index}`}><b>根拠</b><br />{speakerLabel(item.speaker)}「{item.quote}」<br /><small>{item.observedFeature}（{item.source === "self_report" ? "本人の自己申告" : "会話から観察"}）</small></p>)}
    {assessment.unconfirmed.length > 0 && <p className="weekly-metric-unconfirmed"><b>確認できない点</b><br />{assessment.unconfirmed.join("／")}</p>}
  </article>;
}

function V2ReviewForm({ analysisId, record, analysis, revisions, busy, setBusy, setMessage, onSaved }: {
  analysisId: string;
  record: WeeklyRecordV1;
  analysis: Extract<NonNullable<WeeklyAnalysisDisplayState["response"]>["analysis"], { independence: AnalysisScore }>;
  revisions: readonly import("../weeklyAnalysisReviewV2Store.ts").WeeklyAnalysisReviewRevisionV2[];
  busy: boolean;
  setBusy: (value: boolean) => void;
  setMessage: (value: string) => void;
  onSaved: () => void;
}) {
  const latest = revisions[revisions.length - 1];
  const [action, setAction] = useState<"supplement" | "objection" | "exclusion" | "reassessment">(latest?.action ?? "supplement");
  const [supplement, setSupplement] = useState(latest?.supplement ?? "");
  const [objection, setObjection] = useState(latest?.objection ?? "");
  const [excluded, setExcluded] = useState(latest?.excluded ?? false);
  const [exclusionReason, setExclusionReason] = useState(latest?.exclusionReason ?? "");
  const [difficulty, setDifficulty] = useState<"low" | "medium" | "high" | "not_provided">(latest?.subjectiveDifficulty ?? "not_provided");
  const initial = latest?.metrics ?? {
    initiative: pickReviewMetric(analysis.metricAssessments.initiative),
    reasoning: pickReviewMetric(analysis.metricAssessments.reasoning),
    independence: pickReviewMetric(analysis.metricAssessments.independence),
  };
  const [metrics, setMetrics] = useState(initial);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      await appendWeeklyAnalysisReviewRevisionV2({
        schemaVersion: 2, revisionId: createId("analysis-review-v2"), analysisId, recordId: record.id,
        thoughtReceiptId: record.links.thoughtReceiptId, rubricVersion: WEEKLY_ANALYSIS_RUBRIC_VERSION,
        reviewedAt: new Date().toISOString(), action, supplement: supplement || null, objection: objection || null,
        excluded, exclusionReason: exclusionReason || null, subjectiveDifficulty: difficulty, metrics,
      });
      setMessage("本人の補足・異議・除外・再評価を変更履歴として追記しました。AIの元結果は変更していません。"); onSaved();
    } catch (error) { setMessage(error instanceof Error ? error.message : "本人確認履歴を保存できませんでした。"); }
    finally { setBusy(false); }
  }
  return <details className="weekly-analysis-review" open={revisions.length > 0}>
    <summary>本人による補足・異議・除外・再評価</summary>
    <form onSubmit={save}>
      <div className="weekly-form-grid">
        <label>操作<select value={action} onChange={event => setAction(event.target.value as typeof action)}><option value="supplement">補足</option><option value="objection">異議申し立て</option><option value="exclusion">除外</option><option value="reassessment">再評価</option></select></label>
        <label>本人の主観的な難しさ<select value={difficulty} onChange={event => setDifficulty(event.target.value as typeof difficulty)}><option value="not_provided">未提供</option><option value="low">低い</option><option value="medium">中程度</option><option value="high">高い</option></select></label>
      </div>
      <label>本人による補足（self_report）<textarea value={supplement} onChange={event => setSupplement(event.target.value)} /></label>
      <label>異議申し立て<textarea value={objection} onChange={event => setObjection(event.target.value)} /></label>
      <label className="weekly-analysis-consent"><input type="checkbox" checked={excluded} onChange={event => setExcluded(event.target.checked)} /><span>この分析を長期比較から除外する</span></label>
      {excluded && <label>除外理由<textarea required value={exclusionReason} onChange={event => setExclusionReason(event.target.value)} /></label>}
      {(["initiative", "reasoning", "independence"] as const).map(metric => <ReviewMetricEditor key={metric} label={{ initiative: "自発性", reasoning: "論理性", independence: "独立性" }[metric]} value={metrics[metric]} onChange={value => setMetrics((current: typeof metrics) => ({ ...current, [metric]: value }))} />)}
      <button className="secondary-action" type="submit" disabled={busy}>変更履歴へ追記</button>
    </form>
    {revisions.length > 0 && <ol className="weekly-analysis-review-history">{revisions.map(row => <li key={row.revisionId}>{formatDateTime(row.reviewedAt)}：{reviewActionLabel(row.action)}（基準 {row.rubricVersion}）</li>)}</ol>}
  </details>;
}

type ReviewMetricValue = { score: AnalysisScore; status: "confirmed" | "provisional" | "hold" | "not_applicable"; reason: string };
function ReviewMetricEditor({ label, value, onChange }: { label: string; value: ReviewMetricValue; onChange: (next: ReviewMetricValue) => void }) {
  return <fieldset className="weekly-analysis-review-metric"><legend>{label}</legend><div className="weekly-form-grid">
    <label>状態<select value={value.status} onChange={event => { const status = event.target.value as typeof value.status; onChange({ ...value, status, score: status === "hold" || status === "not_applicable" ? null : value.score ?? 50 }); }}><option value="confirmed">確定（根拠十分）</option><option value="provisional">暫定</option><option value="hold">評価保留</option><option value="not_applicable">評価対象外</option></select></label>
    <ScoreSelect label="本人確認後の点数" value={value.score} onChange={score => onChange({ ...value, score, status: score === null ? "hold" : value.status === "hold" || value.status === "not_applicable" ? "provisional" : value.status })} />
  </div><label>変更理由<textarea required value={value.reason} onChange={event => onChange({ ...value, reason: event.target.value })} /></label></fieldset>;
}

function pickReviewMetric(value: WeeklyAnalysisMetricAssessmentV2) { return { score: value.score, status: value.status, reason: value.reason }; }
function Row({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function MetricEvidence({ label, score, target, evidence }: { label: string; score: AnalysisScore; target: WeeklyAnalysisEvidenceV1["target"]; evidence: readonly WeeklyAnalysisEvidenceV1[] }) {
  const matches = evidence.filter((item) => item.target === target);
  return <article><div><strong>{label}</strong><b>{scoreLabel(score)}</b></div>{matches.length > 0
    ? matches.map((item, index) => <p key={`${item.messageIndex}:${index}`}>根拠：会話{item.messageIndex + 1}「{item.quote}」</p>)
    : <p>{score === null ? "根拠不足のため評価できません" : "対応する根拠引用なし（旧形式の分析結果）"}</p>}</article>;
}
function ScoreSelect({ label, value, onChange }: { label: string; value: AnalysisScore; onChange: (value: AnalysisScore) => void }) {
  return <label>{label}<select value={value ?? ""} onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value) as Exclude<AnalysisScore, null>)}><option value="">根拠不足（点数なし）</option>{[0, 25, 50, 75, 100].map((score) => <option key={score} value={score}>{score}</option>)}</select></label>;
}
function reviewFields(review: WeeklyAnalysisReviewV1 | null, analysis: NonNullable<WeeklyAnalysisDisplayState["response"]>["analysis"]): WeeklyAnalysisReviewFieldsV1 {
  if (review) return review.fields;
  const legacyCriticalJudgment = analysis && !isWeeklyAnalysisPayloadV2(analysis) ? analysis.criticalJudgment : null;
  return Object.freeze({
    activityCategory: analysis?.activityCategory ?? null,
    accountCandidate: analysis?.accountCandidate ?? null,
    accountingDispositionCandidate: analysis?.accountingDispositionCandidate ?? null,
    aiRole: analysis?.aiRole ?? null,
    collaborationSummary: analysis?.collaborationBehaviors?.map((item) => item.description).join("\n") || null,
    initiative: analysis?.initiative ?? null,
    reasoning: analysis?.reasoning ?? null,
    criticalJudgment: legacyCriticalJudgment,
    thinkingChange: analysis?.thinkingChange ?? null,
    discovery: analysis?.discovery ?? null,
    reviewerNote: null,
  });
}
function analysisHeading(value: WeeklyAnalysisDisplayState["analysisStatus"]) { return ({ "not-connected": "まだ分析していません", pending: "分析結果を待っています", complete: "分析が完了しました", partial: "一部の項目を評価できませんでした", failed: "分析を完了できませんでした", "not-applicable": "この活動は分析対象外です" } as const)[value]; }
function scoreLabel(value: AnalysisScore) { return value === null ? "未評価（点数なし）" : `${value}点`; }
function metricStatusLabel(value: "confirmed" | "provisional" | "hold" | "not_applicable") { return ({ confirmed: "確定", provisional: "暫定", hold: "評価保留", not_applicable: "評価対象外" } as const)[value]; }
function sufficiencyLabel(value: "high" | "medium" | "low") { return ({ high: "高", medium: "中", low: "低" } as const)[value]; }
function speakerLabel(value: "user" | "assistant" | "system" | "unknown") { return ({ user: "本人", assistant: "AI", system: "システム", unknown: "不明" } as const)[value]; }
function complexityLabel(value: "low" | "medium" | "high" | "unknown") { return ({ low: "低", medium: "中", high: "高", unknown: "不明" } as const)[value]; }
function reviewActionLabel(value: "supplement" | "objection" | "exclusion" | "reassessment") { return ({ supplement: "補足", objection: "異議", exclusion: "除外", reassessment: "再評価" } as const)[value]; }
function dispositionLabel(value: WeeklyAnalysisDispositionCandidate | undefined) { return value === null || value === undefined ? "判定不可" : ({ expense: "費用", asset: "成果物資産", "work-in-progress": "仕掛成果物", unclassified: "未分類" } as const)[value]; }
function nullableCategory(value: string): AnalysisActivityCategory { return value === "" ? null : value as Exclude<AnalysisActivityCategory, null>; }
function nullableAccount(value: string): WeeklyAnalysisAccountCandidate { return value === "" ? null : value as Exclude<WeeklyAnalysisAccountCandidate, null>; }
function nullableDisposition(value: string): WeeklyAnalysisDispositionCandidate { return value === "" ? null : value as Exclude<WeeklyAnalysisDispositionCandidate, null>; }
function createId(prefix: string) { return `${prefix}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`; }
function formatDateTime(value: string) { return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function diagnosticStageLabel(value: WeeklyAnalysisDiagnosticStage) {
  return ({
    "provider-response": "Gemini応答の受信段階",
    "output-truncated": "出力の途中終了",
    "interaction-envelope": "API応答構造の読取段階",
    "json-parse": "JSON解析段階",
    "schema-validation": "必須項目・型・列挙値・null・根拠有無の検証段階",
    "evidence-validation": "会話ID・発言位置・引用一致の検証段階",
  } as const)[value];
}
function validationRuleLabel(value: WeeklyAnalysisValidationRule) {
  return ({
    required: "必須項目がない", "unexpected-fields": "許可されていない項目がある", type: "データ型が異なる",
    enum: "許可された列挙値ではない", integer: "整数ではない", "non-empty": "空文字は許可されない",
    "max-length": "文字数上限を超えている", "max-items": "件数上限を超えている",
    "evidence-required": "非nullの分析値に対応する根拠がない", "message-index-range": "発言番号が範囲外",
    "conversation-id-match": "会話IDが一致しない", "quote-match": "引用が指定発言に完全一致しない", "score-match": "指標点数と詳細評価が一致しない",
  } as const)[value];
}
function unresolvedFieldLabel(value: string) {
  return ({
    "analysis.activityCategory": "活動テーマ", "analysis.accountCandidate": "勘定科目候補",
    "analysis.accountingDispositionCandidate": "会計区分候補", "analysis.aiRole": "AIの役割",
    "analysis.collaborationBehaviors": "協働行動", "analysis.initiative": "自発性",
    "analysis.reasoning": "論理性", "analysis.independence": "独立性", "analysis.criticalJudgment": "批判的判断（旧v1）",
    "analysis.thinkingChange": "思考の変化", "analysis.discovery": "発見・学び",
  } as Record<string, string>)[value] ?? value;
}
function partialReasonLabel(value: "missing-evidence" | "invalid-evidence") { return value === "missing-evidence" ? "対応する根拠がない" : "根拠の発言位置または引用を確認できない"; }
