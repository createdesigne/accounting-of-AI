import type { AnalysisScore } from "./analysisContract.ts";

export const WEEKLY_ANALYSIS_RUBRIC_VERSION = "research-thinking-rubric-v1" as const;

export const WEEKLY_ANALYSIS_SCORE_OPTIONS = [0, 25, 50, 75, 100] as const;

export type WeeklyAnalysisMetric = "initiative" | "reasoning" | "criticalJudgment";

export type WeeklyAnalysisRubricLevel = Readonly<{
  score: Exclude<AnalysisScore, null>;
  description: string;
}>;

/**
 * Research-specific behavioral anchors. They are not official AIAS scores and
 * do not measure a person's general ability. A score is valid only when the
 * analyzed conversation contains direct supporting evidence; otherwise null.
 */
export const WEEKLY_ANALYSIS_RUBRIC: Readonly<Record<WeeklyAnalysisMetric, readonly WeeklyAnalysisRubricLevel[]>> = Object.freeze({
  initiative: Object.freeze([
    Object.freeze({ score: 0, description: "AIの提案に従う発言だけがあり、目的・条件・次の行動を本人が示していない。" }),
    Object.freeze({ score: 25, description: "本人が依頼や関心を示すが、目的・条件・進め方の具体化はAI側に委ねている。" }),
    Object.freeze({ score: 50, description: "本人が目的または条件を示し、AIへの依頼や選択を一部具体化している。" }),
    Object.freeze({ score: 75, description: "本人が目的・条件・判断基準を示し、AIへの追加指示や方向修正を行っている。" }),
    Object.freeze({ score: 100, description: "本人が課題、検証手順、判断基準を主導して設計し、結論と次の行動を自ら決めている。" }),
  ]),
  reasoning: Object.freeze([
    Object.freeze({ score: 0, description: "本人の結論や選択に、会話内で理由・関係・比較が示されていない。" }),
    Object.freeze({ score: 25, description: "本人が結論や希望を述べるが、根拠や比較の説明は限定的である。" }),
    Object.freeze({ score: 50, description: "本人が少なくとも一つの理由、条件、因果関係を示している。" }),
    Object.freeze({ score: 75, description: "本人が複数案・条件・利点と制約を比較し、選択理由を説明している。" }),
    Object.freeze({ score: 100, description: "本人が仮説、根拠、反例や不確実性を関連付け、検証可能な形で結論を組み立てている。" }),
  ]),
  criticalJudgment: Object.freeze([
    Object.freeze({ score: 0, description: "本人がAI出力を受け入れる発言だけで、確認・留保・修正が会話内にない。" }),
    Object.freeze({ score: 25, description: "本人が疑問や違和感を示すが、具体的な確認または修正には至っていない。" }),
    Object.freeze({ score: 50, description: "本人がAI出力の一部を確認、修正、採否判断している。" }),
    Object.freeze({ score: 75, description: "本人が根拠・出典・制約を確認し、AI案を比較して採用・修正・却下している。" }),
    Object.freeze({ score: 100, description: "本人が独立した検証を行い、AI出力の限界を明示したうえで判断理由と適用範囲を記録している。" }),
  ]),
});

export const WEEKLY_ANALYSIS_NULL_RULE = "会話内の本人発言から直接確認できる根拠が不足する場合はnullとし、0点に置き換えない。";
