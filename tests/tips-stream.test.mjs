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
      export { applyEventToBlocks } from './src/utils/ai-stream/chatStreamParser';
      export { consumeChatStream } from './src/utils/ai-stream/streamConsumer';`,
    resolveDir: process.cwd(),
  },
  outfile, bundle: true, platform: 'node', format: 'esm', define: { 'import.meta.env': '{}' },
});
const { createDifyEventNormalizer, extractDifyHistoryBlocks, applyEventToBlocks, consumeChatStream } = await import(pathToFileURL(outfile));
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

test('多条 TIPS 按顺序保留，正式正文到达后一次清除', () => {
  const stream = turn();
  stream.message('<TIPS>正在查询</TIPS>');
  stream.message(wrap('<TIPS>正在整理</TIPS>'));
  stream.message('\n');
  assert.deepEqual(stream.displayed, [['tips', '正在查询'], ['tips', '正在整理']]);
  assert.equal(stream.answer, '');
  stream.message('查询结果');
  assert.deepEqual(stream.displayed, [['answer', '查询结果']]);
});

test('各条 TIPS 保留自己的处理状态，正式回复清除提示和附属状态', async () => {
  async function* source() {
    yield { result: { event: 'status', data: { node: '查询设备', message: '查询设备', phase: 'running' } } };
    yield { result: { event: 'tips', text: '正在查询' } };
    yield { result: { event: 'tips', text: '正在整理' } };
    yield { result: { event: 'subtitle', message: '整理结果 | Organizing results' } };
    yield { result: { event: 'subtitle', message: '' } };
    yield { result: { event: 'message', answer: '设备正常。' } };
  }

  const snapshots = [];
  const result = await consumeChatStream({ source: source(), flushIntervalMs: 0, onSnapshot: snapshot => snapshots.push(snapshot) });
  assert.deepEqual(snapshots[snapshots.length - 2].blocks.map(block => block.payload.processSubtitle), [
    '查询设备', '整理结果 | Organizing results',
  ]);
  assert.deepEqual(result.blocks.map(block => block.type), ['answer']);
});

test('正式引导卡到达时清除临时提示和处理状态，保留设备选项', async () => {
  const normalize = createDifyEventNormalizer();
  const component = { scene: 'guide', type: 'lead', data: { text: '请选择设备', options: ['设备 A'] } };
  async function* source() {
    yield { result: { event: 'status', data: { node: '返回固定作业引导卡', message: '返回固定作业引导卡' } } };
    yield { result: { event: 'tips', text: '交给我就行了。' } };
    for (const result of normalize({
      ...references, event: 'message', answer: `<COMPONENT>${JSON.stringify(component)}</COMPONENT>`,
    })) {
      yield { result };
    }
    yield { result: { event: 'tips', text: '迟到的提示' } };
  }

  const snapshots = [];
  const result = await consumeChatStream({ source: source(), flushIntervalMs: 0, onSnapshot: snapshot => snapshots.push(snapshot) });
  assert.equal(snapshots[1].blocks[0].payload.processSubtitle, '返回固定作业引导卡');
  assert.deepEqual(result.blocks.map(block => block.type), ['guide-lead']);
  assert.deepEqual(result.blocks[0].payload.options, ['设备 A']);
  assert.equal(result.processSubtitle, null);
  assert.equal(result.processStatus.title, undefined);
});

test('工作流收尾重放提示时不重复追加', () => {
  const stream = turn();
  const answer = '<TIPS>正在查询</TIPS><TIPS>正在整理</TIPS>';
  stream.message(answer);
  stream.receive({ event: 'workflow_finished', data: { status: 'succeeded', outputs: { answer } } });
  assert.deepEqual(stream.displayed, [['tips', '正在查询'], ['tips', '正在整理']]);
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
