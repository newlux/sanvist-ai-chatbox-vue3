import type { ChunkData } from "./chunkDecoder";
import { createChunkDecoder } from "./chunkDecoder";

/**
 * SSE 会话解析：把「字节流 / 文本流」还原成一个个事件对象。
 *
 * H5（fetch + ReadableStream）与支付宝小程序（uni.request + onChunkReceived）
 * 只是取数据的方式不同，帧切分与 `data:` 解析完全一致，这里统一实现，
 * 避免两端各写一份、修一处漏一处。
 *
 * 两层缓冲缺一不可：
 * - 解码层保留跨 chunk 的半个 UTF-8 字符；
 * - 帧层保留跨 chunk 的半个 SSE 事件（以空行分隔）。
 */

export interface SseSessionOptions {
  onEvent: (payload: unknown) => void;
  /** 已取消时停止派发，避免迟到的分片继续写 UI */
  isAborted?: () => boolean;
}

export interface SseSession {
  consumeChunk: (data: ChunkData) => void;
  consumeText: (text: string) => void;
  /**
   * 收尾。传入整包响应体时会做兜底解析：
   * 部分支付宝真机不触发 onChunkReceived，只在 success 里给出完整 body，
   * 此时若一个事件都没派发过，就把整包按 SSE 重新解析一遍，退化成非流式但内容不丢。
   */
  finalize: (responseBody?: unknown) => void;
  hasReceivedEvent: () => boolean;
}

const FRAME_SEPARATOR = /\r?\n\r?\n/;

function extractEventData(frame: string) {
  return frame
    .split(/\r?\n/)
    .filter(line => line.startsWith("data:"))
    .map(line => line.slice(5).trimStart())
    .join("\n");
}

export function createSseSession(options: SseSessionOptions): SseSession {
  const decoder = createChunkDecoder();
  let buffer = "";
  let receivedEvent = false;

  const isAborted = () => Boolean(options.isAborted?.());

  function emitFrame(frame: string) {
    if (isAborted()) return;
    const data = extractEventData(frame);
    if (!data || data === "[DONE]") return;

    receivedEvent = true;
    try {
      options.onEvent(JSON.parse(data));
    }
    catch {
      // 后端偶发非 JSON 负载（如纯文本错误信息），原样透传给上层判断
      options.onEvent(data);
    }
  }

  function drainBuffer() {
    const frames = buffer.split(FRAME_SEPARATOR);
    buffer = frames.pop() || "";
    frames.forEach(emitFrame);
  }

  function consumeText(text: string) {
    if (!text || isAborted()) return;
    buffer += text;
    drainBuffer();
  }

  return {
    consumeChunk(data: ChunkData) {
      consumeText(decoder.decode(data));
    },
    consumeText,
    finalize(responseBody?: unknown) {
      buffer += decoder.flush();
      if (buffer.trim()) emitFrame(buffer);
      buffer = "";

      if (receivedEvent) return;
      if (typeof responseBody !== "string" || !responseBody.includes("data:")) return;
      responseBody.split(FRAME_SEPARATOR).forEach(emitFrame);
    },
    hasReceivedEvent: () => receivedEvent,
  };
}
