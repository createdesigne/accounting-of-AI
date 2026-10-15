/** Calendar periods use the browser's local timezone, as existing ledger dates do. */
export type LedgerPeriod = "weekly" | "monthly" | "annual";
export type DatedReceipt = { issuedAt: string; conversationDate: string };

export function calendarDate(year: number, month: number, day: number) {
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month, day);
  return date;
}

export function parseLedgerDate(value: string): Date | null {
  const text = value.trim();
  const match = text.match(/^(\d{4})[\/年.\-](\d{1,2})[\/月.\-](\d{1,2})(?:日)?(?=$|[T\s])/);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = calendarDate(Number(y), Number(m) - 1, Number(d));
  if (Number(y) < 1 || date.getFullYear() !== Number(y) || date.getMonth() !== Number(m) - 1 || date.getDate() !== Number(d)) return null;
  if (text.includes("T")) {
    const timestamp = new Date(text);
    if (Number.isNaN(timestamp.getTime())) return null;
    return calendarDate(timestamp.getFullYear(), timestamp.getMonth(), timestamp.getDate());
  }
  return date;
}

export function ledgerDate(receipt: DatedReceipt) {
  return parseLedgerDate(receipt.issuedAt) ?? parseLedgerDate(receipt.conversationDate);
}

export function dateKey(date: Date) {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function periodBounds(anchor: Date, kind: LedgerPeriod) {
  let start = calendarDate(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  if (kind === "weekly") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (kind === "monthly") start.setDate(1);
  if (kind === "annual") start = calendarDate(start.getFullYear(), 0, 1);
  const end = new Date(start);
  if (kind === "weekly") end.setDate(end.getDate() + 7);
  if (kind === "monthly") end.setMonth(end.getMonth() + 1);
  if (kind === "annual") end.setFullYear(end.getFullYear() + 1);
  return { start, end };
}

export function selectPeriod<T extends DatedReceipt>(data: T[], anchor: Date, kind: LedgerPeriod): T[] {
  const { start, end } = periodBounds(anchor, kind);
  return data.filter((receipt) => {
    const date = ledgerDate(receipt);
    return date !== null && date >= start && date < end;
  });
}

export function shiftPeriod(anchor: Date, kind: LedgerPeriod, amount: number) {
  if (kind === "weekly") {
    const date = new Date(anchor);
    date.setDate(date.getDate() + 7 * amount);
    return date;
  }
  const base = calendarDate(anchor.getFullYear() + (kind === "annual" ? amount : 0), anchor.getMonth() + (kind === "monthly" ? amount : 0), 1);
  const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  base.setDate(Math.min(anchor.getDate(), lastDay));
  return base;
}

export function formatPeriod(anchor: Date, kind: LedgerPeriod) {
  const { start, end } = periodBounds(anchor, kind);
  const last = new Date(end);
  last.setDate(last.getDate() - 1);
  if (kind === "annual") return `${start.getFullYear()}年1月〜12月`;
  if (kind === "monthly") return `${start.getFullYear()}年${start.getMonth() + 1}月`;
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  const label = (date: Date, includeYear: boolean) => `${includeYear ? `${date.getFullYear()}/` : ""}${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}（${days[date.getDay()]}）`;
  return `${label(start, true)}〜${label(last, last.getFullYear() !== start.getFullYear())}`;
}
