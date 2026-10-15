type SummaryRecord = { aiRole: string; aiService: string };
type SummaryPeriod = "weekly" | "monthly" | "annual";

// Presentation only: use one recorded field at a time, never infer a relationship
// between independently counted AI names, roles, topics or thinking balances.
export function buildReportSummary(records: readonly SummaryRecord[], kind: SummaryPeriod, isCurrent = false): string {
  if (records.length === 0) return "この期間の記録はまだありません。";
  const period = isCurrent
    ? kind === "weekly" ? "今週" : kind === "monthly" ? "今月" : "今年"
    : kind === "weekly" ? "この週" : kind === "monthly" ? "この月" : "この年";
  const fallback = `${period}は、思考レシートが${records.length}件残っています。`;
  try {
    const roles = countLabels(records.map(record => record.aiRole));
    const services = countLabels(records.map(record => record.aiService));
    const role = roles[0];
    if (role && shortLabel(role.label)) {
      if (records.length <= 2 && role.count === records.length) return `${period}は、AIを「${role.label}」として使った記録があります。`;
      if (records.length >= 3 && role.count > records.length / 2) {
        return `${period}は、AIを「${role.label}」として使う記録が多めです。`;
      }
    }
    if (roles.length > 1) {
      const [first, second] = roles;
      if (shortLabel(first.label) && shortLabel(second.label) && Array.from(first.label + second.label).length <= 10) {
        return `${period}は、「${first.label}」や「${second.label}」などの役割をAIに求めています。`;
      }
      return `${period}は、AIに複数の役割を求めた記録が残っています。`;
    }
    const service = services[0];
    if (service && shortLabel(service.label)) {
      if (records.length <= 2 && service.count === records.length) return `${period}は、${service.label}を使った記録があります。`;
      if (records.length >= 3 && service.count > records.length / 2) {
        return `${period}は、${service.label}を使った記録が多めです。`;
      }
    }
    if (services.length > 1) return `${period}は、複数のAIを使った記録が残っています。`;
    return fallback;
  } catch {
    return fallback;
  }
}

function shortLabel(value: string) {
  return Array.from(value).length <= 14 && !/[\r\n]/.test(value);
}

function countLabels(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const label = value.trim();
    if (!label || label === "-" || label === "未記録") continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts, ([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ja"));
}
