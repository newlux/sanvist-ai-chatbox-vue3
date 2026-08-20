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
  onError?: (callback: (error: SocketErrorLike) => void) => void;
  onClose?: (callback: (result: { code?: number; reason?: string }) => void) => void;
  send?: (options: { data: string }) => void;
  close?: (options?: { code?: number; reason?: string }) => void;
}

/** 各端错误对象字段不统一：uni/微信给 errMsg，支付宝给 error + errorMessage */
interface SocketErrorLike {
  errMsg?: string;
  error?: number | string;
  errorMessage?: string;
  message?: string;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 8_000;

function readSocketErrorMessage(error?: SocketErrorLike) {
  const detail = error?.errMsg || error?.errorMessage || error?.message;
  if (detail) return error?.error == null ? detail : `${detail}（error=${error.error}）`;
  if (error?.error != null) return `WebSocket 连接异常（error=${error.error}）`;
  // 各端字段不统一，原样带上负载，否则「连接异常」四个字无法区分握手 401 和域名未加白
  let raw = "";
  try {
    raw = JSON.stringify(error);
  }
  catch {
    raw = String(error);
  }
  return `WebSocket 连接异常（raw=${raw}）`;
}

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
      const message = readSocketErrorMessage(error);
      finish(connected ? new Error(message) : new SocketUnavailableError(message));
    });

    socket.onClose?.((result) => {
      session.finalize();
      // 握手没成功就被关闭（端点不存在、被网关拒绝、鉴权失败）时，
      // 部分基础库只回调 onClose 而不回调 onError。这里必须按「不可用」上报，
      // 否则调用方会把空流当成正常结束，既不回落 HTTP 也不报错，界面就是一片空白。
      if (!connected) {
        const detail = result?.reason || (result?.code ? `code=${result.code}` : "连接未建立");
        finish(new SocketUnavailableError(`WebSocket 连接被关闭：${detail}`));
        return;
      }
      finish();
    });
  });

  return {
    abort() {
      aborted = true;
      // 无论是否已结束都要关连接：建流失败后回落 HTTP 时，
      // 残留的连接会让服务端继续为这轮问答生成内容
      closeSocket();
      if (settled) return;
      const error = new Error("请求已取消");
      error.name = "AbortError";
      finish(error);
    },
    isConnected: () => connected,
    done,
  };
}
