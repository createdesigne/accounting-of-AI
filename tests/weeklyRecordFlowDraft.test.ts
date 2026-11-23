import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  clearWeeklyRecordFlowDraft,
  createWeeklyRecordFlowDraft,
  loadWeeklyRecordFlowDraft,
  saveWeeklyRecordFlowDraft,
  updateWeeklyRecordFlowDraft,
} from "../src/weeklyRecordFlowDraft.ts";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

test("the five-step draft survives reload without storing an API key or duplicate conversation body", () => {
  const storage = new MemoryStorage();
  const initial = createWeeklyRecordFlowDraft("chrome-conversation:capture-24", new Date("2026-11-19T01:00:00Z"));
  const edited = updateWeeklyRecordFlowDraft(initial, {
    step: 4,
    measurementRecordId: "measurement-24",
    activityCategory: "学習",
    interactionSummary: "統合方針を相談した",
    ownThoughts: "既存形式を維持すると判断した",
    discovery: "送信順序を分離できる",
  }, new Date("2026-11-19T01:05:00Z"));
  saveWeeklyRecordFlowDraft(edited, storage, "draft");
  const restored = loadWeeklyRecordFlowDraft("chrome-conversation:capture-24", storage, "draft");
  assert.equal(restored.step, 4);
  assert.equal(restored.measurementRecordId, "measurement-24");
  assert.equal(restored.ownThoughts, "既存形式を維持すると判断した");
  const serialized = storage.getItem("draft") ?? "";
  assert.doesNotMatch(serialized, /apiKey|messages|conversationBody/);
});

test("a draft is isolated by conversation capture and can be cleared only after final save", () => {
  const storage = new MemoryStorage();
  const first = updateWeeklyRecordFlowDraft(createWeeklyRecordFlowDraft("capture-a"), {
    step: 5,
    measurementRecordId: "measurement-19",
  });
  saveWeeklyRecordFlowDraft(first, storage, "draft");
  assert.equal(loadWeeklyRecordFlowDraft("capture-a", storage, "draft").measurementRecordId, "measurement-19");
  const other = loadWeeklyRecordFlowDraft("capture-b", storage, "draft");
  assert.equal(other.step, 1);
  assert.equal(other.measurementRecordId, null);
  clearWeeklyRecordFlowDraft(storage, "draft");
  assert.equal(storage.getItem("draft"), null);
});

test("the normal record UI follows the required order and commits only from the accounting step", () => {
  const source = readFileSync(new URL("../src/weekly/WeeklyExtensionImportScreen.tsx", import.meta.url), "utf8");
  const order = ["会話を確認", "実測時間を確認", "本人の考え・判断・発見を記録", "Gemini分析と結果の確認", "会計区分を本人が決めて保存"];
  let cursor = -1;
  for (const label of order) {
    const next = source.indexOf(label, cursor + 1);
    assert.ok(next > cursor, `missing or out-of-order step: ${label}`);
    cursor = next;
  }
  assert.match(source, /会話本文を、設定中のGeminiモデルへ今回だけ送信することに同意/);
  assert.match(source, /分析せず会計区分へ進む/);
  assert.match(source, /本人の事前回答と会計区分は変更していません/);
  assert.match(source, /分析前に入力した内容とは別に保存します/);
  assert.match(source, /このボタンを押すまで、活動・仕訳・決算には反映されません/);
  assert.match(source, /async function saveActivity[\s\S]*saveExtensionWeeklyRecord/);
  assert.doesNotMatch(source.slice(0, source.indexOf("async function saveActivity")), /saveExtensionWeeklyRecord\(/);
});

test("the record flow has explicit 360px responsive behavior and one primary action container", () => {
  const source = readFileSync(new URL("../src/weekly/WeeklyExtensionImportScreen.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../src/weekly/weeklyExtensionImportScreen.css", import.meta.url), "utf8");
  const progress = source.match(/function FlowProgress[\s\S]*?function ConversationStep/)?.[0] ?? "";
  assert.match(progress, /ステップ \{step\}\/5/);
  assert.match(progress, /role="progressbar"/);
  assert.doesNotMatch(progress, /stepLabels\.map|<ol>/);
  assert.match(source, /取得済み会話の末尾最大4件/);
  assert.match(source, /未送信の入力内容は含みません/);
  assert.match(styles, /@media \(max-width: 390px\)/);
  assert.match(styles, /\.weekly-record-step-actions[\s\S]*grid-template-columns: 1fr/);
  assert.match(styles, /\.weekly-record-main-action/);
  assert.match(styles, /\.weekly-record-step > header h2[\s\S]*font-size: 30px/);
  assert.match(styles, /\.weekly-record-main-action[\s\S]*font-size: 18px/);
});

test("the record flow distinguishes received time from a missing conversation without mutating the ledger", () => {
  const source = readFileSync(new URL("../src/weekly/WeeklyExtensionImportScreen.tsx", import.meta.url), "utf8");
  assert.match(source, /実測時間は受信済みです/);
  assert.match(source, /会話はまだ受信していないため、活動・仕訳・決算には反映していません/);
  assert.match(source, /「思考レシート化する」を再実行/);
  assert.match(source, /<EmptyConversation measurements=\{measurements\}/);
});
