import type { AskSlotSubmitPayload, ChatFile, Identifier } from "@/api/chat/types";
import type { ChatMessageAttachment } from "@/stores/chat-types";
import type {
  ReportAdjustmentAction,
  ReportNavigationAction,
  ReportWorkflowAction,
} from "@/utils/ai-stream";
import { useI18n } from "vue-i18n";
import { interruptChat, sendBlockingChatMessage } from "@/api/chat";
import { useChatStream } from "@/hooks/useChatStream";
import { useChatStore, useSessionStore, useUserStore } from "@/stores";
import { buildInitialBlocks, consumeChatStream, extractDifyHistoryBlocks, parseReportInteraction } from "@/utils/ai-stream";

/** 只发附件、没有文字时替代 query 的兜底提问（网关要求 query 非空） */
import { createLogger } from "@/utils/logger";

const logger = createLogger("chat");

type ChatScene = "ASK" | "GUIDE" | "TASK" | "PODCAST";

function isAbortError(error: unknown) {
  if (!error) return false;
  const err = error as { name?: string; message?: string };
  const name = err.name || "";
  const message = String(err.message || "").toLowerCase();
  return name === "AbortError" || message.includes("aborted") || message.includes("abort");
}

export function useChatSend(scope?: string, handlers?: {
  /** 页面明确指定的 Dify 场景；未指定时默认为 ASK。 */
  scene?: ChatScene;
  onReportQa?: (answer: string) => void;
  onReportAdjustment?: (action: ReportAdjustmentAction) => void;
  onReportNavigation?: (action: ReportNavigationAction) => void;
  onReportWorkflowAction?: (action: ReportWorkflowAction) => void;
  onReportBlockingComplete?: () => void;
  /** 页面注入的额外 Dify inputs（如作业指导页的机型选择），每次发送时现取 */
  getExtraInputs?: () => Record<string, unknown>;
  /** 听播问答的异常列表输入。 */
  getPodcastExceptions?: () => unknown[] | null;
}) {
  const { t } = useI18n();
  const chatStore = useChatStore(scope);
  const sessionStore = useSessionStore();
  const userStore = useUserStore();
  const { stream, cancel } = useChatStream({
    onError: (error) => {
      if (!isAbortError(error)) logger.error("stream request failed", error);
    },
  });

  function cancelActiveStream(markStopped = false) {
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
      chatStore.patchMessageById(activeId, {
        loading: false,
        interrupted: true,
        ...(markStopped
          ? {
              processStatus: { ...activeMessage.processStatus, phase: "stopped" as const },
              processSubtitle: null,
            }
          : {}),
      });
    }
    chatStore.activeMessageId = "";
    chatStore.isLoading = false;
  }

  function stopGenerating() {
    if (!chatStore.isLoading) return;
    cancelActiveStream(true);
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
      processSubtitle?: string | null;
      ended?: boolean;
    },
    preserveProcessStatus = false,
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
      processStatus: preserveProcessStatus ? aiMessage.processStatus : snapshot.processStatus ?? aiMessage.processStatus,
      processSubtitle: preserveProcessStatus || snapshot.processSubtitle === undefined
        ? aiMessage.processSubtitle
        : snapshot.processSubtitle,
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

  function createChatRequest(content: string, files: ChatFile[], extraInputs: Record<string, unknown> = {}) {
    const scene = handlers?.scene ?? "ASK";
    return {
      query: content,
      // Dify 要求 user 非空；游客态（未选角色 / 已清空）统一用占位标识，
      // 口径与 /files/upload、反馈接口一致。
      user: String(userStore.userId || "guest"),
      conversationId: chatStore.aiSessionId,
      inputs: scene === "PODCAST"
        ? {
            scene: "PODCAST",
            role_id: userStore.visitorRole || "guest",
            conversation_id: chatStore.aiSessionId  ?? "",
            ...(() => {
              const exceptions = handlers?.getPodcastExceptions?.();
              return exceptions ? { exceptions: JSON.stringify(exceptions) } : {};
            })(),
          }
        : {
            scene,
            ...(handlers?.getExtraInputs?.() ?? {}),
            ...extraInputs,
          },
      files,
    };
  }

  function finishRequest(aiMsgId: string, hadSessionId: boolean, requestSeq: number) {
    if (requestSeq !== chatStore.activeRequestSeq) return;
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

  async function sendAiFlow(options: {
    aiMsgId: string;
    userMsgId: string;
    content: string;
    files: ChatFile[];
    hadSessionId: boolean;
    requestSeq: number;
    extraInputs?: Record<string, unknown>;
    preserveProcessStatus?: boolean;
  }) {
    const { aiMsgId, userMsgId, content, files, hadSessionId, requestSeq, extraInputs, preserveProcessStatus } = options;
    let receivedContent = false;

    try {
      await consumeChatStream({
        source: stream(createChatRequest(content, files, extraInputs), { idleTimeoutMs: 60_000 }),
        isStale: () => requestSeq !== chatStore.activeRequestSeq,
        onSnapshot: (snapshot) => {
          receivedContent = snapshot.receivedContent;
          applySnapshot(aiMsgId, userMsgId, snapshot, preserveProcessStatus);
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
          // 与过程标题的正常结束保持一致：接口/解析异常后不能继续停在“正在思考...”。
          processStatus: { ...aiMessage.processStatus, phase: "failed" },
        });
        logger.error("stream consumption failed", error);
      }
    } finally {
      finishRequest(aiMsgId, hadSessionId, requestSeq);
    }
  }

  async function sendBlockingAiFlow(options: {
    aiMsgId: string;
    userMsgId: string;
    content: string;
    files: ChatFile[];
    hadSessionId: boolean;
    requestSeq: number;
  }) {
    const { aiMsgId, userMsgId, content, files, hadSessionId, requestSeq } = options;

    try {
      const response = await sendBlockingChatMessage(createChatRequest(content, files));
      if (requestSeq !== chatStore.activeRequestSeq) return;
      const reportInteraction = parseReportInteraction(response.answer);
      if (reportInteraction?.interactionType === "qa") {
        handlers?.onReportQa?.(reportInteraction.answer);
      }
      if (reportInteraction?.interactionType === "adjustment") {
        handlers?.onReportAdjustment?.(reportInteraction.action);
      }
      if (reportInteraction?.interactionType === "navigation") {
        handlers?.onReportNavigation?.(reportInteraction.action);
      }
      if (reportInteraction?.interactionType === "workflow") {
        handlers?.onReportWorkflowAction?.(reportInteraction.action);
      }

      applySnapshot(aiMsgId, userMsgId, {
        blocks: reportInteraction || !response.answer
          ? buildInitialBlocks()
          : extractDifyHistoryBlocks(response.answer).map((block, index) => ({
              ...block,
              id: `blocking-${block.type}-${index}`,
              complete: true,
            })),
        conversationId: response.conversationId,
        messageId: response.messageId,
        taskId: response.taskId,
        metadata: response.metadata?.elapsedTime == null
          ? undefined
          : { duration_ms: response.metadata.elapsedTime * 1000, status: "succeeded" },
        processStatus: {
          phase: "succeeded",
          elapsedSeconds: response.metadata?.elapsedTime,
        },
        ended: true,
      });
    } catch (error) {
      const index = chatStore.findMessageIndex(aiMsgId);
      const aiMessage = index >= 0 ? chatStore.messages[index] : null;
      if (aiMessage && requestSeq === chatStore.activeRequestSeq && !isAbortError(error)) {
        chatStore.patchMessageById(aiMsgId, {
          blocks: buildInitialBlocks(),
          content: t("ai-unavailable-retry-later"),
          loading: false,
          processStatus: { ...aiMessage.processStatus, phase: "failed" },
        });
        logger.error("blocking chat request failed", error);
      }
    } finally {
      if (requestSeq === chatStore.activeRequestSeq) handlers?.onReportBlockingComplete?.();
      finishRequest(aiMsgId, hadSessionId, requestSeq);
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
    const options = { aiMsgId, userMsgId, content: query, files, hadSessionId, requestSeq };
    if (handlers?.scene === "PODCAST") await sendBlockingAiFlow(options);
    else await sendAiFlow(options);
  }

  async function sendAssistantCallback(content: string, options: {
    aiMsgId?: string;
    waitingText?: string;
    preserveProcessStatus?: boolean;
  } = {}) {
    const query = String(content || "").trim();
    if (!query) return;

    cancelActiveStream();
    const requestSeq = chatStore.nextRequestSeq();
    const hadSessionId = Boolean(chatStore.aiSessionId);
    const aiMsgId = options.aiMsgId || `assistant-callback-${Date.now()}`;
    const conversationId = chatStore.aiSessionId;

    chatStore.showQuickPrompts = false;
    chatStore.isLoading = true;
    if (chatStore.findMessageIndex(aiMsgId) < 0) {
      chatStore.messages.push({
        id: aiMsgId,
        role: "ai",
        content: "",
        blocks: buildInitialBlocks(),
        loading: true,
        interrupted: false,
        sessionId: conversationId,
        messageId: null,
        waitingText: options.waitingText || "维修助手-快速问答",
        processStatus: { phase: "thinking" },
      });
    }
    chatStore.activeMessageId = aiMsgId;
    chatStore.scrollToBottom(true);

    await sendAiFlow({
      aiMsgId,
      userMsgId: "",
      content: query,
      files: [],
      hadSessionId,
      requestSeq,
      extraInputs: { entry_type: "assistant_callback" },
      preserveProcessStatus: options.preserveProcessStatus,
    });
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

  function buildAskSlotQuery(payload: AskSlotSubmitPayload) {
    const originalQuery = payload.slot.original_query.trim();
    const selectedValues = payload.selectedOptions
      .map(option => option.value.trim())
      .filter(Boolean);
    // 「其他输入」填的自定义内容也算作答，跟选项一起按「、」拼进提问
    const remark = String(payload.remark || "").trim();
    const answer = [selectedValues.join("、"), remark].filter(Boolean).join("、");
    return [originalQuery, answer].filter(Boolean).join("：");
  }

  function sendAskSlotSelection(payload: AskSlotSubmitPayload) {
    const query = buildAskSlotQuery(payload);
    if (query) void sendMessage({ text: query });
  }

  return {
    sendMessage,
    sendQuickPrompt,
    sendAskSlotSelection,
    sendAssistantCallback,
    beginAsrPlaceholder,
    discardAsrPlaceholder,
    stopGenerating,
    cancelActiveStream,
  };
}
