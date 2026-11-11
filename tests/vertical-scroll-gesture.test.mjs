import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temp = await mkdtemp(path.join(tmpdir(), 'sanvist-scroll-'));
const outfile = path.join(temp, 'scroll.mjs');
await build({ entryPoints: ['src/utils/vertical-scroll-gesture.ts'], outfile, bundle: true, platform: 'node', format: 'esm' });
after(() => rm(temp, { recursive: true, force: true }));
const { bindVerticalScrollGesture } = await import(pathToFileURL(outfile));

function stub(t, name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, name, original);
    else delete globalThis[name];
  });
}
function fixture(t, pointer = false, selector, touchCapable = false) {
  stub(t, 'window', touchCapable ? { ontouchstart: null } : {});
  stub(t, 'PointerEvent', pointer ? class {} : undefined);
  stub(t, 'getComputedStyle', node => ({ overflowY: node.overflowY }));
  const outer = { overflowY: 'auto', scrollHeight: 2000, clientHeight: 600, scrollTop: 200, parentElement: null };
  // 中间还有一个不溢出的横向容器，竖向必须跳过它。
  const inner = { overflowY: 'hidden', scrollHeight: 300, clientHeight: 300, parentElement: outer };
  const handlers = new Map();
  const root = {
    parentElement: inner,
    addEventListener(name, handler, options) {
      assert.equal(options.capture, true);
      assert.equal(options.passive, false);
      handlers.set(name, handler);
    },
    removeEventListener(name, handler, capture) {
      assert.equal(capture.capture, true);
      assert.equal(handlers.get(name), handler);
      handlers.delete(name);
    },
  };
  const release = bindVerticalScrollGesture(root, selector);
  t.after(release);
  function fire(type, x, y, extra = {}) {
    const event = {
      type, clientX: x, clientY: y, pointerType: 'touch', pointerId: 1,
      touches: pointer ? undefined : [{ clientX: x, clientY: y }],
      timeStamp: type.endsWith('start') || type.endsWith('down') ? 0 : 20,
      target: { closest: () => true }, cancelable: true,
      preventDefault() { this.prevented = true; },
      stopPropagation() { this.stopped = true; }, ...extra,
    };
    handlers.get(type)?.(event);
    return event;
  }
  return { outer, handlers, fire };
}

test('旧 WebView 的触摸竖滑跨过横向容器滚动外层，并拦住图表拖动', t => {
  const { outer, fire } = fixture(t);
  fire('touchstart', 100, 200);
  const event = fire('touchmove', 103, 140);
  assert.equal(outer.scrollTop, 260);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
});
test('支持 PointerEvent 的安卓使用同一竖滑逻辑', t => {
  const { outer, fire } = fixture(t, true);
  fire('pointerdown', 100, 200);
  fire('pointermove', 100, 150);
  assert.equal(outer.scrollTop, 250);
  fire('pointermove', 100, 120, { pointerId: 2 });
  assert.equal(outer.scrollTop, 250);
});
test('横滑保留原生滚动，方向锁定后不误转成竖滑', t => {
  const { outer, fire } = fixture(t);
  fire('touchstart', 100, 200);
  assert.equal(fire('touchmove', 140, 201).prevented, undefined);
  assert.equal(fire('touchmove', 145, 100).prevented, undefined);
  assert.equal(outer.scrollTop, 200);
});
test('轻点或手指小幅抖动不会触发滚动或阻止图表点击', t => {
  const { outer, fire } = fixture(t);
  fire('touchstart', 100, 200);
  assert.equal(fire('touchmove', 102, 198).prevented, undefined);
  assert.equal(fire('touchend', 102, 198).prevented, undefined);
  assert.equal(outer.scrollTop, 200);
});
test('Markdown 普通段落不接管，只有表格区域走转发', t => {
  const { outer, fire } = fixture(t, false, 'table, ._table');
  fire('touchstart', 100, 200, { target: { closest: () => null } });
  fire('touchmove', 100, 140);
  assert.equal(outer.scrollTop, 200);
});
test('纵向滚轮转发且按行单位换算，横向滚轮放行', t => {
  const { outer, fire } = fixture(t);
  fire('wheel', 0, 0, { deltaX: 0, deltaY: 3, deltaMode: 1 });
  assert.equal(outer.scrollTop, 248);
  assert.equal(fire('wheel', 0, 0, { deltaX: 10, deltaY: 0 }).prevented, undefined);
});
test('鼠标拖动不当成触摸竖滑', t => {
  const { outer, fire } = fixture(t, true);
  fire('pointerdown', 100, 200, { pointerType: 'mouse' });
  fire('pointermove', 100, 140, { pointerType: 'mouse' });
  assert.equal(outer.scrollTop, 200);
});


test('iOS 同时支持 Pointer 和 Touch 时优先绑定 Touch，纵滑不依赖 Pointer 事件', t => {
  const { outer, handlers, fire } = fixture(t, true, undefined, true);
  assert.equal(handlers.has('pointerdown'), false);
  assert.equal(handlers.has('touchstart'), true);
  fire('touchstart', 100, 200, { touches: [{ clientX: 100, clientY: 200 }] });
  const move = fire('touchmove', 102, 140, { touches: [{ clientX: 102, clientY: 140 }] });
  assert.equal(outer.scrollTop, 260);
  assert.equal(move.prevented, true);
  assert.equal(move.stopped, true);
});

test('iOS Pointer 取消不打断 Touch 竖滑，连续移动继续滚动', t => {
  const { outer, fire } = fixture(t, true, undefined, true);
  fire('touchstart', 100, 200, { touches: [{ clientX: 100, clientY: 200 }] });
  fire('touchmove', 100, 170, { touches: [{ clientX: 100, clientY: 170 }] });
  fire('pointercancel', 100, 170);
  fire('touchmove', 100, 130, { touches: [{ clientX: 100, clientY: 130 }] });
  assert.equal(outer.scrollTop, 270);
});

test('安卓双事件设备只消费 Touch 一次，不重复累加 Pointer 位移', t => {
  const { outer, fire } = fixture(t, true, undefined, true);
  fire('pointerdown', 100, 200);
  fire('touchstart', 100, 200, { touches: [{ clientX: 100, clientY: 200 }] });
  fire('pointermove', 100, 140);
  fire('touchmove', 100, 140, { touches: [{ clientX: 100, clientY: 140 }] });
  assert.equal(outer.scrollTop, 260);
});

test('双事件触屏上的横滑与轻点仍放行，不影响表格和图表原有交互', t => {
  const { outer, fire } = fixture(t, true, undefined, true);
  fire('touchstart', 100, 200, { touches: [{ clientX: 100, clientY: 200 }] });
  const move = fire('touchmove', 160, 202, { touches: [{ clientX: 160, clientY: 202 }] });
  const end = fire('touchend', 160, 202, { touches: [] });
  assert.equal(move.prevented, undefined);
  assert.equal(end.prevented, undefined);
  assert.equal(outer.scrollTop, 200);
});
