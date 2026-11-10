import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temp = await mkdtemp(path.join(tmpdir(), 'sanvist-progress-'));
const outfile = path.join(temp, 'parser.mjs');
await build({ entryPoints: ['src/utils/ai-stream/chatStreamParser.ts'], outfile, bundle: true, platform: 'node', format: 'esm' });
after(() => rm(temp, { recursive: true, force: true }));
const { applyEventToBlocks, buildInitialBlocks } = await import(pathToFileURL(outfile));

test('多个节点开始/完成期间一直保持生成中，只有整轮结束才完成', () => {
  let blocks = buildInitialBlocks();
  for (const node of ['前置判断', '资料查询', '生成回答']) {
    for (const phase of ['running', 'completed']) {
      const update = applyEventToBlocks(blocks, {
        event: 'status', data: { node, message: node, phase },
      });
      assert.equal(update.processStatus.phase, 'thinking');
      assert.equal(update.processStatus.title, node);
      blocks = update.blocks;
    }
  }
  const end = applyEventToBlocks(blocks, { event: 'message_end', metadata: { status: 'succeeded', duration_ms: 6000 } });
  assert.equal(end.processStatus.phase, 'succeeded');
  assert.equal(end.processStatus.elapsedSeconds, 6);
});

test('失败和停止仍由整轮结束事件正确落入终态', () => {
  for (const status of ['failed', 'stopped']) {
    const update = applyEventToBlocks(buildInitialBlocks(), { event: 'message_end', metadata: { status } });
    assert.equal(update.processStatus.phase, status);
  }
});
