import { useEffect, useRef, useState } from "react";
import { WeeklyDashboardScreen } from "./WeeklyDashboardScreen.tsx";
import { WeeklyExtensionImportScreen } from "./WeeklyExtensionImportScreen.tsx";
import { WeeklyJournalScreen } from "./WeeklyJournalScreen.tsx";
import { WeeklyManualScreen } from "./WeeklyManualScreen.tsx";
import { WeeklyReflectionScreen } from "./WeeklyReflectionScreen.tsx";
import { WeeklySettlementScreen } from "./WeeklySettlementScreen.tsx";
import { WeeklySettingsScreen } from "./WeeklySettingsScreen.tsx";
import "./weeklyWorkspaceScreen.css";

export type WeeklyPrimaryView = "home" | "records" | "journal" | "settlement" | "settings";
type RecordView = "import" | "manual";
type ClosingView = "settlement" | "reflection";

export function WeeklyWorkspaceScreen({ view = "home", onNavigate = () => undefined }: { view?: WeeklyPrimaryView; onNavigate?: (view: WeeklyPrimaryView) => void }) {
  const [recordView, setRecordView] = useState<RecordView>("import");
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
    onNavigate("records");
  }

  function openReflection(anchor = new Date()) {
    setReflectionAnchor(new Date(anchor));
    setClosingView("reflection");
    onNavigate("settlement");
  }

  if (view === "home") return <WeeklyDashboardScreen onOpenRecords={() => openRecords()} onOpenSavedRecords={() => openRecords(true)} onOpenReflection={openReflection} />;
  if (view === "journal") return <WeeklyJournalScreen onOpenRecords={() => openRecords(true)} />;
  if (view === "settings") return <WeeklySettingsScreen onOpenRecords={() => openRecords(true)} />;
  if (view === "settlement") return <div className="weekly-workspace">
    <nav className="weekly-context-tabs" aria-label="週次決算の切り替え">
      <button type="button" aria-pressed={closingView === "settlement"} onClick={() => setClosingView("settlement")}>決算・B/S・P/L</button>
      <button type="button" aria-pressed={closingView === "reflection"} onClick={() => setClosingView("reflection")}>本人の振り返り</button>
    </nav>
    {closingView === "settlement" ? <WeeklySettlementScreen onOpenRecords={() => openRecords(true)} onOpenReflection={openReflection} /> : <WeeklyReflectionScreen initialAnchor={reflectionAnchor} onOpenRecords={() => openRecords(true)} />}
  </div>;

  return <div className="weekly-workspace">
    <section className="weekly-flow-guide" aria-label="日常利用の流れ">
      <p className="eyebrow">日常利用は3ステップ</p>
      <ol><li><b>会話と時間を取り込む</b><span>拡張機能の実測を本人が確認</span></li><li><b>分析候補を確認</b><span>同意した会話だけGemini分析</span></li><li><b>仕訳へ反映</b><span>分類は本人が確認・修正</span></li></ol>
    </section>
    <nav className="weekly-context-tabs" aria-label="記録方法の切り替え">
      <button type="button" aria-pressed={recordView === "import"} onClick={() => setRecordView("import")}>拡張から取り込む</button>
      <button type="button" aria-pressed={recordView === "manual"} onClick={() => setRecordView("manual")}>保存済み記録・手入力</button>
    </nav>
    {recordView === "import" ? <WeeklyExtensionImportScreen onOpenRecords={() => setRecordView("manual")} /> : <WeeklyManualScreen />}
  </div>;
}
