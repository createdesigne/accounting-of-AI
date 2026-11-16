import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const settings = readFileSync(new URL("../src/weekly/WeeklySettingsScreen.tsx", import.meta.url), "utf8");

test("research mode bottom navigation has exactly the five requested destinations", () => {
  const tabsBlock = app.match(/const tabs: Array<\{ key: TabKey; icon: ReactNode \}> = \[([\s\S]*?)\];/)?.[1] ?? "";
  assert.equal((tabsBlock.match(/key:/g) ?? []).length, 5);
  for (const key of ["home", "weekly", "journal", "tax", "settings"]) assert.match(tabsBlock, new RegExp(`key: "${key}"`));
  for (const label of ['home: "ホーム"', 'weekly: "記録"', 'journal: "仕訳"', 'tax: "決算"', 'settings: "設定"']) assert.match(app, new RegExp(label));
  assert.doesNotMatch(tabsBlock, /receipts|analysis/);
});

test("monthly and annual legacy screens stay in source but are hidden in research mode", () => {
  assert.match(app, /RESEARCH_WEEKLY_MODE = true/);
  assert.match(app, /!RESEARCH_WEEKLY_MODE && activeTab === "tax"/);
  assert.match(app, /ThoughtSettlementScreen/);
  assert.match(app, /PeriodLedgerScreen/);
});

test("settings groups API, privacy and research export, with desktop and mobile layouts", () => {
  assert.match(settings, /API設定/);
  assert.match(settings, /プライバシー設定/);
  assert.match(settings, /WeeklyResearchExportScreen/);
  assert.match(styles, /phone-frame\.research-frame/);
  assert.match(styles, /@media \(min-width: 900px\)/);
});
