import assert from "node:assert/strict";
import test from "node:test";
import { createTimeAccountingLedger, recordAiUsage } from "../src/timeAccounting.ts";
import { loadTimeAccountingStore } from "../src/timeAccountingStore.ts";
import { buildTimeAccountingView } from "../src/timeAccountingView.ts";

test("保存済み61秒を今月の合計と時間仕訳に表示する", () => {
  const ledger = recordAiUsage(createTimeAccountingLedger(), {
    entryId: "ai-usage:record-61",
    sourceEventId: "chrome-time:record-61",
    occurredOn: "2026-11-11",
    actualInputSeconds: 61,
  });

  const view = buildTimeAccountingView(ledger, new Date(2026, 10, 30));

  assert.equal(view.currentMonth, "2026-11");
  assert.equal(view.currentMonthSeconds, 61);
  assert.equal(view.currentMonthRecordCount, 1);
  assert.deepEqual(view.rows[0], {
    id: "ai-usage:record-61",
    sourceEventId: "chrome-time:record-61",
    usedOn: "2026-11-11",
    serviceName: "ChatGPT",
    durationSeconds: 61,
    debitAccount: "AI仮受品",
    creditAccount: "時間拠出",
  });
});

test("月間合計は利用日が現在月の記録だけを合計し、全仕訳は保持する", () => {
  let ledger = recordAiUsage(createTimeAccountingLedger(), {
    entryId: "november-entry",
    sourceEventId: "chrome-time:november",
    occurredOn: "2026-11-30",
    actualInputSeconds: 59,
  });
  ledger = recordAiUsage(ledger, {
    entryId: "december-entry",
    sourceEventId: "chrome-time:december",
    occurredOn: "2026-12-01",
    actualInputSeconds: 60,
  });

  const view = buildTimeAccountingView(ledger, new Date(2026, 10, 15));

  assert.equal(view.currentMonthSeconds, 59);
  assert.equal(view.currentMonthRecordCount, 1);
  assert.equal(view.rows.length, 2);
  assert.deepEqual(view.rows.map((row) => row.usedOn), ["2026-12-01", "2026-11-30"]);
});

test("保存データがまだない場合は空の表示値を返す", () => {
  const view = buildTimeAccountingView(null, new Date(2026, 10, 11));
  assert.equal(view.currentMonthSeconds, 0);
  assert.equal(view.currentMonthRecordCount, 0);
  assert.deepEqual(view.rows, []);
});

test("ページ再読み込みと同じ経路で専用ストアから61秒を復元する", () => {
  const ledger = recordAiUsage(createTimeAccountingLedger(), {
    entryId: "ai-usage:reloaded-61",
    sourceEventId: "chrome-time:reloaded-61",
    occurredOn: "2026-11-11",
    actualInputSeconds: 61,
  });
  const serialized = JSON.stringify({ storeVersion: 1, ledger, importedRecords: [] });
  const restored = loadTimeAccountingStore({ getItem: () => serialized });

  const view = buildTimeAccountingView(restored.ledger, new Date(2026, 10, 11));

  assert.equal(view.currentMonthSeconds, 61);
  assert.equal(view.rows[0]?.durationSeconds, 61);
});
