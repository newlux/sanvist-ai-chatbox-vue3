import { createSseSession } from "@/utils/ai-stream/sseSession";

/**
 * 支付宝小程序侧的 SSE 传输。本文件只负责「把字节取回来」和「中止」，
 * 帧解析统一交给 sseSession。
 *
 * 注意：my.request 至今没有 enableChunked / onChunkReceived（官方文档参数表里没有这两项），
 * 分块只在微信小程序成立。这里保留 enableChunked 是为了让支持分块的运行环境走真流式，
 * 不支持时（当前支付宝的实际情况）自动退化为整包响应，由 success 一次性解析出全部事件。
 */

export interface AlipayStreamOptions {
  url: string;
  data: unknown;
  headers?: Record<string, string>;
  timeout?: number;
  onMessage: (payload: unknown) => void;
}

export interface AlipayStreamTask {
  abort: () => void;
  done: Promise<void>;
}

interface ChunkedRequestTask {
  abort?: () => void;
  onChunkReceived?: (callback: (result: { data: ArrayBuffer }) => void) => void;
}

export function createAlipaySseRequest(options: AlipayStreamOptions): AlipayStreamTask {
  let requestTask: ChunkedRequestTask | undefined;
  let settled = false;
  let aborted = false;
  let rejectDone: (reason?: unknown) => void = () => {};

  const session = createSseSession({
    onEvent: options.onMessage,
    isAborted: () => aborted,
  });

  const done = new Promise<void>((resolve, reject) => {
    rejectDone = reject;
    const requestWithTask = uni.request as unknown as (
      options: UniApp.RequestOptions,
    ) => ChunkedRequestTask;

    requestTask = requestWithTask({
      url: options.url,
      method: "POST",
      data: options.data,
      header: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
        ...options.headers,
      },
      // SSE 响应体不是 JSON，交给 sseSession 解析，避免运行时先做一次失败的 JSON.parse
      dataType: "text",
      timeout: options.timeout ?? 120_000,
      enableChunked: true,
      success(response) {
        if (settled) return;
        settled = true;
        const statusCode = Number(response.statusCode) || 0;
        // 整包兜底：未收到任何分片时（部分机型不回调 onChunkReceived），
        // 直接把完整响应体按 SSE 解析，退化成一次性输出而不是白屏。
        session.finalize(response.data);
        if (statusCode >= 200 && statusCode < 300) resolve();
        else reject(new Error(`流式请求失败（${statusCode}）`));
      },
      fail(error) {
        if (settled) return;
        settled = true;
        const message = error.errMsg || "流式请求失败";
        const normalized = new Error(message);
        if (aborted || /\babort\b|取消/i.test(message)) normalized.name = "AbortError";
        reject(normalized);
      },
    } as UniApp.RequestOptions);

    if (typeof requestTask.onChunkReceived !== "function") {
      // 拿不到分片就等整包，请求本身照常进行，不能在这里中断
      console.warn("[alipay-stream] 当前运行环境不支持 HTTP 分块响应，本次回答将在响应结束后一次性输出");
      return;
    }

    requestTask.onChunkReceived(({ data }) => {
      if (aborted) return;
      try {
        session.consumeChunk(data);
      }
      catch (error) {
        console.error("[alipay-stream] 处理数据块失败", error);
      }
    });
  });

  return {
    abort() {
      aborted = true;
      if (settled) return;
      settled = true;
      requestTask?.abort?.();
      const error = new Error("请求已取消");
      error.name = "AbortError";
      rejectDone(error);
    },
    done,
  };
}
