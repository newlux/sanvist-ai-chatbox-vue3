import type { AskSlotSubmitPayload, ChatFile, Identifier } from "@/api/chat/types";
import type { ChatMessageAttachment } from "@/stores/chat-types";
import type {
  ReportAdjustmentAction,
  ReportNavigationAction,
  ReportWorkflowAction,
} from "@/utils/ai-stream";
import { useI18n } from "vue-i18n";
import { interruptChat } from "@/api/chat";
import { useChatStream } from "@/hooks/useChatStream";
import { useChatStore, useSessionStore, useUserStore } from "@/stores";
import { buildInitialBlocks, consumeChatStream, parseReportInteraction } from "@/utils/ai-stream";

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
  /**
   * 页面明确指定的 Dify 场景；未指定时默认为 ASK。
   * 传函数时每次发送现取：听播页会按「普通播报问答 / 异常列表语音操作」切换场景。
   */
  scene?: ChatScene | (() => ChatScene);
  onReportQa?: (answer: string) => void;
  onReportAdjustment?: (action: ReportAdjustmentAction) => void;
  onReportNavigation?: (action: ReportNavigationAction) => void;
  onReportWorkflowAction?: (action: ReportWorkflowAction) => void;
  onReportBlockingComplete?: () => void;
  /**
   * AI 消息回答完成（snapshot.ended = true，且非 interrupted）时回调一次。
   * 由页面用来在普通问答场景触发自动听播；不传则不触发。
   */
  onAiMessageComplete?: (info: { aiMsgId: string; messageId: Identifier; sessionId: Identifier | null }) => void;
  /**
   * 普通问答场景：答案文字流式渲染期间持续回调，文字开始出现就触发（不等 message_end /
   * workflow_finished）。delta 为本次新增的答案文本；流结束（含异常/中止收尾）时以
   * ended: true 收尾一次。页面用它实现「文字开始渲染就起听播」的流式 TTS。
   */
  onAiAnswerDelta?: (info: { aiMsgId: string; delta: string; ended: boolean }) => void;
  /** 页面注入的额外 Dify inputs（如作业指导页的机型选择），每次发送时现取 */
  getExtraInputs?: () => Record<string, unknown>;
  /** 听播问答的异常列表输入。 */
  getPodcastExceptions?: () => unknown[] | null;
  /**
   * 发送时是否强制把对话列表滚到底部。默认 true（普通问答场景需要）。
   * 作业指导这类「核对卡顶到对话区最上方」的页面传 false：发送后保留当前阅读位置，
   * 由卡片置顶逻辑（focusStepBlock）把新出现的核对卡滚到顶部，不再被强制拽到底部。
   */
  keepScrollOnSend?: boolean;
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

  /** 已回调过 onAiMessageComplete 的 aiMsgId，避免重入/重发。 */
  const notifiedCompletedAiIds = new Set<string>();

  /** 每次发送时现取场景：页面可以按当前所处视图决定走哪套后端分支。 */
  function resolveScene(): ChatScene {
    const value = handlers?.scene;
    return (typeof value === "function" ? value() : value) ?? "ASK";
  }

  /**
   * 听播问答链路：页面挂了汇报问答出口（onReportQa）时，这一轮答案一律从该出口交付
   * （协议体派发动作 / 纯文本兜底当 qa 答案）。与 scene 解耦——听播页可能按视图下发
   * ASK 或 PODCAST，但答案都要回播报页。
   */
  const usesReportAnswerOutlet = Boolean(handlers?.onReportQa);

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

    // 仅在「真正答完一轮」时通知一次：避免中间 snapshot 重入；status=stopped 视作被打断，不算完成。
    if (
      snapshot.ended
      && snapshot.metadata?.status !== "stopped"
      && (snapshot.conversationId ?? aiMessage.sessionId)
      && (snapshot.messageId ?? aiMessage.messageId)
      && !notifiedCompletedAiIds.has(aiMsgId)
    ) {
      notifiedCompletedAiIds.add(aiMsgId);
      handlers?.onAiMessageComplete?.({
        aiMsgId,
        messageId: snapshot.messageId ?? aiMessage.messageId,
        sessionId: snapshot.conversationId ?? aiMessage.sessionId,
      });
    }
  }

  function createChatRequest(content: string, files: ChatFile[], extraInputs: Record<string, unknown> = {}) {
    const scene = resolveScene();
    return {
      query: content,
      // Dify 要求 user 非空；游客态（未选角色 / 已清空）统一用占位标识，
      // 口径与 /files/upload、反馈接口一致。
      user: String(userStore.userId || "guest"),
      conversationId: chatStore.aiSessionId,
      // 听播问答与首页问答的 inputs 口径保持一致：只带场景，会话上下文交给顶层
      // conversation_id / 会话 user 承载，不再重复下发。
      // 听播独有的 exceptions（从异常列表发起时携带）保留，其他场景原样透传扩展入参。
      inputs: scene === "PODCAST"
        ? {
            scene: "PODCAST",
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
    /** 当前请求里已通知过 onAiAnswerDelta 的答案文本长度，用于计算增量。 */
    let lastSeenAnswerLength = 0;
    /** 是否已发过 ended: true 的收尾通知，避免重入。 */
    let answerDeltaEnded = false;
    /** PODCAST：聚合流式答案正文，流结束后按汇报交互协议派发。 */
    let podcastAnswer = "";

    /** 把答案增量通知给页面（首块即触发，不等 message_end / workflow_finished）。 */
    function notifyAnswerDelta(delta: string, ended: boolean) {
      if (!handlers?.onAiAnswerDelta) return;
      if (ended) {
        if (answerDeltaEnded) return;
        answerDeltaEnded = true;
      }
      handlers.onAiAnswerDelta({ aiMsgId, delta, ended });
    }

    try {
      await consumeChatStream({
        source: stream(createChatRequest(content, files, extraInputs), { idleTimeoutMs: 60_000 }),
        isStale: () => requestSeq !== chatStore.activeRequestSeq,
        onSnapshot: (snapshot) => {
          receivedContent = snapshot.receivedContent;
          applySnapshot(aiMsgId, userMsgId, snapshot, preserveProcessStatus);

          // 听播问答：与首页共用同一条流式接口（/proxy/v1/chat-messages + streaming），
          // 这里只聚合答案正文，流结束后按汇报交互协议解析后交给播报页（自己的 TTS 出口）。
          if (usesReportAnswerOutlet) {
            podcastAnswer = snapshot.blocks
              .filter(block => block.type === "answer")
              .map(block => String(block.payload?.content || ""))
              .join("");
          }
          // 普通问答：答案文字边流边播。每收到新的一块 answer 文本就增量通知页面，
          // 页面在第一块文字渲染出来的瞬间就可以起听播，后续文字持续续播。
          // 聚合全部 answer 块（而非只取第一块）：answer 中途穿插了别的块时，
          // 只取第一块会让后半段文字永远收不到增量、听播漏播。
          else if (handlers?.onAiAnswerDelta) {
            const answerContent = snapshot.blocks
              .filter(block => block.type === "answer")
              .map(block => String(block.payload?.content || ""))
              .join("");
            if (answerContent.length > lastSeenAnswerLength) {
              notifyAnswerDelta(answerContent.slice(lastSeenAnswerLength), false);
              lastSeenAnswerLength = answerContent.length;
            }
            if (snapshot.ended) notifyAnswerDelta("", true);
          }
        },
      });
      // 听播问答：流正常收尾后把答案交给播报页，出口与原来的阻塞链路保持一致；
      // 已被新一轮请求 / 停止操作取代时不派发，避免过期答案串到播报页。
      if (usesReportAnswerOutlet && requestSeq === chatStore.activeRequestSeq) {
        applyPodcastAnswer(aiMsgId, podcastAnswer);
      }
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
      // 流异常 / 被取消时也补一次 ended 收尾，避免页面的流式听播会话一直挂着 loading 态。
      if (lastSeenAnswerLength > 0) notifyAnswerDelta("", true);
      // 本轮听播问答收尾（含异常 / 取消）：播报页据此关掉「正在理解」或退回异常列表。
      if (usesReportAnswerOutlet && requestSeq === chatStore.activeRequestSeq) {
        handlers?.onReportBlockingComplete?.();
      }
      finishRequest(aiMsgId, hadSessionId, requestSeq);
    }
  }

  /**
   * 听播问答的答案出口：整轮答案已经在流式链路里聚合完，这里按汇报交互协议解析后派发。
   *
   * 与原阻塞链路的出口语义一致：
   * - 协议体（<PODCAST>{...}</PODCAST> 交互体）只用于派发动作，不落到消息列表；
   * - 显式协议体但解析不出来时什么都不给，绝不把 JSON 当答案念出来；
   * - 其余纯文本兜底当作 qa 答案返回，避免换了接口后正文被丢掉。
   */
  function applyPodcastAnswer(aiMsgId: string, answer: string) {
    const text = String(answer || "").trim();
    if (!text) return;

    const reportInteraction = parseReportInteraction(text);
    if (!reportInteraction) {
      if (text.startsWith("{") || /^<PODCAST>/i.test(text)) {
        logger.warn("unparsable podcast interaction payload", { length: text.length });
        return;
      }
      handlers?.onReportQa?.(text);
      return;
    }

    if (reportInteraction.interactionType === "qa") {
      handlers?.onReportQa?.(reportInteraction.answer);
    }
    if (reportInteraction.interactionType === "adjustment") {
      handlers?.onReportAdjustment?.(reportInteraction.action);
    }
    if (reportInteraction.interactionType === "navigation") {
      handlers?.onReportNavigation?.(reportInteraction.action);
    }
    if (reportInteraction.interactionType === "workflow") {
      handlers?.onReportWorkflowAction?.(reportInteraction.action);
    }
    // 协议体不进消息列表：历史会话里只看得到普通回答。
    chatStore.patchMessageById(aiMsgId, { blocks: buildInitialBlocks() });
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
    // 作业指导等页面要求发送后保留阅读位置（不强制回底），由卡片置顶逻辑接管滚动
    if (!handlers?.keepScrollOnSend) chatStore.scrollToBottom(true);
    const options = { aiMsgId, userMsgId, content: query, files, hadSessionId, requestSeq };
    // 听播问答与首页问答共用同一条流式接口，场景差异只体现在 inputs 与答案出口上。
    await sendAiFlow(options);
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
    // 作业指导等页面：发送不强制回底，语音占位同样不拽到底部
    if (!handlers?.keepScrollOnSend) chatStore.scrollToBottom(true);
  }

  function discardAsrPlaceholder() {
    const index = chatStore.messages.findIndex(item => item.role === "user" && item.asrPending);
    if (index < 0) return;
    chatStore.messages.splice(index, 1);
    if (!chatStore.messages.length) {
      chatStore.showQuickPrompts = true;
      chatStore.showQuickList = true;
    }
    if (!handlers?.keepScrollOnSend) chatStore.scrollToBottom(true);
  }

  function sendQuickPrompt(text: string) {
    chatStore.inputText = text;
    void sendMessage();
  }

  function buildAskSlotQuery(payload: AskSlotSubmitPayload) {
    // 作业协同多步骤表单：按题目顺序拼「Q1: 问题，A1: 回答；Q2: …」
    const answers = Array.isArray(payload.answers) ? payload.answers : [];
    if (answers.length) {
      return answers
        .map((item, index) => `Q${index + 1}: ${item.question}，A${index + 1}: ${item.answer}`)
        .join("；");
    }

    const originalQuery = payload.slot.original_query.trim();
    // 选项一律取 label 回发：value 是业务编码（如 time / space），对话里要给用户看得懂的文案
    const selectedLabels = payload.selectedOptions
      .map(option => String(option.label || option.value).trim())
      .filter(Boolean);
    // 「其他输入」填的自定义内容也算作答，跟选项一起按「、」拼进提问
    const remark = String(payload.remark || "").trim();
    const answer = [selectedLabels.join("、"), remark].filter(Boolean).join("、");
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
