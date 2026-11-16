import { useMemo, useState } from "react";
import { formatPeriod, shiftPeriod } from "../ledgerPeriods.ts";
import {
  buildResearchExportBundle,
  serializeResearchAccountingCsv,
  serializeResearchActivitiesCsv,
  serializeResearchJson,
  serializeResearchReflectionsCsv,
  type ResearchExportScope,
  type ResearchExportSources,
} from "../researchExport.ts";
import { loadWeeklyAnalysisReviewStore } from "../weeklyAnalysisReviewStore.ts";
import { loadWeeklyAnalysisStore } from "../weeklyAnalysisStore.ts";
import { loadWeeklyReflectionStore } from "../weeklyReflectionStore.ts";
import { loadWeeklySettlementStore } from "../weeklySettlementStore.ts";
import { loadWeeklyConversationStore, loadWeeklyRecordStore } from "../weeklyStore.ts";
import "./weeklyResearchExportScreen.css";

type ScopeKind = "week" | "all";

export function WeeklyResearchExportScreen() {
  const [scopeKind, setScopeKind] = useState<ScopeKind>("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [includeSensitiveText, setIncludeSensitiveText] = useState(false);
  const [sensitiveConfirmed, setSensitiveConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);

  const snapshot = useMemo(() => loadSnapshot(), [revision]);
  const scope: ResearchExportScope = scopeKind === "week" ? { kind: "week", anchor } : { kind: "all" };
  const preview = useMemo(() => {
    if (snapshot.error || !snapshot.sources) return null;
    try {
      return buildResearchExportBundle(snapshot.sources, {
        scope,
        includeSensitiveText,
        exportedAt: new Date().toISOString(),
      });
    } catch (error) {
      return { error: messageOf(error, "研究データを準備できませんでした。") } as const;
    }
  }, [snapshot, scopeKind, anchor, includeSensitiveText]);
  const currentWeek = formatPeriod(new Date(), "weekly");
  const selectedWeek = formatPeriod(anchor, "weekly");
  const isCurrentWeek = currentWeek === selectedWeek;
  const exportDisabled = !snapshot.sources || !!snapshot.error || !preview || "error" in preview
    || (includeSensitiveText && !sensitiveConfirmed);

  function changeSensitive(enabled: boolean) {
    setIncludeSensitiveText(enabled);
    setSensitiveConfirmed(false);
    setMessage("");
  }

  function refresh() {
    setRevision((value) => value + 1);
    setMessage("保存済みの週次データを再読み込みしました。");
  }

  function exportFile(kind: "csv" | "json" | "accounting" | "reflection") {
    setMessage("");
    if (!snapshot.sources || exportDisabled) {
      setMessage(includeSensitiveText && !sensitiveConfirmed
        ? "自由記述等を含める場合は、内容を確認したチェックが必要です。"
        : "出力データを準備できませんでした。");
      return;
    }
    try {
      const bundle = buildResearchExportBundle(snapshot.sources, {
        scope,
        includeSensitiveText,
        exportedAt: new Date().toISOString(),
      });
      const suffix = scopeKind === "all" ? "all" : bundle.scope.weekKey ?? "week";
      if (kind === "json") {
        downloadText(`research-weekly-${suffix}.json`, serializeResearchJson(bundle), "application/json;charset=utf-8");
      } else if (kind === "accounting") {
        downloadText(`research-accounting-${suffix}.csv`, serializeResearchAccountingCsv(bundle), "text/csv;charset=utf-8");
      } else if (kind === "reflection") {
        downloadText(`research-reflections-${suffix}.csv`, serializeResearchReflectionsCsv(bundle), "text/csv;charset=utf-8");
      } else {
        downloadText(`research-activities-${suffix}.csv`, serializeResearchActivitiesCsv(bundle), "text/csv;charset=utf-8");
      }
      setMessage(`${kind === "json" ? "JSON" : kind === "accounting" ? "会計CSV" : kind === "reflection" ? "振り返りCSV" : "活動CSV"}を端末へ出力しました。`);
    } catch (error) {
      setMessage(messageOf(error, "研究データを出力できませんでした。保存済みデータは変更していません。"));
    }
  }

  return <div className="weekly-research-export stack">
    <section className="weekly-intro-card">
      <p className="eyebrow">論文用データ</p>
      <h2>研究データをCSV・JSONで出力</h2>
      <p>本人がボタンを押したときだけ端末へファイルを作成します。APIキーと会話本文は、設定にかかわらず出力しません。</p>
      <button type="button" className="secondary-action" onClick={refresh}>保存データを再読み込み</button>
    </section>

    {snapshot.error && <p className="weekly-form-message error" role="alert">{snapshot.error}</p>}
    {preview && "error" in preview && <p className="weekly-form-message error" role="alert">{preview.error}</p>}

    <section className="weekly-panel" aria-labelledby="research-export-scope-heading">
      <div className="weekly-section-heading"><span>1</span><div><p className="eyebrow">対象期間</p><h3 id="research-export-scope-heading">週単位・全期間を選ぶ</h3></div></div>
      <fieldset className="research-export-scope">
        <legend>出力範囲</legend>
        <label><input type="radio" name="research-export-scope" checked={scopeKind === "week"} onChange={() => setScopeKind("week")} />選択した週</label>
        <label><input type="radio" name="research-export-scope" checked={scopeKind === "all"} onChange={() => setScopeKind("all")} />全期間</label>
      </fieldset>
      {scopeKind === "week" && <div className="research-export-week-nav">
        <button type="button" onClick={() => setAnchor((value) => shiftPeriod(value, "weekly", -1))}>← 前の週</button>
        <strong>{selectedWeek}</strong>
        <button type="button" disabled={isCurrentWeek} onClick={() => setAnchor((value) => shiftPeriod(value, "weekly", 1))}>次の週 →</button>
        <button type="button" disabled={isCurrentWeek} onClick={() => setAnchor(new Date())}>今週</button>
      </div>}
      {preview && !("error" in preview) && <div className="research-export-counts">
        <span>活動 <b>{preview.activities.length}件</b></span>
        <span>週次集計 <b>{preview.weeklyStatements.length}週</b></span>
        <span>振り返り <b>{preview.reflections.length}週</b></span>
      </div>}
    </section>

    <section className="weekly-panel" aria-labelledby="research-export-privacy-heading">
      <div className="weekly-section-heading"><span>2</span><div><p className="eyebrow">プライバシー確認</p><h3 id="research-export-privacy-heading">自由記述等の出力範囲</h3></div></div>
      <div className="research-export-standard">
        <strong>標準出力</strong>
        <p>ID、日時、秒数、分類、AIAS Level、研究指標、分析状態、モデル・評価基準、B/S・P/Lを出力します。未評価は空欄／nullのままで、0点にはしません。</p>
        <p>会話本文とAPIキーは常に対象外です。</p>
      </div>
      <label className="research-export-check"><input type="checkbox" checked={includeSensitiveText} onChange={(event) => changeSensitive(event.target.checked)} />
        <span><strong>評価根拠の引用・自由記述・週次振り返り本文も含める</strong><small>個人名、所属、相談内容などが含まれていないか、出力前に確認してください。</small></span>
      </label>
      {includeSensitiveText && <label className="research-export-check confirm"><input type="checkbox" checked={sensitiveConfirmed} onChange={(event) => setSensitiveConfirmed(event.target.checked)} />
        <span>出力対象に個人情報が含まれ得ることを確認し、この端末へ保存します。</span>
      </label>}
    </section>

    <section className="weekly-panel" aria-labelledby="research-export-download-heading">
      <div className="weekly-section-heading"><span>3</span><div><p className="eyebrow">本人の明示操作</p><h3 id="research-export-download-heading">ファイルを作成</h3></div></div>
      <div className="research-export-actions">
        <button type="button" className="primary-action" disabled={exportDisabled} onClick={() => exportFile("csv")}>活動データCSV</button>
        <button type="button" className="secondary-action" disabled={exportDisabled} onClick={() => exportFile("json")}>研究データJSON</button>
        <button type="button" className="secondary-action" disabled={exportDisabled} onClick={() => exportFile("reflection")}>週次振り返りCSV</button>
        <button type="button" className="secondary-action" disabled={exportDisabled} onClick={() => exportFile("accounting")}>週次B/S・P/L CSV</button>
      </div>
      <p className="weekly-muted">CSVはUTF-8 BOM付きです。すべてのセルを引用し、数式として解釈される先頭文字を無効化します。</p>
      {message && <p className="weekly-form-message" role="status">{message}</p>}
    </section>
  </div>;
}

function loadSnapshot(): { sources: ResearchExportSources | null; error: string } {
  try {
    return {
      sources: Object.freeze({
        records: loadWeeklyRecordStore(),
        conversations: loadWeeklyConversationStore(),
        analyses: loadWeeklyAnalysisStore(),
        reviews: loadWeeklyAnalysisReviewStore(),
        reflections: loadWeeklyReflectionStore(),
        settlements: loadWeeklySettlementStore(),
      }),
      error: "",
    };
  } catch (error) {
    return { sources: null, error: messageOf(error, "研究データを読み込めませんでした。保存値は変更していません。") };
  }
}

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
