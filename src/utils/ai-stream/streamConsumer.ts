import type { AiBlock } from "./chatStreamParser";
import type {
  ChatStreamEvent,
  Identifier,
  MessageEndEvent,
} from "@/api/chat/types";
import { applyEventToBlocks, buildInitialBlocks } from "./chatStreamParser";
import { createStreamFlusher } from "./streamFlusher";

/**
 * 消费一次问答的事件流：把 SSE 事件折叠成 blocks，并按固定节奏向 UI 提交快照。
 *
 * 事件折叠很便宜，真正贵的是写响应式状态（小程序要 setData 整条消息）。
 * 因此折叠在窗口期内批量做，一批只提交一次快照。
 */

export interface ChatStreamSnapshot {
  blocks: AiBlock[];
  conversationId?: Identifier;
  messageId?: Identifier;
  taskId?: Identifier;
  metadata?: MessageEndEvent["metadata"];
  processStatus?: {
    phase: "thinking" | "succeeded" | "failed" | "stopped";
    title?: string;
    elapsedSeconds?: number;
  };
  /** 是否收到过实质内容，用于区分「真的没答案」和「刚开始就断了」 */
  receivedContent: boolean;
  ended: boolean;
}

export interface ConsumeChatStreamOptions {
  source: AsyncIterable<{ result: ChatStreamEvent | null; error?: Error }>;
  initialBlocks?: AiBlock[];
  flushIntervalMs?: number;
  /** 会话已被新请求或停止操作取代，立即停止消费且不再提交快照 */
  isStale?: () => boolean;
  onSnapshot: (snapshot: ChatStreamSnapshot) => void;
}

export async function consumeChatStream(
  options: ConsumeChatStreamOptions,
): Promise<ChatStreamSnapshot> {
  const snapshot: ChatStreamSnapshot = {
    blocks: options.initialBlocks ?? buildInitialBlocks(),
    receivedContent: false,
    ended: false,
  };

  const isStale = () => Boolean(options.isStale?.());

  function foldEvent(event: ChatStreamEvent) {
    const update = applyEventToBlocks(snapshot.blocks, event);
    snapshot.blocks = update.blocks;
    snapshot.receivedContent ||= update.receivedContent;
    if (update.conversationId) snapshot.conversationId = update.conversationId;
    if (update.messageId) snapshot.messageId = update.messageId;
    if (update.taskId) snapshot.taskId = update.taskId;
    if (update.metadata) snapshot.metadata = update.metadata;
    if (update.processStatus) snapshot.processStatus = update.processStatus;
    if (event.event === "message_end") snapshot.ended = true;
  }

  const flusher = createStreamFlusher<ChatStreamEvent>({
    intervalMs: options.flushIntervalMs,
    onFlush(events) {
      events.forEach(foldEvent);
      if (isStale()) return;
      options.onSnapshot({ ...snapshot });
    },
  });

  try {
    for await (const chunk of options.source) {
      if (isStale()) break;
      if (chunk.error) throw chunk.error;
      if (!chunk.result) continue;

      flusher.push(chunk.result);
      if (chunk.result.event === "message_end") {
        flusher.flush();
        break;
      }
    }
    // 正常结束（含服务端直接断流）时补交积压分片，否则最后一批内容会丢
    flusher.flush();
  }
  catch (error) {
    // 出错前已收到的内容要保留，让用户看到半截回答而不是空白
    flusher.flush();
    throw error;
  }
  finally {
    flusher.cancel();
  }

  return snapshot;
}
