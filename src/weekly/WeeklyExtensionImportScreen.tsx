import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AiSettingsButton, useAiSettings } from "../AiSettings.tsx";
import { buildWeeklyAnalysisRequest } from "../integrations/weeklyAnalysisAdapter.ts";
import { isWeeklyAnalysisPayloadV2, type WeeklyAnalysisMetricAssessmentV2, type WeeklyAnalysisResponseV1 } from "../integrations/weeklyAnalysisContract.ts";
import type { AnalysisActivityCategory } from "../integrations/analysisContract.ts";
import { WEEKLY_ANALYSIS_RUBRIC_VERSION } from "../integrations/weeklyAnalysisRubric.ts";
import { TIME_ACCOUNTING_CHANGED_EVENT } from "../timeAccountingEvents.ts";
import { TIME_ACCOUNTING_STORAGE_BASE_KEY, loadTimeAccountingStore } from "../timeAccountingStore.ts";
import { buildExtensionWeeklyRecord, defaultExpenseAccountForCategory, type AccountingDisposition, type WeeklyPrivacy } from "../weeklyData.ts";
import { buildConfirmedExtensionRecord, buildMeasuredTimeCandidates, extensionConversationSourceEventId, loadExtensionConversationDraft, selectConversationMeasuredTimeCandidates, selectSessionMatchedMeasurements, selectUnlinkedMeasuredTimeCandidates, type MeasuredTimeCandidate } from "../weeklyExtensionImport.ts";
import { acceptWeeklyAnalysisResponse, queueWeeklyAnalysisRequest } from "../weeklyAnalysisStore.ts";
import { createClientFailureResponse, createWeeklyAnalysisClient, WeeklyAnalysisClientError } from "../weeklyAnalysisClient.ts";
import { appendWeeklyAnalysisReviewRevisionV2 } from "../weeklyAnalysisReviewV2Store.ts";
import { saveWeeklyAnalysisReview } from "../weeklyAnalysisReviewStore.ts";
import { clearWeeklyRecordFlowDraft, createWeeklyRecordFlowDraft, loadWeeklyRecordFlowDraft, saveWeeklyRecordFlowDraft, updateWeeklyRecordFlowDraft, type WeeklyRecordFlowDraftV1, type WeeklyRecordFlowStep } from "../weeklyRecordFlowDraft.ts";
import { loadWeeklyRecordStore, saveExtensionWeeklyRecord, type WeeklyRecordStoreV1 } from "../weeklyStore.ts";
import { WEEKLY_EXPENSE_ACCOUNT_NAMES, type WeeklyExpenseAccount } from "../weeklyAccountingTypes.ts";
import "./weeklyExtensionImportScreen.css";

const categories = ["相談", "壁打ち", "文章作成", "情報収集", "学習", "その他"] as const;
type Props = Readonly<{ onOpenRecords: (recordId?: string) => void }>;

export function WeeklyExtensionImportScreen({ onOpenRecords }: Props) {
  const { credentials } = useAiSettings();
  const [revision, setRevision] = useState(0);
  const [store, setStore] = useState<WeeklyRecordStoreV1>(() => safeLoadWeeklyStore());
  const snapshot = useMemo(() => loadSnapshot(), [revision]);
  const rawConversation = snapshot.conversation;
  const sourceEventId = rawConversation ? extensionConversationSourceEventId(rawConversation) : null;
  const [draft, setDraft] = useState<WeeklyRecordFlowDraftV1 | null>(() => sourceEventId ? safeLoadFlowDraft(sourceEventId) : null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [completed, setCompleted] = useState<{ recordId: string; seconds: number; warning: string | null } | null>(null);
  const existing = sourceEventId ? store.records.find((record) => record.sourceEventId === sourceEventId) ?? null : null;
  const measurements = useMemo(() => selectUnlinkedMeasuredTimeCandidates(snapshot.measurements, store.records), [snapshot.measurements, store.records]);
  const unusedMeasurementIds = useMemo(() => new Set(measurements.map((item) => item.measurementRecordId)), [measurements]);
  const usedMeasurements = snapshot.measurements.filter((item) => !unusedMeasurementIds.has(item.measurementRecordId));
  const exactSessionMatches = selectSessionMatchedMeasurements(measurements, rawConversation?.measurementSessionId);
  const hasMeasurementSessionHint = Boolean(rawConversation?.measurementSessionId);
  const selectableMeasurements = selectConversationMeasuredTimeCandidates(measurements, rawConversation?.measurementSessionId);
  const selectedMeasurement = selectableMeasurements.find((item) => item.measurementRecordId === draft?.measurementRecordId) ?? null;
  const selectedTask = draft?.taskId ? store.tasks.find((task) => task.id === draft.taskId) ?? null : null;

  useEffect(() => {
    if (!sourceEventId) { setDraft(null); return; }
    setDraft(safeLoadFlowDraft(sourceEventId));
    setCompleted(null);
    setMessage("");
  }, [sourceEventId]);

  useEffect(() => {
    if (!draft || existing || completed) return;
    try { saveWeeklyRecordFlowDraft(draft); }
    catch { setLoadError("途中入力を端末に保存できませんでした。この画面を閉じずに操作を続けてください。"); }
  }, [draft, existing, completed]);

  useEffect(() => {
    if (!draft || draft.measurementRecordId || exactSessionMatches.length !== 1) return;
    changeDraft({ measurementRecordId: exactSessionMatches[0].measurementRecordId });
  }, [draft?.sourceEventId, draft?.measurementRecordId, exactSessionMatches.length, exactSessionMatches[0]?.measurementRecordId]);

  useEffect(() => {
    const reload = () => { setStore(safeLoadWeeklyStore()); setRevision((value) => value + 1); setLoadError(""); };
    const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === TIME_ACCOUNTING_STORAGE_BASE_KEY) reload(); };
    const onVisible = () => { if (document.visibilityState === "visible") reload(); };
    window.addEventListener(TIME_ACCOUNTING_CHANGED_EVENT, reload);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", reload);
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.removeEventListener(TIME_ACCOUNTING_CHANGED_EVENT, reload); window.removeEventListener("storage", onStorage); window.removeEventListener("focus", reload); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  function changeDraft(changes: Parameters<typeof updateWeeklyRecordFlowDraft>[1]) {
    setDraft((current) => current ? updateWeeklyRecordFlowDraft(current, changes) : current);
    setMessage("");
  }
  function moveTo(step: WeeklyRecordFlowStep) { changeDraft({ step }); window.scrollTo?.({ top: 0, behavior: "smooth" }); }
  function refresh() {
    try { setStore(loadWeeklyRecordStore()); setRevision((value) => value + 1); setLoadError(""); setMessage("会話と実測時間を再読み込みしました。"); }
    catch (error) { setLoadError(messageOf(error, "連携データを読み込めませんでした。保存値は変更していません。")); }
  }
  function confirmConversation(event: FormEvent) {
    event.preventDefault();
    if (!rawConversation || !draft) return;
    if (!rawConversation.messages?.length) { setMessage("確認できる会話本文がありません。"); return; }
    moveTo(2);
  }
  function confirmMeasurement(event: FormEvent) {
    event.preventDefault();
    if (!selectedMeasurement) { setMessage("この会話に対応する実測時間を本人が選択してください。"); return; }
    moveTo(3);
  }
  function confirmHumanNotes(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    if (selectedTask?.plannedAiasLevel === 1) { setMessage("Level 1はAI不使用の課題です。実測AI利用時間とは関連付けられません。"); return; }
    moveTo(4);
  }

  async function analyze() {
    if (!draft || !rawConversation || !selectedMeasurement) return;
    if (draft.privacy !== "full") { setMessage("時間のみ保存では会話本文を外部送信しません。"); return; }
    if (!credentials.apiKey) { setMessage("APIキーが未設定です。設定するか、分析をスキップして進めてください。"); return; }
    const now = new Date();
    let clientFailureMessage = "";
    setBusy(true); setMessage("");
    try {
      const built = buildStagedRecord(draft, rawConversation, selectedMeasurement);
      if (!built.conversation) throw new Error("分析できる会話本文がありません。");
      const request = buildWeeklyAnalysisRequest({ requestId: createId("analysis-request"), requestedAt: now.toISOString(), consentedAt: now.toISOString(), externalAnalysisConsent: true, record: built.record, conversation: built.conversation, task: selectedTask });
      let response: WeeklyAnalysisResponseV1;
      try {
        const baseUrl = import.meta.env.VITE_AI_SERVER_URL?.trim() || "/api/ai";
        response = await createWeeklyAnalysisClient({ baseUrl, ...credentials }).analyze(request);
      } catch (error) {
        const failure = error instanceof WeeklyAnalysisClientError ? error : new WeeklyAnalysisClientError("PROVIDER_ERROR");
        clientFailureMessage = failure.message;
        response = createClientFailureResponse(request, failure, credentials.model, new Date(), credentials.apiMethod);
      }
      changeDraft({ analysisState: response.analysisStatus, analysisRequest: Object.freeze({ requestId: request.requestId, requestedAt: request.requestedAt, consentedAt: request.consent.consentedAt }), analysisResponse: response });
      setMessage(response.analysisStatus === "complete" ? "分析結果を受信しました。本人の事前回答と会計区分は変更していません。" : response.analysisStatus === "partial" ? "分析できた項目だけ表示します。根拠不足の項目は未評価のままです。" : clientFailureMessage || "分析できませんでした。本人の記録と保存はそのまま続けられます。");
    } catch (error) { setMessage(messageOf(error, "分析を開始できませんでした。本人の記録と保存は続けられます。")); }
    finally { setBusy(false); }
  }

  function skipAnalysis() {
    if (!draft) return;
    changeDraft({ step: 5, analysisState: "skipped", analysisRequest: null, analysisResponse: null, postAnalysisSupplement: "", postAnalysisObjection: "" });
  }

  async function saveActivity(event: FormEvent) {
    event.preventDefault();
    if (!draft || !rawConversation || !selectedMeasurement) return;
    setBusy(true); setMessage("");
    try {
      const input = buildConfirmedExtensionRecord({ rawConversation, measurement: selectedMeasurement, privacy: draft.privacy, taskId: draft.taskId, activityCategory: draft.activityCategory, accountingDisposition: draft.accountingDisposition, accountingAccount: draft.accountingAccount, interactionSummary: draft.interactionSummary, ownThoughts: draft.ownThoughts, discovery: draft.discovery });
      const result = await saveExtensionWeeklyRecord(input);
      let warning: string | null = null;
      if (draft.analysisResponse && draft.analysisRequest && result.record) {
        try {
          const built = buildExtensionWeeklyRecord(input);
          if (!built.conversation) throw new Error("分析結果に対応する会話がありません。");
          const request = buildWeeklyAnalysisRequest({ requestId: draft.analysisRequest.requestId, requestedAt: draft.analysisRequest.requestedAt, consentedAt: draft.analysisRequest.consentedAt, externalAnalysisConsent: true, record: built.record, conversation: built.conversation, task: selectedTask });
          await queueWeeklyAnalysisRequest(request);
          await acceptWeeklyAnalysisResponse(draft.analysisResponse);
          await savePostAnalysisReview(draft, draft.analysisResponse, built.record);
        } catch (error) { warning = `活動は保存しましたが、分析結果の保存を完了できませんでした：${messageOf(error, "分析保存エラー")}`; }
      }
      setStore(result.store);
      clearWeeklyRecordFlowDraft();
      setCompleted({ recordId: result.record?.id ?? buildExtensionWeeklyRecord(input).record.id, seconds: result.record?.activeSeconds ?? selectedMeasurement.activeSeconds, warning });
      setDraft(null);
    } catch (error) { setMessage(messageOf(error, "活動を保存できませんでした。途中入力と既存データは変更していません。")); }
    finally { setBusy(false); }
  }

  if (completed) return <CompletionScreen completed={completed} onOpenRecords={onOpenRecords} />;
  return <div className="weekly-extension-screen stack">
    {loadError && <p className="weekly-form-message error" role="alert">{loadError}</p>}
    {!rawConversation || !draft ? <EmptyConversation measurements={measurements} onRefresh={refresh} /> : existing ? <ExistingConversation recordId={existing.id} onOpenRecords={onOpenRecords} /> : <>
      <FlowProgress step={draft.step} />
      {draft.step === 1 && <ConversationStep rawConversation={rawConversation} draft={draft} onPrivacyChange={(privacy) => changeDraft({ privacy, analysisState: "not-started", analysisRequest: null, analysisResponse: null, postAnalysisSupplement: "", postAnalysisObjection: "" })} onSubmit={confirmConversation} />}
      {draft.step === 2 && <MeasurementStep measurements={selectableMeasurements} usedMeasurements={usedMeasurements} exactSessionMatches={exactSessionMatches} hasMeasurementSessionHint={hasMeasurementSessionHint} unrelatedUnusedCount={measurements.length - exactSessionMatches.length} selectedId={draft.measurementRecordId} onSelect={(measurementRecordId) => changeDraft({ measurementRecordId })} onSubmit={confirmMeasurement} onBack={() => moveTo(1)} />}
      {draft.step === 3 && <HumanNotesStep draft={draft} tasks={store.tasks} onChange={changeDraft} onSubmit={confirmHumanNotes} onBack={() => moveTo(2)} />}
      {draft.step === 4 && <AnalysisStep draft={draft} hasApiKey={!!credentials.apiKey} busy={busy} message={message} onConsentAnalyze={analyze} onSkip={skipAnalysis} onContinue={() => moveTo(5)} onChange={changeDraft} onBack={() => moveTo(3)} />}
      {draft.step === 5 && <AccountingStep draft={draft} busy={busy} message={message} onChange={changeDraft} onSubmit={saveActivity} onBack={() => moveTo(4)} />}
      {draft.step !== 4 && draft.step !== 5 && message && <p className="weekly-form-message" role="status">{message}</p>}
    </>}
    <details id="weekly-record-help" className="weekly-intro-card weekly-extension-help"><summary>Chrome拡張機能との連携方法</summary><div><p>拡張機能から会話と確定済み時間を送ると、5つの確認画面に沿って活動を保存できます。</p><button type="button" className="secondary-action" onClick={refresh}>連携データを再読み込み</button><a href="#weekly-record-support">実測時間の手動連携を開く</a></div></details>
  </div>;
}

function FlowProgress({ step }: { step: WeeklyRecordFlowStep }) {
  return <nav className="weekly-record-progress" aria-label={`記録の進捗：ステップ${step}/5`}><p>ステップ {step}/5</p><div role="progressbar" aria-valuemin={1} aria-valuemax={5} aria-valuenow={step}><span style={{ width: `${step * 20}%` }} /></div></nav>;
}

function ConversationStep({ rawConversation, draft, onPrivacyChange, onSubmit }: { rawConversation: NonNullable<ReturnType<typeof loadExtensionConversationDraft>>; draft: WeeklyRecordFlowDraftV1; onPrivacyChange: (value: WeeklyPrivacy) => void; onSubmit: (event: FormEvent) => void }) {
  return <section className="weekly-panel weekly-record-step" aria-labelledby="record-step-conversation"><header><h2 id="record-step-conversation">会話を確認</h2><p>保存する会話と保存範囲を確認してください。</p></header><article className="weekly-import-summary"><strong>{rawConversation.conversationTitle || "無題の会話"}</strong><div><span>{rawConversation.aiService || "AIサービス不明"}</span><span>{rawConversation.messages?.length ?? 0}メッセージ</span></div><small>取得 {formatDateTime(rawConversation.capturedAt)}</small></article><details className="weekly-record-details"><summary>取得した会話の一部を見る</summary><small>表示するのは取得済み会話の末尾最大4件です。未送信の入力内容は含みません。</small><ol className="weekly-conversation-preview">{(rawConversation.messages ?? []).slice(-4).map((item, index) => <li key={index}><b>{item.role === "user" ? "本人" : item.role === "assistant" ? "AI" : "その他"}</b><span>{truncate(item.text, 180)}</span></li>)}</ol></details><form className="weekly-form" onSubmit={onSubmit}><fieldset className="weekly-record-choice"><legend>端末内に保存する範囲</legend><label><input type="radio" name="privacy" checked={draft.privacy === "full"} onChange={() => onPrivacyChange("full")} /><span><b>会話と時間</b><small>後で同意した場合だけGemini分析ができます</small></span></label><label><input type="radio" name="privacy" checked={draft.privacy === "time-only"} onChange={() => onPrivacyChange("time-only")} /><span><b>時間のみ</b><small>会話本文は活動へ保存せず、Geminiへ送りません</small></span></label></fieldset><button className="primary-action weekly-record-main-action" type="submit">この会話で進む</button></form></section>;
}

function MeasurementStep({ measurements, usedMeasurements, exactSessionMatches, hasMeasurementSessionHint, unrelatedUnusedCount, selectedId, onSelect, onSubmit, onBack }: { measurements: readonly MeasuredTimeCandidate[]; usedMeasurements: readonly MeasuredTimeCandidate[]; exactSessionMatches: readonly MeasuredTimeCandidate[]; hasMeasurementSessionHint: boolean; unrelatedUnusedCount: number; selectedId: string | null; onSelect: (value: string | null) => void; onSubmit: (event: FormEvent) => void; onBack: () => void }) {
  const selectionAvailable = measurements.some((item) => item.measurementRecordId === selectedId);
  return <section className="weekly-panel weekly-record-step" aria-labelledby="record-step-time"><header><p className="eyebrow">ステップ2</p><h2 id="record-step-time">実測時間を確認</h2><p>会話に対応する時間を本人が選びます。活動の保存はまだ行いません。</p></header><div className="weekly-measurement-usage"><article><span>今回の候補</span><strong>{measurements.length}件・{sumSeconds(measurements)}秒</strong><small>{hasMeasurementSessionHint ? "同じ計測セッションだけ" : "本人が日時を確認する未使用時間"}</small></article><article className="used"><span>使用済み</span><strong>{usedMeasurements.length}件・{sumSeconds(usedMeasurements)}秒</strong><small>別の活動へ再使用しません</small></article></div>{exactSessionMatches.length === 1 && <p className="weekly-import-linked">同じ計測セッションの候補を選択しました。日時と秒数を確認してください。</p>}{hasMeasurementSessionHint && exactSessionMatches.length === 0 && <p className="weekly-no-ai-notice">この会話と同じ計測セッションの確定時間は、まだ時間台帳にありません。「帳簿へ連携」後に会計へ取り込み、この画面を再読み込みしてください。{unrelatedUnusedCount > 0 ? ` 他の未使用時間${unrelatedUnusedCount}件は誤紐付け防止のため候補から除外しています。` : ""}</p>}{!hasMeasurementSessionHint && measurements.length > 0 && <p className="weekly-no-ai-notice">この会話には計測セッション情報がありません。対応を推測せず、日時と秒数を本人が確認してください。</p>}<form className="weekly-form" onSubmit={onSubmit}><label>対応する実測時間<select required value={selectionAvailable ? selectedId ?? "" : ""} onChange={(event) => onSelect(event.target.value || null)}><option value="">選択してください</option>{measurements.map((item) => <option key={item.measurementRecordId} value={item.measurementRecordId}>{measurementLabel(item)}</option>)}</select></label>{measurements.length === 0 && !hasMeasurementSessionHint && <p className="weekly-empty">未使用の実測時間がありません。拡張機能から確定済み時間を連携して、再読み込みしてください。</p>}<StepActions onBack={onBack} label="この実測時間で進む" disabled={!selectionAvailable} /></form></section>;
}

function HumanNotesStep({ draft, tasks, onChange, onSubmit, onBack }: { draft: WeeklyRecordFlowDraftV1; tasks: WeeklyRecordStoreV1["tasks"]; onChange: (changes: Parameters<typeof updateWeeklyRecordFlowDraft>[1]) => void; onSubmit: (event: FormEvent) => void; onBack: () => void }) {
  return <section className="weekly-panel weekly-record-step" aria-labelledby="record-step-human"><header><p className="eyebrow">ステップ3</p><h2 id="record-step-human">本人の考え・判断・発見を記録</h2><p>Geminiの結果を見る前に、自分の言葉で残します。空欄があっても進めます。</p></header><form className="weekly-form" onSubmit={onSubmit}><label>活動テーマ（本人の事前判断）<select value={draft.activityCategory} onChange={(event) => onChange({ activityCategory: event.target.value as Exclude<AnalysisActivityCategory, null>, analysisState: "not-started", analysisRequest: null, analysisResponse: null, postAnalysisSupplement: "", postAnalysisObjection: "" })}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label><label>AIとのやり取りの概要<textarea value={draft.interactionSummary} onChange={(event) => onChange({ interactionSummary: event.target.value })} placeholder="何を相談し、どのように進めたか" /></label><label>自分が考えたこと・判断したこと<textarea value={draft.ownThoughts} onChange={(event) => onChange({ ownThoughts: event.target.value })} placeholder="採用・修正・保留したこと" /></label><label>発見・学び<textarea value={draft.discovery} onChange={(event) => onChange({ discovery: event.target.value })} placeholder="今回気づいたこと" /></label><details className="weekly-record-details"><summary>任意のAIAS課題設定</summary><label>関連する課題<select value={draft.taskId ?? ""} onChange={(event) => onChange({ taskId: event.target.value || null, analysisState: "not-started", analysisRequest: null, analysisResponse: null, postAnalysisSupplement: "", postAnalysisObjection: "" })}><option value="">指定しない</option>{tasks.map((task) => <option key={task.id} value={task.id} disabled={task.plannedAiasLevel === 1}>{task.title}（Level {task.plannedAiasLevel ?? "未設定"}）</option>)}</select><small>AIASは能力評価ではなく、課題におけるAIの役割設定です。日常利用では任意です。</small></label></details><StepActions onBack={onBack} label="自分の記録を確認して進む" /></form></section>;
}

function AnalysisStep({ draft, hasApiKey, busy, message, onConsentAnalyze, onSkip, onContinue, onChange, onBack }: { draft: WeeklyRecordFlowDraftV1; hasApiKey: boolean; busy: boolean; message: string; onConsentAnalyze: () => void; onSkip: () => void; onContinue: () => void; onChange: (changes: Parameters<typeof updateWeeklyRecordFlowDraft>[1]) => void; onBack: () => void }) {
  const [consented, setConsented] = useState(false);
  const response = draft.analysisResponse;
  const canAnalyze = draft.privacy === "full" && hasApiKey;
  return <section className="weekly-panel weekly-record-step" aria-labelledby="record-step-analysis"><header><p className="eyebrow">ステップ4・任意</p><h2 id="record-step-analysis">Gemini分析と結果の確認</h2><p>分析は任意です。実行しなくても、本人の記録と会計保存を続けられます。</p></header>{!response && <>{draft.privacy !== "full" ? <p className="weekly-no-ai-notice">「時間のみ保存」を選んだため会話本文を送信しません。</p> : !hasApiKey ? <div className="weekly-no-ai-notice"><p>APIキーが未設定です。分析をスキップするか、補助設定から入力できます。</p><AiSettingsButton label="AI設定を開く" /></div> : <label className="weekly-analysis-consent"><input type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} /><span>会話本文を、設定中のGeminiモデルへ今回だけ送信することに同意します</span></label>}{canAnalyze && <button className="primary-action weekly-record-main-action" type="button" disabled={!consented || busy} onClick={onConsentAnalyze}>{busy ? "分析中…" : "同意してGemini分析を実行"}</button>}<button className="weekly-record-skip" type="button" onClick={onSkip}>分析せず会計区分へ進む</button></>}{response && <><AnalysisResult response={response} /><div className="weekly-post-analysis"><h3>分析を見た後の本人コメント</h3><p>分析前に入力した内容とは別に保存します。AIの元結果は上書きしません。</p><label>補足・修正<textarea value={draft.postAnalysisSupplement} onChange={(event) => onChange({ postAnalysisSupplement: event.target.value })} /></label><label>異議申し立て<textarea value={draft.postAnalysisObjection} onChange={(event) => onChange({ postAnalysisObjection: event.target.value })} /></label></div><button className="primary-action weekly-record-main-action" type="button" onClick={onContinue}>分析結果を確認して会計区分へ</button></>}{message && <p className="weekly-form-message" role="status">{message}</p>}<button className="weekly-record-back" type="button" onClick={onBack}>戻る</button></section>;
}

function AccountingStep({ draft, busy, message, onChange, onSubmit, onBack }: { draft: WeeklyRecordFlowDraftV1; busy: boolean; message: string; onChange: (changes: Parameters<typeof updateWeeklyRecordFlowDraft>[1]) => void; onSubmit: (event: FormEvent) => void; onBack: () => void }) {
  const candidate = draft.analysisResponse?.analysis;
  return <section className="weekly-panel weekly-record-step" aria-labelledby="record-step-accounting"><header><p className="eyebrow">ステップ5</p><h2 id="record-step-accounting">会計区分を本人が決めて保存</h2><p>Gemini候補は参考情報です。選択内容は本人の判断として保存します。</p></header>{candidate && <aside className="weekly-analysis-advisory"><b>Gemini候補（自動確定しません）</b><span>会計区分：{dispositionLabel(candidate.accountingDispositionCandidate)}／勘定科目：{candidate.accountCandidate ?? "未評価"}</span></aside>}<form className="weekly-form" onSubmit={onSubmit}><label>会計区分<select value={draft.accountingDisposition} onChange={(event) => { const disposition = event.target.value as AccountingDisposition; onChange({ accountingDisposition: disposition, accountingAccount: disposition === "expense" ? defaultExpenseAccountForCategory(draft.activityCategory) : null }); }}><option value="unclassified">未分類</option><option value="expense">費用</option><option value="asset">成果物資産</option><option value="work-in-progress">仕掛成果物</option></select></label>{draft.accountingDisposition === "expense" && <label>費用の勘定科目<select required value={draft.accountingAccount ?? ""} onChange={(event) => onChange({ accountingAccount: event.target.value as WeeklyExpenseAccount })}>{WEEKLY_EXPENSE_ACCOUNT_NAMES.map((account) => <option key={account}>{account}</option>)}</select></label>}<div className="weekly-save-summary"><b>保存内容</b><span>{draft.activityCategory}／{dispositionLabel(draft.accountingDisposition)}／分析：{analysisStateLabel(draft.analysisState)}</span><small>このボタンを押すまで、活動・仕訳・決算には反映されません。</small></div><StepActions onBack={onBack} label={busy ? "保存中…" : "この内容で活動を保存"} disabled={busy || (draft.accountingDisposition === "expense" && !draft.accountingAccount)} />{message && <p className="weekly-form-message" role="status">{message}</p>}</form></section>;
}

function AnalysisResult({ response }: { response: WeeklyAnalysisResponseV1 }) {
  if (response.analysisStatus === "failed") return <div className="weekly-analysis-state failed"><strong>分析失敗</strong><span>{analysisErrorLabel(response.error?.code)}</span><span>本人の記録と会計保存は続けられます。</span></div>;
  const analysis = response.analysis;
  if (!analysis) return null;
  const v2 = isWeeklyAnalysisPayloadV2(analysis) ? analysis : null;
  return <div className="weekly-staged-analysis"><div className={`weekly-analysis-state ${response.analysisStatus}`}><strong>{response.analysisStatus === "partial" ? "一部未評価" : "分析完了"}</strong><span>{response.analysisStatus === "partial" ? "根拠を確認できた項目だけ表示します。" : "本人の判断とは別のAI分析結果です。"}</span></div><dl className="weekly-analysis-details"><Row label="活動テーマ候補" value={analysis.activityCategory ?? "未評価"} /><Row label="会計区分候補" value={dispositionLabel(analysis.accountingDispositionCandidate)} /><Row label="勘定科目候補" value={analysis.accountCandidate ?? "未評価"} /><Row label="AIの役割" value={analysis.aiRole ?? "未評価"} /></dl>{v2 && <div className="weekly-analysis-metrics"><Metric label="自発性" assessment={v2.metricAssessments.initiative} /><Metric label="論理性" assessment={v2.metricAssessments.reasoning} /><Metric label="独立性" assessment={v2.metricAssessments.independence} /></div>}{response.analysisStatus === "partial" && <ul className="weekly-unresolved-list">{(response.unresolvedFields ?? []).map((item) => <li key={item.field}>{fieldLabel(item.field)}：根拠不足のため未評価</li>)}</ul>}<details className="weekly-record-details"><summary>分析根拠と詳細</summary><p>思考の変化：{analysis.thinkingChange ?? "未評価"}</p><p>発見・学び：{analysis.discovery ?? "未評価"}</p>{analysis.evidence.length > 0 && <ul>{analysis.evidence.map((item, index) => <li key={`${item.target}:${index}`}>会話 {item.messageIndex + 1}：「{item.quote}」</li>)}</ul>}</details></div>;
}

function Metric({ label, assessment }: { label: string; assessment: WeeklyAnalysisMetricAssessmentV2 }) { return <article><div><strong>{label}</strong><b>{assessment.score === null ? "点数なし" : `${assessment.score}点`}・{metricStatusLabel(assessment.status)}</b></div><p>{assessment.reason}</p><small>証拠充足度：{sufficiencyLabel(assessment.evidenceSufficiency)}</small></article>; }
function StepActions({ onBack, label, disabled = false }: { onBack: () => void; label: string; disabled?: boolean }) { return <div className="weekly-record-step-actions"><button className="weekly-record-back" type="button" onClick={onBack}>戻る</button><button className="primary-action weekly-record-main-action" type="submit" disabled={disabled}>{label}</button></div>; }
function EmptyConversation({ measurements, onRefresh }: { measurements: readonly MeasuredTimeCandidate[]; onRefresh: () => void }) {
  const receivedSeconds = sumSeconds(measurements);
  return <section className="weekly-panel weekly-record-step"><header><p className="eyebrow">記録を始める</p><h2>{measurements.length > 0 ? "実測時間は受信済みです" : "会話を送信してください"}</h2>{measurements.length > 0 ? <><p><strong>{measurements.length}件・{receivedSeconds}秒</strong>の実測時間を端末内の時間台帳に保持しています。会話はまだ受信していないため、活動・仕訳・決算には反映していません。</p><ol><li>同じChromeで研究用Vercel Previewを開き、ログイン後にアプリ画面が表示されることを確認します。</li><li>保存したいChatGPTの会話へ戻り、拡張機能から「思考レシート化する」を再実行します。</li><li>この画面で「送信済みデータを確認」を押します。</li></ol></> : <p>AI会話ページで拡張機能を開き、このアプリへ「思考レシート化」を実行します。</p>}</header><button className="primary-action weekly-record-main-action" type="button" onClick={onRefresh}>送信済みデータを確認</button></section>;
}
function ExistingConversation({ recordId, onOpenRecords }: { recordId: string; onOpenRecords: (recordId?: string) => void }) { return <section className="weekly-panel weekly-existing-import"><p className="eyebrow">保存済み</p><h2>この会話は活動として保存済みです</h2><p>新しい活動を重複登録せず、保存済み活動から分析・本人確認・会計区分を確認できます。</p><button className="primary-action" type="button" onClick={() => onOpenRecords(recordId)}>保存済み活動を確認する</button></section>; }
function CompletionScreen({ completed, onOpenRecords }: { completed: { recordId: string; seconds: number; warning: string | null }; onOpenRecords: (recordId?: string) => void }) { return <section className="weekly-panel weekly-record-complete" aria-labelledby="record-complete"><span aria-hidden="true">✓</span><p className="eyebrow">保存完了</p><h2 id="record-complete">活動を保存しました</h2><p>{completed.seconds}秒の実測時間を1件の活動として保存しました。仕訳・決算にもこの1件だけが反映されます。</p>{completed.warning && <p className="weekly-form-message error" role="alert">{completed.warning}</p>}<button className="primary-action" type="button" onClick={() => onOpenRecords(completed.recordId)}>保存した活動の詳細を見る</button></section>; }

function buildStagedRecord(draft: WeeklyRecordFlowDraftV1, rawConversation: NonNullable<ReturnType<typeof loadExtensionConversationDraft>>, measurement: MeasuredTimeCandidate) { return buildExtensionWeeklyRecord(buildConfirmedExtensionRecord({ rawConversation, measurement, privacy: draft.privacy, taskId: draft.taskId, activityCategory: draft.activityCategory, accountingDisposition: draft.accountingDisposition, accountingAccount: draft.accountingAccount, interactionSummary: draft.interactionSummary, ownThoughts: draft.ownThoughts, discovery: draft.discovery })); }

async function savePostAnalysisReview(draft: WeeklyRecordFlowDraftV1, response: WeeklyAnalysisResponseV1, record: ReturnType<typeof buildExtensionWeeklyRecord>["record"]) {
  if (!response.analysis || (!draft.postAnalysisSupplement.trim() && !draft.postAnalysisObjection.trim())) return;
  if (isWeeklyAnalysisPayloadV2(response.analysis) && response.rubricVersion === WEEKLY_ANALYSIS_RUBRIC_VERSION) {
    const analysis = response.analysis;
    await appendWeeklyAnalysisReviewRevisionV2({ schemaVersion: 2, revisionId: `analysis-review-v2:${response.analysisId}:initial-human`, analysisId: response.analysisId, recordId: record.id, thoughtReceiptId: record.links.thoughtReceiptId, rubricVersion: WEEKLY_ANALYSIS_RUBRIC_VERSION, reviewedAt: new Date().toISOString(), action: draft.postAnalysisObjection.trim() ? "objection" : "supplement", supplement: draft.postAnalysisSupplement.trim() || null, objection: draft.postAnalysisObjection.trim() || null, excluded: false, exclusionReason: null, subjectiveDifficulty: "not_provided", metrics: { initiative: reviewMetric(analysis.metricAssessments.initiative), reasoning: reviewMetric(analysis.metricAssessments.reasoning), independence: reviewMetric(analysis.metricAssessments.independence) } });
    return;
  }
  const legacy = response.analysis;
  await saveWeeklyAnalysisReview({ schemaVersion: 1, analysisId: response.analysisId, recordId: record.id, thoughtReceiptId: record.links.thoughtReceiptId, reviewedAt: new Date().toISOString(), fields: { activityCategory: legacy.activityCategory, accountCandidate: legacy.accountCandidate ?? null, accountingDispositionCandidate: legacy.accountingDispositionCandidate ?? null, aiRole: legacy.aiRole, collaborationSummary: legacy.collaborationBehaviors?.map((item) => item.description).join("\n") || null, initiative: legacy.initiative, reasoning: legacy.reasoning, criticalJudgment: "criticalJudgment" in legacy ? legacy.criticalJudgment : null, thinkingChange: legacy.thinkingChange, discovery: legacy.discovery, reviewerNote: [draft.postAnalysisSupplement, draft.postAnalysisObjection].filter(Boolean).join("\n") || null } });
}

function reviewMetric(assessment: WeeklyAnalysisMetricAssessmentV2) { return { score: assessment.score, status: assessment.status, reason: assessment.reason }; }
function loadSnapshot() { try { const timeKey = globalThis.location?.pathname?.startsWith("/accounting-of-AI/preview/") ? `preview-month-ledger:${TIME_ACCOUNTING_STORAGE_BASE_KEY}` : TIME_ACCOUNTING_STORAGE_BASE_KEY; return { conversation: loadExtensionConversationDraft(), measurements: buildMeasuredTimeCandidates(loadTimeAccountingStore(window.localStorage, timeKey)) }; } catch { return { conversation: null, measurements: Object.freeze([]) as readonly MeasuredTimeCandidate[] }; } }
function safeLoadWeeklyStore(): WeeklyRecordStoreV1 { try { return loadWeeklyRecordStore(); } catch { return Object.freeze({ schemaVersion: 1, records: Object.freeze([]), tasks: Object.freeze([]) }); } }
function safeLoadFlowDraft(sourceEventId: string) { try { return loadWeeklyRecordFlowDraft(sourceEventId); } catch { return createWeeklyRecordFlowDraft(sourceEventId); } }
function measurementLabel(item: MeasuredTimeCandidate) { return `${item.localDate} ${formatTime(item.startedAt)}〜${formatTime(item.endedAt)}／${item.activeSeconds}秒／${item.provider}`; }
function sumSeconds(items: readonly MeasuredTimeCandidate[]) { return items.reduce((total, item) => total + item.activeSeconds, 0); }
function formatTime(value: string) { return new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function formatDateTime(value: string | undefined) { return value && !Number.isNaN(new Date(value).getTime()) ? new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "日時不明"; }
function truncate(value: string | undefined, length: number) { const text = value?.trim() ?? ""; return text.length > length ? `${text.slice(0, length)}…` : text; }
function messageOf(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }
function createId(prefix: string) { return `${prefix}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`; }
function dispositionLabel(value: AccountingDisposition | null | undefined) { return value === null || value === undefined ? "未評価" : ({ expense: "費用", asset: "成果物資産", "work-in-progress": "仕掛成果物", unclassified: "未分類" } as const)[value]; }
function analysisStateLabel(value: WeeklyRecordFlowDraftV1["analysisState"]) { return ({ "not-started": "未実行", skipped: "スキップ", complete: "完了", partial: "一部未評価", failed: "失敗" } as const)[value]; }
function metricStatusLabel(value: WeeklyAnalysisMetricAssessmentV2["status"]) { return ({ confirmed: "確定", provisional: "暫定", hold: "評価保留", not_applicable: "評価対象外" } as const)[value]; }
function sufficiencyLabel(value: WeeklyAnalysisMetricAssessmentV2["evidenceSufficiency"]) { return ({ high: "高", medium: "中", low: "低" } as const)[value]; }
function analysisErrorLabel(value: string | undefined) { return ({ NOT_AUTHENTICATED: "APIキーまたは認証を確認してください。", RATE_LIMITED: "利用上限に達しました。時間を置いて再試行できます。", MODEL_UNAVAILABLE: "選択中のモデルを利用できません。", INVALID_OUTPUT: "分析結果の形式または根拠を確認できませんでした。", TIMEOUT: "分析の応答待ちが時間切れになりました。", PROVIDER_ERROR: "分析サービスに接続できませんでした。" } as Record<string, string>)[value ?? ""] ?? "分析を完了できませんでした。"; }
function fieldLabel(value: string) { return ({ "analysis.activityCategory": "活動テーマ", "analysis.accountCandidate": "勘定科目候補", "analysis.accountingDispositionCandidate": "会計区分候補", "analysis.aiRole": "AIの役割", "analysis.collaborationBehaviors": "協働行動", "analysis.initiative": "自発性", "analysis.reasoning": "論理性", "analysis.independence": "独立性", "analysis.metricAssessments.independence.deliberation": "独立性（検討過程）", "analysis.metricAssessments.independence.finalDecision": "独立性（最終判断）", "analysis.criticalJudgment": "批判的判断（旧形式）", "analysis.thinkingChange": "思考の変化", "analysis.discovery": "発見・学び" } as Record<string, string>)[value] ?? value; }
function Row({ label, value }: { label: string; value: string }) { return <><dt>{label}</dt><dd>{value}</dd></>; }
