import type { AnalysisScore } from "./analysisContract.ts";

export const LEGACY_WEEKLY_ANALYSIS_RUBRIC_VERSION = "research-thinking-rubric-v1" as const;
export const WEEKLY_ANALYSIS_RUBRIC_VERSION = "research-thinking-rubric-v2" as const;
export const WEEKLY_ANALYSIS_SCORE_OPTIONS = [0, 25, 50, 75, 100] as const;

export type WeeklyAnalysisMetric = "initiative" | "reasoning" | "independence";
export type WeeklyAnalysisEvaluationStatus = "confirmed" | "provisional" | "hold" | "not_applicable";
export type WeeklyAnalysisEvidenceSufficiency = "high" | "medium" | "low";
export type WeeklyAnalysisRubricLevel = Readonly<{ score: Exclude<AnalysisScore, null>; description: string }>;

export const WEEKLY_ANALYSIS_RUBRIC: Readonly<Record<WeeklyAnalysisMetric, readonly WeeklyAnalysisRubricLevel[]>> = Object.freeze({
  initiative: Object.freeze([
    { score: 0, description: "思考を要する課題で、自分は考えず全てAIに任せると明示した。" },
    { score: 25, description: "自分の関心・話題は示すが、自ら理由を発展させずAIの答えにほぼ従う。" },
    { score: 50, description: "AIの問いに対し、自分の仮説と理由を述べる。" },
    { score: 75, description: "自分から新しい視点や解決策を提示する。" },
    { score: 100, description: "自分の案の弱点を検討し、適切に発展・再構成する。" },
  ].map(row => Object.freeze(row))) as readonly WeeklyAnalysisRubricLevel[],
  reasoning: Object.freeze([
    { score: 0, description: "中核の推論に決定的な矛盾など、十分に明確な重大問題がある。" },
    { score: 25, description: "結論を支える根拠が著しく弱い、または重要な論理飛躍がある。" },
    { score: 50, description: "主張と理由に基本的なつながりがある。" },
    { score: 75, description: "関連する反論・制約・リスクを検討して調整する。" },
    { score: 100, description: "課題の目的に必要十分な推論・重要条件・検証可能性を扱う。" },
  ].map(row => Object.freeze(row))) as readonly WeeklyAnalysisRubricLevel[],
  independence: Object.freeze([
    { score: 0, description: "本人が担うべき判断を、検討せずAIに全面委任した証拠がある。" },
    { score: 25, description: "自分の関心を多少使うが、判断の大部分をAIに委ねる。" },
    { score: 50, description: "自分の価値観・条件を実際の判断や方向性に使う。" },
    { score: 75, description: "自分の基準で比較し、またはAI提案を吟味して方向性を修正する。" },
    { score: 100, description: "自分の目的から検討方向を主体的に定め、選択または理由ある判断保留を行う。" },
  ].map(row => Object.freeze(row))) as readonly WeeklyAnalysisRubricLevel[],
});

export const WEEKLY_ANALYSIS_NULL_RULE = "証拠不足はholdかprovisionalとし、点数はnullにする。0点は考えなかったことを示す直接の証拠がある場合だけ使用する。";
export const WEEKLY_ANALYSIS_CONTEXT_RULE = "短文や選択肢への回答は利用を許可された前後文脈と合わせて評価し、文脈不足ならholdとする。";
export const WEEKLY_ANALYSIS_SCOPE_NOTICE = "会話から観察できた行動の評価であり、本人の内面・潜在能力・AIAS Level・課題の複雑さを示す点数ではない。";
