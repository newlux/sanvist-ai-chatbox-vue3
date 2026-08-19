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
import { useChatStore } from "./chat";
import { useUserStore } from "./user";

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

export const useSessionStore = defineStore("session", () => {
  const sessions = ref<Conversation[]>([]);
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

  async function loadHistory(sessionId: Identifier) {
    const userStore = useUserStore();
    const chatStore = useChatStore();
    const page = await getMessages({
      conversationId: sessionId,
      user: String(userStore.userId || ""),
      limit: 100,
    });
    chatStore.messages = mapHistoryMessages(page?.data || [], sessionId);
    chatStore.showQuickPrompts = false;
    chatStore.showQuickList = false;
    chatStore.scrollToBottom();
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
    const userStore = useUserStore();
    await renameConversation(sessionId, {
      user: String(userStore.userId || ""),
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
    loadHistory,
    removeSession,
    removeSessions,
    renameSession,
  };
});
