import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temp = await mkdtemp(path.join(tmpdir(), 'sanvist-voice-gesture-'));
const outfile = path.join(temp, 'gesture.mjs');
await build({
  stdin: {
    contents: 'export { useVoiceQueryGesture } from "./src/hooks/useVoiceQueryGesture"; export { ref, effectScope } from "vue";',
    resolveDir: process.cwd(), loader: 'ts',
  },
  outfile, bundle: true, platform: 'node', format: 'esm',
});
after(() => rm(temp, { recursive: true, force: true }));
const { useVoiceQueryGesture, ref, effectScope } = await import(pathToFileURL(outfile));

function setup(t, startup) {
  const oldDocument = globalThis.document;
  const oldWindow = globalThis.window;
  globalThis.document = new EventTarget();
  globalThis.window = new EventTarget();
  const scope = effectScope();
  t.after(() => {
    scope.stop();
    globalThis.document = oldDocument;
    globalThis.window = oldWindow;
  });
  const active = ref(false);
  const holding = ref(false);
  const cancelPending = ref(false);
  const calls = [];
  const start = scope.run(() => useVoiceQueryGesture({
    active, holding, cancelPending,
    start() { active.value = true; calls.push('start'); return startup; },
    send() { calls.push('send'); active.value = false; },
    cancel() { calls.push('cancel'); active.value = false; },
  }));
  return { start, active, holding, cancelPending, calls, scope };
}

function fire(type, data = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, data);
  document.dispatchEvent(event);
  return event;
}

test('单击开始不绑定松手发送，保留原先单击结束逻辑', async t => {
  const { start, calls } = setup(t);
  await start();
  assert.equal(fire('touchend').defaultPrevented, false);
  assert.equal(fire('click').defaultPrevented, false);
  assert.deepEqual(calls, ['start']);
});

test('长按松手发送一次，并吞掉兼容鼠标事件和补发点击', async t => {
  const { start, calls, holding } = setup(t);
  const done = start('hold');
  assert.equal(holding.value, true);
  assert.equal(fire('touchend').defaultPrevented, true);
  assert.equal(holding.value, false);
  fire('mouseup');
  assert.equal(fire('click').defaultPrevented, true);
  await done;
  assert.deepEqual(calls, ['start', 'send']);
});

test('麦克风尚未启动时松手，等启动完成后再发送', async t => {
  let ready;
  const { start, calls } = setup(t, new Promise(resolve => { ready = resolve; }));
  const done = start('hold');
  fire('mouseup');
  assert.deepEqual(calls, ['start']);
  ready();
  await done;
  assert.deepEqual(calls, ['start', 'send']);
});

test('原按钮卸载后仍能收到脱离 document 的触点节点上的松手事件', async t => {
  const { start, calls } = setup(t);
  const detachedTarget = new EventTarget();
  const done = start('hold', detachedTarget);
  detachedTarget.dispatchEvent(new Event('touchend', { cancelable: true }));
  await done;
  assert.deepEqual(calls, ['start', 'send']);
});

test('系统取消手势不发送', async t => {
  const { start, calls } = setup(t);
  const done = start('hold');
  fire('touchcancel');
  await done;
  assert.deepEqual(calls, ['start', 'cancel']);
});

test('旧长按自动结束后松手，不结束新一轮录音', async t => {
  const { start, active, calls } = setup(t);
  const done = start('hold');
  active.value = false;
  await start();
  fire('touchend');
  await done;
  assert.deepEqual(calls, ['start', 'start']);
});

test('页面销毁移除监听，异步启动返回后不再发送', async t => {
  let ready;
  const { start, calls, scope } = setup(t, new Promise(resolve => { ready = resolve; }));
  const done = start('hold');
  scope.stop();
  assert.equal(fire('touchend').defaultPrevented, false);
  ready();
  await done;
  assert.deepEqual(calls, ['start']);
});

function voiceRegion() {
  const target = new EventTarget();
  target.getBoundingClientRect = () => ({ left: 100, right: 300, top: 500, bottom: 550 });
  return target;
}

test('长按移出区域展示取消状态，松手取消，不提交', async t => {
  const { start, calls, cancelPending } = setup(t);
  const done = start('hold', voiceRegion());
  const move = fire('touchmove', { touches: [{ clientX: 200, clientY: 450 }] });
  assert.equal(move.defaultPrevented, true);
  assert.equal(cancelPending.value, true);
  fire('touchend', { changedTouches: [{ clientX: 200, clientY: 450 }] });
  await done;
  assert.deepEqual(calls, ['start', 'cancel']);
  assert.equal(cancelPending.value, false);
});

test('移回原语音区域恢复发送状态，松手只发送一次', async t => {
  const { start, calls, cancelPending } = setup(t);
  const done = start('hold', voiceRegion());
  fire('touchmove', { touches: [{ clientX: 310, clientY: 525 }] });
  assert.equal(cancelPending.value, true);
  fire('touchmove', { touches: [{ clientX: 200, clientY: 525 }] });
  assert.equal(cancelPending.value, false);
  fire('touchend', { changedTouches: [{ clientX: 200, clientY: 525 }] });
  await done;
  assert.deepEqual(calls, ['start', 'send']);
});

test('最后一次 move 丢失也按松手坐标取消；鼠标长按同样生效', async t => {
  const { start, calls } = setup(t);
  const done = start('hold', voiceRegion());
  fire('mouseup', { clientX: 50, clientY: 525 });
  await done;
  assert.deepEqual(calls, ['start', 'cancel']);
});

test('区域按长按开始时固定，后续动画布局移动不改变发送区', async t => {
  const { start, calls } = setup(t);
  const target = voiceRegion();
  const done = start('hold', target);
  target.getBoundingClientRect = () => ({ left: 0, right: 50, top: 0, bottom: 50 });
  fire('mouseup', { clientX: 200, clientY: 525 });
  await done;
  assert.deepEqual(calls, ['start', 'send']);
});
