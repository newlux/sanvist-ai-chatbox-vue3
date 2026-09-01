import type { ChatFile, Identifier } from "@/api/chat/types";
import type { ChatMessageAttachment } from "@/stores/chat-types";
import { useI18n } from "vue-i18n";
import { interruptChat } from "@/api/chat";
import { useChatStream } from "@/hooks/useChatStream";
import { useChatStore, useSessionStore } from "@/stores";
import { buildInitialBlocks, consumeChatStream } from "@/utils/ai-stream";

/** 只发附件、没有文字时替代 query 的兜底提问（网关要求 query 非空） */
import { createLogger } from "@/utils/logger";

const logger = createLogger("chat");

const DIFY_SCENE_BY_SUBAGENT: Record<string, "ASK" | "GUIDE" | "TASK" | "PODCAST"> = {
  guide: "GUIDE",
  task: "TASK",
  report: "PODCAST",
};

function getDifyScene(subagent: string) {
  return DIFY_SCENE_BY_SUBAGENT[subagent] || "ASK";
}

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
  const { stream, cancel } = useChatStream({
    onError: (error) => {
      if (!isAbortError(error)) logger.error("stream request failed", error);
    },
  });

  function cancelActiveStream() {
    const activeId = String(chatStore.activeMessageId || "");
    const index = chatStore.findMessageIndex(activeId);
    const activeMessage = index >= 0 ? chatStore.messages[index] : null;

    chatStore.invalidateActiveRequest();
    try {
      cancel();
    } catch (error) {
      logger.error("failed to cancel stream", error);
    }

    if (activeMessage?.taskId) {
      interruptChat({
        taskId: activeMessage.taskId,
      }).catch(error => logger.error("failed to interrupt chat", error));
    }

    if (activeMessage?.loading) {
      chatStore.patchMessageById(activeId, { loading: false, interrupted: true });
    }
    chatStore.activeMessageId = "";
    chatStore.isLoading = false;
  }

  function stopGenerating() {
    if (!chatStore.isLoading) return;
    cancelActiveStream();
    chatStore.scrollToBottom();
  }

  function applySnapshot(
    aiMsgId: string,
    userMsgId: string,
    snapshot: {
      blocks: ReturnType<typeof buildInitialBlocks>;
      conversationId?: Identifier;
      messageId?: Identifier;
      taskId?: Identifier;
      metadata?: { duration_ms?: number | null; status?: string };
      processStatus?: { phase: "thinking" | "succeeded" | "failed" | "stopped"; title?: string; elapsedSeconds?: number };
      ended?: boolean;
    },
  ) {
    const index = chatStore.findMessageIndex(aiMsgId);
    if (index < 0) return;
    const aiMessage = chatStore.messages[index];

    if (snapshot.conversationId) chatStore.aiSessionId = snapshot.conversationId;
    chatStore.patchMessageById(aiMsgId, {
      blocks: snapshot.blocks,
      sessionId: snapshot.conversationId ?? aiMessage.sessionId,
      messageId: snapshot.messageId ?? aiMessage.messageId,
      taskId: snapshot.taskId ?? aiMessage.taskId,
      durationMs: snapshot.metadata?.duration_ms ?? aiMessage.durationMs,
      processStatus: snapshot.processStatus ?? aiMessage.processStatus,
      loading: !snapshot.ended,
      interrupted: snapshot.metadata?.status === "stopped",
      ttsEnabled: Boolean(
        snapshot.ended
        && snapshot.metadata?.status !== "stopped"
        && (snapshot.conversationId ?? aiMessage.sessionId)
        && (snapshot.messageId ?? aiMessage.messageId),
      ),
      ttsPlaying: false,
    });

    if (snapshot.conversationId && snapshot.messageId) {
      chatStore.patchMessageById(userMsgId, {
        sessionId: snapshot.conversationId,
        messageId: snapshot.messageId,
      });
    }
    chatStore.scrollToBottom();
  }

  async function sendAiFlow(options: {
    aiMsgId: string;
    userMsgId: string;
    content: string;
    files: ChatFile[];
    hadSessionId: boolean;
    requestSeq: number;
  }) {
    const { aiMsgId, userMsgId, content, files, hadSessionId, requestSeq } = options;
    let receivedContent = false;

    try {
      await consumeChatStream({
        source: stream(
          {
            query: content,
            conversationId: chatStore.aiSessionId,
            // Dify 开始节点通过 inputs 接收场景；用户由网关从鉴权上下文注入。
            inputs: {
              scene: getDifyScene(chatStore.subagent),
            },
            files,
          },
          { idleTimeoutMs: 60_000 },
        ),
        isStale: () => requestSeq !== chatStore.activeRequestSeq,
        onSnapshot: (snapshot) => {
          receivedContent = snapshot.receivedContent;
          applySnapshot(aiMsgId, userMsgId, snapshot);
        },
      });
    } catch (error) {
      const index = chatStore.findMessageIndex(aiMsgId);
      const aiMessage = index >= 0 ? chatStore.messages[index] : null;
      if (aiMessage && requestSeq === chatStore.activeRequestSeq && !isAbortError(error)) {
        chatStore.patchMessageById(aiMsgId, {
          blocks: receivedContent ? aiMessage.blocks : buildInitialBlocks(),
          content: receivedContent ? aiMessage.content : t("ai-unavailable-retry-later"),
          loading: false,
        });
        logger.error("stream consumption failed", error);
      }
    } finally {
      if (requestSeq === chatStore.activeRequestSeq) {
        chatStore.patchMessageById(aiMsgId, { loading: false });
        chatStore.isLoading = false;
        chatStore.activeMessageId = "";
        chatStore.scrollToBottom();
        if (!hadSessionId && chatStore.aiSessionId) {
          sessionStore
            .loadSessions()
            .catch(error => logger.error("failed to refresh AI sessions", error));
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
    // 网关要求 query 非空，只发附件时补一句中性提问
    const query = text || t("attachment-only-query");

    cancelActiveStream();
    const requestSeq = chatStore.nextRequestSeq();
    const hadSessionId = Boolean(chatStore.aiSessionId);
    const uuid = Date.now();
    const conversationId = chatStore.aiSessionId;

    chatStore.inputText = "";
    chatStore.showQuickPrompts = false;
    chatStore.isLoading = true;

    const pendingIndex = chatStore.messages.findIndex(item => item.role === "user" && item.asrPending);
    const pendingId = pendingIndex >= 0 ? chatStore.messages[pendingIndex].id : "";
    const userMsgId = pendingId || `user-${uuid}`;
    const aiMsgId = `ai-${uuid}`;

    if (pendingIndex >= 0) {
      chatStore.patchMessageById(userMsgId, {
        content: query,
        asrPending: false,
        sessionId: conversationId,
        ...(attachments.length ? { attachments } : {}),
      });
    } else {
      chatStore.messages.push({
        id: userMsgId,
        role: "user",
        content: query,
        sessionId: conversationId,
        messageId: null,
        ...(attachments.length ? { attachments } : {}),
      });
    }
    chatStore.messages.push({
      id: aiMsgId,
      role: "ai",
      content: "",
      blocks: buildInitialBlocks(),
      loading: true,
      interrupted: false,
      sessionId: conversationId,
      messageId: null,
      ttsPlaybackMode: "realtime",
      waitingText: query,
      // 先展示过程标题，不依赖首个 Dify SSE 事件到达，避免请求初段只剩旧的等待占位。
      processStatus: { phase: "thinking" },
    });
    chatStore.activeMessageId = aiMsgId;
    chatStore.scrollToBottom(true);
    await sendAiFlow({ aiMsgId, userMsgId, content: query, files, hadSessionId, requestSeq });
  }

  /** 语音松手后立刻插入「识别中...」占位，等 ASR 回来再改成真正的问题和回答 */
  function beginAsrPlaceholder() {
    const pending = chatStore.messages.find(item => item.role === "user" && item.asrPending);
    if (pending?.id) return;
    chatStore.showQuickPrompts = false;
    chatStore.messages.push({
      id: `user-asr-${Date.now()}`,
      role: "user",
      content: t("identifying"),
      asrPending: true,
      sessionId: chatStore.aiSessionId,
      messageId: null,
    });
    chatStore.scrollToBottom(true);
  }

  function discardAsrPlaceholder() {
    const index = chatStore.messages.findIndex(item => item.role === "user" && item.asrPending);
    if (index < 0) return;
    chatStore.messages.splice(index, 1);
    if (!chatStore.messages.length) {
      chatStore.showQuickPrompts = true;
      chatStore.showQuickList = true;
    }
    chatStore.scrollToBottom(true);
  }

  function sendQuickPrompt(text: string) {
    chatStore.inputText = text;
    void sendMessage();
  }

  return {
    sendMessage,
    sendQuickPrompt,
    beginAsrPlaceholder,
    discardAsrPlaceholder,
    stopGenerating,
    cancelActiveStream,
  };
}
