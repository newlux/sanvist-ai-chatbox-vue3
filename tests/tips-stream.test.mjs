import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temp = await mkdtemp(path.join(tmpdir(), 'sanvist-tips-'));
after(() => rm(temp, { recursive: true, force: true }));
const outfile = path.join(temp, 'tips.mjs');
await build({
  stdin: {
    contents: `export { createDifyEventNormalizer, extractDifyHistoryBlocks } from './src/utils/ai-stream/dify';
      export { applyEventToBlocks } from './src/utils/ai-stream/chatStreamParser';`,
    resolveDir: process.cwd(),
  },
  outfile, bundle: true, platform: 'node', format: 'esm', define: { 'import.meta.env': '{}' },
});
const { createDifyEventNormalizer, extractDifyHistoryBlocks, applyEventToBlocks } = await import(pathToFileURL(outfile));
const references = { conversation_id: 'c1', message_id: 'm1' };
const wrap = content => `<SANVIST>${JSON.stringify({ event: 'answer', data: { content } })}</SANVIST>`;

function turn() {
  const normalize = createDifyEventNormalizer();
  let blocks = [];
  function receive(payload) {
    const result = normalize({ ...references, ...payload });
    for (const event of Array.isArray(result) ? result : result ? [result] : []) {
      blocks = applyEventToBlocks(blocks, event).blocks;
    }
    return result;
  }
  return {
    receive,
    message(answer) { return receive({ event: 'message', answer }); },
    get displayed() { return blocks.map(block => [block.type, block.payload.content]); },
    get answer() { return blocks.filter(block => block.type === 'answer').map(block => block.payload.content).join(''); },
  };
}

test('TIPS 标签分片解析为临时提示，空白不清除提示，首段正文原地替换', () => {
  const stream = turn();
  for (const chunk of '<TIPS>正在查询设备</TIPS>') stream.message(chunk);
  assert.deepEqual(stream.displayed, [['tips', '正在查询设备']]);
  assert.equal(stream.answer, '');
  stream.message('\n');
  assert.equal(stream.displayed[0][0], 'tips');
  stream.message('设备正常。');
  stream.message('\n\n');
  stream.message('检查完成。<TIPS>迟到的提示</TIPS>');
  assert.deepEqual(stream.displayed, [['answer', '设备正常。\n\n检查完成。']]);
});

test('SANVIST answer 内的 TIPS 跨事件分片也不进入正文', () => {
  const stream = turn();
  stream.message(wrap('<TI'));
  stream.message(wrap('PS>查询中</TI'));
  stream.message(wrap('PS>'));
  assert.deepEqual(stream.displayed, [['tips', '查询中']]);
  stream.message(wrap('查询结果'));
  assert.equal(stream.answer, '查询结果');
  assert.deepEqual(stream.displayed, [['answer', '查询结果']]);
});

test('只有 TIPS 流式到达时，工作流收尾的纯正文会替换提示', () => {
  const stream = turn();
  stream.message('<TIPS>等待结果</TIPS>');
  stream.receive({ event: 'workflow_finished', data: { status: 'succeeded', outputs: { answer: '正式结果' } } });
  assert.deepEqual(stream.displayed, [['answer', '正式结果']]);
});

test('历史回答移除临时提示，提示独占的历史回答不会成为可播报正文', () => {
  assert.deepEqual(extractDifyHistoryBlocks('<TIPS>处理中</TIPS>正式结果'), [
    { type: 'answer', payload: { content: '正式结果' } },
  ]);
  assert.deepEqual(extractDifyHistoryBlocks(wrap('<TIPS>处理') + wrap('中</TIPS>')), []);
});
