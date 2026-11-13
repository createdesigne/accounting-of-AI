import { useState } from "react";
import { WeeklyDashboardScreen } from "./WeeklyDashboardScreen.tsx";
import { WeeklyManualScreen } from "./WeeklyManualScreen.tsx";
import { WeeklySettlementScreen } from "./WeeklySettlementScreen.tsx";
import "./weeklyWorkspaceScreen.css";

type WeeklyWorkspaceView = "dashboard" | "records" | "settlement";

export function WeeklyWorkspaceScreen() {
  const [view, setView] = useState<WeeklyWorkspaceView>("dashboard");

  return (
    <div className="weekly-workspace">
      <nav className="weekly-workspace-tabs" aria-label="週次画面の切り替え">
        <button type="button" aria-pressed={view === "dashboard"} onClick={() => setView("dashboard")}>週次ダッシュボード</button>
        <button type="button" aria-pressed={view === "records"} onClick={() => setView("records")}>課題設定・手入力</button>
        <button type="button" aria-pressed={view === "settlement"} onClick={() => setView("settlement")}>週次仕訳・決算</button>
      </nav>
      {view === "dashboard" && <WeeklyDashboardScreen onOpenRecords={() => setView("records")} />}
      {view === "records" && <WeeklyManualScreen />}
      {view === "settlement" && <WeeklySettlementScreen onOpenRecords={() => setView("records")} />}
    </div>
  );
}
