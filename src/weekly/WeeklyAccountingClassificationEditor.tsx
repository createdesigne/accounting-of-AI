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

export function WeeklyAccountingClassificationEditor({
  record,
  analysisState,
  revisionStore,
  disabled,
  onSaved,
}: {
  record: WeeklyRecordV1;
  analysisState: WeeklyAnalysisDisplayState;
  revisionStore: WeeklyAccountingRevisionStoreV1;
  disabled: boolean;
  onSaved: (result: WeeklyAccountingUpdateResult) => void;
}) {
  const [disposition, setDisposition] = useState<AccountingDisposition>(record.accountingDisposition);
  const [account, setAccount] = useState<WeeklyExpenseAccount>(() => currentExpenseAccount(record));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const analysis = analysisState.response?.analysis ?? null;
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

  return <details className="weekly-accounting-editor">
    <summary>会計区分を編集・確定</summary>
    <div className="weekly-accounting-ai-reference">
      <strong>Gemini候補（参考・自動確定しません）</strong>
      <span>会計区分：{candidateDispositionLabel(analysis?.accountingDispositionCandidate)}</span>
      <span>勘定科目：{analysis?.accountCandidate ?? "候補なし"}</span>
    </div>
    <form onSubmit={save}>
      <div className="weekly-form-grid">
        <label>本人が確定する会計区分<select value={disposition} onChange={(event) => setDisposition(event.target.value as AccountingDisposition)}>
          <option value="expense">費用</option>
          <option value="asset">成果物資産</option>
          <option value="work-in-progress">仕掛成果物</option>
          <option value="unclassified">未分類</option>
        </select></label>
        {disposition === "expense" ? <label>本人が確定する勘定科目<select value={account} onChange={(event) => setAccount(event.target.value as WeeklyExpenseAccount)}>
          {WEEKLY_EXPENSE_ACCOUNT_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
        </select></label> : <label>確定後の勘定科目<input readOnly value={fixedAccountLabel(disposition)} /></label>}
      </div>
      <p>この活動の会計情報だけを更新します。実測秒数、新しい活動、Gemini分析、本人の思考評価は作成・変更しません。</p>
      <button className="secondary-action" type="submit" disabled={busy}>{busy ? "保存中…" : "会計区分を確定して保存"}</button>
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

function fixedAccountLabel(disposition: AccountingDisposition) {
  return ({ asset: "成果物資産", "work-in-progress": "仕掛成果物", unclassified: "AI仮受品（未確定残高）", expense: "" } as const)[disposition];
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
