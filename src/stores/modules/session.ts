import type { useChatStore } from "./chat";
import type { Conversation, Identifier } from "@/api/chat/types";
import type { UiChatMessage } from "@/stores/chat-types";
import type { AiBlock } from "@/utils/ai-stream";
import { defineStore } from "pinia";
import { ref } from "vue";
import {
  batchDeleteConversations,
  deleteConversation,
  getConversations,
  getMessages,
  renameConversation,
} from "@/api/chat";
import { useUserStore } from "./user";

type ChatStore = ReturnType<typeof useChatStore>;

function mapHistoryBlocks(contents: unknown, messageId: Identifier | null): AiBlock[] {
  const items = Array.isArray(contents) ? contents : [];
  return items.reduce<AiBlock[]>((blocks, content, index) => {
    const item = content as { type?: string; data?: Record<string, unknown> };
    const type = String(item?.type || "").toLowerCase();
    const payload = item?.data && typeof item.data === "object" ? item.data : {};
    const id = `history-${messageId ?? "message"}-${index}`;

    if (type === "text" && String(payload.text || "").trim()) {
      blocks.push({
        id,
        type: "answer",
        payload: { content: String(payload.text).trim() },
        complete: true,
      });
    } else if (["chart", "table", "metric", "suggestion"].includes(type)) {
      blocks.push({ id, type: type as AiBlock["type"], payload, complete: true });
    }
    return blocks;
  }, []);
}

export function mapHistoryMessages(
  list: unknown[],
  fallbackSessionId: Identifier | null,
): UiChatMessage[] {
  const mapped: UiChatMessage[] = [];
  (Array.isArray(list) ? list : []).forEach((raw) => {
    const item = raw as Record<string, unknown>;
    const sessionId = (item?.conversationId ?? fallbackSessionId ?? null) as Identifier | null;
    const messageId = (item?.id ?? null) as Identifier | null;
    const userText = String(item?.query || "").trim();
    const blocks = mapHistoryBlocks(item?.contents, messageId);
    if (userText) {
      mapped.push({ role: "user", content: userText, sessionId, messageId });
    }
    if (blocks.length) {
      const feedback = item?.feedback as { rating?: string; content?: string } | undefined;
      mapped.push({
        role: "ai",
        content: "",
        blocks,
        loading: false,
        ttsEnabled: Boolean(sessionId && messageId),
        ttsLoading: false,
        ttsPlaying: false,
        sessionId,
        messageId,
        positive: feedback?.rating === "like" ? true : feedback?.rating === "dislike" ? false : null,
        feedbackValue: feedback?.rating === "like" ? "good" : feedback?.rating === "dislike" ? "bad" : "",
        feedbackRemark: feedback?.content || "",
      });
    }
  });
  return mapped;
}

/** 单页历史消息条数。会话页首屏只拉这一页，上翻再补 */
const HISTORY_PAGE_SIZE = 30;

export const useSessionStore = defineStore("session", () => {
  const sessions = ref<Conversation[]>([]);
  /** 历史消息分页游标：接口按 firstId 往前翻 */
  const historyFirstId = ref<Identifier | null>(null);
  const historyHasMore = ref(false);
  const historyLoading = ref(false);
  const isSessionSwitching = ref(false);
  const hasMore = ref(true);
  const lastId = ref<Identifier | null>(null);

  async function loadSessions(pageNo = 1, pageSize = 20) {
    const userStore = useUserStore();
    const user = String(userStore.userId || "");
    if (!user) return { data: [] as Conversation[], hasMore: false };

    if (pageNo === 1) {
      lastId.value = null;
      hasMore.value = true;
    }

    const page = await getConversations({
      user,
      lastId: pageNo > 1 ? lastId.value || undefined : undefined,
      limit: pageSize,
      sortBy: "updated_at_desc",
    });
    const rows = Array.isArray(page?.data) ? page.data : [];
    lastId.value = rows.at(-1)?.id || null;
    hasMore.value = Boolean(page?.hasMore);
    sessions.value = pageNo === 1
      ? rows
      : [...sessions.value, ...rows.filter(session => !sessions.value.some(item => item.id === session.id))];
    return { data: rows, hasMore: hasMore.value };
  }

  /**
   * 载入某个会话的历史消息（最近一页）。
   * chatStore 由调用方传入：首页和智能体页面各有自己的会话域，
   * 这里默认取一个的话就会写错页面。
   */
  async function loadHistory(sessionId: Identifier, chatStore: ChatStore) {
    const userStore = useUserStore();
    const page = await getMessages({
      conversationId: sessionId,
      user: String(userStore.userId || ""),
      limit: HISTORY_PAGE_SIZE,
    });
    const rows = page?.data || [];
    chatStore.messages = mapHistoryMessages(rows, sessionId);
    // 接口按时间正序返回，最早的一条就是下一页的游标
    historyFirstId.value = (rows[0]?.id ?? null) as Identifier | null;
    historyHasMore.value = Boolean(page?.hasMore);
    historyLoading.value = false;
    chatStore.showQuickPrompts = false;
    chatStore.showQuickList = false;
    chatStore.scrollToBottom(true);
  }

  /**
   * 上翻加载更早的消息，插到列表头部。
   * 不动滚动位置：滚到顶才会触发，内容插在上方，用户当前看的那条仍在视野里。
   */
  async function loadMoreHistory(chatStore: ChatStore) {
    const sessionId = chatStore.aiSessionId;
    if (!sessionId || !historyHasMore.value || historyLoading.value) return false;
    if (!historyFirstId.value) return false;

    historyLoading.value = true;
    try {
      const userStore = useUserStore();
      const page = await getMessages({
        conversationId: sessionId,
        user: String(userStore.userId || ""),
        firstId: historyFirstId.value,
        limit: HISTORY_PAGE_SIZE,
      });
      const rows = page?.data || [];
      if (!rows.length) {
        historyHasMore.value = false;
        return false;
      }
      const older = mapHistoryMessages(rows, sessionId);
      chatStore.messages = [...older, ...chatStore.messages];
      historyFirstId.value = (rows[0]?.id ?? null) as Identifier | null;
      historyHasMore.value = Boolean(page?.hasMore);
      return true;
    } finally {
      historyLoading.value = false;
    }
  }

  async function removeSession(sessionId: Identifier) {
    const userStore = useUserStore();
    await deleteConversation(sessionId, { user: String(userStore.userId || "") });
    await loadSessions();
  }

  async function removeSessions(ids: Identifier[]) {
    const userStore = useUserStore();
    await batchDeleteConversations({
      user: String(userStore.userId || ""),
      conversationIds: ids,
    });
    await loadSessions();
  }

  async function renameSession(sessionId: Identifier, name: string) {
    await renameConversation(sessionId, {
      name: name.slice(0, 200),
    });
    sessions.value = sessions.value.map(item => (
      item.id === sessionId ? { ...item, name } : item
    ));
    await loadSessions();
  }

  return {
    sessions,
    isSessionSwitching,
    hasMore,
    loadSessions,
    historyHasMore,
    historyLoading,
    loadHistory,
    loadMoreHistory,
    removeSession,
    removeSessions,
    renameSession,
  };
});
