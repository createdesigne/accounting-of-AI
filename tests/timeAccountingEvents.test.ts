import assert from "node:assert/strict";
import test from "node:test";
import { TIME_ACCOUNTING_CHANGED_EVENT, notifyTimeAccountingChanged } from "../src/timeAccountingEvents.ts";

test("same-document time-accounting changes notify mounted candidate views", () => {
  const target = new EventTarget();
  let received = 0;
  target.addEventListener(TIME_ACCOUNTING_CHANGED_EVENT, () => { received += 1; });
  notifyTimeAccountingChanged(target);
  assert.equal(received, 1);
});
