import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const screen = readFileSync(new URL("../src/weekly/WeeklyResearchExportScreen.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../src/weekly/WeeklyWorkspaceScreen.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("../src/weekly/WeeklySettingsScreen.tsx", import.meta.url), "utf8");

test("weekly workspace exposes explicit week/all CSV and JSON research exports", () => {
  assert.match(workspace, /WeeklySettingsScreen/);
  assert.match(settings, /WeeklyResearchExportScreen/);
  assert.match(screen, /選択した週/);
  assert.match(screen, /全期間/);
  assert.match(screen, /活動データCSV/);
  assert.match(screen, /研究データJSON/);
  assert.match(screen, /週次振り返りCSV/);
  assert.match(screen, /週次B\/S・P\/L CSV/);
  assert.match(screen, /className="primary-action research-export-json"/);
  assert.match(screen, /対象期間/);
  assert.match(screen, /対象データ/);
  assert.match(screen, /出力形式/);
  assert.match(screen, /最新の保存内容を読み直す/);
  assert.match(screen, /データの復元や初期化は行いません/);
  assert.match(screen, /完全バックアップや復元用ファイルではありません/);
});

test("sensitive text needs a second confirmation and conversation bodies and keys remain excluded", () => {
  assert.match(screen, /評価根拠の引用・自由記述・週次振り返り本文も含める/);
  assert.match(screen, /includeSensitiveText && !sensitiveConfirmed/);
  assert.match(screen, /個人情報が含まれ得ることを確認/);
  assert.match(screen, /APIキーと会話本文は、設定にかかわらず出力しません/);
  assert.doesNotMatch(screen, /fetch\(|\/api\/ai\//);
});
