import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temp = await mkdtemp(path.join(tmpdir(), 'sanvist-voice-replay-'));
after(() => rm(temp, { recursive: true, force: true }));
const outfile = path.join(temp, 'voice-replay.mjs');
await build({
  stdin: {
    contents: `export { createDifyEventNormalizer } from './src/utils/ai-stream/dify';
      export { applyEventToBlocks } from './src/utils/ai-stream/chatStreamParser';`,
    resolveDir: process.cwd(),
  },
  outfile, bundle: true, platform: 'node', format: 'esm', define: { 'import.meta.env': '{}' },
});
const { createDifyEventNormalizer, applyEventToBlocks } = await import(pathToFileURL(outfile));
const references = { conversation_id: 'c1', message_id: 'm1' };

/** 真实抓包的导语 + 正文 + 图片（data_voice.json 的精简版，保留协议结构） */
const VOICE_TEXT = '回转晃动先停机排查，重点查回转支承螺栓是否松动或断裂，用零点五公斤锤敲击听声辨别。想先看螺栓检查还是制动检查';
const answer = [
  '<SANVIST>{"stage":"node_started","message":"公共步骤卡输出边界校验正在执行","dify_event":"node_started"}</SANVIST>',
  `<COMPONENT>\n{"scene":"guide","type":"voice","data":{"text":"${VOICE_TEXT}"}}\n</COMPONENT>`,
  '回转晃动先按**停机排查**处理，别带着晃动继续回转作业。',
  '<COMPONENT>\n{"scene":"guide","type":"image","data":{"items":[{"chunk_id":"fig-pump-6-34","url":"https://example.com/fig.png","caption":"图6-34 回转轴承"}]}}\n</COMPONENT>',
  '2. **回转支承与齿轮齿面**：每运行100小时或每周清除杂物并加注润滑脂。',
].join('\n');

function turn() {
  const normalize = createDifyEventNormalizer();
  let blocks = [];
  let speechText = '';
  function receive(payload) {
    const result = normalize({ ...references, ...payload });
    for (const event of Array.isArray(result) ? result : result ? [result] : []) {
      const update = applyEventToBlocks(blocks, event);
      blocks = update.blocks;
      if (update.speechText !== undefined) speechText = update.speechText;
    }
    return result;
  }
  return {
    receive,
    message(chunk) { return receive({ event: 'message', answer: chunk }); },
    get blocks() { return blocks; },
    get speechText() { return speechText; },
  };
}

test('流式收到导语后，workflow_finished 重放 answer_layout 整体重建不丢 voice 块', () => {
  const stream = turn();
  // 模拟 SSE 分片：正文流里先后到达 SANVIST 节点事件、voice 导语、正文、图片
  for (const chunk of answer.match(/[\s\S]{1,40}/g) || []) stream.message(chunk);
  // workflow_finished：outputs.answer 是含全部协议的完整快照
  stream.receive({
    event: 'workflow_finished',
    data: { status: 'succeeded', outputs: { answer }, elapsed_time: 21.9 },
  });

  const voiceBlocks = stream.blocks.filter(block => block.type === 'voice');
  assert.equal(voiceBlocks.length, 1, `导语块应保留 1 个，实际 ${JSON.stringify(stream.blocks.map(b => b.type))}`);
  assert.equal(voiceBlocks[0].payload.text, VOICE_TEXT);
  assert.equal(stream.speechText, VOICE_TEXT, '播报稿保留在快照上');

  // 正文块不应重复内嵌导语（渲染层剔重前的原始内容也只含一份）
  const answerText = stream.blocks.filter(block => block.type === 'answer').map(b => b.payload.content).join('');
  assert.equal(answerText.indexOf(VOICE_TEXT), -1, '正文里不残留导语文本');
  // 图片块仍在（answer_layout 重建后图文交错序列完整）
  assert.ok(stream.blocks.some(block => block.type === 'image'), '图片块不丢');
});

test('导语只在 outputs.answer 里出现（流式没给过）时，重放后同样落 voice 块', () => {
  const stream = turn();
  // 流式只给正文，voice 导语只在 workflow_finished 的快照里
  for (const chunk of answer.split('\n').slice(2).join('\n').match(/[\s\S]{1,40}/g) || []) stream.message(chunk);
  stream.receive({
    event: 'workflow_finished',
    data: { status: 'succeeded', outputs: { answer }, elapsed_time: 21.9 },
  });

  const voiceBlocks = stream.blocks.filter(block => block.type === 'voice');
  assert.equal(voiceBlocks.length, 1, `导语块应 1 个，实际 ${JSON.stringify(stream.blocks.map(b => b.type))}`);
  assert.equal(voiceBlocks[0].payload.text, VOICE_TEXT);
  assert.equal(stream.speechText, VOICE_TEXT);
});
