import { useCallback, useEffect, useState } from "react";
import { formatPeriod } from "../ledgerPeriods.ts";
import { TIME_ACCOUNTING_CHANGED_EVENT } from "../timeAccountingEvents.ts";
import { TIME_ACCOUNTING_STORAGE_BASE_KEY, loadTimeAccountingStore } from "../timeAccountingStore.ts";
import { buildWeeklyDashboardData } from "../weeklyDashboard.ts";
import { buildMeasuredTimeCandidates, selectUnlinkedMeasuredTimeCandidates } from "../weeklyExtensionImport.ts";
import { selectWeeklyHomeAction, type WeeklyHomeAction } from "../weeklyHome.ts";
import { loadWeeklyRecordStore, WEEKLY_RECORDS_STORAGE_KEY, type WeeklyRecordStoreV1 } from "../weeklyStore.ts";
import "./weeklyDashboardScreen.css";

export function WeeklyDashboardScreen({
  onOpenRecords,
  onOpenSavedRecords,
  onOpenReflection,
  hasPendingRecordWork = false,
}: {
  onOpenRecords: () => void;
  onOpenSavedRecords: () => void;
  onOpenReflection: (anchor: Date) => void;
  hasPendingRecordWork?: boolean;
}) {
  const [store, setStore] = useState<WeeklyRecordStoreV1>(() => emptyOrLoadedStore());
  const [loadError, setLoadError] = useState("");
  const anchor = new Date();
  const dashboard = buildWeeklyDashboardData(store.records, store.tasks, anchor);
  const unclassifiedAccountingCount = dashboard.records.filter(({ record }) => record.accountingDisposition === "unclassified").length;
  const unlinkedMeasurements = loadUnlinkedMeasurements(store).filter((item) => (
    new Date(item.endedAt) > dashboard.weekStart && new Date(item.startedAt) < dashboard.weekEndExclusive
  ));
  const homeAction = selectWeeklyHomeAction({
    recordCount: dashboard.recordCount,
    unlinkedMeasurementCount: unlinkedMeasurements.length,
    unlinkedMeasurementSeconds: unlinkedMeasurements.reduce((total, item) => total + item.activeSeconds, 0),
    unclassifiedAccountingCount,
    hasPendingRecordWork,
  });

  const refresh = useCallback(() => {
    try {
      setStore(loadWeeklyRecordStore());
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "週次データを読み込めませんでした。");
    }
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === WEEKLY_RECORDS_STORAGE_KEY || event.key === TIME_ACCOUNTING_STORAGE_BASE_KEY || event.key === null) refresh();
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

  function runPrimaryAction(action: WeeklyHomeAction) {
    if (action.kind === "link-measurement" || action.kind === "start-recording") onOpenRecords();
    else if (action.kind === "classify-accounting") onOpenSavedRecords();
    else onOpenReflection(anchor);
  }

  const unfinished = homeAction.kind === "link-measurement" || homeAction.kind === "classify-accounting";

  return <div className="weekly-dashboard weekly-home">
    <section className={`weekly-home-action${unfinished ? " unfinished" : ""}`} aria-labelledby="weekly-home-heading">
      <p className="eyebrow">次にすること</p>
      <h2 id="weekly-home-heading">{homeAction.title}</h2>
      <p>{homeAction.description}</p>
      <button className="primary-action" type="button" onClick={() => runPrimaryAction(homeAction)}>{homeAction.buttonLabel}</button>
    </section>

    <section className="weekly-home-status" aria-labelledby="weekly-home-status-heading">
      <header className="weekly-home-status-heading">
        <h3 id="weekly-home-status-heading">今週のAI利用状況</h3>
        <span>{formatPeriod(anchor, "weekly")}</span>
      </header>
      <div className="weekly-home-status-grid">
        <p><span>記録済み利用時間</span><strong>{formatDuration(dashboard.totalSeconds)}</strong></p>
      </div>
      <small>活動に未紐付けの実測時間は含みません。</small>
    </section>
    {loadError && <p className="weekly-dashboard-error" role="alert">{loadError}</p>}
  </div>;
}

function emptyOrLoadedStore(): WeeklyRecordStoreV1 {
  try { return loadWeeklyRecordStore(); } catch { return Object.freeze({ schemaVersion: 1, records: Object.freeze([]), tasks: Object.freeze([]) }); }
}

function loadUnlinkedMeasurements(store: WeeklyRecordStoreV1) {
  try {
    return selectUnlinkedMeasuredTimeCandidates(buildMeasuredTimeCandidates(loadTimeAccountingStore()), store.records);
  } catch {
    return Object.freeze([]);
  }
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return `${hours > 0 ? `${hours}時間` : ""}${minutes}分${String(rest).padStart(2, "0")}秒`;
}
