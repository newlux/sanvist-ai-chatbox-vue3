import type { SseSession } from './sseSession';

interface SseTransportOptions {
  url: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
  session: SseSession;
}

/**
 * iOS 容器可能包装 fetch 并缓冲整包，即使暴露 ReadableStream 也不代表会逐段交付。
 * 在发请求前选 XHR，避免等 fetch 返回后再重发 POST，造成重复创建会话。
 * 不依赖异步注入的 AlipayJSBridge；iPad 桌面 UA 也覆盖。
 */
export function useXhrForSse() {
  if (typeof XMLHttpRequest === 'undefined') return false;
  const ios = typeof navigator !== 'undefined'
    && (/iPad|iPhone|iPod/i.test(navigator.userAgent)
      || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1));
  return ios || typeof fetch === 'undefined' || typeof ReadableStream === 'undefined';
}

function abortError() {
  const error = new Error('请求已取消');
  error.name = 'AbortError';
  return error;
}

/** 用累计 responseText 的增量喂给同一个 SSE 解析器，progress / load 不重复派发。 */
function readWithXhr(options: SseTransportOptions) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let consumedLength = 0;
    let settled = false;

    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      options.signal.removeEventListener('abort', abort);
      xhr.onreadystatechange = xhr.onprogress = xhr.onload = xhr.onerror = xhr.onabort = xhr.ontimeout = null;
      if (error) reject(error);
      else resolve();
    }

    function abort() {
      finish(abortError());
      xhr.abort();
    }

    function drain() {
      if (settled || options.signal.aborted || xhr.readyState < 3) return;
      // 错误响应不能当 SSE 解析；HTTP 错误统一在 load 时报告。
      if (xhr.status < 200 || xhr.status >= 300) return;
      const text = xhr.responseText;
      if (text.length <= consumedLength) return;
      const delta = text.slice(consumedLength);
      consumedLength = text.length;
      options.session.consumeText(delta);
    }

    if (options.signal.aborted) {
      finish(abortError());
      return;
    }
    options.signal.addEventListener('abort', abort, { once: true });
    try {
      xhr.open('POST', options.url, true);
      xhr.responseType = 'text';
      Object.entries(options.headers).forEach(([name, value]) => xhr.setRequestHeader(name, value));
      xhr.onreadystatechange = xhr.onprogress = () => {
        try { drain(); }
        catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
          xhr.abort();
        }
      };
      xhr.onload = () => {
        try {
          if (xhr.status < 200 || xhr.status >= 300) {
            finish(new Error(`流式请求失败（${xhr.status}）`));
            return;
          }
          drain();
          options.session.finalize();
          finish();
        }
        catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      };
      xhr.onerror = () => finish(new Error('流式请求网络异常'));
      xhr.ontimeout = () => finish(new Error('流式响应超时，请重试'));
      xhr.onabort = () => finish(abortError());
      xhr.send(options.body);
    }
    catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** 保留 fetch 为默认通道，iOS / 不支持流的 WebView 走 XHR 文本增量。 */
export async function readSseResponse(options: SseTransportOptions, transport: 'fetch' | 'xhr') {
  if (transport === 'xhr') return readWithXhr(options);
  const response = await fetch(options.url, {
    method: 'POST',
    headers: options.headers,
    body: options.body,
    signal: options.signal,
  });
  if (!response.ok) throw new Error(`流式请求失败（${response.status}）`);
  if (typeof response.body?.getReader !== 'function') {
    // 不重发已提交的 POST；未知容器仍能保留完整答案。
    options.session.finalize(await response.text());
    return;
  }
  const reader = response.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) options.session.consumeChunk(value);
    }
    options.session.finalize();
  }
  finally {
    reader.releaseLock();
  }
}
