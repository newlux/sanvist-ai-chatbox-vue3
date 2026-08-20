import type { ChatFile, Identifier } from "@/api/chat/types";
import type { ChatMessageAttachment } from "@/stores/chat-types";
import { useI18n } from "vue-i18n";
import { interruptChat } from "@/api/chat";
import { useChatStream } from "@/hooks/useChatStream";
import { useChatStore, useSessionStore, useUserStore } from "@/stores";
import { buildInitialBlocks, consumeChatStream } from "@/utils/ai-stream";

/** 只发附件、没有文字时替代 query 的兜底提问（网关要求 query 非空） */
const ATTACHMENT_ONLY_QUERY = "请查看我发送的附件";

function isAbortError(error: unknown) {
  if (!error) return false;
  const err = error as { name?: string; message?: string };
  const name = err.name || "";
  const message = String(err.message || "").toLowerCase();
  return name === "AbortError" || message.includes("aborted") || message.includes("abort");
}

export function useChatSend() {
  const { t } = useI18n();
  const chatStore = useChatStore();
  const sessionStore = useSessionStore();
  const userStore = useUserStore();
  const { stream, cancel } = useChatStream({
    onError: (error) => {
      if (!isAbortError(error)) console.error("[AiChatPage] stream request failed", error);
    },
  });

  function cancelActiveStream() {
    const idx = Number(chatStore.activeAiMsgIndex);
    const activeMessage = Number.isInteger(idx) && idx >= 0 ? chatStore.messages[idx] : null;

    chatStore.invalidateActiveRequest();
    try {
      cancel();
    } catch (error) {
      console.error("[AiChatPage] failed to cancel stream", error);
    }

    if (activeMessage?.sessionId && activeMessage?.messageId) {
      interruptChat({
        conversationId: activeMessage.sessionId,
        messageId: activeMessage.messageId,
      }).catch(error => console.error("[AiChatPage] failed to interrupt chat", error));
    }

    if (activeMessage?.loading) {
      chatStore.replaceMessage(idx, {
        ...activeMessage,
        loading: false,
        interrupted: true,
      });
    }
    chatStore.activeAiMsgIndex = -1;
  }

  function stopGenerating() {
    if (!chatStore.isLoading) return;
    cancelActiveStream();
    chatStore.isLoading = false;
    chatStore.scrollToBottom();
  }

  function applySnapshot(aiMsgIndex: number, userMsgIndex: number, snapshot: {
    blocks: ReturnType<typeof buildInitialBlocks>;
    conversationId?: Identifier;
    messageId?: Identifier;
    metadata?: { duration_ms?: number | null; status?: string };
    ended?: boolean;
  }) {
    const aiMessage = chatStore.messages[aiMsgIndex];
    if (!aiMessage) return;

    if (snapshot.conversationId) chatStore.aiSessionId = snapshot.conversationId;
    chatStore.replaceMessage(aiMsgIndex, {
      ...aiMessage,
      blocks: snapshot.blocks,
      sessionId: snapshot.conversationId ?? aiMessage.sessionId,
      messageId: snapshot.messageId ?? aiMessage.messageId,
      durationMs: snapshot.metadata?.duration_ms ?? aiMessage.durationMs,
      loading: !snapshot.ended,
      interrupted: snapshot.metadata?.status === "stopped",
    });

    const userMessage = chatStore.messages[userMsgIndex];
    if (userMessage && snapshot.conversationId && snapshot.messageId) {
      chatStore.replaceMessage(userMsgIndex, {
        ...userMessage,
        sessionId: snapshot.conversationId,
        messageId: snapshot.messageId,
      });
    }
    chatStore.scrollToBottom();
  }

  async function sendAiFlow(options: {
    aiMsgIndex: number;
    userMsgIndex: number;
    content: string;
    files: ChatFile[];
    hadSessionId: boolean;
    requestSeq: number;
  }) {
    const { aiMsgIndex, userMsgIndex, content, files, hadSessionId, requestSeq } = options;
    let receivedContent = false;

    try {
      await consumeChatStream({
        source: stream({
          query: content,
          user: String(userStore.userId || ""),
          conversationId: chatStore.aiSessionId,
          // 智能体分身通过 inputs 透传；附件只走 files，不再往 inputs 里塞一份
          ...(chatStore.subagent ? { inputs: { subagent: chatStore.subagent } } : {}),
          ...(files.length ? { files } : {}),
        }, { idleTimeoutMs: 60_000 }),
        isStale: () => requestSeq !== chatStore.activeRequestSeq,
        onSnapshot: (snapshot) => {
          receivedContent = snapshot.receivedContent;
          applySnapshot(aiMsgIndex, userMsgIndex, snapshot);
        },
      });
    } catch (error) {
      const aiMessage = chatStore.messages[aiMsgIndex];
      if (aiMessage && requestSeq === chatStore.activeRequestSeq && !isAbortError(error)) {
        chatStore.replaceMessage(aiMsgIndex, {
          ...aiMessage,
          blocks: receivedContent ? aiMessage.blocks : buildInitialBlocks(),
          content: receivedContent ? aiMessage.content : t("ai-unavailable-retry-later"),
          loading: false,
        });
        console.error("[AiChatPage] stream consumption failed", error);
      }
    } finally {
      if (requestSeq === chatStore.activeRequestSeq) {
        const current = chatStore.messages[aiMsgIndex];
        if (current) chatStore.replaceMessage(aiMsgIndex, { ...current, loading: false });
        chatStore.isLoading = false;
        chatStore.activeAiMsgIndex = -1;
        chatStore.scrollToBottom();
        if (!hadSessionId && chatStore.aiSessionId) {
          sessionStore.loadSessions().catch(error => console.error("[AiChatPage] failed to refresh AI sessions", error));
        }
      }
    }
  }

  /**
   * 输入栏会把文本和附件一起交上来；快捷提问等旧调用不传参，仍从 store 取草稿。
   */
  async function sendMessage(payload?: {
    text?: string;
    files?: ChatFile[];
    attachments?: ChatMessageAttachment[];
  }) {
    const text = String(payload?.text ?? chatStore.inputText).trim();
    const files = payload?.files ?? [];
    const attachments = payload?.attachments ?? [];
    if (!text && !files.length) return;
    // 网关要求 query 非空，只发附件时补一句中性提问；气泡里仍然只显示附件本身
    const query = text || ATTACHMENT_ONLY_QUERY;

    cancelActiveStream();
    const requestSeq = chatStore.nextRequestSeq();
    const hadSessionId = Boolean(chatStore.aiSessionId);
    const uuid = Date.now();
    const conversationId = chatStore.aiSessionId;

    chatStore.inputText = "";
    chatStore.showQuickPrompts = false;
    chatStore.isLoading = true;
    const userMsgIndex = chatStore.messages.length;
    chatStore.messages.push({
      id: `user-${uuid}`,
      role: "user",
      content: query,
      sessionId: conversationId,
      messageId: null,
      ...(attachments.length ? { attachments } : {}),
    });
    const aiMsgIndex = chatStore.messages.length;
    chatStore.messages.push({
      id: `ai-${uuid}`,
      role: "ai",
      content: "",
      blocks: buildInitialBlocks(),
      loading: true,
      interrupted: false,
      sessionId: conversationId,
      messageId: null,
      waitingText: query,
    });
    chatStore.activeAiMsgIndex = aiMsgIndex;
    chatStore.scrollToBottom(true);
    await sendAiFlow({ aiMsgIndex, userMsgIndex, content: query, files, hadSessionId, requestSeq });
  }

  function sendQuickPrompt(text: string) {
    chatStore.inputText = text;
    void sendMessage();
  }

  return {
    sendMessage,
    sendQuickPrompt,
    stopGenerating,
    cancelActiveStream,
  };
}
