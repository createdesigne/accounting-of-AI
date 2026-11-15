import { dateKey, periodBounds } from "./ledgerPeriods.ts";
import { allocateRecordToWeeks } from "./weeklyAccounting.ts";
import type { AnalysisActivityCategory } from "./integrations/analysisContract.ts";
import type { TaskV1, WeeklyRecordV1, WeeklyTimeSource } from "./weeklyData.ts";

export type WeeklyDashboardCategoryRow = Readonly<{
  category: AnalysisActivityCategory;
  seconds: number;
  count: number;
}>;

export type WeeklyDashboardSourceRow = Readonly<{
  source: WeeklyTimeSource;
  seconds: number;
  count: number;
}>;

export type WeeklyDashboardRecordRow = Readonly<{
  record: WeeklyRecordV1;
  allocatedSeconds: number;
}>;

export type WeeklyDashboardData = Readonly<{
  weekKey: string;
  weekStart: Date;
  weekEndExclusive: Date;
  totalSeconds: number;
  recordCount: number;
  categories: readonly WeeklyDashboardCategoryRow[];
  sources: readonly WeeklyDashboardSourceRow[];
  tasks: readonly TaskV1[];
  records: readonly WeeklyDashboardRecordRow[];
  unclassifiedCount: number;
  notConnectedCount: number;
  notEvaluatedCount: number;
  notApplicableCount: number;
}>;

const sourceOrder: readonly WeeklyTimeSource[] = ["manual", "measured", "adjusted", "unknown"];
const categoryOrder: readonly AnalysisActivityCategory[] = [
  "相談", "壁打ち", "文章作成", "情報収集", "学習", "その他", null,
];

export function buildWeeklyDashboardData(
  records: readonly WeeklyRecordV1[],
  tasks: readonly TaskV1[],
  anchor: Date,
): WeeklyDashboardData {
  const bounds = periodBounds(anchor, "weekly");
  const weekKey = dateKey(bounds.start);
  const uniqueRecords = deduplicateRecords(records);
  const weeklyRows = uniqueRecords.flatMap((record): WeeklyDashboardRecordRow[] => {
    const allocation = allocateRecordToWeeks(record).find((item) => item.weekKey === weekKey);
    return allocation ? [{ record, allocatedSeconds: allocation.seconds }] : [];
  }).sort((left, right) => right.record.recordedAt.localeCompare(left.record.recordedAt));

  const categoryBuckets = new Map<AnalysisActivityCategory, { seconds: number; count: number }>();
  const sourceBuckets = new Map<WeeklyTimeSource, { seconds: number; count: number }>();
  weeklyRows.forEach(({ record, allocatedSeconds }) => {
    addBucket(categoryBuckets, record.activityCategory, allocatedSeconds);
    addBucket(sourceBuckets, record.timeSource, allocatedSeconds);
  });

  const linkedTaskIds = new Set(weeklyRows.map(({ record }) => record.taskId).filter((id): id is string => id !== null));
  const weeklyTasks = deduplicateTasks(tasks).filter((task) => {
    const createdAt = new Date(task.createdAt);
    return linkedTaskIds.has(task.id)
      || (!Number.isNaN(createdAt.getTime()) && createdAt >= bounds.start && createdAt < bounds.end);
  }).sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return Object.freeze({
    weekKey,
    weekStart: new Date(bounds.start),
    weekEndExclusive: new Date(bounds.end),
    totalSeconds: sum(weeklyRows.map((row) => row.allocatedSeconds)),
    recordCount: weeklyRows.length,
    categories: Object.freeze(categoryOrder.flatMap((category) => {
      const bucket = categoryBuckets.get(category);
      return bucket ? [Object.freeze({ category, ...bucket })] : [];
    })),
    sources: Object.freeze(sourceOrder.map((source) => {
      const bucket = sourceBuckets.get(source) ?? { seconds: 0, count: 0 };
      return Object.freeze({ source, ...bucket });
    })),
    tasks: Object.freeze(weeklyTasks),
    records: Object.freeze(weeklyRows.map((row) => Object.freeze(row))),
    unclassifiedCount: weeklyRows.filter(({ record }) => record.analysisStatus !== "not-applicable"
      && (record.activityCategory === null || record.accountingDisposition === "unclassified")).length,
    notConnectedCount: weeklyRows.filter(({ record }) => record.analysisStatus === "not-connected").length,
    notEvaluatedCount: weeklyRows.filter(({ record }) => record.analysisStatus !== "not-applicable"
      && (record.analysis.initiative === null || record.analysis.reasoning === null
        || record.analysis.criticalJudgment === null)).length,
    notApplicableCount: weeklyRows.filter(({ record }) => record.analysisStatus === "not-applicable").length,
  });
}

function deduplicateRecords(records: readonly WeeklyRecordV1[]) {
  const ids = new Set<string>();
  const sourceIds = new Set<string>();
  return records.filter((record) => {
    if (ids.has(record.id)) return false;
    if (record.sourceEventId !== null && sourceIds.has(record.sourceEventId)) return false;
    ids.add(record.id);
    if (record.sourceEventId !== null) sourceIds.add(record.sourceEventId);
    return true;
  });
}

function deduplicateTasks(tasks: readonly TaskV1[]) {
  const ids = new Set<string>();
  return tasks.filter((task) => {
    if (ids.has(task.id)) return false;
    ids.add(task.id);
    return true;
  });
}

function addBucket<K>(buckets: Map<K, { seconds: number; count: number }>, key: K, seconds: number) {
  const current = buckets.get(key) ?? { seconds: 0, count: 0 };
  buckets.set(key, { seconds: current.seconds + seconds, count: current.count + 1 });
}

function sum(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0);
}
