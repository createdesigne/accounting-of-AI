import { useCallback, useEffect, useMemo, useState } from "react";
import { formatPeriod, shiftPeriod } from "../ledgerPeriods.ts";
import { buildWeeklyDashboardData } from "../weeklyDashboard.ts";
import {
  loadWeeklyAnalysisStore,
  resolveWeeklyAnalysisState,
  WEEKLY_ANALYSES_STORAGE_KEY,
  type WeeklyAnalysisStoreV1,
} from "../weeklyAnalysisStore.ts";
import {
  loadWeeklyReflectionStore,
  getWeeklyReflectionNavigation,
  previousWeekReflection,
  reflectionForWeek,
  saveWeeklyReflection,
  WEEKLY_REFLECTIONS_STORAGE_KEY,
  type WeeklyReflectionActivityRefV1,
  type WeeklyReflectionStoreV1,
} from "../weeklyReflectionStore.ts";
import {
  loadWeeklyConversationStore,
  loadWeeklyRecordStore,
  WEEKLY_CONVERSATIONS_STORAGE_KEY,
  WEEKLY_RECORDS_STORAGE_KEY,
  type WeeklyConversationStoreV1,
  type WeeklyRecordStoreV1,
} from "../weeklyStore.ts";
import type { WeeklyRecordV1 } from "../weeklyData.ts";
import "./weeklyReflectionScreen.css";

type ReflectionDraft = {
  discoveryLearning: string;
  humanJudgment: string;
  relationshipReflection: string;
  nextWeekChallenge: string;
  selectedActivities: readonly WeeklyReflectionActivityRefV1[];
};

const emptyDraft: ReflectionDraft = {
  discoveryLearning: "",
  humanJudgment: "",
  relationshipReflection: "",
  nextWeekChallenge: "",
  selectedActivities: Object.freeze([]),
};

export function WeeklyReflectionScreen({
  initialAnchor,
  onOpenRecords,
}: {
  initialAnchor: Date;
  onOpenRecords: () => void;
}) {
  const [anchor, setAnchor] = useState(() => new Date(initialAnchor));
  const [records, setRecords] = useState<WeeklyRecordStoreV1>(() => loadRecordsSafely());
  const [conversations, setConversations] = useState<WeeklyConversationStoreV1>(() => loadConversationsSafely());
  const [analyses, setAnalyses] = useState<WeeklyAnalysisStoreV1>(() => loadAnalysesSafely());
  const [reflections, setReflections] = useState<WeeklyReflectionStoreV1>(() => loadReflectionsSafely());
  const [draft, setDraft] = useState<ReflectionDraft>(emptyDraft);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const dashboard = useMemo(
    () => buildWeeklyDashboardData(records.records, records.tasks, anchor),
    [records.records, records.tasks, anchor],
  );
  const savedReflection = useMemo(() => reflectionForWeek(reflections, anchor), [reflections, anchor]);
  const previousReflection = useMemo(() => previousWeekReflection(reflections, anchor), [reflections, anchor]);
  const weekKey = dashboard.weekKey;
  const navigation = getWeeklyReflectionNavigation(anchor);
  const conversationByRecord = useMemo(
    () => new Map(conversations.conversations.map((item) => [item.recordId, item])),
    [conversations.conversations],
  );
  const analysisCounts = useMemo(() => dashboard.records.reduce((counts, { record }) => {
    const status = resolveWeeklyAnalysisState(record, analyses, conversationByRecord.get(record.id) ?? null).analysisStatus;
    counts[status] += 1;
    return counts;
  }, { "not-connected": 0, pending: 0, complete: 0, partial: 0, failed: 0, "not-applicable": 0 }), [dashboard.records, analyses, conversationByRecord]);

  useEffect(() => {
    setDraft(savedReflection ? {
      discoveryLearning: savedReflection.discoveryLearning,
      humanJudgment: savedReflection.humanJudgment,
      relationshipReflection: savedReflection.relationshipReflection,
      nextWeekChallenge: savedReflection.nextWeekChallenge,
      selectedActivities: savedReflection.selectedActivities,
    } : emptyDraft);
  }, [weekKey, savedReflection?.updatedAt]);

  const refresh = useCallback(() => {
    try {
      setRecords(loadWeeklyRecordStore());
      setConversations(loadWeeklyConversationStore());
      setAnalyses(loadWeeklyAnalysisStore());
      setReflections(loadWeeklyReflectionStore());
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "振り返りデータを読み込めませんでした。");
    }
  }, []);

  useEffect(() => {
    refresh();
    const onStorage = (event: StorageEvent) => {
      if (event.key === WEEKLY_RECORDS_STORAGE_KEY || event.key === WEEKLY_CONVERSATIONS_STORAGE_KEY || event.key === WEEKLY_ANALYSES_STORAGE_KEY || event.key === WEEKLY_REFLECTIONS_STORAGE_KEY || event.key === null) refresh();
    };
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  function moveWeek(amount: number) {
    setAnchor((current) => shiftPeriod(current, "weekly", amount));
    setMessage("");
    setError("");
  }

  function moveToCurrentWeek() {
    setAnchor(new Date());
    setMessage("");
    setError("");
  }

  function toggleActivity(record: WeeklyRecordV1) {
    if (navigation.isFutureWeek) return;
    const selected = draft.selectedActivities.some((item) => item.recordId === record.id);
    if (selected) {
      setDraft((current) => ({ ...current, selectedActivities: current.selectedActivities.filter((item) => item.recordId !== record.id) }));
      return;
    }
    if (draft.selectedActivities.length >= 3) {
      setError("代表的な活動は最大3件まで選択できます。");
      return;
    }
    setError("");
    setDraft((current) => ({
      ...current,
      selectedActivities: [...current.selectedActivities, Object.freeze({
        recordId: record.id,
        thoughtReceiptId: record.links.thoughtReceiptId,
      })],
    }));
  }

  function removeActivityReference(recordId: string) {
    setDraft((current) => ({
      ...current,
      selectedActivities: current.selectedActivities.filter((item) => item.recordId !== recordId),
    }));
  }

  async function save() {
    if (navigation.isFutureWeek) {
      setError("翌週の準備表示では振り返りを保存できません。週が始まってから入力してください。");
      return;
    }
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const result = await saveWeeklyReflection({ anchor, ...draft });
      setReflections(result.store);
      setMessage("本人による週次の振り返りを端末内に保存しました。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "振り返りを保存できませんでした。");
    } finally {
      setSaving(false);
    }
  }

  const missingSelections = draft.selectedActivities.filter((reference) => (
    !dashboard.records.some(({ record }) => record.id === reference.recordId)
  ));
  const hasUnsavedChanges = !draftMatchesReflection(draft, savedReflection);
  const saveState = savedReflection
    ? hasUnsavedChanges ? "未保存の変更あり" : "保存済み"
    : "未保存";

  return (
    <div className="weekly-reflection stack">
      <section className="weekly-reflection-hero">
        <div><p className="eyebrow light">本人による記録</p><h2>{navigation.isNextWeek ? "翌週の準備表示" : navigation.isCurrentWeek ? "今週の振り返り" : "選択した週の振り返り"}</h2><p>{formatPeriod(anchor, "weekly")}</p></div>
        <span className={hasUnsavedChanges ? "unsaved" : "saved"} aria-live="polite">{saveState}</span>
      </section>

      {navigation.isNextWeek && <section className="weekly-reflection-preparation" aria-label="翌週の準備表示について">
        <strong>翌週の準備表示</strong>
        <p>今週に設定した「来週の小さな挑戦」を事前に確認できます。振り返りの入力と保存は、翌週が始まってから利用できます。</p>
      </section>}

      <nav className="weekly-week-navigation" aria-label="振り返る週">
        <button type="button" onClick={() => moveWeek(-1)}>← 前の週</button>
        <button type="button" className="current-week-button" disabled={navigation.isCurrentWeek} onClick={moveToCurrentWeek}>今週</button>
        <button type="button" disabled={!navigation.canMoveNext} onClick={() => moveWeek(1)}>次の週 →</button>
      </nav>

      {error && <p className="weekly-reflection-alert error" role="alert">{error}</p>}
      {message && <p className="weekly-reflection-alert success" role="status">{message}</p>}

      {previousReflection?.nextWeekChallenge && <section className="weekly-reflection-previous-challenge" aria-labelledby="previous-challenge-heading">
        <div><p className="eyebrow">前週からの引き継ぎ</p><h3 id="previous-challenge-heading">前週に設定した小さな挑戦</h3></div>
        <p>{previousReflection.nextWeekChallenge}</p>
      </section>}

      <section className="weekly-reflection-panel" aria-labelledby="reflection-input-heading">
        <div className="weekly-reflection-heading"><div><p className="eyebrow">自分の言葉で記録</p><h3 id="reflection-input-heading">週を振り返る</h3></div></div>
        <p className="weekly-reflection-note">本人が自分の言葉で入力します。AIが自動生成したり、内容を上書きしたりすることはありません。</p>
        <div className="weekly-reflection-fields">
          <label>今週の大きな発見・学び<textarea disabled={navigation.isFutureWeek} value={draft.discoveryLearning} onChange={(event) => setDraft({ ...draft, discoveryLearning: event.target.value })} placeholder="気づいたこと、学んだことを自分の言葉で記録" /></label>
          <label>AIの提案に対して自分が判断・修正したこと<textarea disabled={navigation.isFutureWeek} value={draft.humanJudgment} onChange={(event) => setDraft({ ...draft, humanJudgment: event.target.value })} placeholder="採用しなかった案、修正した点、最後に自分で決めたこと" /></label>
          <label>来週の小さな挑戦<textarea disabled={navigation.isFutureWeek} value={draft.nextWeekChallenge} onChange={(event) => setDraft({ ...draft, nextWeekChallenge: event.target.value })} placeholder="来週試したい、小さく具体的な行動" /></label>
        </div>
        <details className="weekly-reflection-extra-question">
          <summary>AIとの関わり方も振り返る（任意）</summary>
          <label>今週のAIとの関わり方についての振り返り<textarea disabled={navigation.isFutureWeek} value={draft.relationshipReflection} onChange={(event) => setDraft({ ...draft, relationshipReflection: event.target.value })} placeholder="AIに任せた範囲と、自分で考えた範囲を振り返る" /></label>
        </details>
      </section>

      <details className="weekly-reflection-panel weekly-reflection-disclosure">
        <summary><span><small>任意・最大3件</small><strong id="important-activities-heading">代表的な活動を選ぶ</strong></span><b>{draft.selectedActivities.length}/3件</b></summary>
        <div className="weekly-reflection-disclosure-body">
          <p className="weekly-reflection-note">選択した活動は思考レシートと関連付けて研究データに保持します。選ばなくても保存できます。</p>
          {dashboard.records.length === 0 ? <p className="weekly-reflection-empty compact">この週の活動は0件です。</p> : (
            <div className="weekly-reflection-activities">
              {dashboard.records.map(({ record, allocatedSeconds }) => {
                const selected = draft.selectedActivities.some((item) => item.recordId === record.id);
                const task = record.taskId ? records.tasks.find((item) => item.id === record.taskId) : undefined;
                return <label key={record.id} className={`${selected ? "selected" : ""}${navigation.isFutureWeek ? " disabled" : ""}`}>
                  <input type="checkbox" checked={selected} onChange={() => toggleActivity(record)} disabled={navigation.isFutureWeek || (!selected && draft.selectedActivities.length >= 3)} />
                  <span className="weekly-reflection-activity-copy">
                    <span><strong>{task?.title ?? record.activityCategory ?? "未分類の活動"}</strong><b>{formatDuration(allocatedSeconds)}</b></span>
                    <small>{formatActivityDate(record.recordedAt)}・{record.activityCategory ?? "未分類"}・{sourceLabel(record.timeSource)}</small>
                    <small>{task ? `AIAS Level ${task.plannedAiasLevel ?? "未設定"}（課題でのAIの役割）` : "AIAS課題設定なし"}</small>
                    <p>{record.manualNotes?.discovery ?? record.manualNotes?.ownThoughts ?? "本人による活動メモなし"}</p>
                  </span>
                </label>;
              })}
            </div>
          )}
          {missingSelections.length > 0 && <div className="weekly-reflection-missing">
            <h4>現在の活動一覧にない保存済みリンク</h4>
            {missingSelections.map((reference) => <div key={reference.recordId}><span>以前選択した活動（現在の活動一覧にはありません）</span><button type="button" onClick={() => removeActivityReference(reference.recordId)}>選択から外す</button></div>)}
          </div>}
        </div>
      </details>

      <details className="weekly-reflection-panel weekly-reflection-disclosure">
        <summary><span><small>研究用・入力内容は変更しません</small><strong>研究用の補助情報を見る</strong></span><b>{dashboard.tasks.length > 0 ? `AIAS ${dashboard.tasks.length}件` : "分析状態"}</b></summary>
        <div className="weekly-reflection-disclosure-body weekly-reflection-research-details">
          {dashboard.tasks.length > 0 && <section aria-labelledby="reflection-aias-heading">
            <div className="weekly-reflection-heading"><div><p className="eyebrow">活動前の課題設計</p><h3 id="reflection-aias-heading">この週のAIAS課題設定</h3></div><strong>{dashboard.tasks.length}件</strong></div>
            <p className="weekly-reflection-note">AIAS Levelは課題でのAIの役割設定であり、利用者の能力評価ではありません。</p>
            <div className="weekly-reflection-task-list">
              {dashboard.tasks.map((task) => <article key={task.id}>
                <div><strong>{task.title}</strong><span>Level {task.plannedAiasLevel ?? "未設定"}</span></div>
                <p>{task.goal ?? "活動目的なし"}</p>
                <small>課題で設定したAIの役割：{task.plannedAiasLevel === 1 ? "AI不使用" : task.delegatedToAi ?? "未設定"}</small>
                <small>本人が判断する点：{task.humanDecision ?? "未設定"}</small>
              </article>)}
            </div>
          </section>}
          <section className="weekly-reflection-context" aria-label="AI分析状態の詳細">
            <p><strong>AI分析：</strong>分析済み {analysisCounts.complete}件／一部未評価 {analysisCounts.partial}件／未分析 {analysisCounts["not-connected"]}件／分析待ち {analysisCounts.pending}件／分析失敗 {analysisCounts.failed}件／対象外 {analysisCounts["not-applicable"]}件</p>
            <p>一部未評価は根拠不足の項目だけを保留した状態で、分析失敗とは異なります。</p>
            <p>本人の入力はAI分析と別に保存し、分析結果で上書きしません。</p>
          </section>
        </div>
      </details>

      <div className="weekly-reflection-actions">
        <button type="button" className="primary" disabled={saving || navigation.isFutureWeek} onClick={save}>{navigation.isFutureWeek ? "翌週開始後に保存できます" : saving ? "保存中…" : "振り返りを保存する"}</button>
        <button type="button" className="weekly-reflection-record-link" onClick={onOpenRecords}>活動記録を確認する</button>
      </div>
    </div>
  );
}

function draftMatchesReflection(draft: ReflectionDraft, saved: ReturnType<typeof reflectionForWeek>) {
  if (!saved) return false;
  return draft.discoveryLearning === saved.discoveryLearning
    && draft.humanJudgment === saved.humanJudgment
    && draft.relationshipReflection === saved.relationshipReflection
    && draft.nextWeekChallenge === saved.nextWeekChallenge
    && draft.selectedActivities.length === saved.selectedActivities.length
    && draft.selectedActivities.every((item, index) => item.recordId === saved.selectedActivities[index]?.recordId
      && item.thoughtReceiptId === saved.selectedActivities[index]?.thoughtReceiptId);
}

function loadRecordsSafely(): WeeklyRecordStoreV1 {
  try { return loadWeeklyRecordStore(); } catch { return Object.freeze({ schemaVersion: 1, records: Object.freeze([]), tasks: Object.freeze([]) }); }
}

function loadConversationsSafely(): WeeklyConversationStoreV1 {
  try { return loadWeeklyConversationStore(); } catch { return Object.freeze({ schemaVersion: 1, conversations: Object.freeze([]) }); }
}

function loadAnalysesSafely(): WeeklyAnalysisStoreV1 {
  try { return loadWeeklyAnalysisStore(); } catch { return Object.freeze({ schemaVersion: 1, entries: Object.freeze([]) }); }
}

function loadReflectionsSafely(): WeeklyReflectionStoreV1 {
  try { return loadWeeklyReflectionStore(); } catch { return Object.freeze({ schemaVersion: 1, reflections: Object.freeze([]) }); }
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}分${String(rest).padStart(2, "0")}秒`;
}

function sourceLabel(value: WeeklyRecordV1["timeSource"]) {
  return { manual: "手入力", measured: "自動計測", adjusted: "補正", unknown: "取得方法不明" }[value];
}

function formatActivityDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
