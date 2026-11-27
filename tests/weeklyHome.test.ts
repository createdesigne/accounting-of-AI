import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { selectWeeklyHomeAction } from "../src/weeklyHome.ts";

test("zero records presents conversation capture as the only primary task", () => {
  const action = selectWeeklyHomeAction({
    recordCount: 0,
    unlinkedMeasurementCount: 0,
    unlinkedMeasurementSeconds: 0,
    unclassifiedAccountingCount: 0,
  });
  assert.equal(action.kind, "start-recording");
  assert.equal(action.title, "今日の記録を始めましょう");
  assert.equal(action.description, "会話と実測時間を取り込みます。");
  assert.equal(action.buttonLabel, "会話を記録する");
});

test("a complete recorded week presents reflection after showing the compact total", () => {
  const action = selectWeeklyHomeAction({
    recordCount: 2,
    unlinkedMeasurementCount: 0,
    unlinkedMeasurementSeconds: 0,
    unclassifiedAccountingCount: 0,
  });
  assert.equal(action.kind, "write-reflection");
  assert.equal(action.buttonLabel, "今週の振り返りを開く");
});

test("one unfinished task is prioritized without hiding a more important unlinked measurement", () => {
  const unlinked = selectWeeklyHomeAction({
    recordCount: 2,
    unlinkedMeasurementCount: 1,
    unlinkedMeasurementSeconds: 24,
    unclassifiedAccountingCount: 1,
  });
  assert.equal(unlinked.kind, "link-measurement");
  assert.equal(unlinked.buttonLabel, "続きから再開する");
  assert.match(unlinked.description, /1件・0分24秒/);

  const accounting = selectWeeklyHomeAction({
    recordCount: 2,
    unlinkedMeasurementCount: 0,
    unlinkedMeasurementSeconds: 0,
    unclassifiedAccountingCount: 1,
  });
  assert.equal(accounting.kind, "classify-accounting");
  assert.equal(accounting.buttonLabel, "続きから再開する");

  const received = selectWeeklyHomeAction({
    recordCount: 0,
    unlinkedMeasurementCount: 0,
    unlinkedMeasurementSeconds: 0,
    unclassifiedAccountingCount: 0,
    hasPendingRecordWork: true,
  });
  assert.equal(received.kind, "link-measurement");
  assert.equal(received.buttonLabel, "続きから再開する");
});

test("desktop and 360px home layouts keep one action above a compact weekly status", () => {
  const source = readFileSync(new URL("../src/weekly/WeeklyDashboardScreen.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../src/weekly/weeklyDashboardScreen.css", import.meta.url), "utf8");
  assert.equal((source.match(/className="primary-action"/g) ?? []).length, 1);
  assert.match(source, /weekly-home-action/);
  assert.match(source, /weekly-home-status/);
  assert.match(source, /記録済み利用時間/);
  assert.doesNotMatch(source, /記録した会話|はじめての方へ|weekly-home-guide/);
  assert.doesNotMatch(source, /<p><span>対象週/);
  assert.match(source, /活動に未紐付けの実測時間は含みません/);
  assert.doesNotMatch(source, /weekly-week-navigation|weekly-home-details|moveWeek/);
  assert.match(styles, /@media \(max-width: 390px\)/);
  assert.match(styles, /\.weekly-home-action > button[\s\S]*width: 100%/);
  assert.match(styles, /color: #1e3a8a;[\s\S]*background: #fff;[\s\S]*font-size: 19px/);
  assert.match(styles, /\.weekly-home-action h2[\s\S]*font-size: 29px/);
  assert.match(styles, /\.weekly-home-status-grid strong[\s\S]*font-size: 30px/);
  assert.match(styles, /\.weekly-home-status-grid[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
});
