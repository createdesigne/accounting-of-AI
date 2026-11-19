import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { AnalysisActivityCategory } from "../integrations/analysisContract.ts";
import { TIME_ACCOUNTING_CHANGED_EVENT } from "../timeAccountingEvents.ts";
import { TIME_ACCOUNTING_STORAGE_BASE_KEY, loadTimeAccountingStore } from "../timeAccountingStore.ts";
import type { AccountingDisposition, WeeklyPrivacyChoice } from "../weeklyData.ts";
import {
  buildConfirmedExtensionRecord,
  buildMeasuredTimeCandidates,
  extensionConversationSourceEventId,
  loadExtensionConversationDraft,
  selectUnlinkedMeasuredTimeCandidates,
  selectSessionMatchedMeasurements,
  type MeasuredTimeCandidate,
} from "../weeklyExtensionImport.ts";
import {
  loadWeeklyRecordStore,
  saveExtensionWeeklyRecord,
  type WeeklyRecordStoreV1,
} from "../weeklyStore.ts";
import "./weeklyExtensionImportScreen.css";

const categories = ["相談", "壁打ち", "文章作成", "情報収集", "学習", "その他"] as const;

type Props = Readonly<{ onOpenRecords: () => void }>;

export function WeeklyExtensionImportScreen({ onOpenRecords }: Props) {
  const [revision, setRevision] = useState(0);
  const [store, setStore] = useState<WeeklyRecordStoreV1>(() => safeLoadWeeklyStore());
  const [measurementId, setMeasurementId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [category, setCategory] = useState<Exclude<AnalysisActivityCategory, null>>("壁打ち");
  const [disposition, setDisposition] = useState<AccountingDisposition>("unclassified");
  const [privacy, setPrivacy] = useState<WeeklyPrivacyChoice>("full");
  const [interactionSummary, setInteractionSummary] = useState("");
  const [ownThoughts, setOwnThoughts] = useState("");
  const [discovery, setDiscovery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");

  const snapshot = useMemo(() => loadSnapshot(), [revision]);
  const rawConversation = snapshot.conversation;
  const sourceEventId = rawConversation ? extensionConversationSourceEventId(rawConversation) : null;
  const existing = sourceEventId
    ? store.records.find((record) => record.sourceEventId === sourceEventId) ?? null
    : null;
  const measurements = useMemo(() => (
    selectUnlinkedMeasuredTimeCandidates(snapshot.measurements, store.records)
  ), [snapshot.measurements, store.records]);
  const unusedMeasurementIds = useMemo(
    () => new Set(measurements.map((item) => item.measurementRecordId)),
    [measurements],
  );
  const usedMeasurements = snapshot.measurements.filter((item) => !unusedMeasurementIds.has(item.measurementRecordId));
  const exactSessionMatches = selectSessionMatchedMeasurements(measurements, rawConversation?.measurementSessionId);
  const exactMeasurementId = exactSessionMatches.length === 1
    ? exactSessionMatches[0].measurementRecordId
    : "";
  const selectedMeasurement = measurements.find((item) => item.measurementRecordId === measurementId) ?? null;
  const selectedTask = taskId ? store.tasks.find((task) => task.id === taskId) ?? null : null;

  useEffect(() => {
    setMeasurementId(exactMeasurementId);
  }, [sourceEventId, exactMeasurementId]);

  useEffect(() => {
    const reload = () => {
      setStore(safeLoadWeeklyStore());
      setRevision((value) => value + 1);
      setLoadError("");
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === TIME_ACCOUNTING_STORAGE_BASE_KEY) reload();
    };
    const onVisible = () => { if (document.visibilityState === "visible") reload(); };
    window.addEventListener(TIME_ACCOUNTING_CHANGED_EVENT, reload);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", reload);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(TIME_ACCOUNTING_CHANGED_EVENT, reload);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", reload);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  function refresh() {
    try {
      setStore(loadWeeklyRecordStore());
      setRevision((value) => value + 1);
      setLoadError("");
      setMessage("拡張機能の会話と実測時間を再読み込みしました。");
    } catch (error) {
      setLoadError(messageOf(error, "連携データを読み込めませんでした。保存値は変更していません。"));
    }
  }

  function selectTask(value: string) {
    setTaskId(value);
    const task = store.tasks.find((item) => item.id === value);
    if (task?.activityCategory) setCategory(task.activityCategory);
    setMessage("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    if (!rawConversation) { setMessage("拡張機能から会話を送信してください。"); return; }
    if (!selectedMeasurement) { setMessage("この会話に対応する実測時間を本人が選択してください。"); return; }
    if (selectedTask?.plannedAiasLevel === 1) {
      setMessage("Level 1はAI不使用の課題です。実測AI利用時間とは関連付けられません。");
      return;
    }
    if (privacy === "off") {
      setMessage("保存範囲がoffのため、会話・時間・週次活動は保存していません。");
      return;
    }
    setBusy(true);
    try {
      const result = await saveExtensionWeeklyRecord(buildConfirmedExtensionRecord({
        rawConversation,
        measurement: selectedMeasurement,
        privacy,
        taskId: taskId || null,
        activityCategory: category,
        accountingDisposition: disposition,
        interactionSummary,
        ownThoughts,
        discovery,
      }));
      setStore(result.store);
      setMessage(result.deduplicated
        ? "同じ会話と実測時間はすでに取り込み済みです。二重登録していません。"
        : "本人確認済みの活動として保存しました。週次記録・仕訳・決算・振り返りから参照できます。");
    } catch (error) {
      setMessage(messageOf(error, "週次活動へ取り込めませんでした。既存データは変更していません。"));
    } finally {
      setBusy(false);
    }
  }

  return <div className="weekly-extension-screen stack">
    <details className="weekly-intro-card weekly-extension-help" open={!rawConversation}>
      <summary>Chrome拡張機能との連携方法</summary>
      <div>
        <p className="eyebrow">研究用ローカル連携</p>
        <h2>会話と実測時間を関連付ける</h2>
        <p>計測中に会話を取り込んだ場合は同じ計測セッションの候補を優先します。日時や題名だけでは推測せず、本人が実測時間を確認してから週次活動にします。</p>
        <button type="button" className="secondary-action" onClick={refresh}>連携データを再読み込み</button>
      </div>
    </details>

    {loadError && <p className="weekly-form-message error" role="alert">{loadError}</p>}

    <section className="weekly-panel" aria-labelledby="extension-conversation-heading">
      <div className="weekly-section-heading"><span>1</span><div><p className="eyebrow">端末内の最新データ</p><h3 id="extension-conversation-heading">取り込んだ会話</h3></div></div>
      {!rawConversation ? <p className="weekly-empty">会話がありません。AI会話ページで拡張機能を開き、送信先「研究用ローカル（5174）」へ送ってください。</p> : <article className="weekly-import-summary">
        <strong>{rawConversation.conversationTitle || "無題の会話"}</strong>
        <p>{rawConversation.aiService || "AIサービス不明"}／取得日時 {rawConversation.capturedAt || "不明"}／{rawConversation.messages?.length ?? 0}メッセージ</p>
        <p className="weekly-muted">会話本文は端末内にあります。ここでは本人がfullを選んで保存し、分析時に別途同意するまでGeminiへ送信しません。</p>
        {existing && <p className="weekly-import-linked">この会話は{existing.activeSeconds}秒の活動として保存済みです。新規取り込みフォームは表示しません。</p>}
        {!existing && rawConversation.measurementSessionId && exactSessionMatches.length === 1 && <p className="weekly-import-linked">同じ計測セッションの時間候補を選択しました。保存前に日時と秒数を確認してください。</p>}
        {!existing && rawConversation.measurementSessionId && exactSessionMatches.length > 1 && <p className="weekly-no-ai-notice">同じ計測に複数の時間候補があります。推測で割り振らず、本人が対応する時間を選択してください。</p>}
        {!existing && rawConversation.measurementSessionId && exactSessionMatches.length === 0 && measurements.length === 0 && <p className="weekly-no-ai-notice">この会話の計測セッションはまだ時間台帳へ取り込まれていません。先に拡張機能から確定済み時間を連携してください。</p>}
        {!existing && rawConversation.measurementSessionId && exactSessionMatches.length === 0 && measurements.length > 0 && <p className="weekly-no-ai-notice">同じ計測セッションの候補はありません。別の会話へ推測で紐付けず、日時と秒数を本人が確認してください。</p>}
        {!existing && !rawConversation.measurementSessionId && measurements.length > 0 && <p className="weekly-no-ai-notice">会話取得時の計測セッションを確認できません。日時と秒数を本人が確認して選択してください。</p>}
      </article>}
      <div className="weekly-measurement-usage" aria-label="実測時間の使用状況">
        <article><span>未使用の実測時間</span><strong>{measurements.length}件・{sumSeconds(measurements)}秒</strong><small>これから活動に関連付けられます</small></article>
        <article className="used"><span>使用済みの実測時間</span><strong>{usedMeasurements.length}件・{sumSeconds(usedMeasurements)}秒</strong><small>保存済み活動に関連付け済みです</small></article>
      </div>
    </section>

    {existing ? <section className="weekly-panel weekly-existing-import" aria-labelledby="extension-existing-heading">
      <div className="weekly-section-heading"><span>✓</span><div><p className="eyebrow">保存済み</p><h3 id="extension-existing-heading">活動・分析・本人確認へ進む</h3></div></div>
      <p>保存済み活動から、Gemini分析、本人による補足・異議、会計区分を確認できます。</p>
      <button className="primary-action" type="button" onClick={onOpenRecords}>保存済み活動を確認する</button>
    </section> : <section className="weekly-panel" aria-labelledby="extension-link-heading">
      <div className="weekly-section-heading"><span>2</span><div><p className="eyebrow">本人による対応確認</p><h3 id="extension-link-heading">実測時間と活動を確定</h3></div></div>
      <form className="weekly-form" onSubmit={submit}>
        <label>対応する実測時間<select required value={measurementId} onChange={(event) => { setMeasurementId(event.target.value); setMessage(""); }}>
          <option value="">本人が選択してください（推測しません）</option>
          {measurements.map((item) => <option key={item.measurementRecordId} value={item.measurementRecordId}>{measurementLabel(item)}</option>)}
        </select><small>ここで選んだ確定済み時間だけを「実測」として関連付けます。同じ時間記録は別の活動に使えません。</small></label>
        {snapshot.measurements.length === 0 && <p className="weekly-no-ai-notice">先に拡張機能の「帳簿へ連携」で確定済み時間を取り込み、画面上部の確認操作で時間台帳へ保存してください。</p>}
        <label>関連するAIAS課題（任意）<select value={taskId} onChange={(event) => selectTask(event.target.value)}><option value="">指定しない</option>{store.tasks.map((task) => <option key={task.id} value={task.id}>{task.title}（Level {task.plannedAiasLevel ?? "未設定"}）</option>)}</select><small>日常利用では未設定のままでも取り込めます。AIAS Levelは能力評価には使いません。</small></label>
        <div className="weekly-form-grid">
          <label>本人確認後の活動テーマ<select value={category} onChange={(event) => setCategory(event.target.value as typeof category)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>本人確認後の会計区分<select value={disposition} onChange={(event) => setDisposition(event.target.value as AccountingDisposition)}><option value="unclassified">未分類</option><option value="expense">費用</option><option value="asset">成果物資産</option><option value="work-in-progress">仕掛成果物</option></select></label>
          <label>保存範囲<select value={privacy} onChange={(event) => setPrivacy(event.target.value as WeeklyPrivacyChoice)}><option value="full">会話本文と時間を保存</option><option value="time-only">時間のみ保存</option><option value="off">保存しない</option></select></label>
        </div>
        {privacy !== "full" && <p className="weekly-privacy-notice">{privacy === "time-only" ? "会話本文は週次データに保存せず、Gemini分析も実行できません。" : "会話・時間・週次活動を保存しません。"}</p>}
        <label>AIとのやり取りの概要（本人入力）<textarea disabled={privacy !== "full"} value={interactionSummary} onChange={(event) => setInteractionSummary(event.target.value)} /></label>
        <label>自分が考えたこと・判断したこと（本人入力）<textarea disabled={privacy !== "full"} value={ownThoughts} onChange={(event) => setOwnThoughts(event.target.value)} /></label>
        <label>発見・学び（本人入力）<textarea disabled={privacy !== "full"} value={discovery} onChange={(event) => setDiscovery(event.target.value)} /></label>
        <div className="weekly-form-actions">
          <button className="primary-action" type="submit" disabled={busy || !rawConversation}>{busy ? "保存中…" : "本人確認して週次活動に取り込む"}</button>
          <button className="secondary-action" type="button" onClick={onOpenRecords}>保存した活動・Gemini分析へ</button>
        </div>
        {message && <p className="weekly-form-message" role="status">{message}</p>}
      </form>
    </section>}
  </div>;
}

function loadSnapshot() {
  try {
    const timeKey = globalThis.location?.pathname?.startsWith("/accounting-of-AI/preview/")
      ? `preview-month-ledger:${TIME_ACCOUNTING_STORAGE_BASE_KEY}`
      : TIME_ACCOUNTING_STORAGE_BASE_KEY;
    return {
      conversation: loadExtensionConversationDraft(),
      measurements: buildMeasuredTimeCandidates(loadTimeAccountingStore(window.localStorage, timeKey)),
    };
  } catch {
    return { conversation: null, measurements: Object.freeze([]) as readonly MeasuredTimeCandidate[] };
  }
}

function safeLoadWeeklyStore(): WeeklyRecordStoreV1 {
  try { return loadWeeklyRecordStore(); } catch {
    return Object.freeze({ schemaVersion: 1, records: Object.freeze([]), tasks: Object.freeze([]) });
  }
}

function measurementLabel(item: MeasuredTimeCandidate) {
  return `${item.localDate} ${formatTime(item.startedAt)}〜${formatTime(item.endedAt)}／${item.activeSeconds}秒／${item.provider}`;
}

function sumSeconds(items: readonly MeasuredTimeCandidate[]) {
  return items.reduce((total, item) => total + item.activeSeconds, 0);
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
