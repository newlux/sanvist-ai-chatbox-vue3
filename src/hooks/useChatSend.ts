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
import { saveReportStyleCode } from "@/hooks/useReportStyle";
import { markReportVoiceSyncing, saveReportVoiceByStyle } from "@/hooks/useReportVoice";
import { useChatStore, useSessionStore, useSettingsStore, useUserStore } from "@/stores";
import { buildInitialBlocks, consumeChatStream, parseReportInteraction, parseReportStyleTag, parseRoleTaggedAnswer, parseVoiceStyleTag, parseWorkReportTag } from "@/utils/ai-stream";

import { createLogger } from "@/utils/logger";
import { navigateToScene } from "@/utils/scene-navigation";

const logger = createLogger("chat");

/** TEST 是任务协同当前下发的场景标识（TASK 是早期标识，历史会话仍按任务协同归类，见 utils/session-scene） */
type ChatScene = "ASK" | "GUIDE" | "TASK" | "TEST" | "PODCAST";

function isAbortError(error: unknown) {
  if (!error) return false;
  const err = error as { name?: string; message?: string };
  const name = err.name || "";
  const message = String(err.message || "").toLowerCase();
  return name === "AbortError" || message.includes("aborted") || message.includes("abort");
}

/** 老写法：整段回答就是这个占位文本 "QRCODE"，不是给人看的回答 */
const QRCODE_ANSWER_PLACEHOLDER = "QRCODE";
/** 新写法：<QRCODE>正文</QRCODE>。标签用来判定，尖括号里的正文是给用户看的气泡文案 */
const QRCODE_TAG_OPEN = "<QRCODE>";
const QRCODE_TAG_CLOSE = "</QRCODE>";
/** 占位文本的前缀：流式期间答案还没长全（"Q"、"QR"…），前缀期先按住不播 */
const QRCODE_PLACEHOLDER_PREFIX = /^q(?:r(?:c(?:o(?:de?)?)?)?)?$/i;
/** 二维码页路由（pages/qrcode/index） */
const QRCODE_PAGE_ROUTE = "/pages/qrcode/index";
/**
 * 工作流 `workflow_finished` 下发的跳转目标（target）→ 站内助手页。
 * 只认这两个：作业指导 / 任务协同；其余取值不跳转（避免被无关工作流带去别的页面）。
 */
const ASSISTANT_TARGET_ROUTES: Record<string, string> = {
  work_guidance_assistant: "/pages/guide/index",
  task_coordination_assistant: "/pages/task/index",
};

interface QrcodeMetadata {
  qrcode?: boolean | string;
  qrcode_content?: string;
  outputs_answer?: string;
  status?: string;
}

/** 整段回答就是占位文本 "QRCODE" */
function isQrcodePlaceholder(text: string) {
  return text.trim().toLowerCase() === QRCODE_ANSWER_PLACEHOLDER.toLowerCase();
}

/** 还可能是占位文本的前缀（流式期间），此时先不要播出去 */
function isQrcodePlaceholderPrefix(text: string) {
  return QRCODE_PLACEHOLDER_PREFIX.test(text.trim());
}

/**
 * 解析 <QRCODE>正文</QRCODE>。
 *
 * 流式期间正文是边到边解析的：开标签还没收完（"<"、"<QR"…）按空正文算，
 * 闭合标签还没到就先把已有的正文拿出来。不是这种写法返回 null（含老写法的纯 "QRCODE"）。
 */
function parseQrcodeTaggedAnswer(text: string) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const open = QRCODE_TAG_OPEN.toLowerCase();
  if (raw.length < open.length && open.startsWith(lower)) return { text: "", closed: false };
  if (!lower.startsWith(open)) return null;
  const body = raw.slice(open.length);
  const closeIndex = body.toLowerCase().indexOf(QRCODE_TAG_CLOSE.toLowerCase());
  return {
    text: (closeIndex >= 0 ? body.slice(0, closeIndex) : body).trim(),
    closed: closeIndex >= 0,
  };
}

/**
 * 判定这一轮是不是二维码回答，并取出「气泡文案」与「二维码编码内容」。
 *
 * 两种写法都认：
 *  - 老写法：`outputs.answer` 整段就是占位文本 "QRCODE"（没有给人看的文案，气泡不显示）
 *  - 新写法：`<QRCODE>正文</QRCODE>`，标签用来判定，尖括号里的正文进气泡
 * 二维码的编码内容只认 metadata（`qrcode` 字符串 / `qrcode_content`），标签正文只是文案。
 */
function resolveQrcodeTurn(
  blocks: ReturnType<typeof buildInitialBlocks>,
  metadata?: QrcodeMetadata,
  ended = false,
) {
  const flag = metadata?.qrcode;
  const content = (typeof flag === "string" ? flag : String(metadata?.qrcode_content ?? "")).trim();
  // 答案正文优先；工作流只在 workflow_finished.outputs.answer 给答案时用它兜底
  const answerText = collectAnswerText(blocks).trim() || String(metadata?.outputs_answer ?? "").trim();
  // 失败 / 中断轮的正文不带占位语义，只有正常结束才跳转
  const stopped = metadata?.status === "stopped" || metadata?.status === "failed";
  const tagged = parseQrcodeTaggedAnswer(answerText);
  const isPlaceholder = ended && !stopped && isQrcodePlaceholder(answerText);
  // 标签写法：等闭合标签到齐（或整轮结束）再跳，流式早期不跳，免得气泡还没拿到正文就开页
  const isTagged = Boolean(tagged) && !stopped && (Boolean(tagged?.closed) || ended);
  // metadata 下发标记的老路子：已经出现正文（或整轮结束）再跳，避免正文还在路上就把气泡收掉；
  // 一旦认出是标签写法就改走上面的分支，不受标记提前触发
  const isFlagged = Boolean(flag) && !tagged && (Boolean(answerText) || ended);
  return {
    matched: isTagged || isPlaceholder || isFlagged,
    /** 尖括号里的正文：气泡显示它 */
    text: tagged?.text ?? "",
    /** 是不是标签写法（流式早期也算）：这一轮不进听播，气泡也要摘掉标签 */
    tagged: Boolean(tagged),
    /** 二维码的编码内容：只来自 metadata，没有就由二维码页回落到默认下载地址 */
    content,
  };
}

/**
 * 从 answer 正文里剔除 voice 导语（与 AiContentBlocks 渲染层同一口径）：
 * 同一句导语后端既下发给 voice 块，又可能重复写进正文 answer 开头。
 * 播报时 answer 剔除导语、再补 voice 文本，整段 = 导语 + 正文，各念一遍不重复。
 */
function stripVoiceFromAnswer(content: string, voiceText: string): string {
  const voice = String(voiceText || "").trim();
  if (!voice) return content;
  const index = content.indexOf(voice);
  if (index < 0) return content;
  const after = content.slice(index + voice.length).replace(/^\n+/, "");
  return `${content.slice(0, index)}${after}`.trim();
}

/** 把快照里的 answer / voice 块拼成整段播报文本：导语（voice）在前，answer 剔除重复导语后接正文 */
function collectAnswerText(blocks: ReturnType<typeof buildInitialBlocks>) {
  const voiceText = blocks
    .filter(block => block.type === "voice")
    .map(block => String(block.payload?.text || ""))
    .join("");
  return voiceText + blocks
    .filter(block => block.type === "answer")
    .map(block => stripVoiceFromAnswer(String(block.payload?.content || ""), voiceText))
    .join("");
}

/**
 * 把气泡里的答案正文换成标签正文（<QRCODE> 与 <OWNER> 这类标签共用）。
 * 标签源码不能落到气泡里，正文统一放在第一段 answer 上，其余 answer 清空。
 */
function withAnswerText(blocks: ReturnType<typeof buildInitialBlocks>, text: string) {
  let placed = false;
  return blocks.map((block) => {
    if (block.type !== "answer") return block;
    const content = placed ? "" : text;
    placed = true;
    return { ...block, payload: { ...block.payload, content } };
  });
}

/**
 * 身份切换标签 `<OWNER>…</OWNER>`：取出角色码，并把标签源码从正文里摘掉。
 * tagged 为 true 说明这一拍的正文被改写过，需要写回消息块（否则气泡里会露出尖括号）。
 */
function resolveRoleTagTurn(blocks: ReturnType<typeof buildInitialBlocks>) {
  const answerText = collectAnswerText(blocks);
  const parsed = parseRoleTaggedAnswer(answerText);
  return {
    role: parsed.role,
    text: parsed.text,
    tagged: answerText !== parsed.text,
  };
}

/**
 * 听汇报标签 `<WORK_REPORT date="…" language="…">正文</WORK_REPORT>`：
 * 取出日期与播报语言，并把标签源码摘掉。
 * matched/closed 决定要不要补「听汇报」入口卡（不跳页），tagged 只表示这一拍正文被改写过。
 */
function resolveWorkReportTurn(blocks: ReturnType<typeof buildInitialBlocks>) {
  const answerText = collectAnswerText(blocks);
  const parsed = parseWorkReportTag(answerText);
  return {
    matched: parsed.matched,
    closed: parsed.closed,
    date: parsed.date,
    language: parsed.language,
    text: parsed.text,
    tagged: answerText !== parsed.text,
  };
}

/**
 * 音色切换标签 `<VOICE_STYLE style="…">正文</VOICE_STYLE>`：取出 style 里的音色值，并把标签源码摘掉。
 * tagged 只表示这一拍正文被改写过；音色值拿到就落库（不等闭合标签，与身份标签同一口径）。
 */
function resolveVoiceStyleTurn(blocks: ReturnType<typeof buildInitialBlocks>) {
  const answerText = collectAnswerText(blocks);
  const parsed = parseVoiceStyleTag(answerText);
  return {
    matched: parsed.matched,
    style: parsed.style,
    text: parsed.text,
    tagged: answerText !== parsed.text,
  };
}

/**
 * 播报风格标签 `<REPORT_STYLE style="…">正文</REPORT_STYLE>`：取出 style 里的风格码，并把标签源码摘掉。
 * 风格码落进「听播风格」的同一份存储，下次播报按它作为 styleCode 传值（音色仍取最新音色）。
 */
function resolveReportStyleTurn(blocks: ReturnType<typeof buildInitialBlocks>) {
  const answerText = collectAnswerText(blocks);
  const parsed = parseReportStyleTag(answerText);
  return {
    matched: parsed.matched,
    style: parsed.style,
    text: parsed.text,
    tagged: answerText !== parsed.text,
  };
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
  /**
   * 二维码占位回答（message_end.metadata.qrcode）：这一轮已经直接开二维码页，
   * 页面需要自定义跳转 / 埋点时接管这个回调，不传则内置 uni.navigateTo 打开二维码页。
   */
  onQrcodeAnswer?: (info: { aiMsgId: string; content: string }) => void;
  /**
   * 过程小标题变化时回调（/v1/chat-messages 的 subtitle 事件，如「目标 Dify 工作流已开始。」）。
   * 页面用于在自定义思考态里展示接口下发的进度文案；流结束时回调 null。
   */
  onProcessSubtitle?: (subtitle: string | null) => void;
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
  /**
   * 发送后把这一条用户消息顶到对话区上方（悬浮头部下沿），本轮回合内不再贴底跟随。
   * 首页普通问答开启：长回答一路往下写、不把用户拽到底部；
   * 作业指导 / 任务协同不传，行为保持原样（发送即回底）。
   */
  alignSentMessageToTop?: boolean;
  /**
   * 配合 alignSentMessageToTop：发送后**立刻**把这条提问顶到头部下沿（不等回答变长）。
   * 首页开启 —— 每次提问都落在同一个位置，历史内容往上顶走；
   * 作业指导 / 任务协同不传，仍是「发送回底、回答变长后由 capRoundAtTop 收住」。
   */
  pinOnSend?: boolean;
}) {
  const { t } = useI18n();
  const chatStore = useChatStore(scope);
  const sessionStore = useSessionStore();
  const userStore = useUserStore();
  const settingsStore = useSettingsStore();
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

  /**
   * 消息入列后的定位：
   * - 首页这类开了 alignSentMessageToTop 的页面：只登记本轮的提问 id（消息列表据此加大顶部呼吸位），
   *   滚动从底部起步、边写边贴底跟随，提问顶到头部下沿就停住（上限在消息列表的 alignToReplyEnd 里）；
   * - 其它页面：保持原来的「发送即强制回底」（作业指导另有 keepScrollOnSend 保留阅读位置）。
   */
  function alignAfterUserMessage(userMsgId: string) {
    if (handlers?.alignSentMessageToTop) {
      chatStore.setPinnedToBottom(true);
      chatStore.setPinMessage(userMsgId);
      chatStore.setCapRoundAtTop(true);
      // pinOnSend 的页面（首页）：发送后立刻把提问顶到头部下沿，每次提问都落在同一个位置，
      // 历史内容往上走，回答再从它下面长出来（capRoundAtTop 保证回答再长也不把提问推出屏幕）
      if (handlers.pinOnSend) {
        chatStore.pinMessageToTop(userMsgId);
        return;
      }
      // 其余页面：发送即回底，等回答变长后由 capRoundAtTop 收住
      chatStore.scrollToBottom(true);
      return;
    }
    if (!handlers?.keepScrollOnSend) chatStore.scrollToBottom(true);
  }

  /**
   * 过程小标题的「空白不覆盖」策略。
   *
   * 快收尾时接口会补一条空 subtitle（message_end 清场），而那一拍回答气泡往往还没渲染出来：
   * 用空文案顶掉上一句，思考态下面那行字就会突然空白一下。所以空白一律跳过、沿用上一句，
   * 等这一轮真正收尾（finishRequest）再统一清掉。
   */
  function keepLastProcessSubtitle(next: string | null | undefined, previous: string | null | undefined) {
    if (next === undefined) return previous;
    const text = typeof next === "string" ? next.trim() : "";
    return text || previous;
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
    skipComplete = false,
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
      processSubtitle: preserveProcessStatus
        ? aiMessage.processSubtitle
        : keepLastProcessSubtitle(snapshot.processSubtitle, aiMessage.processSubtitle),
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
      !skipComplete
      && snapshot.ended
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
    // 收尾这一拍才把过程小标题清掉：气泡已经渲染出来，思考态正要退场，
    // 中间那些空 subtitle（message_end 清场）不覆盖上一句，避免思考态闪一下空白
    chatStore.patchMessageById(aiMsgId, { loading: false, processSubtitle: null });
    chatStore.isLoading = false;
    chatStore.activeMessageId = "";
    // 这一下在「顶到上方」模式下会被跳过（不主动跳底）。
    //
    // 注意：这里**不能**顺手把模式关掉。回答正文写完后，图表 / 表格 / 图片还要再晚一步
    // 才撑开高度，那时会再来一次 content-grow → scrollToBottom；只要此处把模式关了，
    // 这一次就会把整整一屏内容拽到底部（表现就是长回答直接跳到末尾那张表）。
    // 模式一直保留到本轮对话结束（换会话 / 新对话 / 重新发问时复位），本页从此不再自动贴底。
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
    /** 二维码占位回答已经开过二维码页：避免同一轮重复跳转，也用来跳过听播出口。 */
    let qrcodeHandled = false;
    /** 工作流跳转目标已经切过页：避免同一轮重复跳转。 */
    let assistantSceneHandled = false;
    /** 本轮已经落过的音色标签值：标签会随每一拍快照重复出现，只处理第一次 */
    let appliedVoiceStyle = "";
    /** 本轮已经执行过的语言切换指令：同样随快照重复出现，只处理第一次 */
    let appliedLanguageSwitch = "";

    /**
     * 音色切换标签落库：本机存储 + `/settings.voiceCode` 两处都写。
     *
     * 只写本机存储的话，服务端合成仍按 `/settings` 里的 voiceCode 取音色，
     * 听感上就是「说了切换音色但没切」；反过来只写服务端，听播页 / 内嵌页读本机存储的那几处又对不上。
     * 两处写同一个值（saveReportVoiceByStyle 返回最终生效的音色码）。
     */
    function applyVoiceStyle(styleValue: string) {
      if (!styleValue || styleValue === appliedVoiceStyle) return;
      const voiceCode = saveReportVoiceByStyle(styleValue);
      if (!voiceCode) return;
      appliedVoiceStyle = styleValue;
      logger.info("[chat] voice style switched by answer tag", { style: styleValue, voiceCode });
      if (settingsStore.voiceCode === voiceCode) return;
      // 先改本地（下一句 TTS 立刻用新音色），再落服务端；失败由 store 自己回滚
      settingsStore.voiceCode = voiceCode;
      /**
       * 这次保存要登记一下：合成只认服务端的 voiceCode，
       * 标签里那句「已切换为…」的确认播报会紧接着发请求，必须等保存落地才用新音色
       * （见 useReportVoice 的 waitReportVoiceSynced）。
       */
      markReportVoiceSyncing(settingsStore.save({ voiceCode }));
    }

    /**
     * 语言切换指令：`<COMPONENT>{"scene":"ask","type":"language_switch","data":{"language":"en"}}</COMPONENT>`。
     *
     * 与设置弹层「语言」分段同一套写入口径，所以走 `settingsStore.setLanguage`：
     * - `systemStore.setLanguage` 切 i18n 全局 locale（界面文案立即变英文 / 中文），
     *   同时改 header 的 `Lang` / `X-Site-Language` —— 设置弹层语言分段读的就是这份，跟着一起变；
     * - `save({ language })` 打 `PUT /settings` 落库（服务端按语言生成后续回答）。
     *
     * 同一轮里指令会随每一拍快照重复出现，只处理第一次；未知语言值直接忽略。
     */
    function applyLanguageSwitch(language: string) {
      const code = String(language || "").trim().toLowerCase();
      if (!code || code === appliedLanguageSwitch) return;
      const target = code === "en" ? "en_US" : code === "zh" ? "zh_CN" : "";
      if (!target) return;
      appliedLanguageSwitch = code;
      logger.info("[chat] language switched by component", { language: code });
      void settingsStore.setLanguage(target);
    }

    /** 把答案增量通知给页面（首块即触发，不等 message_end / workflow_finished）。 */
    function notifyAnswerDelta(delta: string, ended: boolean) {
      if (!handlers?.onAiAnswerDelta) return;
      if (ended) {
        if (answerDeltaEnded) return;
        answerDeltaEnded = true;
      }
      handlers.onAiAnswerDelta({ aiMsgId, delta, ended });
    }

    /**
     * 二维码回答的收尾：打开二维码页。
     * 跳转与其它页面保持一致走 navigateToScene（mPaaS 下开新场景窗口，Web 下退化为 navigateTo）。
     * 二维码的编码内容来自 metadata（qrcode 字符串 / qrcode_content）；
     * 新写法 <QRCODE>正文</QRCODE> 的正文留在气泡里正常展示，老写法的纯占位 "QRCODE" 不出气泡。
     */
    function openQrcodePage(turn: { content: string; text: string }) {
      if (qrcodeHandled) return;
      qrcodeHandled = true;
      logger.debug("qrcode answer detected", { aiMsgId, content: turn.content, text: turn.text });
      if (turn.text) {
        // 标签里带了给人看的文案：这条 AI 卡片要显示，只收掉加载态与听播
        chatStore.patchMessageById(aiMsgId, {
          hidden: false,
          loading: false,
          ttsEnabled: false,
          ttsPlaying: false,
          processStatus: { phase: "succeeded" },
        });
      }
      else {
        // 老写法：整段回答只有占位文本 "QRCODE"，这一轮不出气泡
        chatStore.patchMessageById(aiMsgId, {
          hidden: true,
          loading: false,
          content: "",
          blocks: buildInitialBlocks(),
          ttsEnabled: false,
          ttsPlaying: false,
          processStatus: { phase: "succeeded" },
        });
      }
      if (handlers?.onQrcodeAnswer) {
        handlers.onQrcodeAnswer({ aiMsgId, content: turn.content });
        return;
      }
      const url = turn.content
        ? `${QRCODE_PAGE_ROUTE}?content=${encodeURIComponent(turn.content)}`
        : QRCODE_PAGE_ROUTE;
      void navigateToScene(url).catch(error => logger.error("failed to open qrcode page", error));
    }

    /**
     * 听汇报标签的收尾：**不再自动跳播报页**，改成在气泡里补一张「听汇报」入口卡
     * （设计稿 479:384），点卡片才跳（跳转逻辑在卡片内，见 utils/listen-report）。
     *
     * 卡片随标签闭合（或整轮结束）出现，date / language 挂在 payload 上；
     * 标签会随每一拍快照出现，这里按 type 幂等追加，不会堆出一排卡。
     */
    function withReportCard(
      blocks: ReturnType<typeof buildInitialBlocks>,
      turn: { date: string; language?: string },
    ) {
      if (blocks.some(block => block?.type === "report-card")) return blocks;
      return [
        ...blocks,
        {
          id: `report-card-${turn.date || "current"}`,
          type: "report-card" as const,
          payload: { date: turn.date, language: turn.language || "" },
          complete: true,
        },
      ];
    }

    /**
     * 工作流结束事件（workflow_finished）带上跳转目标时的收尾：直接切到对应助手页。
     *
     * 与其它页面跳转一致走 navigateToScene（mPaaS 下开新场景窗口，Web 下退化为 navigateTo）。
     * 已经停在目标页时不重复跳自己；同一轮只处理一次。
     *
     * @returns 是否已经触发跳转，调用方据此跳过本轮后续的听播出口
     */
    function openAssistantScene(target?: string) {
      const route = ASSISTANT_TARGET_ROUTES[String(target || "").trim()];
      if (!route || assistantSceneHandled) return false;
      assistantSceneHandled = true;
      const pages = getCurrentPages();
      const current = pages[pages.length - 1];
      if (current && `/${String(current.route || "")}` === route) return false;
      logger.info("[chat] assistant target switched scene", { target, route });
      void navigateToScene(route).catch(error => logger.error("failed to open assistant scene", error));
      return true;
    }

    try {
      await consumeChatStream({
        source: stream(createChatRequest(content, files, extraInputs), { idleTimeoutMs: 60_000 }),
        isStale: () => requestSeq !== chatStore.activeRequestSeq,
        onSnapshot: (snapshot) => {
          receivedContent = snapshot.receivedContent;
          // 二维码回答：老写法「整段 == QRCODE」不出气泡直接跳；新写法 <QRCODE>正文</QRCODE>
          // 保留气泡并展示尖括号里的正文，两种写法都会跳到二维码页。
          const qrcodeTurn = resolveQrcodeTurn(snapshot.blocks, snapshot.metadata, snapshot.ended);
          // 标签源码不落到气泡里：先把 answer 正文换成标签正文再写入消息
          let displayBlocks = qrcodeTurn.tagged
            ? withAnswerText(snapshot.blocks, qrcodeTurn.text)
            : snapshot.blocks;
          /**
           * 身份切换标签 `<OWNER>…</OWNER>`（OWNER 老板 / ADMIN 设备管理员 / OPERATOR 操作手）：
           * 正文去掉标签，只留尖括号里的提示文字；角色码落到 userStore ——
           * setVisitorRole 会写 uni storage（visitor_role），Guest-Role 请求头由 App.vue 对
           * visitorRole 的 watch（flush: "sync"）在同一拍同步，这里不重复调 setGuestRole。
           */
          const roleTurn = resolveRoleTagTurn(displayBlocks);
          if (roleTurn.role && userStore.visitorRole !== roleTurn.role) {
            userStore.setVisitorRole(roleTurn.role);
            logger.info("[chat] visitor role switched by answer tag", roleTurn.role);
          }
          if (roleTurn.tagged) displayBlocks = withAnswerText(displayBlocks, roleTurn.text);

          /**
           * 听汇报标签 `<WORK_REPORT date="…">正文</WORK_REPORT>`：
           * 正文留在气泡里，date / language 交给下面追加的「听汇报」入口卡；
           * 这一轮不再自动跳播报页，等用户点卡片才跳。
           */
          const reportTurn = resolveWorkReportTurn(displayBlocks);
          if (reportTurn.tagged) displayBlocks = withAnswerText(displayBlocks, reportTurn.text);

          /**
           * 音色切换标签 `<VOICE_STYLE style="…">正文</VOICE_STYLE>`：
           * 正文留在气泡里，style 属性里的音色值按听播音色的同一份存储写进去
           * （saveReportVoiceByStyle：先按音色 id、再按性格标签匹配 REPORT_VOICE_OPTIONS）。
           * 开标签到齐即落库，不等闭合标签；标签源码不进气泡，也不会被流式听播念出来
           * （下面的听播增量取的就是 displaySnapshot 里剥完标签的正文）。
           */
          const voiceStyleTurn = resolveVoiceStyleTurn(displayBlocks);
          if (voiceStyleTurn.tagged) displayBlocks = withAnswerText(displayBlocks, voiceStyleTurn.text);
          if (voiceStyleTurn.matched && voiceStyleTurn.style) {
            applyVoiceStyle(voiceStyleTurn.style);
          }

          /**
           * 语言切换指令 `<COMPONENT type="language_switch" data.language=en|zh>`：
           * 切界面语言 + 落 `/settings`（与设置弹层同一个入口），整段 JSON 不进气泡。
           */
          if (snapshot.languageSwitch) applyLanguageSwitch(snapshot.languageSwitch);

          /**
           * 播报风格标签 `<REPORT_STYLE style="…">正文</REPORT_STYLE>`：
           * 正文留在气泡里，style 属性里的风格码落进「听播风格」存储，
           * 下次播报按它作为 styleCode 传值（音色仍然取最新音色，不受这个标签影响）。
           */
          const reportStyleTurn = resolveReportStyleTurn(displayBlocks);
          if (reportStyleTurn.tagged) displayBlocks = withAnswerText(displayBlocks, reportStyleTurn.text);
          if (reportStyleTurn.matched && reportStyleTurn.style) {
            saveReportStyleCode(reportStyleTurn.style);
            logger.info("[chat] report style switched by answer tag", { style: reportStyleTurn.style });
          }

          /**
           * 跳转目标有两个来源，任一命中就切页（不弹「是否进入」确认框）：
           * - 协议块 `<COMPONENT type="navigation" target=…>` → snapshot.assistantScene（流中即到）；
           * - 工作流结束事件 `workflow_finished.target` → metadata.assistant_target（随 message_end 到）。
           * 同一轮只跳一次；已在目标页时不跳自己（见 openAssistantScene）。
           */
          const sceneTarget = snapshot.assistantScene
            || (snapshot.ended ? snapshot.metadata?.assistant_target : "");
          /**
           * 听汇报标签：等闭合标签到齐（或整轮结束）再补入口卡，
           * 避免正文还在流就先把卡插进去、卡和正文顺序打架。
           * 这里只加卡，**不跳页** —— 跳不跳交给用户点卡片。
           */
          if (reportTurn.matched && (reportTurn.closed || snapshot.ended)) {
            displayBlocks = withReportCard(displayBlocks, reportTurn);
          }
          // 新手（分步骤）模式：后端可能仍返回老师傅的导语（voice）块，这里直接丢弃，不渲染也不播报
          const isNovice = userStore.operatorRole?.roleKey === "novice_operator";
          const filteredBlocks = isNovice
            ? displayBlocks.filter(block => block.type !== "voice")
            : displayBlocks;
          const displaySnapshot = displayBlocks === snapshot.blocks
            ? snapshot
            : { ...snapshot, blocks: filteredBlocks };
          // 要跳页的这一轮不触发「回答完成」回调（页面会据此起自动听播，跳走就白播了）
          applySnapshot(aiMsgId, userMsgId, displaySnapshot, preserveProcessStatus, qrcodeTurn.matched || Boolean(sceneTarget));
          if (qrcodeTurn.matched) {
            openQrcodePage(qrcodeTurn);
            return;
          }
          if (openAssistantScene(sceneTarget)) {
            // 跳页前把本轮流式听播收尾，避免旧页面在后台继续念
            notifyAnswerDelta("", true);
            return;
          }

          // 过程小标题：接口 subtitle 事件（如「目标 Dify 工作流已开始。」），听播思考态直接展示它。
          // 空白（收尾时的清场事件）不往页面传：页面那边用它直接覆盖自己的 ref，
          // 传空就会让思考态那行字闪一下空白，得等回答气泡彻底渲染出来才能收。
          if (snapshot.processSubtitle !== undefined) {
            const subtitle = typeof snapshot.processSubtitle === "string" ? snapshot.processSubtitle.trim() : "";
            if (subtitle) handlers?.onProcessSubtitle?.(subtitle);
          }

          // 听播问答：与首页共用同一条流式接口（/proxy/v1/chat-messages + streaming），
          // 这里只聚合答案正文，流结束后按汇报交互协议解析后交给播报页（自己的 TTS 出口）。
          if (usesReportAnswerOutlet) {
            // 用剥掉标签后的正文，避免把 <OWNER> 这类源码念出来
            podcastAnswer = collectAnswerText(displaySnapshot.blocks);
          }
          // 普通问答：答案文字边流边播。每收到新的一块 answer 文本就增量通知页面，
          // 页面在第一块文字渲染出来的瞬间就可以起听播，后续文字持续续播。
          // 聚合全部 answer 块（而非只取第一块）：answer 中途穿插了别的块时，
          // 只取第一块会让后半段文字永远收不到增量、听播漏播。
          else if (handlers?.onAiAnswerDelta) {
            const answerContent = collectAnswerText(displaySnapshot.blocks);
            // "QRCODE" 是给前端看的占位，不是给人听的：文本还是占位前缀时按住不播，
            // 一旦长成正常答案（含已压住的开头）再一次性补播，避免把字母一个个念出来。
            // <QRCODE>…</QRCODE> 这一轮同样不进听播（要跳二维码页），整段按住。
            const placeholderPrefix = qrcodeTurn.tagged || isQrcodePlaceholderPrefix(answerContent);
            if (!placeholderPrefix && answerContent.length > lastSeenAnswerLength) {
              notifyAnswerDelta(answerContent.slice(lastSeenAnswerLength), false);
              lastSeenAnswerLength = answerContent.length;
            }
            if (snapshot.ended) notifyAnswerDelta("", true);
          }
        },
      });
      // 听播问答：流正常收尾后把答案交给播报页，出口与原来的阻塞链路保持一致；
      // 已被新一轮请求 / 停止操作取代时不派发，避免过期答案串到播报页。
      if (usesReportAnswerOutlet && requestSeq === chatStore.activeRequestSeq && !qrcodeHandled) {
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
      if (lastSeenAnswerLength > 0 && !qrcodeHandled) notifyAnswerDelta("", true);
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
    // 问题顶到上方（首页）或强制回底（其余页面），见 alignAfterUserMessage
    alignAfterUserMessage(userMsgId);
    const options = { aiMsgId, userMsgId, content: query, files, hadSessionId, requestSeq };
    // 听播问答与首页问答共用同一条流式接口，场景差异只体现在 inputs 与答案出口上。
    await sendAiFlow(options);
  }

  /**
   * 静默发送一轮对话：**不往消息列表写任何消息、不动任何 UI 状态**
   * （不置 isLoading / activeMessageId、不滚动、不清草稿），只把流式快照里的 blocks 回调给页面。
   *
   * 作业协同页用它拉初始化卡片数据：页面初始化时问「今天任务有哪些」，
   * 只取回答里的卡片（gantt / 表格 / 追问等），用户消息与 AI 回答文本都不展示。
   *
   * 会话延续：默认把拿到的 conversationId 写回 store（这一轮已经在服务端建了会话，
   * 后续用户提问要续在同一个会话里，避免多出一个空会话）。
   * keepSession=true 时不写回：初始化取卡片时用，页面停在原地等卡片，
   * 会话 id 通过 onSessionId 交给页面暂存，等用户真正提问时再续上。
   */
  async function sendSilentMessage(options: {
    text: string;
    /** 每次快照回调（gantt 等 blocks 随流逐步到达，最后一次即最全） */
    onBlocks?: (blocks: ReturnType<typeof buildInitialBlocks>, ended: boolean) => void;
    /** 额外 Dify inputs（与普通发送的 getExtraInputs 口径一致） */
    extraInputs?: Record<string, unknown>;
    /**
     * 为 true 时不改 store 里的会话 id、不刷新会话列表：
     * 初始化请求按「后台拉数据」处理，页面不会因为多了个会话而重建 / 跳到会话态。
     */
    keepSession?: boolean;
    /** keepSession=true 时把本轮会话 id 抛给页面暂存（每次快照都会回调，覆盖即可） */
    onSessionId?: (conversationId: Identifier | null) => void;
  }) {
    const query = String(options.text || "").trim();
    if (!query) return;

    const requestSeq = chatStore.nextRequestSeq();
    const hadSessionId = Boolean(chatStore.aiSessionId);
    try {
      await consumeChatStream({
        source: stream(createChatRequest(query, [], options.extraInputs ?? {}), { idleTimeoutMs: 60_000 }),
        isStale: () => requestSeq !== chatStore.activeRequestSeq,
        onSnapshot: (snapshot) => {
          if (snapshot.conversationId) {
            if (options.keepSession) options.onSessionId?.(snapshot.conversationId);
            else chatStore.aiSessionId = snapshot.conversationId;
          }
          options.onBlocks?.(snapshot.blocks, Boolean(snapshot.ended));
        },
      });
    } catch (error) {
      if (!isAbortError(error)) logger.error("silent chat request failed", error);
    } finally {
      // 新会话（会话列表里原本没有这条）拿回来后才需要刷新，和普通发送一致。
      // keepSession 不改 store，这一轮对会话列表不可见，也就不刷新。
      if (!options.keepSession && !hadSessionId && chatStore.aiSessionId) {
        sessionStore
          .loadSessions()
          .catch(error => logger.error("failed to refresh AI sessions", error));
      }
    }
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
        waitingText: options.waitingText || "维修助理-快速问答",
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
    const placeholderId = `user-asr-${Date.now()}`;
    chatStore.messages.push({
      id: placeholderId,
      role: "user",
      content: t("identifying"),
      asrPending: true,
      sessionId: chatStore.aiSessionId,
      messageId: null,
    });
    // 「识别中」这条同样是这一轮的提问气泡：先登记它，识别结果回填后不再跳位置
    alignAfterUserMessage(placeholderId);
  }

  function discardAsrPlaceholder() {
    const index = chatStore.messages.findIndex(item => item.role === "user" && item.asrPending);
    if (index < 0) return;
    chatStore.messages.splice(index, 1);
    if (!chatStore.messages.length) {
      chatStore.showQuickPrompts = true;
      chatStore.showQuickList = true;
    }
    // 这一轮没发出去：占位气泡已经撤掉，登记的本轮提问与跟随上限一起清掉，
    // 否则顶部呼吸位一直按它算，下一次跟随也会卡在「提问顶到上方」的位置
    chatStore.setPinMessage("");
    chatStore.setCapRoundAtTop(false);
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

    // 选项一律取 label 回发：value 是业务编码（如 time / space），对话里要给用户看得懂的文案
    const selectedLabels = payload.selectedOptions
      .map(option => String(option.label || option.value).trim())
      .filter(Boolean);
    // 「其他输入」填的自定义内容也算作答，跟选项一起按「、」拼进提问
    const remark = String(payload.remark || "").trim();
    /**
     * 只发本次点击的内容，**不再拼上一轮的提问**（原 `original_query` 前缀）：
     * 追问卡的选项本身就是一句完整意图（如「近 7 天：11 月 3 日至 11 月 9 日」），
     * 再把上一问带进去会让后端把两轮问题合成一条重新理解，一串重复语义反而查不准。
     */
    return [selectedLabels.join("、"), remark].filter(Boolean).join("、");
  }

  function sendAskSlotSelection(payload: AskSlotSubmitPayload) {
    const query = buildAskSlotQuery(payload);
    if (query) void sendMessage({ text: query });
  }

  return {
    sendMessage,
    sendSilentMessage,
    sendQuickPrompt,
    sendAskSlotSelection,
    sendAssistantCallback,
    beginAsrPlaceholder,
    discardAsrPlaceholder,
    stopGenerating,
    cancelActiveStream,
  };
}
