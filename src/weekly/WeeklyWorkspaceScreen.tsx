import { type ReactNode, useEffect, useRef, useState } from "react";
import { WeeklyDashboardScreen } from "./WeeklyDashboardScreen.tsx";
import { WeeklyExtensionImportScreen } from "./WeeklyExtensionImportScreen.tsx";
import { WeeklyJournalScreen } from "./WeeklyJournalScreen.tsx";
import { WeeklyManualScreen } from "./WeeklyManualScreen.tsx";
import { WeeklyReflectionScreen } from "./WeeklyReflectionScreen.tsx";
import { WeeklySettlementScreen } from "./WeeklySettlementScreen.tsx";
import { WeeklySettingsScreen } from "./WeeklySettingsScreen.tsx";
import "./weeklyWorkspaceScreen.css";
import "./weeklyResearchTypography.css";

export type WeeklyPrimaryView = "home" | "records" | "journal" | "settlement" | "settings";
type RecordView = "import" | "manual";
type ClosingView = "settlement" | "reflection";

export function WeeklyWorkspaceScreen({
  view = "home",
  onNavigate = () => undefined,
  recordTools = null,
  hasPendingRecordWork = false,
}: {
  view?: WeeklyPrimaryView;
  onNavigate?: (view: WeeklyPrimaryView) => void;
  recordTools?: ReactNode;
  hasPendingRecordWork?: boolean;
}) {
  const [recordView, setRecordView] = useState<RecordView>("import");
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [selectedRecordScreen, setSelectedRecordScreen] = useState<"detail" | "accounting">("detail");
  const [closingView, setClosingView] = useState<ClosingView>("settlement");
  const [reflectionAnchor, setReflectionAnchor] = useState(() => new Date());
  const requestedRecordView = useRef<RecordView | null>(null);

  useEffect(() => {
    if (view !== "records") return;
    setRecordView(requestedRecordView.current ?? "import");
    requestedRecordView.current = null;
  }, [view]);

  function openRecords(manual = false) {
    requestedRecordView.current = manual ? "manual" : "import";
    setSelectedRecordId(null);
    setSelectedRecordScreen("detail");
    onNavigate("records");
  }

  function openRecordAccounting(recordId: string) {
    requestedRecordView.current = "manual";
    setSelectedRecordId(recordId);
    setSelectedRecordScreen("accounting");
    onNavigate("records");
  }

  function openReflection(anchor = new Date()) {
    setReflectionAnchor(new Date(anchor));
    setClosingView("reflection");
    onNavigate("settlement");
  }

  if (view === "home") return <WeeklyDashboardScreen onOpenRecords={() => openRecords()} onOpenSavedRecords={() => openRecords(true)} onOpenReflection={openReflection} hasPendingRecordWork={hasPendingRecordWork} />;
  if (view === "journal") return <WeeklyJournalScreen onOpenRecords={() => openRecords(true)} onOpenRecordAccounting={openRecordAccounting} />;
  if (view === "settings") return <WeeklySettingsScreen onOpenRecords={() => openRecords(true)} />;
  if (view === "settlement") return <div className="weekly-workspace">
    <nav className="weekly-context-tabs" aria-label="週次決算の切り替え">
      <button type="button" aria-pressed={closingView === "settlement"} onClick={() => setClosingView("settlement")}>決算・B/S・P/L</button>
      <button type="button" aria-pressed={closingView === "reflection"} onClick={() => setClosingView("reflection")}>本人の振り返り</button>
    </nav>
    {closingView === "settlement" ? <WeeklySettlementScreen onOpenRecordAccounting={openRecordAccounting} /> : <WeeklyReflectionScreen initialAnchor={reflectionAnchor} onOpenRecords={() => openRecords(true)} />}
  </div>;

  return <div className="weekly-workspace">
    <nav className="weekly-record-shortcuts" aria-label="記録の関連メニュー">
      {recordView === "import"
        ? <><button type="button" onClick={() => { setSelectedRecordId(null); setRecordView("manual"); }}>保存済み活動を見る</button><a href="#weekly-record-help">連携方法・補助メニュー</a></>
        : <button type="button" onClick={() => setRecordView("import")}>新しい会話を記録する</button>}
    </nav>
    {hasPendingRecordWork && recordTools && <aside id="weekly-record-support" className="weekly-record-tools priority" aria-label="記録連携の続き">{recordTools}</aside>}
    {recordView === "import" ? <WeeklyExtensionImportScreen onOpenRecords={(recordId) => { setSelectedRecordId(recordId ?? null); setSelectedRecordScreen("detail"); setRecordView("manual"); }} /> : <WeeklyManualScreen initialRecordId={selectedRecordId} initialScreen={selectedRecordScreen} />}
    {!hasPendingRecordWork && recordTools && <aside id="weekly-record-support" className="weekly-record-tools" aria-label="記録の補助メニュー"><p className="eyebrow">補助メニュー</p>{recordTools}</aside>}
  </div>;
}
