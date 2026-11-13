import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temp = await mkdtemp(path.join(tmpdir(), 'sanvist-duplex-'));
after(() => rm(temp, { recursive: true, force: true, maxRetries: 3 }));
await build({ entryPoints: ['src/utils/asr/duplex-runtime.ts'], outfile: path.join(temp, 'runtime.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { createDuplexVoiceRuntime } = await import(pathToFileURL(path.join(temp, 'runtime.mjs')));
await build({
  entryPoints: ['src/utils/asr/native-pcm-stream.ts'], outfile: path.join(temp, 'native.mjs'), bundle: true, platform: 'node', format: 'esm',
  plugins: [{ name: 'native-device-mock', setup(build) {
    build.onResolve({ filter: /^@\/utils\/(logger|platform\/mpaas)$/ }, args => ({ path: args.path, namespace: 'mock' }));
    build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `
      export const createLogger=()=>({info(){},warn(){}});
      export const isMpaasReady=()=>true;
      export const callNative=(...args)=>globalThis.nativeFixture.call(...args);
      export const onNativeEvent=(name,callback)=>{globalThis.nativeFixture.events[name]=callback;return ()=>{delete globalThis.nativeFixture.events[name]}};
    ` }));
  } }],
});
const { startNativePcmCapture } = await import(pathToFileURL(path.join(temp, 'native.mjs')));

function fixture(t, overrides = {}) {
  let time = 100;
  const sessions = [], submissions = [], gains = [], states = [], errors = [];
  let captureHandlers, captureStops = 0, starts = 0;
  const runtime = createDuplexVoiceRuntime({
    now: () => time,
    openSession(handlers) {
      const session = { handlers, frames: [], finishes: 0, closed: false,
        pushFrame(frame) { this.frames.push(frame); },
        finish() { this.finishes++; },
        close() { this.closed = true; },
      };
      sessions.push(session);
      return session;
    },
    async startCapture(handlers) { starts++; captureHandlers = handlers; return { stop() { captureStops++; } }; },
    submit: text => submissions.push(text), setGain: gain => gains.push(gain),
    onState: state => states.push(state), onError: error => errors.push(error),
    ...overrides,
  });
  t.after(() => runtime.stop());
  return { runtime, sessions, submissions, gains, states, errors,
    get capture() { return captureHandlers; }, get stops() { return captureStops; }, get starts() { return starts; },
    advance(ms) { time += ms; runtime.advance(); },
  };
}
test('连续收音，两句分别定稿发送；识别连接轮换不重开麦克风', async t => {
  const f = fixture(t); await f.runtime.start();
  const frame = new ArrayBuffer(32);
  f.capture.onFrame(frame);
  f.sessions[0].handlers.onPartial('第一句');
  f.advance(1001);
  assert.equal(f.sessions[0].finishes, 1);
  assert.equal(f.sessions.length, 2);
  assert.equal(f.stops, 0);
  f.capture.onFrame(frame);
  assert.equal(f.sessions[1].frames.length, 1);
  f.sessions[0].handlers.onFinal('第一句。');
  f.sessions[1].handlers.onPartial('第二句'); f.advance(1001);
  f.sessions[1].handlers.onFinal('第二句。');
  assert.deepEqual(f.submissions, ['第一句。', '第二句。']);
  assert.equal(f.starts, 1);
});
test('播报原文和少量错字的回读被过滤，麦克风仍可提交用户的插话', async t => {
  const f = fixture(t);
  await f.runtime.start();
  f.runtime.setPlaybackText('本次巡检的设备运行状态全部正常。');
  f.capture.onFrame(new ArrayBuffer(32));
  f.sessions[0].handlers.onPartial('设备运行状态');
  assert.equal(f.states.at(-1).transcript, '');
  f.advance(1001);
  f.sessions[0].handlers.onFinal('本次巡检的设备运行状太全部正常');
  assert.deepEqual(f.submissions, []);

  f.sessions[1].handlers.onPartial('停一下，查昨天的报警');
  assert.equal(f.states.at(-1).transcript, '停一下，查昨天的报警');
  f.advance(1001);
  f.sessions[1].handlers.onFinal('停一下，查昨天的报警');
  assert.deepEqual(f.submissions, ['停一下，查昨天的报警']);
  assert.equal(f.starts, 1);
  assert.equal(f.stops, 0);
});

test('播报结束后的回声尾音和迟到定稿仍会过滤', async t => {
  const f = fixture(t);
  await f.runtime.start();
  f.runtime.setPlaybackText('今天的巡检已经完成。');
  f.sessions[0].handlers.onPartial('巡检已经完成');
  f.advance(1001);
  f.runtime.setPlaybackText('');
  f.advance(2500);
  f.sessions[0].handlers.onFinal('今天的巡检已经完成');
  assert.deepEqual(f.submissions, []);
});

test('播报结束一段时间后，用户主动复述同一句仍可发送', async t => {
  const f = fixture(t);
  await f.runtime.start();
  f.runtime.setPlaybackText('巡检完成。');
  f.runtime.setPlaybackText('');
  f.advance(2500);
  f.capture.onFrame(new ArrayBuffer(32));
  f.sessions[0].handlers.onPartial('巡检完成');
  f.advance(1001);
  f.sessions[0].handlers.onFinal('巡检完成');
  assert.deepEqual(f.submissions, ['巡检完成']);
});

test('partial 不发送，重复快照不延迟断句，持续静音不产生空问题', async t => {
  const f = fixture(t); await f.runtime.start(); f.advance(5000);
  assert.equal(f.sessions[0].finishes, 0);
  f.sessions[0].handlers.onPartial('预览'); f.advance(600);
  f.sessions[0].handlers.onPartial('预览'); f.advance(401);
  assert.equal(f.sessions[0].finishes, 1);
  assert.deepEqual(f.submissions, []);
  f.sessions[0].handlers.onFinal('');
  assert.deepEqual(f.submissions, []);
});
test('连续人声降低音量，700ms 无人声后恢复；讲话期间不切句', async t => {
  const f = fixture(t); await f.runtime.start();
  f.capture.onLevel(.05); f.advance(150); f.capture.onLevel(.05);
  assert.equal(f.gains.at(-1), .25);
  f.sessions[0].handlers.onPartial('讲话中');
  f.advance(600); f.capture.onLevel(.05);
  assert.equal(f.sessions[0].finishes, 0);
  f.advance(699); assert.equal(f.gains.at(-1), .25);
  f.advance(1); assert.equal(f.gains.at(-1), 1);
});
test('乱序 final 保持原说话顺序，同一 final 不重复发送', async t => {
  const f = fixture(t); await f.runtime.start();
  f.sessions[0].handlers.onPartial('一'); f.advance(1001);
  f.sessions[1].handlers.onPartial('二'); f.advance(1001);
  f.sessions[1].handlers.onFinal('二');
  assert.deepEqual(f.submissions, []);
  f.sessions[0].handlers.onFinal('一');
  f.sessions[0].handlers.onFinal('一');
  assert.deepEqual(f.submissions, ['一', '二']);
});
test('关闭丢弃待发送定稿与字幕，旧回调不能再次发送或重连', async t => {
  const f = fixture(t); await f.runtime.start();
  f.sessions[0].handlers.onPartial('关闭前'); f.advance(1001);
  await f.runtime.stop();
  f.sessions[0].handlers.onFinal('关闭前');
  f.sessions[1].handlers.onError('旧错误');
  assert.deepEqual(f.submissions, []); assert.deepEqual(f.errors, []);
  assert.equal(f.stops, 1); assert.equal(f.states.at(-1).active, false);
  assert.equal(f.states.at(-1).transcript, ''); assert.equal(f.gains.at(-1), 1);
});
test('正在申请权限时关闭，延迟返回的设备必须释放', async t => {
  let resolveCapture, stops = 0;
  const f = fixture(t, { startCapture: () => new Promise(resolve => { resolveCapture = resolve; }) });
  const starting = f.runtime.start(); await Promise.resolve();
  const stopped = f.runtime.stop();
  resolveCapture({ stop() { stops++; } });
  await starting; await stopped;
  assert.equal(stops, 1); assert.equal(f.sessions.length, 0);
  assert.equal(f.states.at(-1).active, false);
});
test('设备不支持时退出，无绿点和空发送', async t => {
  const f = fixture(t, { async startCapture() { throw new Error('permission denied'); } });
  await f.runtime.start();
  assert.equal(f.states.at(-1).active, false); assert.equal(f.states.at(-1).starting, false);
  assert.deepEqual(f.errors, ['permission denied']); assert.deepEqual(f.submissions, []);
});
test('到达单次识别时限主动轮换，保持收音且不发空问题', async t => {
  const f = fixture(t); await f.runtime.start(); f.advance(110001);
  assert.equal(f.sessions[0].finishes, 1); assert.equal(f.sessions.length, 2);
  f.sessions[0].handlers.onFinal(''); assert.equal(f.starts, 1);
  assert.deepEqual(f.submissions, []);
});
test('可恢复识别错误重连期间保留采集，关闭后取消重试', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t); await f.runtime.start();
  f.sessions[0].handlers.onError('断线');
  assert.equal(f.stops, 0); t.mock.timers.tick(250);
  assert.equal(f.sessions.length, 2);
  f.sessions[1].handlers.onError('断线'); await f.runtime.stop();
  t.mock.timers.tick(2000); assert.equal(f.sessions.length, 2);
});

test('切换模式必须等旧设备完成释放，新模式才能申请录音', async t => {
  let releaseDevice;
  let starts = 0;
  const f = fixture(t, {
    async startCapture() {
      starts++;
      return { stop: () => new Promise(resolve => { releaseDevice = resolve; }) };
    },
  });
  await f.runtime.start();
  const releasing = f.runtime.stop();
  const restarting = f.runtime.start();
  await Promise.resolve();
  assert.equal(starts, 1);
  releaseDevice(); await releasing; await restarting;
  assert.equal(starts, 2);
  // Resolve the second stop as well so this test leaves no pending device release.
  const last = f.runtime.stop(); await Promise.resolve(); releaseDevice(); await last;
});

test('原生停止只调用一次，重复停止仍等待同一个宿主释放结果', async () => {
  let resolveStop, stops = 0;
  globalThis.nativeFixture = { events: {}, call(name) {
    if (name === 'pcmStreamStop') { stops++; return new Promise(resolve => { resolveStop = resolve; }); }
    return Promise.resolve({});
  } };
  const device = await startNativePcmCapture({ onFrame() {} });
  const first = device.stop(), second = device.stop();
  let finished = false; second.then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(stops, 1); assert.equal(finished, false);
  resolveStop(); await first; await second;
  assert.equal(finished, true);
  assert.deepEqual(globalThis.nativeFixture.events, {});
  delete globalThis.nativeFixture;
});
test('宿主提前结束推流会退出语音态，不能继续显示绿色录音点', async () => {
  const errors = [];
  let stops = 0;
  globalThis.nativeFixture = { events: {}, call(name) { if (name === 'pcmStreamStop') stops++; return Promise.resolve({}); } };
  const device = await startNativePcmCapture({ onFrame() {}, onError: message => errors.push(message) });
  globalThis.nativeFixture.events.pcmStreamEnd({});
  await device.stop();
  assert.equal(errors.length, 1); assert.equal(stops, 1);
  assert.deepEqual(globalThis.nativeFixture.events, {});
  delete globalThis.nativeFixture;
});
