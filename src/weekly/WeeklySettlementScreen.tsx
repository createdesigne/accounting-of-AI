import { useCallback, useEffect, useMemo, useState } from "react";
import { formatPeriod, periodBounds, shiftPeriod } from "../ledgerPeriods.ts";
import type { WeeklyAccount } from "../weeklyAccounting.ts";
import { buildWeeklyDashboardData } from "../weeklyDashboard.ts";
import {
  loadWeeklyReflectionStore,
  reflectionForWeek,
  WEEKLY_REFLECTIONS_STORAGE_KEY,
  type WeeklyReflectionStoreV1,
} from "../weeklyReflectionStore.ts";
import {
  confirmWeeklySettlement,
  loadWeeklySettlementStore,
  previewWeeklySettlement,
  WEEKLY_SETTLEMENTS_STORAGE_KEY,
  type WeeklySettlementStoreV1,
} from "../weeklySettlementStore.ts";
import {
  loadWeeklyRecordStore,
  WEEKLY_RECORDS_STORAGE_KEY,
  type WeeklyRecordStoreV1,
} from "../weeklyStore.ts";
import type { WeeklyTimeSource } from "../weeklyData.ts";
import "./weeklySettlementScreen.css";

export function WeeklySettlementScreen({ onOpenRecords, onOpenReflection }: { onOpenRecords: () => void; onOpenReflection?: (anchor: Date) => void }) {
  const [anchor, setAnchor] = useState(() => new Date());
  const [records, setRecords] = useState<WeeklyRecordStoreV1>(() => loadRecordsSafely());
  const [history, setHistory] = useState<WeeklySettlementStoreV1>(() => loadHistorySafely());
  const [reflections, setReflections] = useState<WeeklyReflectionStoreV1>(() => loadReflectionsSafely());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const preview = useMemo(
    () => previewWeeklySettlement(records.records, records.tasks, anchor, history),
    [records.records, records.tasks, anchor, history],
  );
  const dashboard = useMemo(() => buildWeeklyDashboardData(records.records, records.tasks, anchor), [records.records, records.tasks, anchor]);
  const reflection = useMemo(() => reflectionForWeek(reflections, anchor), [reflections, anchor]);
  const largestCategorySeconds = Math.max(1, ...dashboard.categories.map((item) => item.seconds));
  const currentWeekStart = periodBounds(new Date(), "weekly").start;
  const isCurrentWeek = periodBounds(anchor, "weekly").start.getTime() === currentWeekStart.getTime();

  const refresh = useCallback(() => {
    try {
      setRecords(loadWeeklyRecordStore());
      setHistory(loadWeeklySettlementStore());
      setReflections(loadWeeklyReflectionStore());
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "週次決算データを読み込めませんでした。");
    }
  }, []);

  useEffect(() => {
    refresh();
    const onStorage = (event: StorageEvent) => {
      if (event.key === WEEKLY_RECORDS_STORAGE_KEY || event.key === WEEKLY_SETTLEMENTS_STORAGE_KEY || event.key === WEEKLY_REFLECTIONS_STORAGE_KEY || event.key === null) refresh();
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

  async function confirmPreview() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await confirmWeeklySettlement(records.records, records.tasks, anchor);
      setHistory(result.store);
      setMessage(result.inserted
        ? `週次決算を改訂${preview.revisions.length + 1}として確定しました。`
        : "同じ内容で確定済みです。二重計上はしていません。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "週次決算を確定できませんでした。");
    } finally {
      setSaving(false);
    }
  }

  function moveWeek(amount: number) {
    setAnchor((current) => shiftPeriod(current, "weekly", amount));
    setMessage("");
    setError("");
  }

  const status = settlementStatus(preview.confirmationStatus);
  const canConfirm = preview.settlement.trialBalance.isBalanced
    && preview.settlement.balanceSheet.isBalanced
    && preview.confirmationStatus !== "confirmed";

  return (
    <div className="weekly-settlement stack">
      <section className="weekly-settlement-hero">
        <div>
          <p className="eyebrow light">週次仕訳・週次決算</p>
          <h2>時間を単位にした週次決算</h2>
          <p>{formatPeriod(anchor, "weekly")}</p>
        </div>
        <span className={`weekly-settlement-status ${preview.confirmationStatus}`}>{status}</span>
      </section>

      <nav className="weekly-week-navigation" aria-label="決算対象の週">
        <button type="button" onClick={() => moveWeek(-1)}>← 前の週</button>
        <button type="button" className="current-week-button" disabled={isCurrentWeek} onClick={() => setAnchor(new Date())}>今週</button>
        <button type="button" disabled={isCurrentWeek} onClick={() => moveWeek(1)}>次の週 →</button>
      </nav>

      {error && <p className="weekly-settlement-alert error" role="alert">{error}</p>}
      {message && <p className="weekly-settlement-alert success" role="status">{message}</p>}

      <section className="weekly-settlement-panel preview" aria-labelledby="weekly-settlement-preview-heading">
        <div className="weekly-settlement-heading">
          <div><p className="eyebrow">確定前の確認</p><h3 id="weekly-settlement-preview-heading">週次決算プレビュー</h3></div>
          <strong>{formatDuration(preview.settlement.totals.recordSeconds)}</strong>
        </div>
        <div className="weekly-settlement-summary-grid">
          <Summary label="費用" seconds={preview.settlement.totals.expenseSeconds} />
          <Summary label="成果物資産" seconds={preview.settlement.totals.assetSeconds} />
          <Summary label="仕掛成果物" seconds={preview.settlement.totals.workInProgressSeconds} />
          <Summary label="未確定残高" seconds={preview.settlement.totals.unclassifiedSeconds} />
        </div>
        <p className="weekly-settlement-note">
          未分類の記録は費用化せず、AI仮受品に残します。費用・資産・仕掛は、活動登録時に本人が選択した会計区分です。
        </p>
        <p className="weekly-accounting-meaning"><strong>費用は、思考の悪さやAI依存度ではありません。</strong> 相談・学習・情報収集など、その週の活動に使った時間を研究上の区分で整理したものです。</p>
        {preview.confirmationStatus === "needs-reconfirmation" && (
          <p className="weekly-settlement-change-note">確定後に記録が編集または削除されています。最新内容を確認して再確定してください。</p>
        )}
        <div className="weekly-settlement-balance-check">
          <span>仕訳貸借</span><strong>{preview.settlement.trialBalance.isBalanced ? "一致" : "不一致"}</strong>
          <span>B/S貸借</span><strong>{preview.settlement.balanceSheet.isBalanced ? "一致" : "不一致"}</strong>
        </div>
        <button className="weekly-settlement-confirm" type="button" disabled={!canConfirm || saving} onClick={confirmPreview}>
          {saving ? "確定中…" : preview.confirmationStatus === "confirmed" ? "この内容で確定済み" : "プレビューを確認して確定する"}
        </button>
      </section>

      <details className="weekly-settlement-panel weekly-disclosure">
        <summary><span><small>時間会計</small><strong id="weekly-bs-heading">週次B/S</strong></span><b>借方・貸方 {formatDuration(preview.settlement.balanceSheet.debitSeconds)}</b></summary>
        <div className="weekly-disclosure-body">
          <p className="weekly-settlement-note">企業会計の財務諸表ではなく、秒を単位にした独自の時間会計表示です。</p>
          <div className="weekly-statement-columns">
            <StatementColumn title="借方" lines={preview.settlement.balanceSheet.debit} />
            <StatementColumn title="貸方" lines={preview.settlement.balanceSheet.credit} />
          </div>
          <div className="weekly-statement-total"><span>借方 {formatDuration(preview.settlement.balanceSheet.debitSeconds)}</span><span>貸方 {formatDuration(preview.settlement.balanceSheet.creditSeconds)}</span></div>
        </div>
      </details>

      <details className="weekly-settlement-panel weekly-disclosure">
        <summary><span><small>活動費用</small><strong id="weekly-pl-heading">週次P/L</strong></span><b>{formatDuration(preview.settlement.profitAndLoss.totalExpenseSeconds)}</b></summary>
        <div className="weekly-disclosure-body weekly-pl-list">
          {preview.settlement.profitAndLoss.expenses.map((line) => <div key={line.account}><span>{line.account}</span><strong>{formatDuration(line.seconds)}</strong></div>)}
        </div>
      </details>

      <section className="weekly-settlement-panel" aria-labelledby="weekly-category-chart-heading">
        <div className="weekly-settlement-heading"><div><p className="eyebrow">今週の活動構成</p><h3 id="weekly-category-chart-heading">活動テーマ別グラフ</h3></div><span>{dashboard.recordCount}件</span></div>
        {dashboard.categories.length === 0 ? <p className="weekly-settlement-empty">この週の活動記録はありません。</p> : <div className="weekly-category-chart">
          {dashboard.categories.map((item) => <div key={item.category ?? "unclassified"}>
            <div><span>{item.category ?? "未分類"}</span><strong>{formatDuration(item.seconds)}・{item.count}件</strong></div>
            <i><b style={{ width: `${Math.max(3, Math.round((item.seconds / largestCategorySeconds) * 100))}%` }} /></i>
          </div>)}
        </div>}
      </section>

      <section className="weekly-settlement-panel" aria-labelledby="weekly-settlement-reflection-heading">
        <div className="weekly-settlement-heading"><div><p className="eyebrow">本人による記録</p><h3 id="weekly-settlement-reflection-heading">この週の振り返り</h3></div></div>
        {reflection ? <dl className="weekly-settlement-reflection">
          <div><dt>発見・学び</dt><dd>{reflection.discoveryLearning || "記入なし"}</dd></div>
          <div><dt>本人が判断・修正したこと</dt><dd>{reflection.humanJudgment || "記入なし"}</dd></div>
          <div><dt>AIとの関わり方</dt><dd>{reflection.relationshipReflection || "記入なし"}</dd></div>
          <div><dt>来週の小さな挑戦</dt><dd>{reflection.nextWeekChallenge || "記入なし"}</dd></div>
        </dl> : <p className="weekly-settlement-empty">この週の振り返りはまだありません。</p>}
        {onOpenReflection && <button className="weekly-settlement-edit" type="button" onClick={() => onOpenReflection(anchor)}>{reflection ? "振り返りを編集" : "本人の振り返りを記録"}</button>}
      </section>

      <details className="weekly-settlement-panel weekly-disclosure">
        <summary><span><small>借方＝貸方</small><strong id="weekly-journal-heading">週次仕訳一覧</strong></span><b>{preview.journalEntries.length}仕訳</b></summary>
        <div className="weekly-disclosure-body">
          <p className="weekly-settlement-note"><strong>仮仕訳</strong>は利用時間の発生、<strong>決算振替</strong>は本人が確定した区分への移動です。同じ秒数が両方に表示されても二重計上ではありません。</p>
          {preview.journalEntries.length === 0 ? <p className="weekly-settlement-empty">この週のAI利用仕訳はありません。</p> : (
            <div className="weekly-journal-list">
            {preview.journalEntries.map((entry) => <article key={entry.id}>
              <div className="weekly-journal-meta"><span>{entry.kind === "usage-recognition" ? "仮仕訳" : "決算振替"}</span><span>{sourceLabel(entry.timeSource)}</span></div>
              <div className="weekly-journal-lines">
                <div><small>借方</small><strong>{entry.lines[0].account}</strong><span>{formatDuration(entry.lines[0].seconds)}</span></div>
                <div><small>貸方</small><strong>{entry.lines[1].account}</strong><span>{formatDuration(entry.lines[1].seconds)}</span></div>
              </div>
            </article>)}
            </div>
          )}
        </div>
      </details>

      <section className="weekly-settlement-panel" aria-labelledby="weekly-revision-heading">
        <div className="weekly-settlement-heading"><div><p className="eyebrow">監査履歴</p><h3 id="weekly-revision-heading">確定履歴</h3></div><span>{preview.revisions.length}件</span></div>
        {preview.revisions.length === 0 ? <p className="weekly-settlement-empty">この週はまだ確定されていません。</p> : (
          <ol className="weekly-revision-list">
            {[...preview.revisions].reverse().map((revision, index) => <li key={revision.id}>
              <div><strong>改訂{preview.revisions.length - index}</strong><time>{formatDateTime(revision.confirmedAt)}</time></div>
              <span>{formatDuration(revision.settlement.totals.recordSeconds)}・{revision.settlement.totals.recordCount}件</span>
            </li>)}
          </ol>
        )}
        <p className="weekly-settlement-note">過去の確定内容は履歴として保持し、現在のB/S・P/Lには最新記録だけを反映します。</p>
      </section>

      <button className="weekly-settlement-edit" type="button" onClick={onOpenRecords}>活動記録を確認・編集する</button>
    </div>
  );
}

function Summary({ label, seconds }: { label: string; seconds: number }) {
  return <article><span>{label}</span><strong>{formatDuration(seconds)}</strong></article>;
}

function StatementColumn({ title, lines }: { title: string; lines: readonly { account: WeeklyAccount; seconds: number }[] }) {
  return <div><h4>{title}</h4>{lines.map((line) => <p key={line.account}><span>{line.account}</span><strong>{formatDuration(line.seconds)}</strong></p>)}</div>;
}

function loadRecordsSafely(): WeeklyRecordStoreV1 {
  try { return loadWeeklyRecordStore(); } catch { return Object.freeze({ schemaVersion: 1, records: Object.freeze([]), tasks: Object.freeze([]) }); }
}

function loadHistorySafely(): WeeklySettlementStoreV1 {
  try { return loadWeeklySettlementStore(); } catch { return Object.freeze({ schemaVersion: 1, weeks: Object.freeze([]) }); }
}

function loadReflectionsSafely(): WeeklyReflectionStoreV1 {
  try { return loadWeeklyReflectionStore(); } catch { return Object.freeze({ schemaVersion: 1, reflections: Object.freeze([]) }); }
}

function settlementStatus(value: "unconfirmed" | "confirmed" | "needs-reconfirmation") {
  return { unconfirmed: "未確定", confirmed: "確定済み", "needs-reconfirmation": "要再確定" }[value];
}

function sourceLabel(value: WeeklyTimeSource) {
  return { manual: "手入力", measured: "自動計測", adjusted: "補正", unknown: "取得方法不明" }[value];
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return `${hours > 0 ? `${hours}時間` : ""}${minutes}分${String(rest).padStart(2, "0")}秒`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}
