import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReportSummary } from '../src/reportSummary.ts';

// Unit fixtures only; never saved to the application or its sample ledger.
const record = (aiRole = '', aiService = '') => ({ aiRole, aiService });

test('empty and single records avoid invented trends in all periods', () => {
  for (const [kind, period] of [['weekly', 'この週'], ['monthly', 'この月'], ['annual', 'この年']] as const) {
    assert.equal(buildReportSummary([], kind), 'この期間の記録はまだありません。');
    const text = buildReportSummary([record('先生', 'ChatGPT')], kind);
    assert.equal(text, `${period}は、AIを「先生」として使った記録があります。`);
    assert.doesNotMatch(text, /今週|今月|今年|多め/);
  }
});

test('only a strict majority of all records is described as frequent', () => {
  assert.match(buildReportSummary([record('先生'), record('先生'), record('編集者')], 'weekly'), /「先生」.*多め/);
  for (const records of [
    [record('先生'), record('先生')],
    [record('先生'), record('編集者')],
    [record('先生'), record('先生'), record('編集者'), record('相談')],
    [record('先生'), record('先生'), record(), record()],
  ]) assert.doesNotMatch(buildReportSummary(records, 'weekly'), /多め/);
});

test('mixed roles and AI names never become a fabricated pairing', () => {
  const records = [record('先生', 'Claude'), record('先生', 'Gemini'), record('編集者', 'ChatGPT'), record('先生', 'ChatGPT')];
  const text = buildReportSummary(records, 'monthly');
  assert.match(text, /先生/);
  assert.doesNotMatch(text, /ChatGPT|Claude|Gemini/);
  const mixed = buildReportSummary([record('先生'), record('調査役'), record('相談')], 'annual');
  assert.match(mixed, /「先生」や「相談」/);
  assert.doesNotMatch(mixed, /多め/);
  assert.match(buildReportSummary([record('', 'ChatGPT'), record('', 'ChatGPT'), record('', 'Claude')], 'annual'), /ChatGPT.*多め/);
  assert.match(buildReportSummary([record('', 'ChatGPT'), record('', 'Claude')], 'annual'), /複数のAI/);
});

test('missing, oversized and malformed labels have concise factual fallbacks', () => {
  for (const value of ['', ' ', '-', '未記録', 'とても長い役割名'.repeat(20), '先生\n調査役']) {
    assert.equal(buildReportSummary([record(value)], 'weekly'), 'この週は、思考レシートが1件残っています。');
  }
  const broken = { get aiRole(): string { throw new Error('unavailable'); }, aiService: '' };
  assert.equal(buildReportSummary([broken], 'monthly'), 'この月は、思考レシートが1件残っています。');
});

test('output is stable without mutation and follows additions, edits and deletions', () => {
  const records = [Object.freeze(record('先生')), Object.freeze(record('編集者'))];
  const snapshot = JSON.stringify(records);
  const mixed = buildReportSummary(records, 'weekly');
  assert.equal(buildReportSummary([...records].reverse(), 'weekly'), mixed);
  assert.match(buildReportSummary([...records, record('先生')], 'weekly'), /先生.*多め/);
  assert.match(buildReportSummary([records[0], record('先生')], 'weekly'), /先生.*記録があります/);
  assert.match(buildReportSummary(records.slice(1), 'weekly'), /編集者.*記録があります/);
  assert.equal(JSON.stringify(records), snapshot);
});
