import type { ChatStreamEvent, Identifier, SendChatMessageParams } from "@/api/chat/types";
import { createDifyEventNormalizer, toDifyChatMessagesRequest } from "@/utils/ai-stream/dify";
import { createSseSession } from "@/utils/ai-stream/sseSession";
import { readSseResponse, useXhrForSse } from "@/utils/ai-stream/sseTransport";
import { createLogger } from "@/utils/logger";
import { getRequestBaseURL, getRequestHeaders } from "@/utils/request";

const logger = createLogger("chat-stream");

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

// 首包等待和事件静默均允许 5 分钟，避免长回答或长任务被端上提前中止。
const DEFAULT_IDLE_TIMEOUT_MS = 300_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;

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
  let activeRequest: { abort: () => void; taskId?: Identifier } | undefined;

  async function* stream(params: SendChatMessageParams, streamOptions: StreamOptions = {}) {
    const queue = createAsyncQueue<StreamChunk<ChatStreamEvent>>();
    const url = `${getRequestBaseURL().replace(/\/$/, "")}/proxy/v1/chat-messages`;
    const body = toDifyChatMessagesRequest(params);
    logger.info("[chat] 对话接口入参", body);
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
        abortRequest();
        fail(new Error("流式响应超时，请重试"));
      }, waitMs);
    }

    const normalizeEvent = createDifyEventNormalizer();

    function pushEvent(payload: unknown) {
      if (finished) return;
      // 首包可能只带 task_id。收到就保存，服务端停止无需等消息快照刷新。
      if (payload && typeof payload === "object" && "task_id" in payload) {
        const taskId = payload.task_id;
        if ((typeof taskId === "string" && taskId) || typeof taskId === "number") {
          request.taskId = taskId;
        }
      }
      logger.info("[chat] 对话接口出参", payload);
      const event = normalizeEvent(payload);
      if (!event) return;
      if (event instanceof Error) {
        fail(event);
        return;
      }
      receivedEvent = true;
      armIdleTimer();
      (Array.isArray(event) ? event : [event]).forEach(item => queue.push({ result: item }));
    }

    // iOS 容器用 XHR 增量读取，避免包装后的 fetch 把过程事件缓冲到回答结束。
    const controller = new AbortController();
    const abortRequest = () => controller.abort();
    const request: { abort: () => void; taskId?: Identifier } = { abort: abortRequest };
    activeRequest = request;
    const session = createSseSession({
      onEvent: pushEvent,
      isAborted: () => finished,
    });
    const transport = useXhrForSse() ? "xhr" : "fetch";
    logger.info("[chat] SSE 传输通道", { transport });
    armIdleTimer();
    void (async () => {
      try {
        await readSseResponse({
          url,
          headers: getRequestHeaders({
            Accept: "text/event-stream",
            "Content-Type": "application/json",
          }),
          body: JSON.stringify(body),
          signal: controller.signal,
          session,
        }, transport);
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
      abortRequest();
      if (activeRequest === request) activeRequest = undefined;
    }
  }

  function cancel() {
    const request = activeRequest;
    activeRequest = undefined;
    request?.abort();
    return request?.taskId;
  }

  return { stream, cancel };
}
