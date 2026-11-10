import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// 使用项目现有的 Vite/esbuild 编译真实 TypeScript 模块，不复制传输实现。
const temp = await mkdtemp(path.join(tmpdir(), 'sanvist-sse-'));
await build({
  entryPoints: ['src/utils/ai-stream/sseTransport.ts', 'src/utils/ai-stream/sseSession.ts'],
  outdir: temp,
  bundle: true,
  platform: 'node',
  format: 'esm',
  outExtension: { '.js': '.mjs' },
});
after(() => rm(temp, { recursive: true, force: true }));
const { readSseResponse, useXhrForSse } = await import(pathToFileURL(path.join(temp, 'sseTransport.mjs')));
const { createSseSession } = await import(pathToFileURL(path.join(temp, 'sseSession.mjs')));

class FakeXhr {
  static requests = [];
  readyState = 0;
  status = 200;
  responseText = '';
  headers = {};
  aborted = false;
  constructor() { FakeXhr.requests.push(this); }
  open(...args) { this.openArgs = args; }
  setRequestHeader(name, value) { this.headers[name] = value; }
  send(body) { this.body = body; }
  abort() { this.aborted = true; this.onabort?.(); }
  chunk(text) {
    this.readyState = 3;
    this.responseText += text;
    this.onreadystatechange?.();
    this.onprogress?.();
  }
  complete(text = '') {
    this.responseText += text;
    this.readyState = 4;
    this.onreadystatechange?.();
    this.onload?.();
  }
}

function stubGlobal(t, name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  const restore = () => {
    if (original) Object.defineProperty(globalThis, name, original);
    else delete globalThis[name];
  };
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(restore);
  return { restore };
}

function start(t) {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('XHR 不得重发 fetch'); });
  stubGlobal(t, 'XMLHttpRequest', FakeXhr);
  FakeXhr.requests = [];
  const events = [];
  const controller = new AbortController();
  const pending = readSseResponse({
    url: '/proxy/v1/chat-messages',
    headers: { Accept: 'text/event-stream', Authorization: 'test-only' },
    body: '{"query":"测试"}',
    signal: controller.signal,
    session: createSseSession({ onEvent: event => events.push(event), isAborted: () => controller.signal.aborted }),
  }, 'xhr');
  return { xhr: FakeXhr.requests[0], pending, events, controller };
}

const frame = value => `data: ${JSON.stringify(value)}\n\n`;

test('XHR 在请求结束前交付进度，累计文本与多次回调不重复派发', async (t) => {
  const { xhr, pending, events } = start(t);
  let ended = false;
  pending.then(() => { ended = true; });
  const progress = { event: 'subtitle', message: '查询设备资料' };
  xhr.chunk(frame(progress));
  await Promise.resolve();
  assert.deepEqual(events, [progress]);
  assert.equal(ended, false);
  const answer = { event: 'answer', content: '作业步骤' };
  xhr.chunk(frame(answer));
  xhr.complete();
  await pending;
  assert.deepEqual(events, [progress, answer]);
  assert.equal(FakeXhr.requests.length, 1);
  assert.deepEqual(xhr.openArgs, ['POST', '/proxy/v1/chat-messages', true]);
  assert.equal(xhr.headers.Authorization, 'test-only');
  assert.equal(xhr.body, '{"query":"测试"}');
});

test('跨分片 JSON、中文和结尾无空行的事件均不丢失', async (t) => {
  const { xhr, pending, events } = start(t);
  const payload = { message: '正在查询设备🙂' };
  const text = frame(payload);
  const split = text.indexOf('🙂') + 1;
  xhr.chunk(text.slice(0, split));
  assert.deepEqual(events, []);
  xhr.chunk(text.slice(split));
  xhr.complete('data: {"event":"message_end"}');
  await pending;
  assert.deepEqual(events, [payload, { event: 'message_end' }]);
});

test('仅 load 时补齐的整包仍能读取且不重复发请求', async (t) => {
  const { xhr, pending, events } = start(t);
  xhr.complete(frame({ message: '回答' }));
  await pending;
  assert.deepEqual(events, [{ message: '回答' }]);
  assert.equal(FakeXhr.requests.length, 1);
});

test('取消会中断 XHR，迟到的分片不再派发', async (t) => {
  const { xhr, pending, events, controller } = start(t);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  controller.abort();
  xhr.chunk(frame({ message: '迟到的内容' }));
  xhr.complete();
  await rejected;
  assert.equal(xhr.aborted, true);
  assert.deepEqual(events, []);
});

test('HTTP 错误响应不作为正常进度派发', async (t) => {
  const { xhr, pending, events } = start(t);
  const rejected = assert.rejects(pending, /401/);
  xhr.status = 401;
  xhr.chunk(frame({ message: '未登录' }));
  xhr.complete();
  await rejected;
  assert.deepEqual(events, []);
});

test('网络错误能结束读取并报告失败', async (t) => {
  const { xhr, pending } = start(t);
  const rejected = assert.rejects(pending, /网络异常/);
  xhr.onerror();
  await rejected;
});

test('iPhone / iPad 桌面 UA 和无流能力环境在请求前选 XHR', (t) => {
  stubGlobal(t, 'XMLHttpRequest', FakeXhr);
  const nav = stubGlobal(t, 'navigator', { userAgent: 'iPhone', maxTouchPoints: 5 });
  assert.equal(useXhrForSse(), true);
  nav.restore();
  stubGlobal(t, 'navigator', { userAgent: 'Macintosh', maxTouchPoints: 5 });
  assert.equal(useXhrForSse(), true);
});

test('普通桌面浏览器继续使用 fetch', (t) => {
  stubGlobal(t, 'XMLHttpRequest', FakeXhr);
  stubGlobal(t, 'navigator', { userAgent: 'Chrome Linux', maxTouchPoints: 0 });
  assert.equal(useXhrForSse(), false);
  stubGlobal(t, 'ReadableStream', undefined);
  assert.equal(useXhrForSse(), true);
});

test('fetch 通道保留字节分片解码，中文跨字节分片不乱码', async (t) => {
  const bytes = new TextEncoder().encode(frame({ message: '资料查询' }));
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, 22));
      controller.enqueue(bytes.slice(22));
      controller.close();
    },
  })));
  const events = [];
  await readSseResponse({
    url: '/test', headers: {}, body: '{}', signal: new AbortController().signal,
    session: createSseSession({ onEvent: event => events.push(event) }),
  }, 'fetch');
  assert.deepEqual(events, [{ message: '资料查询' }]);
});
