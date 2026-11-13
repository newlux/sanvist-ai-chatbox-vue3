import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { parse, compileScript } from '@vue/compiler-sfc';

const temp = await mkdtemp(path.join(tmpdir(), 'sanvist-welcome-hold-'));
const outfile = path.join(temp, 'welcome.mjs');
await build({
  stdin: {
    contents: 'export { default as AiWelcome } from "./src/components/ai-welcome/index.vue"; export { createRenderer, nextTick, ref, effectScope } from "vue"; export { useVoiceQueryGesture } from "./src/hooks/useVoiceQueryGesture";',
    resolveDir: process.cwd(), loader: 'ts',
  },
  outfile, bundle: true, platform: 'node', format: 'esm',
  plugins: [{ name: 'compile-welcome', setup(build) {
    build.onLoad({ filter: /\.vue$/ }, async args => {
      const source = await readFile(args.path, 'utf8');
      const { descriptor } = parse(source, { filename: args.path });
      return { contents: compileScript(descriptor, { id: 'welcome-test', inlineTemplate: true }).content, loader: 'ts' };
    });
    build.onResolve({ filter: /^(vue-i18n|@\/)/ }, args => args.path === '@/utils/voice-message-motion' ? { path: path.resolve('src/utils/voice-message-motion.ts') } : ({ path: args.path, namespace: 'mock' }));
    build.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents:
      args.path === 'vue-i18n' ? 'export function useI18n(){return {t: key => key}}'
        : args.path.includes('useSafeArea') ? 'export function useSafeArea(){return {safeAreaStyle:{}}}'
          : args.path.includes('attachment-notice') ? 'export function showAttachmentComingSoon(){}'
            : 'export default "test-asset"',
    }));
  } }],
});
after(() => rm(temp, { recursive: true, force: true }));
const { AiWelcome, createRenderer, nextTick, ref, effectScope, useVoiceQueryGesture } = await import(pathToFileURL(outfile));
const previousHTMLElement = globalThis.HTMLElement;
class HostElement extends EventTarget {
  constructor(type) { super(); this.type = type; this.props = {}; this.children = []; this.parent = null; }
  closest() { return this; }
  getBoundingClientRect() { return { left: 100, right: 300, top: 500, bottom: 550 }; }
}
globalThis.HTMLElement = HostElement;
after(() => { globalThis.HTMLElement = previousHTMLElement; });
const renderer = createRenderer({
  createElement: type => new HostElement(type),
  createText: text => ({ text }), createComment: text => ({ text }),
  setText(node, text) { node.text = text; },
  setElementText(node, text) { node.text = text; },
  patchProp(node, key, _old, value) { node.props[key] = value; },
  insert(node, parent) { node.parent = parent; parent.children.push(node); },
  remove(node) { const index = node.parent?.children.indexOf(node); if (index >= 0) node.parent.children.splice(index, 1); },
  parentNode: node => node.parent, nextSibling: () => null,
});
function mount(t, handleStart, props = {}) {
  const calls = [];
  const root = { children: [] };
  const app = renderer.createApp(AiWelcome, { ...props, onStartChat: (...args) => { calls.push(args); handleStart?.(...args); } });
  app.mount(root);
  t.after(() => app.unmount());
  const find = (match, node = root) => match(node.props) ? node : node.children?.map(child => find(match, child)).find(Boolean);
  return { button: find(props => props?.class === 'welcome__composer-voice'), calls, find };
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('初始输入栏直接展示双工按钮，点击走双工入口', t => {
  let toggles = 0;
  const { find, calls } = mount(t, undefined, { duplexEnabled: true, onDuplexToggle: () => { toggles++; } });
  const duplex = find(props => props?.['aria-label'] === 'duplex-open');
  assert.ok(duplex);
  assert.equal(duplex.props['aria-pressed'], false);
  duplex.props.onTap({ stopPropagation() {} });
  assert.equal(toggles, 1);
  assert.deepEqual(calls, []);
});

test('键盘输入有草稿时发送占用切换按钮位，提交后恢复麦克风按钮', async (t) => {
  const previousUni = globalThis.uni;
  globalThis.uni = { hideKeyboard() {} };
  t.after(() => { globalThis.uni = previousUni; });
  const sent = [];
  const { find } = mount(t, undefined, { inlineInput: true, duplexEnabled: true, onSendText: text => sent.push(text) });
  find(props => props?.class === 'welcome__composer-kb').props.onTap();
  await nextTick();
  find(props => props?.class === 'welcome__composer-textarea').props.onInput({ detail: { value: '你好' } });
  await nextTick();
  assert.ok(find(props => props?.['aria-label'] === 'duplex-open'));
  assert.equal(find(props => props?.class === 'welcome__composer-kb welcome__composer-kb--mic'), undefined);
  find(props => props?.class === 'welcome__composer-kb welcome__composer-kb--send').props.onTap();
  assert.deepEqual(sent, ['你好']);
  await nextTick();
  assert.ok(find(props => props?.class === 'welcome__composer-kb welcome__composer-kb--mic'));
});

test('欢迎页真实组件：长按在松手前启动并传递 hold 和原触点，后续 tap 不再启动', async t => {
  const { button, calls } = mount(t);
  const target = new EventTarget();
  button.props.onTouchstart({ touches: [{ clientX: 50, clientY: 100 }], target });
  await wait(380);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'hold');
  assert.equal(calls[0][1], button);
  button.props.onTouchend();
  button.props.onTap();
  await wait(140);
  assert.equal(calls.length, 1);
});

test('欢迎页真实组件：短按仍走点击录音，不传长按模式', async t => {
  const { button, calls } = mount(t);
  button.props.onTouchstart({ touches: [{ clientX: 50, clientY: 100 }] });
  button.props.onTouchend();
  button.props.onTap();
  await wait(140);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], undefined);
});

test('欢迎页真实组件：滚动移动和手势取消不会误触长按录音', async t => {
  const { button, calls } = mount(t);
  button.props.onTouchstart({ touches: [{ clientX: 50, clientY: 100 }] });
  button.props.onTouchmove({ touches: [{ clientX: 50, clientY: 140 }] });
  await wait(380);
  assert.equal(calls.length, 0);
  button.props.onTouchstart({ touches: [{ clientX: 50, clientY: 100 }] });
  button.props.onTouchcancel();
  await wait(380);
  assert.equal(calls.length, 0);
});


test('uni-app 归一化 target 为普通对象时，通过组件 ref 仍能更新移出取消状态', async t => {
  const oldDocument = globalThis.document;
  const oldWindow = globalThis.window;
  globalThis.document = new EventTarget();
  globalThis.window = new EventTarget();
  const scope = effectScope();
  t.after(() => { scope.stop(); globalThis.document = oldDocument; globalThis.window = oldWindow; });
  const active = ref(false);
  const holding = ref(false);
  const cancelPending = ref(false);
  const actions = [];
  const gesture = scope.run(() => useVoiceQueryGesture({
    active, holding, cancelPending,
    start() { active.value = true; },
    send() { actions.push('send'); }, cancel() { actions.push('cancel'); },
  }));
  let done;
  const { button } = mount(t, (...args) => { done = gesture(...args); });
  button.props.onTouchstart({
    touches: [{ clientX: 200, clientY: 525 }],
    target: { id: '', dataset: {} }, currentTarget: { id: '', dataset: {} },
  });
  await wait(380);
  const move = new Event('touchmove', { cancelable: true });
  Object.assign(move, { touches: [{ clientX: 200, clientY: 450 }] });
  document.dispatchEvent(move);
  assert.equal(holding.value, true);
  assert.equal(cancelPending.value, true);
  const release = new Event('touchend', { cancelable: true });
  Object.assign(release, { touches: [], changedTouches: [{ clientX: 200, clientY: 450 }] });
  document.dispatchEvent(release);
  await done;
  assert.deepEqual(actions, ['cancel']);
});
