import { useCallback, useEffect, useMemo, useState } from "react";
import { formatPeriod, periodBounds, shiftPeriod } from "../ledgerPeriods.ts";
import type { WeeklyAccount, WeeklyJournalEntry } from "../weeklyAccounting.ts";
import { previewWeeklySettlement, loadWeeklySettlementStore, WEEKLY_SETTLEMENTS_STORAGE_KEY } from "../weeklySettlementStore.ts";
import { loadWeeklyRecordStore, WEEKLY_RECORDS_STORAGE_KEY, type WeeklyRecordStoreV1 } from "../weeklyStore.ts";
import type { WeeklyTimeSource } from "../weeklyData.ts";
import "./weeklySettlementScreen.css";

export function WeeklyJournalScreen({ onOpenRecords, onOpenRecordAccounting }: { onOpenRecords: () => void; onOpenRecordAccounting: (recordId: string) => void }) {
  const [anchor, setAnchor] = useState(() => new Date());
  const [records, setRecords] = useState<WeeklyRecordStoreV1>(() => loadRecordsSafely());
  const [revision, setRevision] = useState(0);
  const preview = useMemo(() => previewWeeklySettlement(
    records.records,
    records.tasks,
    anchor,
    loadHistorySafely(),
  ), [records.records, records.tasks, anchor, revision]);
  const isCurrentWeek = periodBounds(anchor, "weekly").start.getTime() === periodBounds(new Date(), "weekly").start.getTime();
  const recordsById = useMemo(() => new Map(records.records.map((record) => [record.id, record])), [records.records]);
  const unclassifiedRecords = useMemo(() => preview.settlement.recordIds
    .map((recordId) => recordsById.get(recordId))
    .filter((record) => record?.accountingDisposition === "unclassified" && record.activeSeconds > 0), [preview.settlement.recordIds, recordsById]);
  const firstUnclassifiedRecord = unclassifiedRecords[0] ?? null;

  const refresh = useCallback(() => {
    setRecords(loadRecordsSafely());
    setRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === WEEKLY_RECORDS_STORAGE_KEY || event.key === WEEKLY_SETTLEMENTS_STORAGE_KEY || event.key === null) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  return <div className="weekly-settlement weekly-journal-screen stack">
    <section className="weekly-settlement-hero">
      <div><p className="eyebrow light">週次仕訳</p><h2>活動時間の仕訳を確認</h2><p>{formatPeriod(anchor, "weekly")}</p></div>
      <span className="weekly-settlement-status">{preview.journalEntries.length}仕訳</span>
    </section>
    <nav className="weekly-week-navigation" aria-label="仕訳対象の週">
      <button type="button" onClick={() => setAnchor((value) => shiftPeriod(value, "weekly", -1))}>← 前の週</button>
      <button type="button" className="current-week-button" disabled={isCurrentWeek} onClick={() => setAnchor(new Date())}>今週</button>
      <button type="button" disabled={isCurrentWeek} onClick={() => setAnchor((value) => shiftPeriod(value, "weekly", 1))}>次の週 →</button>
    </nav>
    <section className="weekly-settlement-panel weekly-journal-overview" aria-labelledby="weekly-journal-overview-heading">
      <div className="weekly-settlement-heading"><div><p className="eyebrow">今週の時間会計</p><h3 id="weekly-journal-overview-heading">記録時間と仕訳の状態</h3></div><span>{preview.settlement.totals.recordCount}件</span></div>
      <div className="weekly-journal-overview-values"><div><span>記録済み利用時間</span><strong>{formatDuration(preview.settlement.totals.recordSeconds)}</strong></div><div><span>仕訳</span><strong>{preview.journalEntries.length}件</strong></div></div>
      {firstUnclassifiedRecord ? <div className="weekly-journal-classification-waiting"><div><strong>仮仕訳・分類待ち</strong><span>{formatDuration(preview.settlement.totals.unclassifiedSeconds)}・{unclassifiedRecords.length}活動の会計区分が未分類です。</span></div><button className="primary-action" type="button" onClick={() => onOpenRecordAccounting(firstUnclassifiedRecord.id)}>この活動の会計区分を決める</button></div> : <p className="weekly-journal-classified">この週の活動はすべて会計区分を確認済みです。</p>}
    </section>
    <details className="weekly-settlement-panel weekly-accounting-guide"><summary>会計区分の考え方を見る</summary><div><p><strong>費用は、思考の悪さやAI依存を意味しません。</strong> 相談・学習・情報収集など、その週の活動に使った時間の分類です。</p><p><strong>仮仕訳</strong>は利用時間が発生した時点の記録、<strong>決算振替</strong>は本人が確定した会計区分への移動です。同じ秒数が両方に表示されても、利用時間の二重計上ではありません。</p><p>AIAS Levelや研究指標を金額・資産価値へ換算していません。</p></div></details>
    <section className="weekly-settlement-panel" aria-labelledby="weekly-journal-only-heading">
      <div className="weekly-settlement-heading"><div><p className="eyebrow">借方＝貸方</p><h3 id="weekly-journal-only-heading">週次仕訳一覧</h3></div><span>{preview.journalEntries.length}仕訳</span></div>
      {preview.journalEntries.length === 0 ? <p className="weekly-settlement-empty">この週のAI利用仕訳はありません。</p> : <div className="weekly-journal-list">
        {preview.journalEntries.map((entry) => <article key={entry.id}>
          <div className="weekly-journal-meta"><span>{journalStatusLabel(entry, recordsById.get(entry.recordId)?.accountingDisposition)}</span><span>{sourceLabel(entry.timeSource)}</span></div>
          <div className="weekly-journal-lines">
            <div><small>借方</small><strong>{entry.lines[0].account}</strong><b>{formatDuration(entry.lines[0].seconds)}</b><p>{accountDescription(entry.lines[0].account)}</p></div>
            <div><small>貸方</small><strong>{entry.lines[1].account}</strong><b>{formatDuration(entry.lines[1].seconds)}</b><p>{accountDescription(entry.lines[1].account)}</p></div>
          </div>
        </article>)}
      </div>}
    </section>
    {!firstUnclassifiedRecord && <button className="weekly-settlement-edit" type="button" onClick={onOpenRecords}>保存済み活動を確認</button>}
  </div>;
}

function loadRecordsSafely(): WeeklyRecordStoreV1 {
  try { return loadWeeklyRecordStore(); } catch { return Object.freeze({ schemaVersion: 1, records: Object.freeze([]), tasks: Object.freeze([]) }); }
}
function loadHistorySafely() {
  try { return loadWeeklySettlementStore(); } catch { return Object.freeze({ schemaVersion: 1 as const, weeks: Object.freeze([]) }); }
}
function sourceLabel(value: WeeklyTimeSource) { return { manual: "手入力", measured: "自動計測", adjusted: "補正", unknown: "取得方法不明" }[value]; }
function journalStatusLabel(entry: WeeklyJournalEntry, disposition?: string) {
  if (entry.kind === "usage-recognition" && disposition === "unclassified") return "仮仕訳・分類待ち";
  return entry.kind === "usage-recognition" ? "仮仕訳" : "決算振替";
}
function accountDescription(account: WeeklyAccount) {
  return ({
    "AI仮受品": "会計区分が決まるまで一時的に置く時間",
    "時間拠出": "本人がAIを使う活動に提供した時間",
    "相談活動費": "相談活動に使った時間",
    "思考探究費": "考えを深める活動に使った時間",
    "成果物利用費": "成果物を作成・利用する活動に使った時間",
    "情報収集費": "情報を集める活動に使った時間",
    "学習活動費": "学習活動に使った時間",
    "その他AI利用費": "その他のAI利用活動に使った時間",
    "成果物資産": "完成し、今後も利用する成果物につながる時間",
    "仕掛成果物": "制作途中の成果物につながる時間",
    "累積時間損失": "費用として整理した時間の累計",
  } as const)[account];
}
function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); const rest = seconds % 60;
  return `${hours > 0 ? `${hours}時間` : ""}${minutes}分${String(rest).padStart(2, "0")}秒`;
}
