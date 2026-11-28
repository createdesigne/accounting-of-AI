import { useCallback, useEffect, useMemo, useState } from "react";
import { formatPeriod, periodBounds, shiftPeriod } from "../ledgerPeriods.ts";
import type { WeeklyAccount } from "../weeklyAccounting.ts";
import { buildWeeklyDashboardData } from "../weeklyDashboard.ts";
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
import "./weeklySettlementScreen.css";

export function WeeklySettlementScreen({ onOpenRecordAccounting }: { onOpenRecordAccounting: (recordId: string) => void }) {
  const [anchor, setAnchor] = useState(() => new Date());
  const [records, setRecords] = useState<WeeklyRecordStoreV1>(() => loadRecordsSafely());
  const [history, setHistory] = useState<WeeklySettlementStoreV1>(() => loadHistorySafely());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const preview = useMemo(
    () => previewWeeklySettlement(records.records, records.tasks, anchor, history),
    [records.records, records.tasks, anchor, history],
  );
  const dashboard = useMemo(() => buildWeeklyDashboardData(records.records, records.tasks, anchor), [records.records, records.tasks, anchor]);
  const recordsById = useMemo(() => new Map(records.records.map((record) => [record.id, record])), [records.records]);
  const unclassifiedRecords = useMemo(() => preview.settlement.recordIds
    .map((id) => recordsById.get(id))
    .filter((record) => record?.accountingDisposition === "unclassified" && record.activeSeconds > 0), [preview.settlement.recordIds, recordsById]);
  const firstUnclassifiedRecord = unclassifiedRecords[0];
  const largestCategorySeconds = Math.max(1, ...dashboard.categories.map((item) => item.seconds));
  const currentWeekStart = periodBounds(new Date(), "weekly").start;
  const isCurrentWeek = periodBounds(anchor, "weekly").start.getTime() === currentWeekStart.getTime();

  const refresh = useCallback(() => {
    try {
      setRecords(loadWeeklyRecordStore());
      setHistory(loadWeeklySettlementStore());
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "週次決算データを読み込めませんでした。");
    }
  }, []);

  useEffect(() => {
    refresh();
    const onStorage = (event: StorageEvent) => {
      if (event.key === WEEKLY_RECORDS_STORAGE_KEY || event.key === WEEKLY_SETTLEMENTS_STORAGE_KEY || event.key === null) refresh();
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
      setReviewing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "週次決算を確定できませんでした。");
    } finally {
      setSaving(false);
    }
  }

  function moveWeek(amount: number) {
    setAnchor((current) => shiftPeriod(current, "weekly", amount));
    setReviewing(false);
    setMessage("");
    setError("");
  }

  const status = settlementStatus(preview.confirmationStatus);
  const canConfirm = preview.settlement.trialBalance.isBalanced
    && preview.settlement.balanceSheet.isBalanced
    && preview.confirmationStatus !== "confirmed";

  if (reviewing) return (
    <div className="weekly-settlement weekly-closing-screen weekly-settlement-review stack">
      <section className="weekly-settlement-hero">
        <div>
          <p className="eyebrow light">確定前の最終確認</p>
          <h2>決算内容を確認する</h2>
          <p className="weekly-settlement-period">対象週：{formatPeriod(anchor, "weekly")}</p>
        </div>
        <div className="weekly-settlement-state"><small>決算状態</small><span className={`weekly-settlement-status ${preview.confirmationStatus}`}>{status}</span></div>
      </section>

      {error && <p className="weekly-settlement-alert error" role="alert">{error}</p>}

      <section className="weekly-settlement-panel weekly-settlement-review-card" aria-labelledby="weekly-settlement-review-heading">
        <div className="weekly-settlement-heading">
          <div><p className="eyebrow">確定する内容</p><h3 id="weekly-settlement-review-heading">今週の時間会計</h3></div>
          <strong className="weekly-closing-total">{formatDuration(preview.settlement.totals.recordSeconds)}</strong>
        </div>
        <div className="weekly-settlement-summary-grid">
          <Summary label="費用" seconds={preview.settlement.totals.expenseSeconds} />
          <Summary label="成果物資産" seconds={preview.settlement.totals.assetSeconds} />
          <Summary label="仕掛成果物" seconds={preview.settlement.totals.workInProgressSeconds} />
          <Summary label="未分類" seconds={preview.settlement.totals.unclassifiedSeconds} tone={preview.settlement.totals.unclassifiedSeconds > 0 ? "warning" : "default"} />
        </div>
        {preview.settlement.totals.recordCount === 0 ? <p className="weekly-closing-classified">今週はまだ活動が記録されていません。</p> : preview.settlement.totals.unclassifiedSeconds > 0 ? <div className="weekly-settlement-review-warning" role="status">
          <strong>未分類のまま確定します</strong>
          <p>{formatDuration(preview.settlement.totals.unclassifiedSeconds)}は費用や資産へ振り替えず、AI仮受品の未確定残高として残ります。</p>
        </div> : <p className="weekly-closing-classified">会計区分はすべて確認済みです。</p>}
        <div className="weekly-settlement-balance-check">
          <div><span>仕訳の借方・貸方</span><strong>{preview.settlement.trialBalance.isBalanced ? "一致" : "不一致"}</strong></div>
          <div><span>B/Sの借方・貸方</span><strong>{preview.settlement.balanceSheet.isBalanced ? "一致" : "不一致"}</strong></div>
          <small>一致は、左右に記録した時間の合計が同じことを示します。</small>
        </div>
        <div className="weekly-settlement-review-actions">
          <button className="weekly-settlement-back" type="button" disabled={saving} onClick={() => { setReviewing(false); setError(""); }}>戻る</button>
          <button className="weekly-settlement-confirm" type="button" disabled={!canConfirm || saving} onClick={confirmPreview}>
            {saving ? "確定中…" : canConfirm ? "この内容で決算を確定する" : "この内容で確定済み"}
          </button>
        </div>
      </section>
    </div>
  );

  return (
    <div className="weekly-settlement weekly-closing-screen stack">
      <section className="weekly-settlement-hero">
        <div>
          <p className="eyebrow light">今週の時間会計</p>
          <h2>週次決算を確認する</h2>
          <p className="weekly-settlement-period">対象週：{formatPeriod(anchor, "weekly")}</p>
        </div>
        <div className="weekly-settlement-state"><small>決算状態</small><span className={`weekly-settlement-status ${preview.confirmationStatus}`}>{status}</span></div>
      </section>

      <nav className="weekly-week-navigation" aria-label="決算対象の週">
        <button type="button" onClick={() => moveWeek(-1)}>← 前の週</button>
        <button type="button" className="current-week-button" disabled={isCurrentWeek} onClick={() => setAnchor(new Date())}>今週</button>
        <button type="button" disabled={isCurrentWeek} onClick={() => moveWeek(1)}>次の週 →</button>
      </nav>

      {error && <p className="weekly-settlement-alert error" role="alert">{error}</p>}
      {message && <p className="weekly-settlement-alert success" role="status">{message}</p>}

      <section className="weekly-settlement-panel preview weekly-closing-overview" aria-labelledby="weekly-settlement-preview-heading">
        <div className="weekly-settlement-heading">
          <div><p className="eyebrow">記録済み実利用時間</p><h3 id="weekly-settlement-preview-heading">今週の決算内容</h3></div>
          <strong className="weekly-closing-total">{formatDuration(preview.settlement.totals.recordSeconds)}</strong>
        </div>
        <div className="weekly-settlement-summary-grid">
          <Summary label="費用" seconds={preview.settlement.totals.expenseSeconds} />
          <Summary label="成果物資産" seconds={preview.settlement.totals.assetSeconds} />
          <Summary label="仕掛成果物" seconds={preview.settlement.totals.workInProgressSeconds} />
          <Summary label="未分類" seconds={preview.settlement.totals.unclassifiedSeconds} tone={preview.settlement.totals.unclassifiedSeconds > 0 ? "warning" : "default"} />
        </div>
        {preview.settlement.totals.recordCount === 0 ? <p className="weekly-closing-classified">今週はまだ活動が記録されていません。</p> : firstUnclassifiedRecord ? <div className="weekly-closing-unclassified" role="status">
          <div><strong>会計区分が未分類の活動があります</strong><p>{formatDuration(preview.settlement.totals.unclassifiedSeconds)}・{unclassifiedRecords.length}件は、費用や資産へ移さずAI仮受品に残っています。未分類のまま決算を確定することもできます。</p></div>
          <button type="button" onClick={() => onOpenRecordAccounting(firstUnclassifiedRecord.id)}>この活動の会計区分を決める</button>
        </div> : <p className="weekly-closing-classified">会計区分はすべて確認済みです。</p>}
        {preview.confirmationStatus === "needs-reconfirmation" && (
          <p className="weekly-settlement-change-note">確定後に記録が編集または削除されています。最新内容を確認して再確定してください。</p>
        )}
        <div className="weekly-settlement-balance-check">
          <div><span>仕訳の借方・貸方</span><strong>{preview.settlement.trialBalance.isBalanced ? "一致" : "不一致"}</strong></div>
          <div><span>B/Sの借方・貸方</span><strong>{preview.settlement.balanceSheet.isBalanced ? "一致" : "不一致"}</strong></div>
          <small>一致は、左右に記録した時間の合計が同じことを示します。</small>
        </div>
        <button className="weekly-settlement-confirm" type="button" disabled={!canConfirm || saving} onClick={() => { setReviewing(true); setMessage(""); setError(""); }}>
          {preview.confirmationStatus === "confirmed" ? "この内容で確定済み" : preview.confirmationStatus === "needs-reconfirmation" ? "変更後の決算内容を確認する" : "決算内容を確認する"}
        </button>
      </section>

      <details className="weekly-settlement-panel weekly-disclosure">
        <summary><span><small>時間会計</small><strong id="weekly-bs-heading">週次B/S</strong></span><b>借方・貸方 {formatDuration(preview.settlement.balanceSheet.debitSeconds)}</b></summary>
        <div className="weekly-disclosure-body">
          <p className="weekly-settlement-note">B/Sは、その週末に費用・資産・未分類として残る時間を示します。企業会計の財務諸表ではなく、秒を単位にした独自の時間会計表示です。</p>
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
          <p className="weekly-settlement-note">P/Lは、その週に費用として整理したAI利用時間の内訳です。</p>
          {preview.settlement.profitAndLoss.expenses.map((line) => <div key={line.account}><span>{line.account}</span><strong>{formatDuration(line.seconds)}</strong></div>)}
        </div>
      </details>

      <details className="weekly-settlement-panel weekly-disclosure">
        <summary><span><small>詳細情報</small><strong id="weekly-category-chart-heading">活動テーマ別の内訳</strong></span><b>{dashboard.recordCount}件</b></summary>
        <div className="weekly-disclosure-body">
          {dashboard.categories.length === 0 ? <p className="weekly-settlement-empty compact">この週の活動記録はありません。</p> : dashboard.recordCount === 1 ? <div className="weekly-category-single">
            <span>{dashboard.categories[0]?.category ?? "未分類"}</span><strong>{formatDuration(dashboard.categories[0]?.seconds ?? 0)}・1件</strong>
          </div> : <div className="weekly-category-chart">
            {dashboard.categories.map((item) => <div key={item.category ?? "unclassified"}>
              <div><span>{item.category ?? "未分類"}</span><strong>{formatDuration(item.seconds)}・{item.count}件</strong></div>
              <i><b style={{ width: `${Math.max(3, Math.round((item.seconds / largestCategorySeconds) * 100))}%` }} /></i>
            </div>)}
          </div>}
        </div>
      </details>

      {preview.revisions.length > 0 ? <details className="weekly-settlement-panel weekly-disclosure">
        <summary><span><small>監査履歴</small><strong id="weekly-revision-heading">確定履歴</strong></span><b>{preview.revisions.length}件</b></summary>
        <div className="weekly-disclosure-body">
          <ol className="weekly-revision-list">
            {[...preview.revisions].reverse().map((revision, index) => <li key={revision.id}>
              <div><strong>改訂{preview.revisions.length - index}</strong><time>{formatDateTime(revision.confirmedAt)}</time></div>
              <span>{formatDuration(revision.settlement.totals.recordSeconds)}・{revision.settlement.totals.recordCount}件</span>
            </li>)}
          </ol>
          <p className="weekly-settlement-note">過去の確定内容は履歴として保持し、現在のB/S・P/Lには最新記録だけを反映します。</p>
        </div>
      </details> : <p className="weekly-closing-no-history">確定後の履歴は、ここから確認できます。</p>}
    </div>
  );
}

function Summary({ label, seconds, tone = "default" }: { label: string; seconds: number; tone?: "default" | "warning" }) {
  return <article className={tone === "warning" ? "warning" : undefined}><span>{label}</span><strong>{formatDuration(seconds)}</strong></article>;
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

function settlementStatus(value: "unconfirmed" | "confirmed" | "needs-reconfirmation") {
  return { unconfirmed: "未確定", confirmed: "確定済み", "needs-reconfirmation": "要再確定" }[value];
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
