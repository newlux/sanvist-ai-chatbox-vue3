import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { nextTick, ref } from 'vue';

const temp = await mkdtemp(path.join(tmpdir(), 'sanvist-remote-lifecycle-'));
after(() => rm(temp, { recursive: true, force: true, maxRetries: 3 }));
await build({
  entryPoints: ['src/hooks/useRemoteKey.ts'], outfile: path.join(temp, 'hook.mjs'),
  bundle: true, platform: 'node', format: 'esm',
  // 与测试使用同一个 Vue 实例。
  define: { 'import.meta.env.VITE_REMOTE_VOICE_KEY': '"Y"' },
  plugins: [{ name: 'native-mock', setup(builder) {
    builder.onResolve({ filter: /^vue$/ }, () => ({ path: path.resolve('node_modules/vue/index.mjs'), external: true }));
    builder.onResolve({ filter: /^(@\/utils\/(logger|platform\/mpaas)|@dcloudio\/uni-app)$/ }, args => ({ path: args.path, namespace: 'mock' }));
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents:
      args.path.includes('logger') ? 'export const createLogger=()=>({info(){},warn(){},debug(){}});'
        : args.path.includes('uni-app') ? 'export const onShow=()=>{};'
          : `export const onNativeEvent=()=>()=>{};
             export const onRemoteKeyEvent=cb=>globalThis.remoteFixture.subscribe(cb);
             export const registerRemoteKeyListener=cb=>globalThis.remoteFixture.register(cb);
             export const unregisterRemoteKeyListener=()=>globalThis.remoteFixture.unregister();`,
    }));
  } }],
});
const { useRemoteKey } = await import(pathToFileURL(path.join(temp, 'hook.mjs')));
const key = { action: 'down', repeatCount: 0, key: 'volumeup', keyCode: 24, scanCode: 0 };

await build({
  entryPoints: ['src/utils/voiceRecorderNative.js'], outfile: path.join(temp, 'recorder.mjs'),
  bundle: true, platform: 'node', format: 'esm',
  plugins: [{ name: 'recorder-native-mock', setup(builder) {
    builder.onResolve({ filter: /^@\/utils\/(logger|platform\/mpaas)$/ }, args => ({ path: args.path, namespace: 'mock' }));
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents:
      args.path.includes('logger') ? 'export const createLogger=()=>({info(){},warn(){}});'
        : `export const isMpaasReady=()=>true;
           export const startNativeRecord=()=>globalThis.recorderFixture.start();
           export const stopNativeRecord=()=>globalThis.recorderFixture.stop();
           export const cancelNativeRecord=()=>globalThis.recorderFixture.cancel();`,
    }));
  } }],
});
const { default: NativeRecorder } = await import(pathToFileURL(path.join(temp, 'recorder.mjs')));
const turn = () => new Promise(resolve => setImmediate(resolve));


test('停用后即使原生继续推旧 callback，也不触发旧页面录音；恢复后重新受理', async () => {
  let callback, count = 0;
  globalThis.remoteFixture = {
    subscribe: () => () => {},
    register(cb) { callback = cb; return Promise.resolve(); },
    unregister: () => Promise.resolve(),
  };
  const enabled = ref(true);
  const hook = useRemoteKey({ enabled, onConfirm: () => count++ });
  await hook.start(); await nextTick();
  callback(key); assert.equal(count, 1);
  enabled.value = false;
  // 不等 watcher/原生注销完成，就发送旧回调。
  callback(key); assert.equal(count, 1);
  await nextTick(); await hook.stop();
  enabled.value = true;
  await nextTick(); await hook.start();
  callback(key); assert.equal(count, 2);
  enabled.value = false; await hook.stop();
});

test('离开时等待尚未完成的原生注册作废，避免迟到的注销干扰下一页', async () => {
  let finishRegister, callback, unregistered = 0;
  globalThis.remoteFixture = {
    subscribe: () => () => {},
    register(cb) { callback = cb; return new Promise(resolve => { finishRegister = resolve; }); },
    unregister() { unregistered++; return Promise.resolve(); },
  };
  let count = 0;
  const enabled = ref(true);
  const hook = useRemoteKey({ enabled, onConfirm: () => count++ });
  enabled.value = false;
  let released = false;
  const stopping = hook.stop().then(() => { released = true; });
  await nextTick(); callback(key);
  assert.equal(count, 0); assert.equal(released, false);
  finishRegister(); await stopping;
  assert.equal(released, true); assert.equal(unregistered, 1);
});

test('原生录音已启动：离页 release 等待 microphoneEnd 回调，重复释放不提前完成', async () => {
  let finishCancel, cancellations = 0;
  globalThis.recorderFixture = {
    start: async () => {},
    cancel() { cancellations++; return new Promise(resolve => { finishCancel = resolve; }); },
  };
  const recorder = new NativeRecorder();
  assert.equal((await recorder.start()).success, true);
  let released = false;
  const first = recorder.release().then(() => { released = true; });
  const second = recorder.release();
  await turn(); assert.equal(released, false); assert.equal(cancellations, 1);
  finishCancel(); await Promise.all([first, second]); assert.equal(released, true);
});

test('原生录音尚在启动时离页：启动迟到后立即结束，并等待结束确认', async () => {
  let finishStart, finishCancel;
  globalThis.recorderFixture = {
    start: () => new Promise(resolve => { finishStart = resolve; }),
    cancel: () => new Promise(resolve => { finishCancel = resolve; }),
  };
  const recorder = new NativeRecorder();
  let completed = false;
  const starting = recorder.start().then(result => { completed = true; return result; });
  await turn(); await recorder.release(); finishStart();
  await turn(); assert.equal(completed, false); assert.equal(typeof finishCancel, 'function');
  finishCancel(); const result = await starting;
  assert.equal(result.cancelled, true); assert.equal(recorder.isRecording, false);
});

test('快速回退时先完成旧注销，再重新注册，避免新监听被旧注销覆盖', async () => {
  let finishStop, registrations = 0;
  globalThis.remoteFixture = {
    subscribe: () => () => {},
    register: async () => { registrations++; },
    unregister: () => new Promise(resolve => { finishStop = resolve; }),
  };
  const enabled = ref(true);
  const hook = useRemoteKey({ enabled });
  await nextTick(); await turn();
  assert.equal(registrations, 1);
  enabled.value = false;
  const stopping = hook.stop();
  await nextTick();
  enabled.value = true;
  await nextTick();
  // 返回信号可能在原生注销回调之前到达，不能提前建立新监听。
  assert.equal(registrations, 1);
  finishStop(); await stopping; await turn();
  assert.equal(registrations, 2);
  assert.equal(hook.registered.value, true);
  enabled.value = false;
  const cleanup = hook.stop(); await turn(); finishStop(); await cleanup;
});

test('从子助手返回运营助手：跨页面也必须先完成旧注销，再注册运营助手', async () => {
  let finishStop, registrations = 0;
  globalThis.remoteFixture = {
    subscribe: () => () => {},
    register: async () => { registrations++; },
    unregister: () => new Promise(resolve => { finishStop = resolve; }),
  };
  const childEnabled = ref(true);
  const child = useRemoteKey({ enabled: childEnabled });
  await turn(); assert.equal(registrations, 1);
  childEnabled.value = false;
  const childStop = child.stop(); await turn();
  const mainEnabled = ref(true);
  const main = useRemoteKey({ enabled: mainEnabled });
  await turn(); assert.equal(registrations, 1);
  finishStop(); await childStop; await turn();
  assert.equal(registrations, 2); assert.equal(main.registered.value, true);
  mainEnabled.value = false;
  const cleanup = main.stop(); await turn(); finishStop(); await cleanup;
});
