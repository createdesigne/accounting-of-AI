import assert from "node:assert/strict";
import test from "node:test";
import {
  accountingPeriodAt,
  accountingPeriodForDate,
  createAccountingPeriodState,
  isAccountingPeriodClosed,
  isDateInAccountingPeriod,
  lastDateOfAccountingPeriod,
  nextAccountingPeriod,
  nextOpenAccountingPeriod,
  normalizeAccountingPeriodState,
  withClosedAccountingPeriod,
} from "../src/accountingPeriods.ts";

test("未締め月と締め済み月を区別し、締め日時を保持する", () => {
  const open = createAccountingPeriodState("Asia/Tokyo");
  assert.equal(isAccountingPeriodClosed(open, "2026-10"), false);
  const closed = withClosedAccountingPeriod(open, "2026-10", "2026-11-01T01:02:03.000Z");
  assert.equal(isAccountingPeriodClosed(closed, "2026-10"), true);
  assert.equal(isAccountingPeriodClosed(closed, "2026-11"), false);
  assert.deepEqual(closed.closedPeriods, [{
    periodKey: "2026-10", closedAt: "2026-11-01T01:02:03.000Z",
  }]);
  assert.deepEqual(withClosedAccountingPeriod(closed, "2026-10", "2026-11-02T00:00:00.000Z"), closed);
});

test("連続した締め済み月を飛ばして次の未締め期間を求める", () => {
  let state = createAccountingPeriodState("UTC");
  state = withClosedAccountingPeriod(state, "2026-10", "2026-11-01T00:00:00.000Z");
  state = withClosedAccountingPeriod(state, "2026-11", "2026-12-01T00:00:00.000Z");
  assert.equal(nextOpenAccountingPeriod(state, "2026-09"), "2026-09");
  assert.equal(nextOpenAccountingPeriod(state, "2026-10"), "2026-12");
});

test("月末・うるう年・年末の境界を正しく扱う", () => {
  assert.equal(accountingPeriodForDate("2026-01-31"), "2026-01");
  assert.equal(accountingPeriodForDate("2026-12-31"), "2026-12");
  assert.equal(nextAccountingPeriod("2026-12"), "2027-01");
  assert.equal(lastDateOfAccountingPeriod("2026-02"), "2026-02-28");
  assert.equal(lastDateOfAccountingPeriod("2028-02"), "2028-02-29");
  assert.equal(isDateInAccountingPeriod("2027-01-01", "2027-01"), true);
  assert.throws(() => accountingPeriodForDate("2026-02-29"));
});

test("同じ瞬間でも会計タイムゾーンに応じて月を判定する", () => {
  const instant = Date.parse("2026-12-31T15:30:00.000Z");
  assert.equal(accountingPeriodAt(instant, "Asia/Tokyo"), "2027-01");
  assert.equal(accountingPeriodAt(instant, "America/Los_Angeles"), "2026-12");
});

test("保存形式を正規化し、不正・重複した締め状態を拒否する", () => {
  const restored = normalizeAccountingPeriodState({
    version: 1,
    accountingTimeZone: "Asia/Tokyo",
    closedPeriods: [
      { periodKey: "2026-11", closedAt: "2026-12-01T00:00:00.000Z" },
      { periodKey: "2026-10", closedAt: "2026-11-01T00:00:00.000Z" },
    ],
  });
  assert.deepEqual(restored.closedPeriods.map((item) => item.periodKey), ["2026-10", "2026-11"]);
  assert.throws(() => normalizeAccountingPeriodState({
    version: 1,
    accountingTimeZone: "UTC",
    closedPeriods: [
      { periodKey: "2026-10", closedAt: "2026-11-01T00:00:00.000Z" },
      { periodKey: "2026-10", closedAt: "2026-11-02T00:00:00.000Z" },
    ],
  }));
});
