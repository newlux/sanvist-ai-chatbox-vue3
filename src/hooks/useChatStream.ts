import type { ChatStreamEvent, SendChatMessageParams } from "@/api/chat/types";
import { createAlipaySseRequest } from "@/utils/platform/alipay-stream";
import { getRequestBaseURL, getRequestHeaders } from "@/utils/request";

interface StreamChunk<T> {
  result: T | null;
  error?: Error;
}

interface StreamOptions {
  timeout?: number;
}

function createAsyncQueue<T>() {
  const values: T[] = [];
  const waiters: Array<(result: IteratorResult<T>) => void> = [];
  let ended = false;

  return {
    push(value: T) {
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

export function useChatStream(options: { onError?: (error: Error) => void } = {}) {
  let abortActiveRequest: (() => void) | undefined;

  async function* stream(params: SendChatMessageParams, streamOptions: StreamOptions = {}) {
    const queue = createAsyncQueue<StreamChunk<ChatStreamEvent>>();
    const url = `${getRequestBaseURL().replace(/\/$/, "")}/chat/send`;

    // #ifdef MP-ALIPAY
    const task = createAlipaySseRequest({
      url,
      data: { ...params, responseMode: "streaming" },
      headers: getRequestHeaders(),
      timeout: streamOptions.timeout,
      onMessage(payload) {
        queue.push({ result: payload as ChatStreamEvent });
      },
    });
    abortActiveRequest = task.abort;
    task.done.then(queue.end).catch((error: Error) => {
      if (error?.name !== "AbortError") options.onError?.(error);
      queue.push({ result: null, error });
      queue.end();
    });
    // #endif

    // #ifndef MP-ALIPAY
    const controller = new AbortController();
    abortActiveRequest = () => controller.abort();
    void (async () => {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: getRequestHeaders({
            Accept: "text/event-stream",
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({ ...params, responseMode: "streaming" }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error(`流式请求失败（${response.status}）`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split(/\r?\n\r?\n/);
          buffer = events.pop() || "";
          for (const event of events) {
            const raw = event.split(/\r?\n/)
              .filter(line => line.startsWith("data:"))
              .map(line => line.slice(5).trimStart())
              .join("\n");
            if (!raw || raw === "[DONE]") continue;
            queue.push({ result: JSON.parse(raw) as ChatStreamEvent });
          }
        }
      }
      catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        options.onError?.(normalized);
        queue.push({ result: null, error: normalized });
      }
      finally {
        queue.end();
      }
    })();
    // #endif

    try {
      while (true) {
        const item = await queue.next();
        if (item.done) break;
        yield item.value;
      }
    }
    finally {
      abortActiveRequest = undefined;
    }
  }

  function cancel() {
    abortActiveRequest?.();
    abortActiveRequest = undefined;
  }

  return { stream, cancel };
}
