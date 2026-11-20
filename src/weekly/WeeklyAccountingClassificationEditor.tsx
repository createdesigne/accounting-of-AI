import { useEffect, useState, type FormEvent } from "react";
import type { AccountingDisposition, WeeklyRecordV1 } from "../weeklyData.ts";
import { defaultExpenseAccountForCategory } from "../weeklyData.ts";
import {
  accountingRevisionsForRecord,
  updateWeeklyRecordAccounting,
  type WeeklyAccountingRevisionStoreV1,
  type WeeklyAccountingUpdateResult,
} from "../weeklyAccountingClassificationStore.ts";
import { WEEKLY_EXPENSE_ACCOUNT_NAMES, type WeeklyExpenseAccount } from "../weeklyAccountingTypes.ts";
import type { WeeklyAnalysisDisplayState } from "../weeklyAnalysisStore.ts";

const dispositionOptions: ReadonlyArray<{ value: AccountingDisposition; label: string; description: string }> = [
  { value: "expense", label: "費用", description: "相談・学習・情報収集など、その活動で使い切った時間" },
  { value: "asset", label: "成果物資産", description: "完成し、今後も利用する文章・資料・制作物につながる時間" },
  { value: "work-in-progress", label: "仕掛成果物", description: "まだ制作途中で、今後完成させる成果物につながる時間" },
  { value: "unclassified", label: "未分類", description: "今は判断せず、後で本人が分類する時間" },
];

export function WeeklyAccountingClassificationEditor({
  record,
  analysisState,
  revisionStore,
  disabled,
  expanded = false,
  onSaved,
}: {
  record: WeeklyRecordV1;
  analysisState: WeeklyAnalysisDisplayState;
  revisionStore: WeeklyAccountingRevisionStoreV1;
  disabled: boolean;
  expanded?: boolean;
  onSaved: (result: WeeklyAccountingUpdateResult) => void;
}) {
  const [disposition, setDisposition] = useState<AccountingDisposition>(record.accountingDisposition);
  const [account, setAccount] = useState<WeeklyExpenseAccount>(() => currentExpenseAccount(record));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const analysis = analysisState.response?.analysis ?? null;
  const hasAiCandidate = Boolean(analysis?.accountingDispositionCandidate || analysis?.accountCandidate);
  const revisions = accountingRevisionsForRecord(revisionStore, record.id);

  useEffect(() => {
    setDisposition(record.accountingDisposition);
    setAccount(currentExpenseAccount(record));
  }, [record.id, record.accountingDisposition, record.accountingAccount, record.activityCategory]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await updateWeeklyRecordAccounting(
        record.id,
        disposition,
        disposition === "expense" ? account : null,
      );
      onSaved(result);
      setMessage(result.changed
        ? "本人確定の会計区分を保存しました。時間・会話・AI分析は変更していません。"
        : "会計区分は保存済みの内容と同じです。二重更新していません。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "会計区分を保存できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  if (disabled) {
    return <p className="weekly-accounting-disabled">AI不使用の活動はAI利用時間の会計分類対象外です。</p>;
  }

  return <details className="weekly-accounting-editor" open={expanded ? true : undefined}>
    <summary>会計区分を編集・確定</summary>
    {hasAiCandidate && <div className="weekly-accounting-ai-reference">
      <strong>Gemini候補（参考・自動確定しません）</strong>
      {analysis?.accountingDispositionCandidate && <span>会計区分：{candidateDispositionLabel(analysis.accountingDispositionCandidate)}</span>}
      {analysis?.accountCandidate && <span>勘定科目：{analysis.accountCandidate}</span>}
    </div>}
    <form onSubmit={save}>
      <fieldset className="weekly-accounting-options"><legend>本人が決める会計区分</legend><div>{dispositionOptions.map((option) => <label key={option.value} className={disposition === option.value ? "selected" : ""}><input type="radio" name={`accounting-disposition-${record.id}`} value={option.value} checked={disposition === option.value} onChange={() => setDisposition(option.value)} /><span><strong>{option.label}</strong><small>{option.description}</small></span></label>)}</div></fieldset>
      {disposition === "expense" && <label className="weekly-accounting-account">費用の勘定科目<select value={account} onChange={(event) => setAccount(event.target.value as WeeklyExpenseAccount)}>
          {WEEKLY_EXPENSE_ACCOUNT_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
        </select><small>活動の目的に最も近い科目を本人が選びます。</small></label>}
      <p>この活動の会計情報だけを更新します。実測秒数、新しい活動、Gemini分析、本人の思考評価は作成・変更しません。</p>
      <button className="primary-action weekly-accounting-save" type="submit" disabled={busy}>{busy ? "保存中…" : disposition === "unclassified" ? "未分類のまま保存" : "この区分で保存"}</button>
      {message && <p className="weekly-form-message" role="status">{message}</p>}
    </form>
    {revisions.length > 0 && <div className="weekly-accounting-history"><strong>会計区分の変更履歴</strong><ol>
      {[...revisions].reverse().map((revision) => <li key={revision.id}>
        <time>{formatDateTime(revision.changedAt)}</time>
        <span>{selectionLabel(revision.before)} → {selectionLabel(revision.after)}</span>
      </li>)}
    </ol></div>}
  </details>;
}

function currentExpenseAccount(record: WeeklyRecordV1): WeeklyExpenseAccount {
  return record.accountingAccount
    ?? defaultExpenseAccountForCategory(record.activityCategory)
    ?? "その他AI利用費";
}

function selectionLabel(selection: { disposition: AccountingDisposition; account: WeeklyExpenseAccount | null }) {
  const disposition = ({ expense: "費用", asset: "成果物資産", "work-in-progress": "仕掛成果物", unclassified: "未分類" } as const)[selection.disposition];
  return selection.account ? `${disposition}（${selection.account}）` : disposition;
}

function candidateDispositionLabel(value: AccountingDisposition | null | undefined) {
  return value ? ({ expense: "費用", asset: "成果物資産", "work-in-progress": "仕掛成果物", unclassified: "未分類" } as const)[value] : "候補なし";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(value));
}
