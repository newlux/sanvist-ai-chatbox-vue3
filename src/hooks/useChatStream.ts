import type { ChatStreamEvent, SendChatMessageParams } from "@/api/chat/types";
import { createDifyEventNormalizer, toDifyChatMessagesRequest } from "@/utils/ai-stream/dify";
import { createSseSession } from "@/utils/ai-stream/sseSession";
import { getRequestBaseURL, getRequestHeaders } from "@/utils/request";

export interface StreamChunk<T> {
  result: T | null;
  error?: Error;
}

export interface StreamOptions {
  /**
   * 静默超时：距上一个事件超过该时长即判定链路已断并中止。
   * 不能用总时长做超时，长回答本身就可能持续很久。
   */
  idleTimeoutMs?: number;
  /** 传输层总超时，仅小程序 uni.request 生效 */
  requestTimeoutMs?: number;
}

// 必须大于网关的 algorithm.idle-timeout-ms(120s)：端上先判超时会 abort 连接，
// 而 WebSocket 断开在网关等同于一次主动中断，长任务（图表等）会被误杀
const DEFAULT_IDLE_TIMEOUT_MS = 130_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

function createAsyncQueue<T>() {
  const values: T[] = [];
  const waiters: Array<(result: IteratorResult<T>) => void> = [];
  let ended = false;

  return {
    push(value: T) {
      if (ended) return;
      const waiter = waiters.shift();
      if (waiter) waiter({ value, done: false });
      else values.push(value);
    },
    end() {
      ended = true;
      while (waiters.length) waiters.shift()?.({ value: undefined, done: true });
    },
    async next(): Promise<IteratorResult<T>> {
      if (values.length) return { value: values.shift() as T, done: false };
      if (ended) return { value: undefined, done: true };
      return new Promise(resolve => waiters.push(resolve));
    },
  };
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

export function useChatStream(options: { onError?: (error: Error) => void } = {}) {
  let abortActiveRequest: (() => void) | undefined;

  async function* stream(params: SendChatMessageParams, streamOptions: StreamOptions = {}) {
    const queue = createAsyncQueue<StreamChunk<ChatStreamEvent>>();
    const url = `${getRequestBaseURL().replace(/\/$/, "")}/proxy/v1/chat-messages`;
    const body = toDifyChatMessagesRequest(params);
    const idleTimeoutMs = streamOptions.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    const requestTimeoutMs = streamOptions.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let receivedEvent = false;
    let finished = false;

    function clearIdleTimer() {
      if (!idleTimer) return;
      clearTimeout(idleTimer);
      idleTimer = null;
    }

    function fail(error: Error) {
      if (finished) return;
      finished = true;
      clearIdleTimer();
      if (error.name !== "AbortError") options.onError?.(error);
      queue.push({ result: null, error });
      queue.end();
    }

    function succeed() {
      if (finished) return;
      finished = true;
      clearIdleTimer();
      queue.end();
    }

    function armIdleTimer() {
      if (finished) return;
      // 首个事件到达前按总时长等：不支持分块的环境要等整包响应，中途一个事件都没有
      const waitMs = receivedEvent ? idleTimeoutMs : requestTimeoutMs;
      if (!waitMs) return;
      clearIdleTimer();
      idleTimer = setTimeout(() => {
        abortActiveRequest?.();
        fail(new Error("流式响应超时，请重试"));
      }, waitMs);
    }

    const normalizeEvent = createDifyEventNormalizer();

    function pushEvent(payload: unknown) {
      if (finished) return;
      const event = normalizeEvent(payload);
      if (!event) return;
      if (event instanceof Error) {
        fail(event);
        return;
      }
      receivedEvent = true;
      armIdleTimer();
      queue.push({ result: event });
    }

    // 浏览器环境：fetch 原生支持分块读取，直接消费 SSE，不需要 WebSocket 通道
    const controller = new AbortController();
    abortActiveRequest = () => controller.abort();
    const session = createSseSession({
      onEvent: pushEvent,
      isAborted: () => finished,
    });
    armIdleTimer();
    void (async () => {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: getRequestHeaders({
            Accept: "text/event-stream",
            "Content-Type": "application/json",
          }),
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`流式请求失败（${response.status}）`);
        if (!response.body) {
          // 个别 WebView 不暴露 ReadableStream，退化成一次性读取整包再解析
          session.finalize(await response.text());
          succeed();
          return;
        }

        const reader = response.body.getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) session.consumeChunk(value);
        }
        session.finalize();
        succeed();
      }
      catch (error) {
        // 浏览器抛的是 DOMException，name 是只读 getter，改不得，
        // 中止场景直接换一个自己的 Error 往下传
        if (controller.signal.aborted) {
          const aborted = new Error("请求已取消");
          aborted.name = "AbortError";
          fail(aborted);
          return;
        }
        fail(toError(error));
      }
    })();

    try {
      while (true) {
        const item = await queue.next();
        if (item.done) break;
        yield item.value;
      }
    }
    finally {
      clearIdleTimer();
      finished = true;
      abortActiveRequest = undefined;
    }
  }

  function cancel() {
    abortActiveRequest?.();
    abortActiveRequest = undefined;
  }

  return { stream, cancel };
}
