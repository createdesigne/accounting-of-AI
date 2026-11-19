import { useCallback, useEffect, useMemo, useState } from "react";
import { formatPeriod, periodBounds, shiftPeriod } from "../ledgerPeriods.ts";
import { TIME_ACCOUNTING_CHANGED_EVENT } from "../timeAccountingEvents.ts";
import { TIME_ACCOUNTING_STORAGE_BASE_KEY, loadTimeAccountingStore } from "../timeAccountingStore.ts";
import { buildWeeklyDashboardData } from "../weeklyDashboard.ts";
import { buildMeasuredTimeCandidates, selectUnlinkedMeasuredTimeCandidates } from "../weeklyExtensionImport.ts";
import { loadWeeklyAnalysisStore, resolveWeeklyAnalysisState, WEEKLY_ANALYSES_STORAGE_KEY, type WeeklyAnalysisStoreV1 } from "../weeklyAnalysisStore.ts";
import { loadWeeklyConversationStore, loadWeeklyRecordStore, WEEKLY_CONVERSATIONS_STORAGE_KEY, WEEKLY_RECORDS_STORAGE_KEY, type WeeklyConversationStoreV1, type WeeklyRecordStoreV1 } from "../weeklyStore.ts";
import type { AccountingDisposition, WeeklyTimeSource } from "../weeklyData.ts";
import "./weeklyDashboardScreen.css";

export function WeeklyDashboardScreen({
  onOpenRecords,
  onOpenSavedRecords,
  onOpenReflection,
}: {
  onOpenRecords: () => void;
  onOpenSavedRecords: () => void;
  onOpenReflection: (anchor: Date) => void;
}) {
  const [anchor, setAnchor] = useState(() => new Date());
  const [store, setStore] = useState<WeeklyRecordStoreV1>(() => emptyOrLoadedStore());
  const [conversations, setConversations] = useState<WeeklyConversationStoreV1>(() => emptyOrLoadedConversations());
  const [analyses, setAnalyses] = useState<WeeklyAnalysisStoreV1>(() => emptyOrLoadedAnalyses());
  const [loadError, setLoadError] = useState("");
  const dashboard = useMemo(
    () => buildWeeklyDashboardData(store.records, store.tasks, anchor),
    [store.records, store.tasks, anchor],
  );
  const currentWeekStart = periodBounds(new Date(), "weekly").start;
  const isCurrentWeek = dashboard.weekStart.getTime() === currentWeekStart.getTime();
  const conversationByRecord = useMemo(() => new Map(conversations.conversations.map((item) => [item.recordId, item])), [conversations.conversations]);
  const analysisCounts = useMemo(() => dashboard.records.reduce((counts, item) => {
    const status = resolveWeeklyAnalysisState(item.record, analyses, conversationByRecord.get(item.record.id) ?? null).analysisStatus;
    counts[status] += 1;
    return counts;
  }, { "not-connected": 0, pending: 0, complete: 0, partial: 0, failed: 0, "not-applicable": 0 }), [dashboard.records, analyses, conversationByRecord]);
  const unclassifiedAccountingCount = dashboard.records.filter(({ record }) => record.accountingDisposition === "unclassified").length;
  const unlinkedMeasurements = useMemo(
    () => loadUnlinkedMeasurements(store).filter((item) => (
      new Date(item.endedAt) > dashboard.weekStart && new Date(item.startedAt) < dashboard.weekEndExclusive
    )),
    [store, dashboard.weekStart, dashboard.weekEndExclusive],
  );
  const unlinkedMeasurementSeconds = unlinkedMeasurements.reduce((total, item) => total + item.activeSeconds, 0);

  const refresh = useCallback(() => {
    try {
      setStore(loadWeeklyRecordStore());
      setConversations(loadWeeklyConversationStore());
      setAnalyses(loadWeeklyAnalysisStore());
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "週次データを読み込めませんでした。");
    }
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === WEEKLY_RECORDS_STORAGE_KEY || event.key === WEEKLY_CONVERSATIONS_STORAGE_KEY || event.key === WEEKLY_ANALYSES_STORAGE_KEY || event.key === TIME_ACCOUNTING_STORAGE_BASE_KEY || event.key === null) refresh();
    };
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener(TIME_ACCOUNTING_CHANGED_EVENT, refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(TIME_ACCOUNTING_CHANGED_EVENT, refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  function moveWeek(amount: number) {
    setAnchor((current) => shiftPeriod(current, "weekly", amount));
  }

  return (
    <div className="weekly-dashboard stack">
      <section className="weekly-dashboard-hero">
        <p className="eyebrow light">週次ダッシュボード</p>
        <div className="weekly-dashboard-title-row">
          <div><h2>{isCurrentWeek ? "今週のAI実利用時間" : "選択した週のAI実利用時間"}</h2><p>{formatPeriod(anchor, "weekly")}</p></div>
          <span>{dashboard.recordCount}件</span>
        </div>
        <strong className="weekly-dashboard-total">{formatDuration(dashboard.totalSeconds)}</strong>
        <small>保存済みの実記録だけを集計しています。秒を金額や評価点へ換算していません。</small>
      </section>

      <nav className="weekly-week-navigation" aria-label="表示する週">
        <button type="button" onClick={() => moveWeek(-1)}>← 前の週</button>
        <button type="button" className="current-week-button" disabled={isCurrentWeek} onClick={() => setAnchor(new Date())}>今週</button>
        <button type="button" disabled={isCurrentWeek} onClick={() => moveWeek(1)}>次の週 →</button>
      </nav>

      <section className="weekly-dashboard-panel weekly-dashboard-next" aria-labelledby="weekly-next-action-heading">
        <div className="weekly-dashboard-heading"><div><p className="eyebrow">迷ったらここから</p><h3 id="weekly-next-action-heading">次にすること</h3></div></div>
        <div className="weekly-dashboard-actions">
          <button className="weekly-dashboard-record-button" type="button" onClick={onOpenRecords}><strong>新しい会話・時間を取り込む</strong><small>拡張機能の記録を確認して保存</small></button>
          <button className="weekly-dashboard-record-button secondary" type="button" onClick={onOpenSavedRecords}><strong>保存済み活動を確認</strong><small>分析・本人確認・会計区分を編集</small></button>
          <button className="weekly-dashboard-record-button reflection" type="button" onClick={() => onOpenReflection(anchor)}><strong>この週の振り返りを開く</strong><small>本人の発見と次週の挑戦を記録</small></button>
        </div>
      </section>

      {loadError && <p className="weekly-dashboard-error" role="alert">{loadError}</p>}

      <section className="weekly-dashboard-status-grid" aria-label="未処理と分析の状態">
        <article className="weekly-dashboard-status-card">
          <span>会計区分が未分類の活動</span>
          <strong>{unclassifiedAccountingCount}件</strong>
          <small>本人が会計区分を確認するまで未分類として保持します。</small>
        </article>
        <article className="weekly-dashboard-status-card measured">
          <span>活動に未紐付けの実測時間</span>
          <strong>{unlinkedMeasurements.length}件・{formatDuration(unlinkedMeasurementSeconds)}</strong>
          <small>会計には取り込み済みですが、週次活動としてはまだ確定していません。</small>
        </article>
        <article className="weekly-dashboard-status-card analysis">
          <span>AI分析の状態</span>
          <strong>{dashboard.recordCount === 0 ? "記録なし" : `${dashboard.recordCount}件の内訳`}</strong>
          <div className="weekly-analysis-counts">
            <span>分析済み <b>{analysisCounts.complete}件</b></span>
            <span>一部未評価 <b>{analysisCounts.partial}件</b></span>
            <span>未分析 <b>{analysisCounts["not-connected"]}件</b></span>
            <span>分析待ち <b>{analysisCounts.pending}件</b></span>
            <span>分析失敗 <b>{analysisCounts.failed}件</b></span>
            <span>対象外 <b>{analysisCounts["not-applicable"]}件</b></span>
          </div>
        </article>
      </section>

      <section className="weekly-dashboard-panel" aria-labelledby="weekly-time-source-heading">
        <div className="weekly-dashboard-heading"><div><p className="eyebrow">計測方法</p><h3 id="weekly-time-source-heading">時間の記録元</h3></div></div>
        <div className="weekly-source-grid">
          {dashboard.sources.map((source) => <article key={source.source}>
            <span>{sourceLabel(source.source)}</span>
            <strong>{formatDuration(source.seconds)}</strong>
            <small>{source.count}件</small>
          </article>)}
        </div>
        <p className="weekly-dashboard-note">手入力は「実測」と表示しません。自動計測値が保存された場合も別枠で集計します。</p>
      </section>

      <section className="weekly-dashboard-panel" aria-labelledby="weekly-category-heading">
        <div className="weekly-dashboard-heading"><div><p className="eyebrow">活動テーマ別</p><h3 id="weekly-category-heading">利用時間と件数</h3></div></div>
        {dashboard.categories.length === 0 ? <EmptyMessage /> : <div className="weekly-category-list">
          {dashboard.categories.map((row) => <div key={row.category ?? "unclassified"}>
            <span>{row.category ?? "未分類"}</span>
            <strong>{formatDuration(row.seconds)}</strong>
            <small>{row.count}件</small>
          </div>)}
        </div>}
      </section>

      <section className="weekly-dashboard-panel" aria-labelledby="weekly-task-list-heading">
        <div className="weekly-dashboard-heading"><div><p className="eyebrow">活動前の設定</p><h3 id="weekly-task-list-heading">登録済みのAIAS課題</h3></div></div>
        <p className="weekly-dashboard-note">AIAS Levelは課題におけるAIの役割設定です。能力評価や成長スコアではありません。</p>
        {dashboard.tasks.length === 0 ? <p className="weekly-dashboard-empty">この週に登録・使用された課題設定はありません。</p> : <div className="weekly-dashboard-task-list">
          {dashboard.tasks.map((task) => <article key={task.id}>
            <div><strong>{task.title}</strong><span>Level {task.plannedAiasLevel ?? "未設定"}</span></div>
            <p>{task.goal ?? "活動目的なし"}</p>
            <small>{task.activityCategory ?? "未分類"} · {task.plannedAiasLevel === 1 ? "AI不使用" : task.delegatedToAi ?? "AIの役割未設定"}</small>
          </article>)}
        </div>}
      </section>

      <section className="weekly-dashboard-panel" aria-labelledby="weekly-history-heading">
        <div className="weekly-dashboard-heading"><div><p className="eyebrow">保存済み実データ</p><h3 id="weekly-history-heading">週次活動履歴</h3></div><span>{dashboard.recordCount}件</span></div>
        {dashboard.records.length === 0 ? <EmptyMessage /> : <div className="weekly-dashboard-history">
          {dashboard.records.map(({ record, allocatedSeconds }) => {
            const task = record.taskId ? store.tasks.find((item) => item.id === record.taskId) : undefined;
            const noAi = record.analysisStatus === "not-applicable" || task?.plannedAiasLevel === 1;
            const actualAnalysis = resolveWeeklyAnalysisState(record, analyses, conversationByRecord.get(record.id) ?? null);
            return <article key={record.id}>
              <div className="weekly-history-top"><div><time>{formatDateTime(record.recordedAt)}</time><strong>{task?.title ?? record.activityCategory ?? "未分類の活動"}</strong></div><span>{noAi ? "AI不使用" : formatDuration(allocatedSeconds)}</span></div>
              <div className="weekly-history-tags"><span>{record.activityCategory ?? "未分類"}</span><span>{sourceLabel(record.timeSource)}</span><span>{dispositionLabel(record.accountingDisposition)}</span>{task && <span>Level {task.plannedAiasLevel ?? "未設定"}</span>}</div>
              <p>{record.manualNotes?.discovery ?? record.manualNotes?.ownThoughts ?? (record.privacy === "time-only" ? "本文を保存しない記録" : "本人メモなし")}</p>
              <small>{noAi ? "AI分析対象外" : `AI分析：${analysisStatusLabel(actualAnalysis.analysisStatus)}`}</small>
            </article>;
          })}
        </div>}
      </section>

    </div>
  );
}

function EmptyMessage() {
  return <p className="weekly-dashboard-empty">この週の記録はありません。0件として集計しています。</p>;
}

function emptyOrLoadedStore(): WeeklyRecordStoreV1 {
  try { return loadWeeklyRecordStore(); } catch { return Object.freeze({ schemaVersion: 1, records: Object.freeze([]), tasks: Object.freeze([]) }); }
}

function emptyOrLoadedConversations(): WeeklyConversationStoreV1 {
  try { return loadWeeklyConversationStore(); } catch { return Object.freeze({ schemaVersion: 1, conversations: Object.freeze([]) }); }
}

function emptyOrLoadedAnalyses(): WeeklyAnalysisStoreV1 {
  try { return loadWeeklyAnalysisStore(); } catch { return Object.freeze({ schemaVersion: 1, entries: Object.freeze([]) }); }
}

function loadUnlinkedMeasurements(store: WeeklyRecordStoreV1) {
  try {
    return selectUnlinkedMeasuredTimeCandidates(
      buildMeasuredTimeCandidates(loadTimeAccountingStore()),
      store.records,
    );
  } catch {
    return Object.freeze([]);
  }
}

function analysisStatusLabel(value: "not-connected" | "pending" | "complete" | "partial" | "failed" | "not-applicable") {
  return { "not-connected": "未分析", pending: "分析待ち", complete: "分析完了", partial: "一部未評価", failed: "分析失敗", "not-applicable": "対象外" }[value];
}

function sourceLabel(source: WeeklyTimeSource) {
  return { manual: "手入力", measured: "自動計測", adjusted: "補正", unknown: "取得方法不明" }[source];
}

function dispositionLabel(value: AccountingDisposition) {
  return { expense: "費用", asset: "成果物資産", "work-in-progress": "仕掛成果物", unclassified: "未分類" }[value];
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return `${hours > 0 ? `${hours}時間` : ""}${minutes}分${String(rest).padStart(2, "0")}秒`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
