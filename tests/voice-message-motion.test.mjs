import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temp = await mkdtemp(path.join(tmpdir(), 'sanvist-motion-'));
const outfile = path.join(temp, 'motion.mjs');
await build({ entryPoints: ['src/utils/voice-message-motion.ts'], outfile, bundle: true, platform: 'node', format: 'esm' });
after(() => rm(temp, { recursive: true, force: true }));
const { animateVoiceMessageArrival, readVoiceMessageOrigin } = await import(pathToFileURL(outfile));

function stub(t, name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, name, original);
    else delete globalThis[name];
  });
}

test('从实时文字起点移入胶囊，扣除新胶囊内边距，不修改布局位置', (t) => {
  stub(t, 'getComputedStyle', () => ({ paddingLeft: '18px', paddingTop: '12px', backgroundColor: 'white', borderColor: '#efefef' }));
  stub(t, 'matchMedia', () => ({ matches: false }));
  let captured;
  let cancelled = false;
  const element = {
    getBoundingClientRect: () => ({ left: 70, top: 150 }),
    animate(frames, options) { captured = { frames, options }; return { cancel() { cancelled = true; } }; },
  };
  const cancel = animateVoiceMessageArrival(element, { left: 20, top: 162 });
  assert.equal(captured.frames[0].transform, 'translate3d(-68px, 0px, 0)');
  assert.equal(captured.frames[0].backgroundColor, 'transparent');
  assert.equal(captured.frames[1].transform, 'translate3d(0, 0, 0)');
  assert.equal(captured.frames[1].backgroundColor, 'white');
  assert.equal(captured.options.duration, 420);
  cancel();
  assert.equal(cancelled, true);
});

test('不可见的字幕不创建错误的动画起点', () => {
  assert.equal(readVoiceMessageOrigin(null), null);
  assert.equal(readVoiceMessageOrigin({ getBoundingClientRect: () => ({ width: 0, height: 20 }) }), null);
});

test('减少动态效果或缺少动画能力时，直接保留正式消息', (t) => {
  stub(t, 'matchMedia', () => ({ matches: true }));
  assert.equal(animateVoiceMessageArrival({ animate() { assert.fail('不应启动动画'); } }, { left: 0, top: 0 }), null);
  assert.equal(animateVoiceMessageArrival({}, { left: 0, top: 0 }), null);
});
