export const WEEKLY_EXPENSE_ACCOUNT_NAMES = Object.freeze([
  "相談活動費",
  "思考探究費",
  "成果物利用費",
  "情報収集費",
  "学習活動費",
  "その他AI利用費",
] as const);

export type WeeklyExpenseAccount = typeof WEEKLY_EXPENSE_ACCOUNT_NAMES[number];

export function isWeeklyExpenseAccount(value: unknown): value is WeeklyExpenseAccount {
  return typeof value === "string"
    && WEEKLY_EXPENSE_ACCOUNT_NAMES.includes(value as WeeklyExpenseAccount);
}
