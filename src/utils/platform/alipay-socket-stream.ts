import type { AlipayStreamTask } from "./alipay-stream";
import { createSseSession } from "@/utils/ai-stream/sseSession";

/**
 * 支付宝小程序的 WebSocket 流式通道。
 *
 * my.request 没有分块响应能力，小程序端要拿到真正的流式输出只能走 WebSocket。
 * 协议刻意与 SSE 保持同构，服务端可以直接把原本写进 SseEmitter 的事件推过来：
 * - 连接建立后客户端发一帧 JSON，内容与 POST /chat/send 的请求体一致；
 * - 服务端每帧推一个事件对象（JSON），或直接推 SSE 原文（`data: {...}`）；
 * - 收到 message_end 或服务端关闭连接即视为本轮结束。
 */

export interface AlipaySocketStreamOptions {
  url: string;
  data: unknown;
  headers?: Record<string, string>;
  /** 建连超时，超时后由调用方决定是否回落到 HTTP */
  connectTimeout?: number;
  onMessage: (payload: unknown) => void;
}

export interface AlipaySocketStreamTask extends AlipayStreamTask {
  /** 是否成功建过连：没建起来才可以安全回落 HTTP，否则会重复输出 */
  isConnected: () => boolean;
}

interface SocketTaskLike {
  onOpen?: (callback: () => void) => void;
  onMessage?: (callback: (result: { data: string | ArrayBuffer }) => void) => void;
  onError?: (callback: (error: { errMsg?: string }) => void) => void;
  onClose?: (callback: (result: { code?: number; reason?: string }) => void) => void;
  send?: (options: { data: string }) => void;
  close?: (options?: { code?: number; reason?: string }) => void;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 8_000;

export class SocketUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SocketUnavailableError";
  }
}

function isSseText(text: string) {
  return /^\s*(?:event|data|id|retry):/.test(text);
}

export function createAlipaySocketStream(
  options: AlipaySocketStreamOptions,
): AlipaySocketStreamTask {
  let socket: SocketTaskLike | undefined;
  let settled = false;
  let aborted = false;
  let connected = false;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;
  let rejectDone: (reason?: unknown) => void = () => {};
  let resolveDone: () => void = () => {};

  const session = createSseSession({
    onEvent: options.onMessage,
    isAborted: () => aborted,
  });

  function clearConnectTimer() {
    if (!connectTimer) return;
    clearTimeout(connectTimer);
    connectTimer = null;
  }

  function closeSocket() {
    try {
      socket?.close?.({ code: 1000, reason: "client close" });
    }
    catch (error) {
      console.warn("[alipay-socket] 关闭连接失败", error);
    }
  }

  function finish(error?: Error) {
    if (settled) return;
    settled = true;
    clearConnectTimer();
    if (error) rejectDone(error);
    else resolveDone();
  }

  function handleFrame(data: string | ArrayBuffer) {
    if (aborted) return;
    if (typeof data !== "string") {
      session.consumeChunk(data);
      return;
    }
    const text = data.trim();
    if (!text || text === "[DONE]") {
      if (text === "[DONE]") finish();
      return;
    }
    // 服务端直接转发 SSE 原文时补齐帧分隔，避免最后一个事件卡在缓冲区
    if (isSseText(text)) {
      session.consumeText(/\n\s*\n$/.test(data) ? data : `${text}\n\n`);
      return;
    }
    try {
      options.onMessage(JSON.parse(text));
    }
    catch {
      options.onMessage(text);
    }
  }

  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;

    try {
      socket = uni.connectSocket({
        url: options.url,
        header: { "Content-Type": "application/json", ...options.headers },
        // 支付宝需要该参数才会返回独立的 SocketTask，而不是走全局单连接回调
        multiple: true,
        complete: () => {},
      } as UniApp.ConnectSocketOption) as unknown as SocketTaskLike;
    }
    catch (error) {
      finish(new SocketUnavailableError(`WebSocket 建连失败：${(error as Error)?.message || error}`));
      return;
    }

    if (!socket || typeof socket.onMessage !== "function" || typeof socket.send !== "function") {
      finish(new SocketUnavailableError("当前运行环境不支持 SocketTask"));
      return;
    }

    connectTimer = setTimeout(() => {
      closeSocket();
      finish(new SocketUnavailableError("WebSocket 建连超时"));
    }, options.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT_MS);

    socket.onOpen?.(() => {
      connected = true;
      clearConnectTimer();
      try {
        socket?.send?.({ data: JSON.stringify(options.data) });
      }
      catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });

    socket.onMessage?.(({ data }) => handleFrame(data));

    socket.onError?.((error) => {
      const message = error?.errMsg || "WebSocket 连接异常";
      finish(connected ? new Error(message) : new SocketUnavailableError(message));
    });

    socket.onClose?.(() => {
      session.finalize();
      finish();
    });
  });

  return {
    abort() {
      aborted = true;
      if (settled) return;
      closeSocket();
      const error = new Error("请求已取消");
      error.name = "AbortError";
      finish(error);
    },
    isConnected: () => connected,
    done,
  };
}
