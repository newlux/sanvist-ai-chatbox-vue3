/**
 * 流式分片合并器。
 *
 * SSE 的 delta 频率远高于渲染需要的频率（一秒可达上百次）。
 * 小程序每次写响应式状态都要跨线程 setData，逐片刷新会直接卡住列表，
 * 因此把窗口期内的分片攒起来一次性提交。
 */

const DEFAULT_FLUSH_INTERVAL_MS = 64;

export interface StreamFlusherOptions<T> {
  onFlush: (items: T[]) => void;
  intervalMs?: number;
}

export interface StreamFlusher<T> {
  push: (item: T) => void;
  /** 立即提交积压分片：结束、出错、用户停止前必须调用，否则最后几个字会丢 */
  flush: () => void;
  /** 丢弃积压分片：会话作废时使用 */
  cancel: () => void;
}

export function createStreamFlusher<T>(options: StreamFlusherOptions<T>): StreamFlusher<T> {
  const intervalMs = options.intervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  let pending: T[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastFlushAt = 0;

  function clearTimer() {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  }

  function flush() {
    clearTimer();
    if (!pending.length) return;
    const items = pending;
    pending = [];
    lastFlushAt = Date.now();
    options.onFlush(items);
  }

  return {
    push(item: T) {
      pending.push(item);
      if (timer) return;
      const elapsed = Date.now() - lastFlushAt;
      if (elapsed >= intervalMs) {
        flush();
        return;
      }
      timer = setTimeout(flush, intervalMs - elapsed);
    },
    flush,
    cancel() {
      clearTimer();
      pending = [];
    },
  };
}
