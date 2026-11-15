import { useState } from "react";
import { WeeklyDashboardScreen } from "./WeeklyDashboardScreen.tsx";
import { WeeklyManualScreen } from "./WeeklyManualScreen.tsx";
import { WeeklyReflectionScreen } from "./WeeklyReflectionScreen.tsx";
import { WeeklySettlementScreen } from "./WeeklySettlementScreen.tsx";
import "./weeklyWorkspaceScreen.css";

type WeeklyWorkspaceView = "dashboard" | "records" | "settlement" | "reflection";

export function WeeklyWorkspaceScreen() {
  const [view, setView] = useState<WeeklyWorkspaceView>("dashboard");
  const [reflectionAnchor, setReflectionAnchor] = useState(() => new Date());

  function openReflection(anchor = new Date()) {
    setReflectionAnchor(new Date(anchor));
    setView("reflection");
  }

  return (
    <div className="weekly-workspace">
      <nav className="weekly-workspace-tabs" aria-label="週次画面の切り替え">
        <button type="button" aria-pressed={view === "dashboard"} onClick={() => setView("dashboard")}>週次ダッシュボード</button>
        <button type="button" aria-pressed={view === "records"} onClick={() => setView("records")}>課題設定・手入力</button>
        <button type="button" aria-pressed={view === "settlement"} onClick={() => setView("settlement")}>週次仕訳・決算</button>
        <button type="button" aria-pressed={view === "reflection"} onClick={() => openReflection()}>今週の振り返り</button>
      </nav>
      {view === "dashboard" && <WeeklyDashboardScreen onOpenRecords={() => setView("records")} onOpenReflection={openReflection} />}
      {view === "records" && <WeeklyManualScreen />}
      {view === "settlement" && <WeeklySettlementScreen onOpenRecords={() => setView("records")} />}
      {view === "reflection" && <WeeklyReflectionScreen initialAnchor={reflectionAnchor} onOpenRecords={() => setView("records")} />}
    </div>
  );
}
