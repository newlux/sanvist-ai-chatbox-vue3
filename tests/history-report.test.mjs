import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temp = await mkdtemp(path.join(tmpdir(), 'sanvist-history-report-'));
const outfile = path.join(temp, 'history.mjs');
await build({
  entryPoints: ['src/utils/ai-stream/dify.ts'], outfile,
  bundle: true, platform: 'node', format: 'esm',
  define: { 'import.meta.env': '{}' },
});
after(() => rm(temp, { recursive: true, force: true }));
const { extractDifyHistoryBlocks } = await import(pathToFileURL(outfile));

test('历史 WORK_REPORT 保留正文并还原带日期和语言的听汇报卡片', () => {
  assert.deepEqual(extractDifyHistoryBlocks('<WORK_REPORT date="2026-11-10" language="zh">好的，我现在开始为你汇报对应日期的工作情况。预计约2分钟。\n</WORK_REPORT>'), [
    { type: 'answer', payload: { content: '好的，我现在开始为你汇报对应日期的工作情况。预计约2分钟。' } },
    { type: 'report-card', payload: { date: '2026-11-10', language: 'zh' } },
  ]);
});

test('SANVIST answer 中的标签也能还原，且保留标签前后正文', () => {
  const content = "前文<work_report language='en' date='2026-11-09'>汇报正文</work_report>后文";
  const source = `<SANVIST>${JSON.stringify({ event: 'answer', data: { content } })}</SANVIST>`;
  assert.deepEqual(extractDifyHistoryBlocks(source), [
    { type: 'answer', payload: { content: '前文汇报正文后文' } },
    { type: 'report-card', payload: { date: '2026-11-09', language: 'en' } },
  ]);
});

test('历史整轮已结束，缺少闭合标签仍按实时收尾规则还原卡片', () => {
  assert.deepEqual(extractDifyHistoryBlocks('<WORK_REPORT>汇报正文'), [
    { type: 'answer', payload: { content: '汇报正文' } },
    { type: 'report-card', payload: { date: '', language: '' } },
  ]);
});

test('标签没有正文时仍显示卡片，不回退显示标签源码', () => {
  assert.deepEqual(extractDifyHistoryBlocks('<WORK_REPORT date="2026-11-10"></WORK_REPORT>'), [
    { type: 'report-card', payload: { date: '2026-11-10', language: '' } },
  ]);
});

test('混合表格与汇报标签时保留表格，卡片放在回答末尾', () => {
  const table = { type: 'table', data: { columns: ['设备'], rows: [['泵车']] } };
  const blocks = extractDifyHistoryBlocks(`<COMPONENT>${JSON.stringify(table)}</COMPONENT><WORK_REPORT date="2026-11-10">汇报正文</WORK_REPORT>`);
  assert.deepEqual(blocks, [
    { type: 'table', payload: { columns: ['设备'], rows: [['泵车']] } },
    { type: 'answer', payload: { content: '汇报正文' } },
    { type: 'report-card', payload: { date: '2026-11-10', language: '' } },
  ]);
});

test('普通历史正文保持原样，其他协议不产生听汇报卡片', () => {
  const content = '\n  普通回答\n';
  assert.deepEqual(extractDifyHistoryBlocks(content), [{ type: 'answer', payload: { content } }]);
  assert.deepEqual(extractDifyHistoryBlocks('<SANVIST>{"event":"status","data":{}}</SANVIST>'), []);
});
