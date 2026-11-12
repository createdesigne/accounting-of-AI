import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { AnalysisActivityCategory } from "../integrations/analysisContract.ts";
import type { AccountingDisposition, TaskV1, WeeklyPrivacyChoice, WeeklyRecordV1 } from "../weeklyData.ts";
import {
  deleteWeeklyRecord,
  deleteWeeklyTask,
  loadWeeklyConversationStore,
  loadWeeklyRecordStore,
  saveManualWeeklyRecord,
  saveWeeklyTask,
  WEEKLY_CONVERSATIONS_STORAGE_KEY,
  WEEKLY_RECORDS_STORAGE_KEY,
  type WeeklyRecordStoreV1,
} from "../weeklyStore.ts";
import "./weeklyManualScreen.css";

const categories = ["相談", "壁打ち", "文章作成", "情報収集", "学習", "その他"] as const;
const levelDescriptions: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "AIを使わない課題として記録します。利用時間には加算しません。",
  2: "限定した部分だけAIの支援を使う課題設定です。",
  3: "一部の工程をAIと協働する課題設定です。",
  4: "広い範囲でAIと協働し、人が重要な判断を行う課題設定です。",
  5: "AIに広い実行範囲を任せ、人が目的設定と監督を行う課題設定です。",
};

type TaskDraft = {
  title: string;
  goal: string;
  expectedAiRole: string;
  level: 1 | 2 | 3 | 4 | 5;
  category: Exclude<AnalysisActivityCategory, null>;
};

type ActivityDraft = {
  taskId: string;
  recordedAt: string;
  seconds: string;
  category: Exclude<AnalysisActivityCategory, null>;
  aiService: "chatgpt" | "claude" | "gemini" | "other";
  disposition: AccountingDisposition;
  privacy: WeeklyPrivacyChoice;
  interactionSummary: string;
  ownThoughts: string;
  discovery: string;
};

const emptyTask = (): TaskDraft => ({
  title: "",
  goal: "",
  expectedAiRole: "",
  level: 2,
  category: "壁打ち",
});

const emptyActivity = (): ActivityDraft => ({
  taskId: "",
  recordedAt: toLocalDateTimeInput(new Date()),
  seconds: "",
  category: "壁打ち",
  aiService: "chatgpt",
  disposition: "expense",
  privacy: "full",
  interactionSummary: "",
  ownThoughts: "",
  discovery: "",
});

export function WeeklyManualScreen() {
  const [store, setStore] = useState<WeeklyRecordStoreV1>(() => safeLoadStore());
  const [taskDraft, setTaskDraft] = useState<TaskDraft>(emptyTask);
  const [activityDraft, setActivityDraft] = useState<ActivityDraft>(emptyActivity);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [taskMessage, setTaskMessage] = useState("");
  const [activityMessage, setActivityMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");

  const tasksById = useMemo(() => new Map(store.tasks.map((task) => [task.id, task])), [store.tasks]);
  const selectedTask = activityDraft.taskId ? tasksById.get(activityDraft.taskId) ?? null : null;
  const selectedTaskIsNoAi = selectedTask?.plannedAiasLevel === 1;
  const records = useMemo(
    () => [...store.records].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)),
    [store.records],
  );

  useEffect(() => {
    const refresh = (event?: StorageEvent) => {
      if (event && event.key !== WEEKLY_RECORDS_STORAGE_KEY
        && event.key !== WEEKLY_CONVERSATIONS_STORAGE_KEY && event.key !== null) return;
      try {
        setStore(loadWeeklyRecordStore());
        setLoadError("");
      } catch (error) {
        setLoadError(messageOf(error, "週次記録を読み込めませんでした。保存値は変更していません。"));
      }
    };
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);

  async function submitTask(event: FormEvent) {
    event.preventDefault();
    setTaskMessage("");
    if (!taskDraft.title.trim()) {
      setTaskMessage("課題名を入力してください。");
      return;
    }
    if (!taskDraft.goal.trim()) {
      setTaskMessage("活動目的を入力してください。");
      return;
    }
    if (taskDraft.level !== 1 && !taskDraft.expectedAiRole.trim()) {
      setTaskMessage("期待するAIの役割を入力してください。");
      return;
    }
    setBusy(true);
    try {
      const existing = editingTaskId ? tasksById.get(editingTaskId) : undefined;
      const next = await saveWeeklyTask({
        id: editingTaskId ?? createId("task"),
        title: taskDraft.title,
        goal: taskDraft.goal,
        plannedAiasLevel: taskDraft.level,
        activityCategory: taskDraft.category,
        delegatedToAi: taskDraft.level === 1 ? "AIを使用しない" : taskDraft.expectedAiRole,
        humanDecision: null,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      });
      setStore(next);
      setTaskDraft(emptyTask());
      setEditingTaskId(null);
      setTaskMessage(existing ? "課題設定を更新しました。" : "活動前の課題設定を保存しました。");
    } catch (error) {
      setTaskMessage(messageOf(error, "課題設定を保存できませんでした。"));
    } finally {
      setBusy(false);
    }
  }

  function editTask(task: TaskV1) {
    setEditingTaskId(task.id);
    setTaskDraft({
      title: task.title,
      goal: task.goal ?? "",
      expectedAiRole: task.plannedAiasLevel === 1 ? "" : task.delegatedToAi ?? "",
      level: task.plannedAiasLevel ?? 2,
      category: task.activityCategory ?? "その他",
    });
    setTaskMessage("課題設定を編集中です。");
  }

  async function removeTask(task: TaskV1) {
    if (!window.confirm(`課題「${task.title}」を削除しますか？`)) return;
    setBusy(true);
    try {
      setStore(await deleteWeeklyTask(task.id));
      if (editingTaskId === task.id) cancelTaskEdit();
      setTaskMessage("課題設定を削除しました。");
    } catch (error) {
      setTaskMessage(messageOf(error, "課題設定を削除できませんでした。"));
    } finally {
      setBusy(false);
    }
  }

  function cancelTaskEdit() {
    setEditingTaskId(null);
    setTaskDraft(emptyTask());
    setTaskMessage("");
  }

  function selectTask(taskId: string) {
    const task = tasksById.get(taskId);
    setActivityDraft((current) => ({
      ...current,
      taskId,
      category: task?.activityCategory ?? current.category,
      seconds: task?.plannedAiasLevel === 1 ? "0" : current.seconds,
      aiService: task?.plannedAiasLevel === 1 ? "other" : current.aiService,
      disposition: task?.plannedAiasLevel === 1 ? "unclassified" : current.disposition,
    }));
    setActivityMessage("");
  }

  async function submitActivity(event: FormEvent) {
    event.preventDefault();
    setActivityMessage("");
    const noAi = selectedTaskIsNoAi;
    const seconds = noAi ? 0 : Number(activityDraft.seconds);
    if (!activityDraft.recordedAt || Number.isNaN(new Date(activityDraft.recordedAt).getTime())) {
      setActivityMessage("活動日時を入力してください。");
      return;
    }
    if (!Number.isSafeInteger(seconds) || seconds < 0) {
      setActivityMessage("利用時間は0以上の整数秒で入力してください。");
      return;
    }
    if (!noAi && seconds === 0) {
      setActivityMessage("AIを利用した活動は1秒以上で入力してください。");
      return;
    }
    if (activityDraft.privacy === "full"
      && ![activityDraft.interactionSummary, activityDraft.ownThoughts, activityDraft.discovery].some((value) => value.trim())) {
      setActivityMessage("概要・自分の判断・発見のいずれかを入力してください。");
      return;
    }
    setBusy(true);
    try {
      const recordId = editingRecordId ?? createId("activity");
      const full = activityDraft.privacy === "full";
      const result = await saveManualWeeklyRecord({
        id: recordId,
        recordedAt: new Date(activityDraft.recordedAt).toISOString(),
        activeSeconds: seconds,
        timeSource: "manual",
        aiService: noAi ? "other" : activityDraft.aiService,
        privacy: activityDraft.privacy,
        taskId: activityDraft.taskId || null,
        activityCategory: activityDraft.category,
        accountingDisposition: noAi ? "unclassified" : activityDraft.disposition,
        analysisApplicable: !noAi,
        selfReflection: full ? activityDraft.ownThoughts : null,
        manualNotes: full ? {
          interactionSummary: activityDraft.interactionSummary,
          ownThoughts: activityDraft.ownThoughts,
          discovery: activityDraft.discovery,
        } : null,
        conversation: full && activityDraft.interactionSummary.trim() ? {
          id: `${recordId}:manual-summary`,
          title: selectedTask?.title ?? "手入力による活動記録",
          captureScope: "unknown",
          messages: [{ role: "user", text: activityDraft.interactionSummary.trim() }],
        } : null,
      });
      setStore(result.store);
      const wasEditing = editingRecordId !== null;
      setEditingRecordId(null);
      setActivityDraft(emptyActivity());
      setActivityMessage(result.persisted
        ? wasEditing ? "活動記録を更新しました。" : "活動記録を保存しました。"
        : wasEditing ? "保存範囲をoffに変更し、活動記録を削除しました。" : "保存範囲がoffのため記録は保存していません。");
    } catch (error) {
      setActivityMessage(messageOf(error, "活動記録を保存できませんでした。入力内容は画面に残しています。"));
    } finally {
      setBusy(false);
    }
  }

  function editRecord(record: WeeklyRecordV1) {
    const contents = loadWeeklyConversationStore().conversations.find((item) => item.recordId === record.id);
    setEditingRecordId(record.id);
    setActivityDraft({
      taskId: record.taskId ?? "",
      recordedAt: toLocalDateTimeInput(new Date(record.recordedAt)),
      seconds: String(record.activeSeconds),
      category: record.activityCategory ?? "その他",
      aiService: record.aiService,
      disposition: record.accountingDisposition,
      privacy: record.privacy,
      interactionSummary: record.manualNotes?.interactionSummary
        ?? contents?.messages.map((message) => message.text).join("\n") ?? "",
      ownThoughts: record.manualNotes?.ownThoughts ?? record.selfReflection ?? "",
      discovery: record.manualNotes?.discovery ?? "",
    });
    setActivityMessage("活動記録を編集中です。保存すると週次集計が再計算されます。");
  }

  async function removeRecord(record: WeeklyRecordV1) {
    if (!window.confirm("この活動記録を削除しますか？週次集計からも除外されます。")) return;
    setBusy(true);
    try {
      setStore(await deleteWeeklyRecord(record.id));
      if (editingRecordId === record.id) cancelRecordEdit();
      setActivityMessage("活動記録を削除しました。");
    } catch (error) {
      setActivityMessage(messageOf(error, "活動記録を削除できませんでした。"));
    } finally {
      setBusy(false);
    }
  }

  function cancelRecordEdit() {
    setEditingRecordId(null);
    setActivityDraft(emptyActivity());
    setActivityMessage("");
  }

  return (
    <div className="weekly-manual-screen stack">
      <section className="weekly-intro-card">
        <p className="eyebrow">週次プロトタイプ</p>
        <h2>課題設定と手入力</h2>
        <p>AIAS Levelは能力の採点ではなく、この課題でAIに任せる範囲を活動前に決めるための設定です。</p>
      </section>

      {loadError && <p className="weekly-form-message error" role="alert">{loadError}</p>}

      <section className="weekly-panel" aria-labelledby="weekly-task-heading">
        <div className="weekly-section-heading">
          <span>1</span>
          <div><p className="eyebrow">活動前に設定</p><h3 id="weekly-task-heading">AIAS課題設定</h3></div>
        </div>
        <form className="weekly-form" onSubmit={submitTask}>
          <label>課題名<input required value={taskDraft.title} onChange={(event) => setTaskDraft({ ...taskDraft, title: event.target.value })} placeholder="例：研究発表の構成を考える" /></label>
          <label>活動目的<textarea required value={taskDraft.goal} onChange={(event) => setTaskDraft({ ...taskDraft, goal: event.target.value })} placeholder="この活動で達成したいこと" /></label>
          <label>活動テーマ<select value={taskDraft.category} onChange={(event) => setTaskDraft({ ...taskDraft, category: event.target.value as TaskDraft["category"] })}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
          <fieldset className="aias-levels">
            <legend>課題に設定するAIAS Level</legend>
            <div>{([1, 2, 3, 4, 5] as const).map((level) => <label key={level} className={taskDraft.level === level ? "selected" : ""}><input type="radio" name="aias-level" value={level} checked={taskDraft.level === level} onChange={() => setTaskDraft({ ...taskDraft, level })} /><strong>Level {level}</strong></label>)}</div>
            <p>{levelDescriptions[taskDraft.level]}</p>
          </fieldset>
          <label>期待するAIの役割<input disabled={taskDraft.level === 1} value={taskDraft.level === 1 ? "AIを使用しない" : taskDraft.expectedAiRole} onChange={(event) => setTaskDraft({ ...taskDraft, expectedAiRole: event.target.value })} placeholder="例：論点を整理する壁打ち相手" /></label>
          <div className="weekly-form-actions">
            <button className="primary-action" type="submit" disabled={busy}>{editingTaskId ? "課題設定を更新" : "課題設定を保存"}</button>
            {editingTaskId && <button className="secondary-action" type="button" onClick={cancelTaskEdit}>編集をやめる</button>}
          </div>
          {taskMessage && <p className="weekly-form-message" role="status">{taskMessage}</p>}
        </form>
        <div className="weekly-saved-list" aria-label="保存済み課題設定">
          <h4>保存済みの課題設定</h4>
          {store.tasks.length === 0 ? <p className="weekly-empty">まだ課題設定はありません。</p> : store.tasks.map((task) => <article className="weekly-task-card" key={task.id}>
            <div><strong>{task.title}</strong><p>{task.goal}</p></div>
            <div className="weekly-tags"><span>Level {task.plannedAiasLevel ?? "未設定"}</span><span>{task.activityCategory ?? "未分類"}</span>{task.plannedAiasLevel === 1 && <span className="no-ai-tag">AI不使用</span>}</div>
            <p className="weekly-muted">期待する役割：{task.delegatedToAi ?? "未設定"}</p>
            <div className="weekly-item-actions"><button type="button" onClick={() => editTask(task)}>編集</button><button type="button" className="danger" onClick={() => void removeTask(task)}>削除</button></div>
          </article>)}
        </div>
      </section>

      <section className="weekly-panel" aria-labelledby="weekly-activity-heading">
        <div className="weekly-section-heading">
          <span>2</span>
          <div><p className="eyebrow">活動後に記録</p><h3 id="weekly-activity-heading">活動を手入力</h3></div>
        </div>
        <form className="weekly-form" onSubmit={submitActivity}>
          <label>関連する課題<select value={activityDraft.taskId} onChange={(event) => selectTask(event.target.value)}><option value="">課題を指定しない</option>{store.tasks.map((task) => <option key={task.id} value={task.id}>{task.title}（Level {task.plannedAiasLevel ?? "未設定"}）</option>)}</select></label>
          {selectedTaskIsNoAi && <p className="weekly-no-ai-notice">Level 1の課題です。AI利用時間は0秒として記録し、AI分析の対象外にします。</p>}
          <label>活動日時<input required type="datetime-local" value={activityDraft.recordedAt} onChange={(event) => setActivityDraft({ ...activityDraft, recordedAt: event.target.value })} /></label>
          <label>利用時間（秒）<input required inputMode="numeric" type="number" min="0" step="1" disabled={selectedTaskIsNoAi} value={selectedTaskIsNoAi ? "0" : activityDraft.seconds} onChange={(event) => setActivityDraft({ ...activityDraft, seconds: event.target.value })} placeholder="例：720" /><small>手入力値として保存します。実測とは表示しません。</small></label>
          <div className="weekly-form-grid">
            <label>活動テーマ<select value={activityDraft.category} onChange={(event) => setActivityDraft({ ...activityDraft, category: event.target.value as ActivityDraft["category"] })}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
            <label>AIサービス<select disabled={selectedTaskIsNoAi} value={selectedTaskIsNoAi ? "other" : activityDraft.aiService} onChange={(event) => setActivityDraft({ ...activityDraft, aiService: event.target.value as ActivityDraft["aiService"] })}><option value="chatgpt">ChatGPT</option><option value="claude">Claude</option><option value="gemini">Gemini</option><option value="other">その他</option></select></label>
            <label>会計区分<select disabled={selectedTaskIsNoAi} value={selectedTaskIsNoAi ? "unclassified" : activityDraft.disposition} onChange={(event) => setActivityDraft({ ...activityDraft, disposition: event.target.value as AccountingDisposition })}><option value="expense">費用</option><option value="asset">成果物資産</option><option value="work-in-progress">仕掛成果物</option><option value="unclassified">未分類</option></select></label>
            <label>保存範囲<select value={activityDraft.privacy} onChange={(event) => setActivityDraft({ ...activityDraft, privacy: event.target.value as WeeklyPrivacyChoice })}><option value="full">full（時間と入力本文）</option><option value="time-only">time-only（時間のみ）</option><option value="off">off（保存しない）</option></select></label>
          </div>
          {activityDraft.privacy !== "full" && <p className="weekly-privacy-notice">{activityDraft.privacy === "time-only" ? "本文3項目は保存せず、時間と分類だけを保存します。" : "時間・本文とも保存しません。編集中の記録は削除されます。"}</p>}
          <label>AIとのやり取りの概要<textarea disabled={activityDraft.privacy !== "full"} value={activityDraft.interactionSummary} onChange={(event) => setActivityDraft({ ...activityDraft, interactionSummary: event.target.value })} /></label>
          <label>自分が考えたこと・判断したこと<textarea disabled={activityDraft.privacy !== "full"} value={activityDraft.ownThoughts} onChange={(event) => setActivityDraft({ ...activityDraft, ownThoughts: event.target.value })} /></label>
          <label>発見・学び<textarea disabled={activityDraft.privacy !== "full"} value={activityDraft.discovery} onChange={(event) => setActivityDraft({ ...activityDraft, discovery: event.target.value })} /></label>
          <div className="weekly-analysis-state"><strong>AI分析：未接続・未評価</strong><span>自動スコアは生成しません。3指標はすべて未評価（null）です。</span></div>
          <div className="weekly-form-actions">
            <button className="primary-action" type="submit" disabled={busy}>{editingRecordId ? "活動記録を更新" : "活動記録を保存"}</button>
            {editingRecordId && <button className="secondary-action" type="button" onClick={cancelRecordEdit}>編集をやめる</button>}
          </div>
          {activityMessage && <p className="weekly-form-message" role="status">{activityMessage}</p>}
        </form>
      </section>

      <section className="weekly-panel" aria-labelledby="weekly-records-heading">
        <div className="weekly-section-heading"><span>3</span><div><p className="eyebrow">週次データ基盤</p><h3 id="weekly-records-heading">保存した活動</h3></div></div>
        {records.length === 0 ? <p className="weekly-empty">実データはまだありません。固定サンプルは集計していません。</p> : <div className="weekly-record-list">{records.map((record) => {
          const task = record.taskId ? tasksById.get(record.taskId) : undefined;
          const noAi = task?.plannedAiasLevel === 1 || record.analysisStatus === "not-applicable";
          return <article className="weekly-record-card" key={record.id}>
            <div className="weekly-record-top"><div><time>{formatDateTime(record.recordedAt)}</time><strong>{task?.title ?? record.activityCategory ?? "未分類の活動"}</strong></div><span>{noAi ? "AI不使用" : `${record.activeSeconds}秒`}</span></div>
            <div className="weekly-tags"><span>{record.activityCategory ?? "未分類"}</span><span>{dispositionLabel(record.accountingDisposition)}</span><span>{record.timeSource === "manual" ? "手入力" : record.timeSource}</span>{task && <span>Level {task.plannedAiasLevel ?? "未設定"}</span>}</div>
            {record.manualNotes?.interactionSummary && <p><b>概要：</b>{record.manualNotes.interactionSummary}</p>}
            {record.manualNotes?.ownThoughts && <p><b>自分の判断：</b>{record.manualNotes.ownThoughts}</p>}
            {record.manualNotes?.discovery && <p><b>発見・学び：</b>{record.manualNotes.discovery}</p>}
            <div className={`weekly-analysis-state compact${noAi ? " not-applicable" : ""}`}><strong>{noAi ? "AI分析：対象外" : "AI分析：未接続・未評価"}</strong><span>{noAi ? "Level 1として事前設定されたAI不使用課題です。" : "評価値：— / — / —（0点ではありません）"}</span></div>
            <div className="weekly-item-actions"><button type="button" onClick={() => editRecord(record)}>編集</button><button type="button" className="danger" onClick={() => void removeRecord(record)}>削除</button></div>
          </article>;
        })}</div>}
      </section>
    </div>
  );
}

function safeLoadStore(): WeeklyRecordStoreV1 {
  try { return loadWeeklyRecordStore(); } catch { return Object.freeze({ schemaVersion: 1, records: Object.freeze([]), tasks: Object.freeze([]) }); }
}

function createId(prefix: string) {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${suffix}`;
}

function toLocalDateTimeInput(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function dispositionLabel(value: AccountingDisposition) {
  return { expense: "費用", asset: "成果物資産", "work-in-progress": "仕掛成果物", unclassified: "未分類" }[value];
}

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
