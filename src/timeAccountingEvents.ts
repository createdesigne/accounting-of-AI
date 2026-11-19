export const TIME_ACCOUNTING_CHANGED_EVENT = "watashi-to-ai-time-accounting-changed";

export function notifyTimeAccountingChanged(target: EventTarget = window) {
  target.dispatchEvent(new Event(TIME_ACCOUNTING_CHANGED_EVENT));
}
