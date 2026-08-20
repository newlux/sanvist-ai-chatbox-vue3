import type { ChatStreamEvent, SendChatMessageParams } from "@/api/chat/types";
import { createAlipaySocketStream } from "@/utils/platform/alipay-socket-stream";
import { createAlipaySseRequest } from "@/utils/platform/alipay-stream";
import { getChatSocketURL, getRequestBaseURL, getRequestHeaders } from "@/utils/request";

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
    const url = `${getRequestBaseURL().replace(/\/$/, "")}/chat/send`;
    const body = { ...params, responseMode: "streaming" as const };
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

    function pushEvent(payload: unknown) {
      if (finished) return;
      receivedEvent = true;
      armIdleTimer();
      queue.push({ result: payload as ChatStreamEvent });
    }

    function startHttpTransport() {
      const task = createAlipaySseRequest({
        url,
        data: body,
        headers: getRequestHeaders(),
        timeout: requestTimeoutMs,
        onMessage: pushEvent,
      });
      abortActiveRequest = task.abort;
      armIdleTimer();
      task.done.then(succeed).catch((error: unknown) => fail(toError(error)));
    }

    const socketUrl = getChatSocketURL();
    if (socketUrl) {
      const socketTask = createAlipaySocketStream({
        url: socketUrl,
        data: body,
        headers: getRequestHeaders(),
        onMessage: pushEvent,
      });
      abortActiveRequest = socketTask.abort;
      armIdleTimer();
      socketTask.done.then(succeed).catch((error: unknown) => {
        const normalized = toError(error);
        // 一个事件都没收到才回落：此时界面上还没有任何内容，整包重放不会重复。
        // 已经开始输出后再断，只能报错，否则会出现两段拼接的回答。
        const canFallback = !finished && !receivedEvent && normalized.name !== "AbortError";
        if (canFallback) {
          console.warn(
            `[useChatStream] WebSocket 通道不可用（已建连=${socketTask.isConnected()}，凭证=${socketUrl.replace(/=[^&]*/g, match => `=${match.slice(1, 5)}***`)}），回落 HTTP：`,
            normalized.message,
          );
          // 先确保连接彻底关掉，避免服务端还在为这条僵尸连接生成回答
          socketTask.abort();
          startHttpTransport();
          return;
        }
        fail(normalized);
      });
    }
    else {
      startHttpTransport();
    }

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
