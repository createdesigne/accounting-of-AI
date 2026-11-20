export type WeeklyHomeAction = Readonly<{
  kind: "link-measurement" | "classify-accounting" | "start-recording" | "write-reflection";
  title: string;
  description: string;
  buttonLabel: string;
}>;

export function selectWeeklyHomeAction(input: Readonly<{
  recordCount: number;
  unlinkedMeasurementCount: number;
  unlinkedMeasurementSeconds: number;
  unclassifiedAccountingCount: number;
  hasPendingRecordWork?: boolean;
}>): WeeklyHomeAction {
  if (input.hasPendingRecordWork) {
    return Object.freeze({
      kind: "link-measurement",
      title: "未完了の記録があります",
      description: "受信済みの実測時間を確認して、記録を続けます。",
      buttonLabel: "続きから再開する",
    });
  }
  if (input.unlinkedMeasurementCount > 0) {
    return Object.freeze({
      kind: "link-measurement",
      title: "未完了の記録があります",
      description: `${input.unlinkedMeasurementCount}件・${formatDuration(input.unlinkedMeasurementSeconds)}の実測時間を活動に関連付けます。`,
      buttonLabel: "続きから再開する",
    });
  }
  if (input.unclassifiedAccountingCount > 0) {
    return Object.freeze({
      kind: "classify-accounting",
      title: "未完了の記録があります",
      description: `${input.unclassifiedAccountingCount}件の活動について、会計区分を確認します。`,
      buttonLabel: "続きから再開する",
    });
  }
  if (input.recordCount === 0) {
    return Object.freeze({
      kind: "start-recording",
      title: "今日の記録を始めましょう",
      description: "Chrome拡張機能から会話と実測時間を取り込みます。",
      buttonLabel: "会話を記録する",
    });
  }
  return Object.freeze({
    kind: "write-reflection",
    title: "今週を振り返る",
    description: "保存した活動を見ながら、本人の発見と次週の挑戦を記録します。",
    buttonLabel: "今週の振り返りを開く",
  });
}

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}分${String(rest).padStart(2, "0")}秒`;
}
