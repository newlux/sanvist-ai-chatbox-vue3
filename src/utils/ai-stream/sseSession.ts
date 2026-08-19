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
   * 收尾。传入整包响应体时会补齐尚未解析的部分：
   * 支付宝真机可能完全不触发 onChunkReceived，也可能只送了前几个分片，
   * 两种情况都靠「整包比已消费部分长出来的尾巴」补齐，退化成非流式但内容不丢。
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
  /** 已喂进解析器的文本长度，用于和整包响应体对齐出未解析的尾部 */
  let consumedLength = 0;
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
    consumedLength += text.length;
    buffer += text;
    drainBuffer();
  }

  return {
    consumeChunk(data: ChunkData) {
      consumeText(decoder.decode(data));
    },
    consumeText,
    finalize(responseBody?: unknown) {
      consumeText(decoder.flush());
      // 分块内容一定是整包响应体的前缀，按已消费长度截出尾巴补解析即可：
      // 一个分片都没收到时补的是整包，只收到一半时补的是剩下那半，都不会重复输出。
      if (typeof responseBody === "string" && responseBody.length > consumedLength) {
        consumeText(responseBody.slice(consumedLength));
      }
      if (buffer.trim()) emitFrame(buffer);
      buffer = "";
    },
    hasReceivedEvent: () => receivedEvent,
  };
}
