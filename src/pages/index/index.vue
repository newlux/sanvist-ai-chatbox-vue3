<script setup lang="ts">
import type {
  AskSlotPayload,
  AskSlotSubmitPayload,
  AssistantNavigationAction,
  AssistantNavigationPayload,
  GuideStepItem,
  GuideStepPayload,
  GuideStepSelectEvent,
  GuideSuggestionPayload,
} from "@/api/chat/types";
import type { TodayListenBroadcast } from "@/api/listen-broadcast/types";
import type { AttachmentSource } from "@/hooks/useComposerAttachments";
import type { ChatMessageAttachment } from "@/stores/chat-types";
import type { AsrStreamSession } from "@/utils/asr/asr-stream-session";
import type { PcmCapture } from "@/utils/asr/pcm-capture";
import { onHide, onLoad, onShow, onUnload } from "@dcloudio/uni-app";
import { storeToRefs } from "pinia";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { getConversationSummary } from "@/api/conversation-summary";
import { getTodayListenBroadcast } from "@/api/listen-broadcast";
import { getTodayAwakeningPrompt } from "@/api/user-role";
import AiAssistantNavigationSheet from "@/components/ai-assistant-navigation-sheet/index.vue";
import AiBadFeedbackSheet from "@/components/ai-bad-feedback-sheet/index.vue";
import AiChatBackdrop from "@/components/ai-chat-backdrop/index.vue";
import AiChatHeader from "@/components/ai-chat-header/index.vue";
import AiChatInput from "@/components/ai-chat-input/index.vue";
import AiGuideStepSheet from "@/components/ai-guide-step-sheet/index.vue";
import AiGuideSuggestionSheet from "@/components/ai-guide-suggestion-sheet/index.vue";
import AiMessageList from "@/components/ai-message-list/index.vue";
import AiPartsJumpSheet from "@/components/ai-parts-jump-sheet/index.vue";
import ShareConversationPoster from "@/components/ai-share-poster/index.vue";
import AiSlotDrawer from "@/components/ai-slot-drawer/index.vue";
import AiVoiceQueryBar from "@/components/ai-voice-query-bar/index.vue";
import AiWelcome from "@/components/ai-welcome/index.vue";
import { AI_ASK_WELCOME_DONE_KEY, LISTEN_REPORT_CURRENT_DATE_KEY, LISTEN_REPORT_DATE_KEY } from "@/config";
import { useChatFeedback } from "@/hooks/useChatFeedback";
import { useChatSend } from "@/hooks/useChatSend";
import { useChatShare } from "@/hooks/useChatShare";
import { useChatViewport } from "@/hooks/useChatViewport";
import { useComposerAttachments } from "@/hooks/useComposerAttachments";
import { useRealtimeTts } from "@/hooks/useRealtimeTts";
import { DEFAULT_CHAT_SCOPE, provideChatScope, useChatStore, useSessionStore, useSystemStore, useUserStore } from "@/stores";
import { isAsrStreamSupported, openAsrStreamSession } from "@/utils/asr/asr-stream-session";
import { isPcmCaptureSupported, startPcmCapture } from "@/utils/asr/pcm-capture";
import { saveCurrentListenReportDate } from "@/utils/listen-report";
import { createLogger } from "@/utils/logger";
import { closeWebview, ensureNativePermission, isMpaasReady, onNativeEvent, permissionDeniedMessage } from "@/utils/platform/mpaas";
import { clearPendingRepairCallback, consumePendingRepairCallback, parseRepairCallbackSummary, stashPendingRepairCallback } from "@/utils/repair-callback";
import { stashPendingRepairNavigationContext } from "@/utils/repair-navigation";
import { navigateToScene } from "@/utils/scene-navigation";
import { consumePendingHistorySession, getSessionId, navigateToSessionScene, peekPendingHistorySession, readSessionIdFromOptions } from "@/utils/session-scene";

defineOptions({ name: "AiChatPage" });
const logger = createLogger("chat-page");
const { t } = useI18n();
const userStore = useUserStore();
provideChatScope(DEFAULT_CHAT_SCOPE);
const chatStore = useChatStore(DEFAULT_CHAT_SCOPE);
/**
 * 自动滚动的落点：回复内容末尾（不含参考来源）——参考来源不被贴底滚进视野，
 * 以内容块容器高度减去参考来源高度为准（见 ai-message-list 的 alignToReplyEnd）。
 * 回复里没有参考来源时，表现与原来的贴底一致。
 */
chatStore.setStopAtReplyEnd(true);
const sessionStore = useSessionStore();
/** 外观（设置弹层 → 深色）：首页问答态走 C 方案暗色 1193:2097 的底色与顶部渐隐 */
const systemStore = useSystemStore();
const isDark = computed(() => systemStore.isDark);
const sharePosterWrap = ref<unknown>(null);
/** 输入栏实例：步骤卡拍照后把附件挂进输入栏并聚焦，不再直接发送 */
const chatInputRef = ref<{
  appendAttachments?: (meta: ChatMessageAttachment[]) => void;
  focusTextInput?: () => void;
} | null>(null);
const shareSheetBottomInset = ref("");
const pageStage = ref<"welcome" | "chat">("welcome");
/** 初始页起飞中：欢迎层先不卸载，等中间 logo 滑到对话页顶部再收起 */
const welcomeLeaving = ref(false);
/** 初始页 logo 的落点 transform：按对话页灵动岛图标的真实坐标算出来 */
const welcomeLogoStyle = ref<Record<string, string>>({});
/** 已到顶：欢迎层 logo 淡出，交给对话页自己的灵动岛图标接上 */
const welcomeLanded = ref(false);
/** 欢迎层是否还挂在页面上（起飞期间与对话页同时存在） */
const showWelcome = computed(() => pageStage.value === "welcome" || welcomeLeaving.value);
const listenBroadcast = ref<TodayListenBroadcast | null>(null);
const listenBroadcastLoading = ref(false);
const listenReportRefreshKey = ref(0);
const guideStepSheetVisible = ref(false);
/** 底部步骤白板实例：点核对卡步骤条时用它直接切到对应步 */
const guideStepSheetRef = ref<{ goToStep: (index: number) => void } | null>(null);
/** 请求白板显示的步骤下标（0 起）：点核对卡步骤条时带上，展开时按它定位 */
const guideStepRequestedIndex = ref(0);
const guideStepSheetHeight = ref(0);
/** 核对卡要顶到对话区顶部还缺的底部间距（px，由消息列表量出来） */
const guideStepCardSpace = ref(0);

let isDemoPage = false;

const {
  messages,
  inputText,
  isLoading,
  aiSessionId,
  showQuickPrompts,
  showQuickList,
  awakeningLoading,
  scrollIntoView,
  pinnedToBottom,
  replyEndToken,
} = storeToRefs(chatStore);
const { sessions, isSessionSwitching } = storeToRefs(sessionStore);

const {
  chatViewportStyle,
  keyboardHeight,
  voiceKeyboardHeight,
  composerBottomInset,
  syncWindowHeight,
  setInputDockHeight,
  setTextInputFocused,
  setVoiceInputFocused,
} = useChatViewport();
// 提前到 useChatSend 之前：onAiAnswerDelta 回调里要用它做流式听播。
const realtimeTts = useRealtimeTts();
const {
  sendMessage: sendChatMessage,
  sendQuickPrompt,
  sendAskSlotSelection,
  sendAssistantCallback,
  beginAsrPlaceholder,
  discardAsrPlaceholder,
  stopGenerating,
  cancelActiveStream,
} = useChatSend(undefined, {
  // 问答完成、答案文字开始渲染就自动听播（不等 workflow_finished / message_end）：
  // 第一块 answer 文字到达即开播，后续文字流式增量续播，音频按原文顺序排队播放。
  onAiAnswerDelta({ aiMsgId, delta, ended }) {
    const index = chatStore.messages.findIndex(item => item.id === aiMsgId);
    if (index < 0) return;
    realtimeTts.feedAnswerDelta(chatStore.messages[index], delta, ended);
  },
  // 本轮的提问是跟随上限：回答边写边贴底跟随，提问顶到头部下沿就停住（见消息列表 alignToReplyEnd）
  alignSentMessageToTop: true,
  // 首页：发送后立刻把这条提问顶到头部下沿（每次提问同一个位置，历史往上顶）
  pinOnSend: true,
});

/**
 * 发送新消息（文字会话 / 语音确认发送共用 @send 出口）时立刻停掉正在进行的听播。
 * 同步停、不依赖 activeRequestSeq watcher —— 发出去的瞬间就安静，
 * 避免旧播报一直响到新答案文字出来才被替换。
 */
function sendMessage(payload?: Parameters<typeof sendChatMessage>[0]) {
  realtimeTts.stop();
  return sendChatMessage(payload);
}

/** 用户主动点出来的提问（快捷问题 / 推荐追问 / 作业指导卡片） */
function sendUserPrompt(query: string) {
  sendQuickPrompt(query);
}

/**
 * 按住说话 / 再次识别按下的瞬间停掉听播。此时录音刚开始、请求还没发出，
 * activeRequestSeq watcher 不会动 —— 但旧播报继续响会盖住用户对着麦克风说话，
 * 还会被录进 ASR 里，必须按下即停。
 */
function stopRealtimeTtsOnVoiceStart() {
  realtimeTts.stop();
}

// 「再次发起其他提问 / 切换会话 / 停止生成」时立刻停掉正在进行的自动听播：
// activeRequestSeq 在新请求开始（nextRequestSeq）和取消/重置（invalidateActiveRequest）
// 时都会变化，一个 watcher 统一覆盖全部入口（输入框、快捷提问、建议、插槽、助手回调、历史切换）。
// 不等到新答案首块文字才停 —— 那中间几秒旧播报还会继续响。
watch(() => chatStore.activeRequestSeq, () => {
  realtimeTts.stop();
});
const {
  iconCopyImage,
  iconSaveImage,
  shareSheetVisible,
  shareSelectedIndexes,
  shareSuppressHighlight,
  sharePosterVisible,
  sharePosterDataUrl,
  sharePosterGenerating,
  shareSheetOptions,
  shareSelectAllDisabled,
  shareSelectedRoundCount,
  shareAllChecked,
  onShareClick,
  onShareSelectToggle,
  onShareSelectAll,
  closeShareSheet,
  onShareSheetOption,
  onCopyMessage,
  closeSharePosterModal,
  onSaveSharePoster,
  onCopySharePoster,
} = useChatShare(sharePosterWrap);
const { badFeedbackSheetVisible, onFeedbackChange, onBadFeedbackConfirm, onBadFeedbackClose } = useChatFeedback();
/** 步骤卡「拍照」入口专用：独立实例，选完一张图直接把文件交给 sendMessage */
const photoPicker = useComposerAttachments();

const messageBottomInset = computed(() => {
  if (shareSheetVisible.value) return shareSheetBottomInset.value;
  // 步骤卡贴底展开：列表底部既要让开卡片高度，也要留够把核对卡顶到对话区最上方的间距
  if (guideStepSheetVisible.value && guideStepSheetHeight.value > 0) {
    return `${Math.max(guideStepSheetHeight.value, guideStepCardSpace.value)}px`;
  }
  // 追问卡（单选点即作答 / 多选确认提交）弹出时同样让出卡片高度
  if (askSlotDrawerVisible.value && askSlotDrawerHeight.value > 0) {
    return `${askSlotDrawerHeight.value}px`;
  }
  // 底部只剩输入栏：不再给已移除的快捷入口条预留高度
  return composerBottomInset.value;
});
/**
 * 录音态底部面板（设计稿 1204:467 录动态）是否展开。
 * 设计稿这一屏底部只有「水面 + 提示行 + 声纹」，底部导航与「一键回到底部」都要让位，
 * 否则它们会盖在水面上（AiChatNav / .chat-scroll-bottom 的层级都在面板之上）。
 */
const voicePanelOpen = ref(false);
/**
 * 「按住说话」录音中：输入栏把录音态透出来，顶部灵动岛据此把常态动图换成 listen.gif。
 * 只在录音期间为 true（松手进识别 / 取消 / 发送都会回落），思考中的 think.gif 逻辑不受影响。
 */
const voiceListening = ref(false);
const askSlotQueue = ref<AskSlotPayload[]>([]);
const askSlotDrawerVisible = ref(false);
/** 追问卡实时高度（px）：卡片弹出时给消息列表加底部间距，最后一条内容不会被盖住 */
const askSlotDrawerHeight = ref(0);
const assistantNavigationPayload = ref<AssistantNavigationPayload | null>(null);
const assistantNavigationVisible = ref(false);
/** 底部「配件助手」点击后的地址输入弹层 */
const partsJumpVisible = ref(false);
let repairSummaryPollingTimer: ReturnType<typeof setTimeout> | null = null;
let repairSummaryPollingAttempts = 0;
const REPAIR_SUMMARY_POLL_INTERVAL_MS = 5_000;
const REPAIR_SUMMARY_MAX_ATTEMPTS = 30;

function onAssistantNavigationOpen(payload: AssistantNavigationPayload) {
  if (payload.target !== "maintenance_assistant" && payload.target !== "parts_assistant") return;
  assistantNavigationPayload.value = payload;
  assistantNavigationVisible.value = true;
}

/** 点维修助手回流卡：跳维修助手详情；已生成的回流结果看过就不再重复拉取。 */
function onAssistantCallbackOpen(conversationId: string) {
  const id = String(conversationId || "").trim();
  if (!id) return;
  clearPendingRepairCallback();
  void navigateToScene(`/pages/repair/index?conversationId=${encodeURIComponent(id)}`);
}

/**
 * 弹层确认后的去向按 target 分流：
 * - maintenance_assistant：把上下文落盘 → 另开维修助手页（/pages/repair/index）；
 * - parts_assistant：配件助手还没独立页，就地切到首页内联智能体（subagent=parts），不跳页；
 *   其中「启动拍照 / 启动上传」再把对应选择器拉起来，选完挂在输入栏（与步骤卡拍照同一套）。
 */
async function onAssistantNavigationConfirm(
  payload: AssistantNavigationPayload,
  action?: AssistantNavigationAction,
) {
  if (payload.target === "parts_assistant") {
    enterPartsAssistant();
    if (action?.key === "camera" || action?.key === "upload") {
      const picked = await photoPicker.pickAttachmentForSend(action.key === "camera" ? "camera" : "album");
      if (picked) {
        chatInputRef.value?.appendAttachments(picked.meta);
        chatInputRef.value?.focusTextInput();
      }
    }
    return;
  }
  if (payload.target !== "maintenance_assistant") return;
  stashPendingRepairNavigationContext({
    ...payload.context,
    userId: userStore.userId,
    sessionId: payload.sessionId,
    conversationId: payload.conversationId,
  });
  const aiAskConversationId = String(payload.conversationId || "").trim();
  const aiAskSessionId = String(payload.sessionId || "").trim();
  if (aiAskConversationId && aiAskSessionId) {
    stashPendingRepairCallback({ aiAskConversationId, aiAskSessionId });
  }
  void navigateToScene("/pages/repair/index");
}

/** 确认进入配件助手：就地切到内联智能体（subagent=parts）。 */
function enterPartsAssistant() {
  chatStore.setSubagent("parts");
  nextTick(() => chatStore.scrollToBottom(true));
}

function clearRepairSummaryPolling() {
  if (!repairSummaryPollingTimer) return;
  clearTimeout(repairSummaryPollingTimer);
  repairSummaryPollingTimer = null;
}

function startRepairSummaryCallback() {
  const task = consumePendingRepairCallback();
  if (!task) return;

  clearRepairSummaryPolling();
  repairSummaryPollingAttempts = 0;
  const aiMsgId = `repair-summary-${Date.now()}`;
  chatStore.messages.push({
    id: aiMsgId,
    role: "ai",
    content: "",
    blocks: [],
    loading: true,
    sessionId: chatStore.aiSessionId,
    messageId: null,
    waitingText: "维修助手-快速问答",
    assistantCallbackTitle: "维修助手-快速问答",
    // 状态文案由气泡统一补「...」，这里只写标题本体，避免卡片上出现重复省略号
    processStatus: { phase: "thinking", title: "故障诊断中" },
  });
  chatStore.scrollToBottom(true);

  /**
   * 已经补到卡片上的维修助手会话 ID。
   * 诊断中没有回填明细，但 ID 一到位就要让卡片可点（气泡只按这个字段决定是否显示右箭头），
   * 所以要单独记一份，避免每轮都重复 patch，也避免 Completed 回包没带 ID 时把它覆盖成空。
   */
  let patchedConversationId = "";

  const poll = async () => {
    repairSummaryPollingAttempts += 1;
    try {
      const data = await getConversationSummary(task);
      const summaryPayload = JSON.stringify(data);
      const summary = parseRepairCallbackSummary(summaryPayload);
      // 结果就绪：先把卡片标题/副标题/明细/会话 ID 补到消息上，再走回流接口。
      const applySummary = () => chatStore.patchMessageById(aiMsgId, {
        assistantCallbackTitle: summary.title,
        assistantCallbackStatus: summary.statusText,
        assistantCallbackDetails: summary.details,
        assistantCallbackConversationId: summary.repairConversationId || patchedConversationId,
      });
      /**
       * 结果就绪：只有下面两种情况才结束轮询并回流。
       * - 无 status：快速问答没有状态字段，首次取到结果就回流；
       * - Completed：诊断报告已完成。
       * Diagnosing 是「诊断中」，服务端此时返回的 conclusion / treatment 还只是
       * 「当前故障案例报告还未生成」这种占位文案，提前回流会把占位内容当成结论写进卡片，
       * 而且会走到下面的 return，把 setTimeout 掐断 —— 表现就是只请求了一次、不再轮询。
       * 所以 Diagnosing 一律放行到末尾继续轮询，等状态收敛成 Completed。
       * repairConversationId 只决定卡片能不能点进详情（为空时气泡不渲染箭头），
       * 不能拿它当作「结果就绪」的依据。
       */
      const status = String(data.status || "");
      if (!status || status === "Completed") {
        clearRepairSummaryPolling();
        applySummary();
        await sendAssistantCallback(summaryPayload, { aiMsgId, waitingText: "维修助手-快速问答" });
        return;
      }

      /**
       * 还没到 Completed（如 Diagnosing 诊断中）：结论仍是占位文案，明细 / 副标题一律不写；
       * 但只要服务端这次带回了 repairConversationId，就立刻把卡片补成可点击的，
       * 用户不用等诊断结束也能点右箭头跳到维修助手看诊断详情。
       * 只补这一个字段，不碰明细，也不打断下面的轮询。
       */
      const conversationId = summary.repairConversationId;
      if (conversationId && conversationId !== patchedConversationId) {
        patchedConversationId = conversationId;
        chatStore.patchMessageById(aiMsgId, { assistantCallbackConversationId: conversationId });
      }
    }
    catch (error) {
      logger.error("failed to query repair conversation summary", error);
    }

    if (repairSummaryPollingAttempts >= REPAIR_SUMMARY_MAX_ATTEMPTS) {
      clearRepairSummaryPolling();
      chatStore.patchMessageById(aiMsgId, {
        content: "维修助手结果暂未生成，请稍后再试。",
        loading: false,
        processStatus: { phase: "failed", title: "故障诊断未完成" },
      });
      return;
    }
    repairSummaryPollingTimer = setTimeout(poll, REPAIR_SUMMARY_POLL_INTERVAL_MS);
  };

  void poll();
}

function onAskSlotOpen(slot: AskSlotPayload) {
  // 作业协同多步骤表单会一次带来整组题目（slot.slots），按顺序拆开入队；普通追问卡就是一道题
  const incoming = Array.isArray(slot.slots) && slot.slots.length ? slot.slots : [slot];
  incoming.forEach((item) => {
    const existingIndex = askSlotQueue.value.findIndex(existing => existing.slot_name === item.slot_name);
    askSlotQueue.value = existingIndex < 0
      ? [...askSlotQueue.value, item]
      : askSlotQueue.value.map((existing, index) => index === existingIndex ? item : existing);
  });
  askSlotDrawerVisible.value = true;
}

function closeAskSlotDrawer() {
  askSlotDrawerVisible.value = false;
}

/** 追问卡高度量出来了：底部间距随之变化，贴一次底把内容抬到卡片上方 */
function onAskSlotDrawerHeightChange(height: number) {
  askSlotDrawerHeight.value = height;
  if (askSlotDrawerVisible.value && height > 0) nextTick(() => chatStore.scrollToBottom(true));
}

function onAskSlotSubmit(payload: AskSlotSubmitPayload) {
  closeAskSlotDrawer();
  askSlotQueue.value = [];
  sendAskSlotSelection(payload);
}

/** 指导步骤卡片（COMPONENT scene=guide / type=step）：单步点一下进入下一轮，多步选好后确认回发。 */
const guideStepPayload = ref<GuideStepPayload | null>(null);
/**
 * 当前要顶到对话区顶部的那张核对卡属于哪一步（步骤 id）：多步骤卡每轮各带一张，
 * 按 id 从最新一轮往回找，避免新一轮的卡被算到第一张卡的位置上。
 */
const guideStepCardStepId = ref("");

/**
 * 把当前显示的那张核对卡（对话区的 .chat-box__card）顶到对话区最上方。
 * 步骤卡出现、翻页、卡片高度变化后都用它：卡片顶在上方才整张可见。
 */
function focusGuideStepCardAtTop() {
  const stepId = String(guideStepCardStepId.value || "").trim();
  if (stepId) chatStore.focusStepBlock(stepId);
}

/** 步骤卡片：单步是多轮追问（点一下直接发），多步选好后确认，统一按普通问题发送。 */
function onGuideStepOpen(payload: GuideStepPayload) {
  guideStepPayload.value = payload;
  guideStepRequestedIndex.value = 0;
  guideStepSheetVisible.value = true;
  // 这一轮的核对卡：按本轮第一步定位（每轮回答各带一套自己的卡，取最新那一轮）
  guideStepCardStepId.value = String(payload?.steps?.[0]?.id || "");
  // 步骤卡弹出：把这一步的核对卡滚到对话区顶部
  nextTick(() => focusGuideStepCardAtTop());
}

function onGuideStepSubmit(query: string) {
  guideStepSheetVisible.value = false;
  sendUserPrompt(query);
}

function onGuideStepHeightChange(height: number) {
  guideStepSheetHeight.value = height;
  // 卡片高度 / 底部间距刚生效，按当前步骤重新对齐到对话区顶部
  if (guideStepSheetVisible.value) nextTick(() => focusGuideStepCardAtTop());
}

/** 核对卡高度量出来了（底部间距跟着变），再对齐一次对话区顶部 */
function onGuideStepCardSpaceChange(space: number) {
  guideStepCardSpace.value = space;
  if (guideStepSheetVisible.value) nextTick(() => focusGuideStepCardAtTop());
}

/**
 * 步骤卡的附件按钮：选完不直接发送——收起步骤卡、把附件挂到输入栏并聚焦输入框，
 * 用户补一句说明或直接点发送，都走原来的对话发送链路。
 */
async function onGuideStepPhoto(source: AttachmentSource) {
  const picked = await photoPicker.pickAttachmentForSend(source);
  if (!picked) return;
  guideStepSheetVisible.value = false;
  chatInputRef.value?.appendAttachments(picked.meta);
  chatInputRef.value?.focusTextInput();
}

/** 步骤卡片展开 / 翻页时，把这一步对应的核对卡（最新那一轮）顶到对话区顶部 */
function onGuideStepChange(step: GuideStepItem | null) {
  const stepId = String(step?.id || "").trim();
  if (!stepId) return;
  const steps = guideStepPayload.value?.steps || [];
  const index = steps.findIndex(item => String(item?.id || "") === stepId);
  if (index >= 0) guideStepCardStepId.value = stepId;
  nextTick(() => focusGuideStepCardAtTop());
}

/**
 * 按 step_id 回溯这次点击所属那一轮的步骤数据（气泡里的 guide-step）。
 * 点核对卡时「当前这轮」不一定在 guideStepPayload 里（历史会话不带 auto_open、
 * 或用户没点开过「操作步骤」入口），所以从消息里按 step_id 反查，取最后一条匹配的。
 */
function resolveGuidePayload(stepId: string): GuideStepPayload | null {
  const id = String(stepId || "").trim();
  for (let index = chatStore.messages.length - 1; index >= 0; index -= 1) {
    const blocks = chatStore.messages[index]?.blocks || [];
    for (const block of blocks) {
      if (block?.type !== "guide-step") continue;
      const steps = Array.isArray(block.payload?.steps) ? block.payload.steps as GuideStepItem[] : [];
      if (!id || steps.some(step => String(step?.id || "") === id)) return block.payload as GuideStepPayload;
    }
  }
  return null;
}

/**
 * 点核对卡上的步骤条某一段：切到该步（1 起），并把底部步骤白板打开到同一步
 * （参考任务协同多步骤卡的「上一题/下一题」随意切换）。
 * 步骤数据优先用「当前这轮」，取不到就按 step_id 回溯；再取不到就只切核对卡。
 */
function onGuideCheckStepSelect(payload: GuideStepSelectEvent) {
  const target = Math.max(1, Math.round(Number(payload?.index) || 1));
  const resolved = resolveGuidePayload(payload?.stepId || "") || guideStepPayload.value;
  const steps = (resolved?.steps || []) as GuideStepItem[];
  if (!steps.length) return;
  guideStepPayload.value = resolved as GuideStepPayload;
  const index = Math.min(target, steps.length) - 1;
  // 先把核对卡切过去：按点击那一段的步骤 id 定位（同一份指导重复触发时切最新那一轮）
  guideStepCardStepId.value = String(steps[index]?.id || payload?.stepId || "");
  guideStepRequestedIndex.value = index;
  guideStepSheetVisible.value = true;
  // 白板已展开时 stepIndex 可能没变化（比如又切回上一步），用方法兜底再切一次
  nextTick(() => guideStepSheetRef.value?.goToStep(index));
}

/**
 * 多轮追问卡（COMPONENT scene=guide / type=suggestion）：options 是并行分支，
 * 点哪一项就把那一项作为下一轮提问发出去（与按顺序推进的步骤卡区分开）。
 */
const guideSuggestionPayload = ref<GuideSuggestionPayload | null>(null);
const guideSuggestionSheetVisible = ref(false);
/** 追问卡实时高度（px）：同步骤卡，展开时给列表底部让位 */
const guideSuggestionSheetHeight = ref(0);

function onGuideSuggestionOpen(payload: GuideSuggestionPayload) {
  guideSuggestionPayload.value = payload;
  guideSuggestionSheetVisible.value = true;
}

function onGuideSuggestionSubmit(query: string) {
  guideSuggestionSheetVisible.value = false;
  sendUserPrompt(query);
}

function onGuideSuggestionHeightChange(height: number) {
  guideSuggestionSheetHeight.value = height;
}

/** 消息播音统一走实时 TTS。 */
function onTtsClick(index: number) {
  const msg = chatStore.messages[index];
  const messageId = msg?.messageId;
  if (messageId == null || msg?.sessionId == null) return;

  if (realtimeTts.playingMessageId.value === messageId) {
    realtimeTts.stop();
    return;
  }

  realtimeTts.stop();
  void realtimeTts.togglePlay(msg);
}

const localizedQuickPrompts = computed(() => chatStore.quickPrompts.map(item => t(item)));

watch(() => chatStore.messages.length, () => nextTick(() => chatStore.scrollToBottom()));

watch(shareSheetVisible, async (visible) => {
  if (!visible) {
    shareSheetBottomInset.value = "";
    return;
  }

  await nextTick();
  uni.createSelectorQuery()
    .select(".share-sheet")
    .boundingClientRect((rect) => {
      const height = Array.isArray(rect) ? rect[0]?.height : rect?.height;
      shareSheetBottomInset.value = height ? `${height}px` : "";
    })
    .exec();
});

function startNewConversation() {
  // 已经是一轮空白会话就别再重置了，重复点击给个明确反馈
  if (!chatStore.messages.length && !chatStore.aiSessionId) {
    uni.showToast({ title: t("already-new-conversation"), icon: "none" });
    return;
  }
  // 正在生成时切走：先掐掉在途请求，否则回包会继续往新会话里写
  cancelActiveStream();
  chatStore.resetConversation();
  nextTick(() => chatStore.scrollToBottom(true));
}

/**
 * 快捷入口：听汇报 / 作业指导 / 任务协同都走专属页（url 优先）。
 * 听汇报跳转前先记下当天早报日期，供播报页判断是否已收听。
 */
function enterListenReport() {
  saveCurrentListenReportDate(listenBroadcast.value?.bizDate);
  void navigateToScene("/pages/podcast/index");
}

/**
 * 配件助手跳转：弹层里填的是完整地址，原样带给内嵌页（不拼参数、不做校验）。
 */
function onPartsJump(url: string) {
  const target = String(url || "").trim();
  if (!target) return;
  void navigateToScene(`/pages/parts/index?url=${encodeURIComponent(target)}`);
}

/**
 * 音频卡片「去收听」：跳转前固定本次早报日期。
 */
function onGoListenReport() {
  enterListenReport();
}

/**
 * 历史抽屉分页取数。z-paging 每翻一页回调一次，实现落在 sessionStore 里。
 */
function getAISessionList(pageNo = 1, pageSize = 20) {
  return sessionStore.loadSessions(pageNo, pageSize);
}

function toggleQuickList(show: boolean) {
  if (chatStore.messages.length > 0 && show) return;
  chatStore.showQuickList = show;
}

/** 起飞动画时长：必须与 .welcome__logo-img 的 transform transition 对齐 */
const WELCOME_FLY_MS = 640;
/** 落位后留给「欢迎层 logo 淡出 → 对话页 logo 接上」的时间 */
const WELCOME_LAND_FADE_MS = 160;
let welcomeFlyTimer: ReturnType<typeof setTimeout> | null = null;

function readClientRect(selector: string) {
  if (typeof document === "undefined") return null;
  const el = document.querySelector(selector) as HTMLElement | null;
  return el ? el.getBoundingClientRect() : null;
}

/** 等两帧：第一帧把新节点画出来，第二帧写 transform 才会走 transition（否则是瞬移） */
function nextPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/**
 * 对话页首帧布局要等到这些时机才稳定：header 里的状态栏占位高度由 useSafeArea
 * 回填、字体/图标尺寸也可能在首帧后才定。这些都会让灵动岛图标整体上下移动，
 * 所以量目标位置之前要等布局落定，否则会量到偏高的一点（表现为「冲过头再掉回来」）。
 */
async function waitChatLayoutSettled() {
  await nextTick();
  await nextPaint();
  await new Promise<void>(resolve => setTimeout(resolve, 48));
}

/**
 * listen.gif 第一次「扩散到最大」的时刻，起飞动画卡在这一刻开始。
 *
 * 实测（500×500 / 150 帧 / 每帧 40ms）：图形面积占比 0ms 起一路涨到
 * 第 12 帧 480ms 达到最大值（ratio 0.12），之后 560ms 起回落收束。
 * 所以 480ms 就是第一次扩散的顶点；想改看第二段呼吸的顶点就填 3520。
 * 前提是动图从第 0 帧起播 —— AiWelcome 在点击时才挂载这张图来保证这一点。
 */
const WELCOME_LISTEN_PEAK_MS = 480;
/** 首帧 load 到父页面接管之间的相位差（约 1 帧），从峰值里扣掉，别让起飞晚半拍 */
const WELCOME_LISTEN_LOAD_LAG_MS = 40;
/** 切到 listen.gif 之后先停留多久再起飞（= 峰值时刻 - 已播掉的那 1 帧） */
const WELCOME_LISTEN_HOLD_MS = Math.max(0, WELCOME_LISTEN_PEAK_MS - WELCOME_LISTEN_LOAD_LAG_MS);
/** 对话页淡入从起飞那一刻开始，避免 logo 还停在中间时对话页已经铺满整屏 */
const CHAT_ENTER_DELAY_MS = Math.max(0, WELCOME_LISTEN_HOLD_MS - 120);

/** 飞行曲线的侧向弧线幅度（px）：首尾都在屏幕中线上，靠它画出「抛物线」的弧 */
const WELCOME_FLY_ARC_X = 18;
/** 中段最大放大倍数：先慢慢变大，末段再收敛回灵动岛图标尺寸 */
const WELCOME_FLY_PEAK_SCALE = 1.16;
/** 放大达到峰值的进度点（0~1）：前半程膨胀，后半程收小并加速冲刺 */
const WELCOME_FLY_PEAK_AT = 0.45;

/**
 * 岛内是否处在「从初始页飞进来」的 listen 态。
 *
 * 落位后切上去就一直保持 listen.gif，不再淡回常态三角图 —— 顶部从此就是这张呼吸图，
 * 想换回三角图只有两个出口：长按灵动岛回初始页，或页面卸载。
 */
const islandListenFromWelcome = ref(false);

/**
 * 初始页「点击说话」→ 立刻起飞，同时在问答页顶部做实时字幕（WS 流式 ASR）。
 *
 * 点击即进问答页：partial 边识别边在顶部从左往右长出来，说完（静音 1.5s）自动收尾，
 * final 再把它落成右侧用户气泡；这条气泡固定停在顶部，回答从它下面长出来。
 */
const voiceQueryActive = ref(false);
/** 实时字幕：partial 是「完整文本的当前版本」，直接整体替换，不要自己拼接 */
const voiceQueryText = ref("");
/** 实时音量 0~1（已平滑）：驱动底部录音条的声纹长短 */
const voiceLevel = ref(0);
/** 已录秒数：底部录音条右侧那枚 4s */
const voiceSeconds = ref(0);
let voiceSession: AsrStreamSession | null = null;
let voiceCapture: PcmCapture | null = null;
/** 每轮一个序号：重置 / 重开时让旧回调自行作废 */
let voiceSeq = 0;
/** 已发过 finish、正在等 final：静音检测 / 手动发送都可能触发，用它防重 */
const voiceFinishing = ref(false);
let voiceTickTimer: ReturnType<typeof setInterval> | null = null;
/** 静音收尾：连续这么久没声音就认为说完了（文档建议 1.5s） */
const VOICE_SILENCE_MS = 1500;
/** 一直没听到人声的兜底：别让麦克风空转 */
const VOICE_NO_SPEECH_MS = 8000;
let voiceNoSpeechTimer: ReturnType<typeof setTimeout> | null = null;
/** 判定「有声音」的 RMS 阈值，低于它按静音算 */
const VOICE_LEVEL_THRESHOLD = 0.015;
let voiceSilenceSince = 0;
let voiceHeard = false;

function resetVoiceQuery() {
  // 序号自增：正在 await 权限 / 采集的启动流程据此自行作废
  voiceSeq += 1;
  voiceQueryActive.value = false;
  voiceQueryText.value = "";
  voiceFinishing.value = false;
  voiceLevel.value = 0;
  voiceSeconds.value = 0;
  voiceSilenceSince = 0;
  voiceHeard = false;
  if (voiceNoSpeechTimer) {
    clearTimeout(voiceNoSpeechTimer);
    voiceNoSpeechTimer = null;
  }
  if (voiceTickTimer) {
    clearInterval(voiceTickTimer);
    voiceTickTimer = null;
  }
  voiceCapture?.stop();
  voiceCapture = null;
  voiceSession?.close();
  voiceSession = null;
}

function failVoiceQuery(title: string) {
  resetVoiceQuery();
  uni.showToast({ title, icon: "none" });
}

async function startVoiceQuery() {
  if (!isAsrStreamSupported() || !isPcmCaptureSupported()) {
    uni.showToast({ title: t("welcome-voice-unsupported"), icon: "none" });
    return;
  }

  const seq = ++voiceSeq;
  voiceQueryText.value = "";
  voiceFinishing.value = false;
  voiceLevel.value = 0;
  voiceSeconds.value = 0;
  voiceSilenceSince = 0;
  voiceHeard = false;
  voiceQueryActive.value = true;

  // 底部录音条的计时：从进入问答页就开始走，和真实录音时长对齐
  if (voiceTickTimer) clearInterval(voiceTickTimer);
  voiceTickTimer = setInterval(() => {
    voiceSeconds.value += 1;
  }, 1000);

  try {
    // 容器里要先向原生申请麦克风权限，否则浏览器那层会被静默拒绝
    const granted = await ensureNativePermission("record_audio");
    if (seq !== voiceSeq) return;
    if (!granted) {
      failVoiceQuery(permissionDeniedMessage("record_audio"));
      return;
    }

    const session = openAsrStreamSession({
      onPartial(text) {
        if (seq === voiceSeq) voiceQueryText.value = text;
      },
      onFinal(text) {
        if (seq !== voiceSeq) return;
        const query = String(text).trim();
        resetVoiceQuery();
        // 静音 / 误触时服务端回空串：提示重说，别拿空问题去提问
        if (!query) {
          uni.showToast({ title: t("no-speech-recognized"), icon: "none" });
          return;
        }
        sendQuickPrompt(query);
      },
      onError() {
        // 通道层失败（握手被网关拦、服务未部署）和「没听清」要分开提示，
        // 否则用户会以为是自己说话的问题
        if (seq === voiceSeq) failVoiceQuery(t("welcome-voice-unavailable"));
      },
    });
    voiceSession = session;

    const capture = await startPcmCapture({
      onFrame: frame => session.pushFrame(frame),
      onLevel: onVoiceLevel,
    });
    if (seq !== voiceSeq) {
      capture.stop();
      return;
    }
    voiceCapture = capture;

    // 采集就绪开始计时：一直没人说话就自己收尾，别让麦克风空转
    voiceNoSpeechTimer = setTimeout(() => {
      voiceNoSpeechTimer = null;
      if (!voiceHeard) stopVoiceQuery();
    }, VOICE_NO_SPEECH_MS);
  }
  catch (error) {
    logger.warn("voice query start failed", error);
    if (seq === voiceSeq) failVoiceQuery(t("record-start-failed"));
  }
}

/** 说完了：先停采集再发 finish，等 final 回来才落成气泡 */
function stopVoiceQuery() {
  if (!voiceQueryActive.value || voiceFinishing.value) return;
  voiceFinishing.value = true;
  // 计时停在这里：底部条要显示「最终录了几秒」，不要再涨
  if (voiceTickTimer) {
    clearInterval(voiceTickTimer);
    voiceTickTimer = null;
  }
  voiceCapture?.stop();
  voiceCapture = null;
  voiceSession?.finish();
}

/** 取消这一轮：直接断流，不发 finish、不落气泡 */
function cancelVoiceQuery() {
  if (!voiceQueryActive.value) return;
  resetVoiceQuery();
}

/** 静音检测：说过话之后连续 1.5s 没声音就自动收尾，用户不用再点一次 */
function onVoiceLevel(level: number) {
  // 声纹用的音量：RMS 0.15 已经算大声，再乘一次平滑，跳动才跟得上 100ms 的采样
  const normalized = Math.min(1, Math.max(0, level / 0.15));
  voiceLevel.value += (normalized - voiceLevel.value) * 0.35;

  if (level >= VOICE_LEVEL_THRESHOLD) {
    voiceHeard = true;
    voiceSilenceSince = 0;
    return;
  }
  if (!voiceHeard) return;
  if (!voiceSilenceSince) {
    voiceSilenceSince = performance.now();
    return;
  }
  if (performance.now() - voiceSilenceSince < VOICE_SILENCE_MS) return;
  stopVoiceQuery();
}

/**
 * 初始页「点击说话」的落地动作：起飞的同时把语音会话跑起来，
 * 用户在飞行动画里开口也不会丢（ready 前的音频由会话自己缓存）。
 */
function onWelcomeStart() {
  void startVoiceQuery();
  void goToChat();
}

/** 对话页把淡入推迟到起飞那一刻（保留原有 chatViewportStyle，只加一个动画延迟变量） */
const chatEnterStyle = computed(() => ({
  ...chatViewportStyle.value,
  "--chat-enter-delay": `${CHAT_ENTER_DELAY_MS}ms`,
}));

/** 当前这趟飞行的 rAF 取消器（重启 / 卸载时要掐掉，避免继续往已卸载的层写样式） */
let cancelWelcomeFly: (() => void) | null = null;

function stopWelcomeFly() {
  if (cancelWelcomeFly) {
    cancelWelcomeFly();
    cancelWelcomeFly = null;
  }
}

/**
 * 抛物线式飞行：逐帧算 transform。
 *
 * - 位移：进度取 1.9 次幂 → 起手慢、越往后越快（末段「冲刺」）；
 * - 轨迹：叠一条 sin 弧线，中段偏离中线最多、两端归零，看起来才是抛物线而不是直线；
 * - 尺寸：0 → 45% 从 1 放大到 1.16 倍，之后收到灵动岛图标的实际比例（62/110），
 *   落位时大小与顶部图标完全一致。
 */
function runWelcomeFly(from: DOMRect, to: DOMRect, onDone: () => void) {
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const targetScale = from.width > 0 ? to.width / from.width : 1;
  const startedAt = performance.now();
  let rafId = 0;

  const frame = (now: number) => {
    const p = Math.min(1, (now - startedAt) / WELCOME_FLY_MS);
    const travel = p ** 1.9;
    const arc = Math.sin(Math.PI * p) * WELCOME_FLY_ARC_X;
    const scale = p <= WELCOME_FLY_PEAK_AT
      ? 1 + (WELCOME_FLY_PEAK_SCALE - 1) * (p / WELCOME_FLY_PEAK_AT)
      : WELCOME_FLY_PEAK_SCALE
        + (targetScale - WELCOME_FLY_PEAK_SCALE) * ((p - WELCOME_FLY_PEAK_AT) / (1 - WELCOME_FLY_PEAK_AT));

    welcomeLogoStyle.value = {
      transform: `translate3d(${dx * travel + arc}px, ${dy * travel}px, 0) scale(${scale})`,
    };

    if (p < 1) {
      rafId = requestAnimationFrame(frame);
      return;
    }
    // 由最后一帧收尾（而不是另起一个固定时长的定时器）：两者时间基准不同，
    // 定时器有可能比最后一帧早到，把 logo 停在半路
    onDone();
  };

  rafId = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(rafId);
}

/**
 * 初始页 → 对话页：中间图标按抛物线飞到对话页顶部灵动岛的位置停住，
 * 同时欢迎层淡出、对话页整体淡入，避免硬切。
 *
 * 落点直接量 `.chat-header__island-logo` 的真实包围盒，所以不受状态栏高度、
 * 屏幕尺寸影响；落位尺寸按两侧宽度比收敛，交接瞬间不会跳大小。
 */
async function goToChat() {
  if (welcomeLeaving.value) return;
  try {
    uni.setStorageSync(AI_ASK_WELCOME_DONE_KEY, true);
  } catch (error) {
    logger.error("caught error", error);
  }

  // 起飞前先量欢迎页 logo 的中心（量飞行层，sani / listen 两张图都在它里面），
  // 随后欢迎层让位、对话页开始渲染
  const from = readClientRect(".welcome__logo-fly");
  const startedAt = performance.now();
  welcomeLeaving.value = true;
  pageStage.value = "chat";

  await waitChatLayoutSettled();
  const to = readClientRect(".chat-header__island-logo");

  // 等 listen.gif 扩散到最大再起飞：动图还在涨的时候就走，会显得后半段被吃掉
  const holdRemain = WELCOME_LISTEN_HOLD_MS - (performance.now() - startedAt);
  if (holdRemain > 0) {
    await new Promise<void>(resolve => setTimeout(resolve, holdRemain));
  }
  if (!welcomeLeaving.value) return;

  /** 落位收尾：先淡出欢迎层 logo（对话页图标同位置同尺寸接上），再卸载欢迎层 */
  const land = () => {
    stopWelcomeFly();
    welcomeLanded.value = true;
    if (welcomeFlyTimer) clearTimeout(welcomeFlyTimer);
    welcomeFlyTimer = setTimeout(() => {
      welcomeFlyTimer = null;
      welcomeLeaving.value = false;
      welcomeLanded.value = false;
      welcomeLogoStyle.value = {};
      // 位移特效彻底走完、欢迎层也收掉了，这时才把岛内换成 listen.gif：
      // 飞行途中提前换的话，会被上层欢迎层挡住一半，露出来的那半边容易看成「两张图打架」
      islandListenFromWelcome.value = true;
    }, WELCOME_LAND_FADE_MS);
  };

  if (from && to && to.width > 0) {
    stopWelcomeFly();
    cancelWelcomeFly = runWelcomeFly(from, to, () => {
      cancelWelcomeFly = null;
      land();
    });
    return;
  }

  // 量不到目标（对话页还没渲染出灵动岛）：不做位移，直接按原时长收尾
  if (welcomeFlyTimer) clearTimeout(welcomeFlyTimer);
  welcomeFlyTimer = setTimeout(land, WELCOME_FLY_MS);
}

function backToWelcome() {
  if (userStore.isVisitor) {
    try {
      uni.removeStorageSync(LISTEN_REPORT_DATE_KEY);
      uni.removeStorageSync(LISTEN_REPORT_CURRENT_DATE_KEY);
    } catch (error) {
      logger.warn("failed to reset visitor listen report state", error);
    }
    listenBroadcast.value = null;
    userStore.setVisitorRole(null);
    userStore.setUserId("");
  }
  // 嵌在宿主 APP 里时，返回交回 mPaaS 容器
  if (isMpaasReady()) {
    void closeWebview().catch(error => logger.warn("popWindow failed", error));
    return;
  }
  if (getCurrentPages().length > 1) uni.navigateBack({ delta: 1 });
}

/**
 * 长按顶部三角图标 5 秒：回到初始页。
 * 不换路由 —— 首页本身就是「初始页 / 对话页」两个态（pageStage），
 * 把 stage 打回 welcome 就等于重进初始页（AiWelcome 重新挂载，内部状态全清），
 * 同时把 demo 标记与「已进过对话」的存储标记清掉，
 * 否则 onShow 里的 syncPageStage 会立刻把页面拽回对话。
 */
function onRestartToStart() {
  // 生成中：先掐在途请求与听播，避免旧回包继续往新状态里写
  cancelActiveStream();
  realtimeTts.stop();
  // 收起挂着的浮层，别让抽屉 / 追问卡压在初始页上
  guideStepSheetVisible.value = false;
  guideSuggestionSheetVisible.value = false;
  askSlotDrawerVisible.value = false;
  guideStepPayload.value = null;
  guideSuggestionPayload.value = null;
  askSlotQueue.value = [];
  // 离开 demo 模式，并清掉「欢迎页已完成」标记（会员分支靠它决定要不要直接进对话）
  isDemoPage = false;
  try {
    uni.removeStorageSync(AI_ASK_WELCOME_DONE_KEY);
  } catch (error) {
    logger.warn("failed to clear welcome flag", error);
  }
  // 初始页重新进来就是一轮新会话，与 role-select / 初始页「开始体验」的入口保持一致
  chatStore.resetConversation();
  // 复位起飞动画状态，下次进对话页重新量落点（否则 logo 会停在上一次的位置）
  if (welcomeFlyTimer) {
    clearTimeout(welcomeFlyTimer);
    welcomeFlyTimer = null;
  }
  stopWelcomeFly();
  resetVoiceQuery();
  islandListenFromWelcome.value = false;
  welcomeLeaving.value = false;
  welcomeLanded.value = false;
  welcomeLogoStyle.value = {};
  pageStage.value = "welcome";
}

async function openLocalHistory(id: string | number, force = false) {
  if (!force && String(chatStore.aiSessionId) === String(id) && chatStore.messages.length) return;
  cancelActiveStream();
  chatStore.showQuickPrompts = false;
  chatStore.showQuickList = false;
  chatStore.messages = [];
  sessionStore.isSessionSwitching = true;
  chatStore.aiSessionId = id;
  try {
    await sessionStore.loadHistory(id, chatStore);
  } catch (error) {
    logger.error("caught error", error);
    uni.showToast({ title: t("load-history-failed"), icon: "none" });
  } finally {
    sessionStore.isSessionSwitching = false;
  }
}

function onSessionClick(session: { sessionId?: string | number; id?: string | number; inputs?: Record<string, unknown> }) {
  const id = getSessionId(session);
  if (!id) return;
  if (navigateToSessionScene(session, "ASK")) return;
  if (String(chatStore.aiSessionId) === String(id)) return;
  void openLocalHistory(id);
}

async function confirmModal(title: string, content: string) {
  return new Promise<boolean>((resolve) => {
    uni.showModal({
      title,
      content,
      confirmColor: "#F8315E",
      success: res => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    });
  });
}

async function onSessionDelete(session: { id?: string | number }) {
  const id = session?.id;
  if (!id) return;
  if (!await confirmModal("删除此对话？", "删除后，这条对话记录将无法找回。确定删除此对话？")) return;
  try {
    await sessionStore.removeSession(id);
    if (String(chatStore.aiSessionId) === String(id)) chatStore.resetConversation();
    uni.showToast({ title: t("delete-success"), icon: "none" });
  } catch (error) {
    logger.error("caught error", error);
    uni.showToast({ title: t("delete-failed"), icon: "none" });
  }
}

async function onSessionDeleteBatch(ids: Array<string | number>) {
  const uniqueIds = Array.from(new Set((ids || []).map(id => String(id))));
  if (!uniqueIds.length) return;
  if (!await confirmModal("批量删除选中对话？", "删除后，选中对话记录将无法找回。确定删除选中对话？")) return;
  try {
    await sessionStore.removeSessions(uniqueIds);
    if (chatStore.aiSessionId && uniqueIds.includes(String(chatStore.aiSessionId))) {
      chatStore.resetConversation();
    }
    uni.showToast({ title: t("delete-success"), icon: "none" });
  } catch (error) {
    logger.error("caught error", error);
    uni.showToast({ title: t("batch-delete-failed"), icon: "none" });
  }
}

async function onSessionRename(session: { id?: string | number; name?: string }) {
  const id = session?.id;
  const name = (session?.name || "").trim();
  if (!id || !name) return;
  try {
    await sessionStore.renameSession(id, name);
    uni.showToast({ title: t("rename-success"), icon: "none" });
  } catch (error) {
    logger.error("caught error", error);
    uni.showToast({ title: t("rename-failed"), icon: "none" });
  }
}

async function loadAwakeningPrompt() {
  if (!userStore.visitorRole || userStore.awakeningPrompt) return;
  chatStore.awakeningLoading = true;
  try {
    userStore.setAwakeningPrompt(await getTodayAwakeningPrompt() ?? null);
  } catch (error) {
    logger.warn("failed to load awakening prompt", error);
    userStore.setAwakeningPrompt(null);
  } finally {
    chatStore.awakeningLoading = false;
  }
}

async function loadTodayListenBroadcast() {
  if (!isDemoPage) return;
  listenBroadcastLoading.value = true;
  try {
    listenBroadcast.value = await getTodayListenBroadcast();
    saveCurrentListenReportDate(listenBroadcast.value?.bizDate);
  } catch (error) {
    logger.warn("failed to load today listen broadcast", error);
    listenBroadcast.value = null;
  } finally {
    listenBroadcastLoading.value = false;
  }
}

function syncPageStage() {
  if (isDemoPage) {
    pageStage.value = "chat";
    return;
  }
  try {
    if (!userStore.isVisitor && uni.getStorageSync(AI_ASK_WELCOME_DONE_KEY)) {
      pageStage.value = "chat";
    }
  } catch (error) {
    logger.error("caught error", error);
  }
}

/**
 * 一键回到底部：没贴底时出现，回到底部（含发送后强制贴底）自动消失。
 * 分享选择态、贴底卡片（步骤卡 / 追问卡）展开时不显示，避免和这些浮层抢位置。
 */
const showScrollToBottom = computed(
  () =>
    !shareSheetVisible.value
    && !guideStepSheetVisible.value
    && !askSlotDrawerVisible.value
    && !pinnedToBottom.value
    && (messages.value?.length || 0) > 0,
);

function onScrollToBottomTap() {
  // 点了就恢复「跟随底部」，后续流式增量会继续贴底
  // 落点是「真末尾」（含最后一条消息的操作栏 / 参考来源），不能用 scrollToBottom：
  // 首页开着 stopAtReplyEnd，那条落点会把尾部操作栏留在输入栏下面，看起来没到底
  chatStore.jumpToBottom();
}

/**
 * 消息列表上报贴底状态，不能直接绑 setPinnedToBottom：
 * 用户自己滑回底部时要把本轮的「提问封顶」一起撤掉，
 * 否则下一帧内容长高，对齐又会把视图拽回提问那边（表现为「滑到底又弹回去」）。
 */
function onPinnedChange(pinned: boolean) {
  chatStore.setPinnedToBottom(pinned);
  if (pinned) chatStore.setCapRoundAtTop(false);
}

async function onScrollTop() {
  if (!chatStore.aiSessionId) return;
  try {
    await sessionStore.loadMoreHistory(chatStore);
  } catch (error) {
    logger.error("failed to load more history", error);
    uni.showToast({ title: t("load-history-failed"), icon: "none" });
  }
}

onLoad((options) => {
  isDemoPage = options?.mode === "demo";
  syncPageStage();
  const sessionId = readSessionIdFromOptions(options) || peekPendingHistorySession("ASK", "PODCAST");
  if (sessionId) {
    pageStage.value = "chat";
    void openLocalHistory(consumePendingHistorySession("ASK", "PODCAST") || sessionId, true);
  }
  void loadTodayListenBroadcast();
});

onMounted(() => {
  syncWindowHeight();
  loadAwakeningPrompt();
  uni.$on("listen-report-marked", refreshListenReportState);
});
function refreshListenReportState() {
  listenReportRefreshKey.value += 1;
}

const stopNativeResume = onNativeEvent("resume", () => {
  refreshListenReportState();
  // 维修助手是独立场景窗口：关窗回到本页时原 webview 一直在，不会经历 onHide/onShow，
  // 只靠 onShow 消费回调会漏，这里在原生 resume 上补一次（重复调用有 pending 判空，安全）。
  startRepairSummaryCallback();
});

onShow(() => {
  syncWindowHeight();
  const sessionId = consumePendingHistorySession("ASK", "PODCAST");
  if (sessionId) {
    pageStage.value = "chat";
    void openLocalHistory(sessionId, true);
  }
  syncPageStage();
  chatStore.refreshQuickPrompts();
  refreshListenReportState();
  startRepairSummaryCallback();
});
// 离开页面时停止自动听播：navigateTo 进入别的页面时本页只是被压栈隐藏、组件并不卸载，
// useRealtimeTts 自带的 onBeforeUnmount(stop) 不会触发，必须挂在 onHide / onUnload 上。
onHide(() => {
  realtimeTts.stop();
});
onUnload(() => {
  realtimeTts.stop();
});
onBeforeUnmount(() => {
  clearRepairSummaryPolling();
  stopNativeResume();
  uni.$off("listen-report-marked", refreshListenReportState);
  cancelActiveStream();
  realtimeTts.stop();
  if (welcomeFlyTimer) {
    clearTimeout(welcomeFlyTimer);
    welcomeFlyTimer = null;
  }
  stopWelcomeFly();
  resetVoiceQuery();
  islandListenFromWelcome.value = false;
});
</script>

<template>
  <view class="ai-page" :class="{ 'ai-page--dark': isDark }">
    <!-- 欢迎页：起飞动画期间继续挂载，logo 滑到顶部再收起 -->
    <AiWelcome
      v-if="showWelcome"
      :leaving="welcomeLeaving"
      :landed="welcomeLanded"
      :logo-style="welcomeLogoStyle"
      @start-chat="onWelcomeStart"
    />

    <!-- 问答页：与欢迎层同时存在，整体淡入 -->
    <view
      v-if="pageStage === 'chat'"
      class="ai-page__chat ai-page__chat--enter"
      :style="chatEnterStyle"
    >
      <view class="ai-chat-glow ai-chat-glow--blue" />
      <view class="ai-chat-glow ai-chat-glow--red" />
      <!-- 设备线稿背景图：跟着用户选的机型走（履带吊 / 混凝土泵车）；深色下隐藏（见 .ai-page--dark） -->
      <AiChatBackdrop class="ai-page__backdrop" />
      <!-- 顶部白色渐变：页面上沿由白向下渐隐，压住线稿背景与滚上来的内容 -->
      <view class="ai-page__top-fade" />
      <!-- Header：悬浮在内容之上（不占布局），消息可以滚到它下面，由 .ai-page__top-fade 做毛玻璃渐隐 -->
      <AiChatHeader
        v-model:sessions="sessions"
        class="ai-page__header"
        plain-bg
        :load-sessions="getAISessionList"
        :selected-session-id="aiSessionId"
        :generating="isLoading"
        :realtime-tts-playing="realtimeTts.playing.value"
        :share-mode="shareSheetVisible"
        :share-select-all-disabled="shareSelectAllDisabled"
        :share-all-checked="shareAllChecked"
        :share-selected-round-count="shareSelectedRoundCount"
        :voice-listening="voiceListening"
        :listen-idle="islandListenFromWelcome"
        restartable
        @back="backToWelcome"
        @restart="onRestartToStart"
        @new-conversation="startNewConversation"
        @session-click="onSessionClick"
        @session-delete="onSessionDelete"
        @session-delete-batch="onSessionDeleteBatch"
        @session-rename="onSessionRename"
        @share-select-all="onShareSelectAll"
      />
      <AiMessageList
        :key="aiSessionId || 'new-conversation'"
        top-inset="var(--chat-top-inset, 300rpx)"
        :dark="isDark"
        :messages="messages"
        :quick-prompts="localizedQuickPrompts"
        :show-quick-prompts="showQuickPrompts"
        :show-business-overview="false"
        :top-aligned="true"
        :scroll-into-view="scrollIntoView"
        :reply-end-token="replyEndToken"
        :pin-message-token="chatStore.pinMessageToken"
        :pin-message-id="chatStore.pinMessageId"
        :cap-round-at-top="chatStore.capRoundAtTop"
        :show-quick-list="showQuickList"
        :selected-indexes="shareSelectedIndexes"
        :select-mode="shareSheetVisible"
        :suppress-highlight="shareSuppressHighlight"
        :bottom-inset="messageBottomInset"
        :step-card-step-id="guideStepCardStepId"
        :pin-step-card="guideStepSheetVisible"
        @card-space-change="onGuideStepCardSpaceChange"
        @content-grow="chatStore.scrollToBottom()"
        :awakening="userStore.awakeningPrompt"
        :awakening-loading="awakeningLoading"
        :listen-broadcast="listenBroadcast"
        :listen-broadcast-loading="listenBroadcastLoading"
        :listen-report-refresh-key="listenReportRefreshKey"
        :pinned-to-bottom="pinnedToBottom"
        :realtime-tts-message-key="realtimeTts.playingMessageKey.value"
        :realtime-tts-playing="realtimeTts.playing.value"
        @quick-prompt="sendUserPrompt"
        @suggestion-tap="sendUserPrompt"
        @ask-slot-open="onAskSlotOpen"
        @assistant-navigation-open="onAssistantNavigationOpen"
        @assistant-callback-open="onAssistantCallbackOpen"
        @guide-step-open="onGuideStepOpen"
        @guide-suggestion-open="onGuideSuggestionOpen"
        @guide-check-step-select="onGuideCheckStepSelect"
        @tts-click="onTtsClick"
        @feedback-change="onFeedbackChange"
        @share-click="onShareClick"
        @copy-click="onCopyMessage"
        @select-toggle="onShareSelectToggle"
        @listen-report="onGoListenReport"
        @scroll-top="onScrollTop"
        @pinned-change="onPinnedChange"
      />
      <!-- 语音提词：初始页说出来的那句话先在顶部逐字铺开（左对齐、图标下方 20px），
           铺完再收成右侧用户气泡发出去 -->
      <view v-if="voiceQueryActive" class="voice-typewriter">
        <text class="voice-typewriter__body">
          {{ voiceQueryText || t("welcome-voice-listening") }}
        </text>
        <text class="voice-typewriter__caret">
          |
        </text>
      </view>
      <!-- 一键回到底部：离底时出现，贴底自动隐藏；
           垂直位置 = 输入栏高（含键盘抬起）+ 24rpx 间隙；
           水平居中，只放 arrow-down.png（无白底 / 阴影，见 .chat-scroll-bottom） -->
      <view
        v-if="showScrollToBottom && !voicePanelOpen"
        class="chat-scroll-bottom"
        :style="{ bottom: `calc(${composerBottomInset} + 24rpx)` }"
        @tap="onScrollToBottomTap"
      >
        <image
          class="chat-scroll-bottom__chevron"
          src="@/assets/img/arrow-down.png"
          mode="aspectFit"
        />
      </view>
      <AiSlotDrawer
        :slots="askSlotQueue"
        :visible="askSlotDrawerVisible"
        :dark="isDark"
        @close="closeAskSlotDrawer"
        @submit="onAskSlotSubmit"
        @height-change="onAskSlotDrawerHeightChange"
      />
      <AiAssistantNavigationSheet
        v-model:visible="assistantNavigationVisible"
        :payload="assistantNavigationPayload"
        @confirm="onAssistantNavigationConfirm"
      />
      <!-- 底部「配件助手」入口：填地址 → 新开内嵌页 -->
      <AiPartsJumpSheet
        v-model:visible="partsJumpVisible"
        :dark="isDark"
        @jump="onPartsJump"
      />
      <AiGuideStepSheet
        ref="guideStepSheetRef"
        v-model:visible="guideStepSheetVisible"
        :payload="guideStepPayload"
        :step-index="guideStepRequestedIndex"
        :keyboard-height="keyboardHeight"
        @submit="onGuideStepSubmit"
        @height-change="onGuideStepHeightChange"
        @step-change="onGuideStepChange"
        @photo="onGuideStepPhoto"
      />
      <AiGuideSuggestionSheet
        v-model:visible="guideSuggestionSheetVisible"
        :payload="guideSuggestionPayload"
        :keyboard-height="keyboardHeight"
        @submit="onGuideSuggestionSubmit"
        @height-change="onGuideSuggestionHeightChange"
      />
      <view v-if="isSessionSwitching" class="session-loading">
        <view class="session-loading__spinner" />
      </view>

      <view v-if="shareSheetVisible" class="share-sheet-modal">
        <view class="share-sheet" @tap.stop>
          <text class="share-sheet__title">
            分享到：
          </text>
          <view class="share-sheet__options">
            <view
              v-for="item in shareSheetOptions"
              :key="item.key"
              class="share-sheet__option"
              :class="{
                'share-sheet__option--disabled':
                  item.key === 'share-image' && shareSelectedIndexes.length === 0,
              }"
              @tap="
                item.key === 'share-image' && shareSelectedIndexes.length === 0
                  ? null
                  : onShareSheetOption(item)
              "
            >
              <view class="share-sheet__option-icon">
                <image :src="item.icon" mode="aspectFit" class="share-sheet__option-icon-img" />
              </view>
              <text class="share-sheet__option-label">
                {{ item.label }}
              </text>
            </view>
          </view>
          <view class="share-sheet__divider" />
          <view class="share-sheet__cancel-btn" @tap="closeShareSheet">
            <text class="share-sheet__cancel-text">
              {{ $t("cancel") }}
            </text>
          </view>
        </view>
      </view>

      <!-- 分享图片预览/生成（Figma: 495:809） -->
      <view v-else-if="sharePosterVisible" class="share-poster-modal">
        <view class="share-poster-modal__mask" @tap="closeSharePosterModal" />
        <view class="share-poster-modal__card" @tap.stop>
          <view class="share-poster-modal__content">
            <view v-if="sharePosterGenerating" class="share-poster-modal__loading">
              <view class="share-poster-modal__loading-content">
                <view class="session-loading__spinner share-poster-modal__loading-spinner" />
                <text class="share-poster-modal__loading-text">
                  图片生成中
                </text>
              </view>
            </view>
            <scroll-view
              v-else-if="sharePosterDataUrl"
              class="share-poster-modal__scroll-img"
              scroll-y
              :scroll-with-animation="true"
            >
              <view class="share-poster-modal__img-center">
                <image class="share-poster-modal__img" :src="sharePosterDataUrl" mode="widthFix" />
              </view>
            </scroll-view>
          </view>

          <view class="share-poster-modal__bottom">
            <view class="share-poster-modal__bottom-action-wrap">
              <view class="share-poster-modal__option" @tap="onSaveSharePoster">
                <view class="share-poster-modal__option-icon">
                  <image class="share-poster-modal__option-icon-img" :src="iconSaveImage" mode="aspectFit" />
                </view>
                <text class="share-poster-modal__option-label">
                  保存图片
                </text>
              </view>
              <view class="share-poster-modal__option" @tap="onCopySharePoster">
                <view class="share-poster-modal__option-icon">
                  <image class="share-poster-modal__option-icon-img" :src="iconCopyImage" mode="aspectFit" />
                </view>
                <text class="share-poster-modal__option-label">
                  复制图片
                </text>
              </view>
            </view>
            <view class="share-poster-modal__divider" />
            <view class="share-poster-modal__cancel" @tap="closeSharePosterModal">
              <text class="share-poster-modal__cancel-text">
                取消
              </text>
            </view>
          </view>
        </view>

        <view id="share-poster-wrap" ref="sharePosterWrap" class="share-poster-hidden">
          <ShareConversationPoster :messages="messages" :selected-indexes="shareSelectedIndexes" />
        </view>
      </view>

      <AiChatInput
        v-else-if="!voiceQueryActive"
        ref="chatInputRef"
        v-model="inputText"
        :dark="isDark"
        :is-loading="isLoading"
        :keyboard-height="keyboardHeight"
        :voice-keyboard-height="voiceKeyboardHeight"
        :compact-voice-listening="true"
        :tap-to-talk="true"
        @send="sendMessage"
        @voice-query-start="startVoiceQuery"
        @stop="stopGenerating"
        @voice-start="stopRealtimeTtsOnVoiceStart"
        @voice-restart="stopRealtimeTtsOnVoiceStart"
        @voice-listening="voiceListening = $event"
        @recognize-begin="beginAsrPlaceholder"
        @recognize-fail="discardAsrPlaceholder"
        @toggle-quick-list="toggleQuickList"
        @input-focus="setTextInputFocused(true)"
        @input-blur="setTextInputFocused(false)"
        @voice-input-focus="setVoiceInputFocused(true)"
        @voice-input-blur="setVoiceInputFocused(false)"
        @voice-panel-open="voicePanelOpen = $event"
        @dock-height-change="setInputDockHeight"
      />

      <!-- 录音中：输入栏换成「取消 / 声纹 / 计时 + 发送」这一条（稿子 Frame 114） -->
      <AiVoiceQueryBar
        v-else
        :level="voiceLevel"
        :seconds="voiceSeconds"
        :busy="voiceFinishing"
        :dark="isDark"
        @cancel="cancelVoiceQuery"
        @submit="stopVoiceQuery"
      />

      <AiBadFeedbackSheet
        :visible="badFeedbackSheetVisible"
        @close="onBadFeedbackClose"
        @confirm="onBadFeedbackConfirm"
      />
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* Design tokens from Ardot */
$color-text-primary: #1a1a1a;       // r:0.102
$color-text-secondary: #6b6b6b;     // r:0.420
$color-text-muted: #bababa;         // r:0.729
$color-red-accent: #ff0000;
$color-red-btn: #fe0000;             // r:0.996 g:0 b:0
$color-bg-phone: #fafafa;           // r:0.98
$color-bg-voice: #f5f5f5;           // r:0.96
$color-border-light: #efefef;       // r:0.937
$color-white: #ffffff;

/* Background */
.phone-bg {
  position: absolute;
  inset: 0;
  background-color: $color-bg-phone;
  z-index: 0;
}

/* Decorative glows — top corners */
.glow {
  position: absolute;
  z-index: 1;
  pointer-events: none;
}

.glow-blue {
  left: -40px;
  top: -20px;
  width: 280px;
  height: 180px;
  background: radial-gradient(
    ellipse 80% 60% at 40% 40%,
    rgba(123, 167, 217, 0.10) 0%,
    rgba(123, 167, 217, 0.04) 50%,
    rgba(123, 167, 217, 0) 70%
  );
  filter: blur(8px);
}

.glow-red {
  left: 44px;
  top: -20px;
  width: 380px;
  height: 180px;
  background: radial-gradient(
    ellipse 70% 55% at 60% 35%,
    rgba(255, 80, 80, 0.08) 0%,
    rgba(255, 80, 80, 0.03) 50%,
    rgba(255, 80, 80, 0) 70%
  );
  filter: blur(10px);
}

.ai-page {
  min-height: 100vh;
  height: 100%;
  box-sizing: border-box;
  background: #fafafa;
  font-family: PingFang SC;
  overflow: hidden;
  overscroll-behavior: none;
}

.ai-page__chat {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  background: #fafafa;
  overflow: hidden;
  position: relative;
  // 顶部毛玻璃层的高度 = 悬浮头部在内容里的占位：
  // 两者共用一个值，消息正好从渐隐的下沿起步，往上滚就被模糊掉
  --chat-top-inset: calc(constant(safe-area-inset-top) + 300rpx);
  --chat-top-inset: calc(env(safe-area-inset-top) + 300rpx);
}

/* 初始页 → 对话页：整页淡入。
   延迟由 --chat-enter-delay 控制（= listen.gif 停留时间），让淡入跟起飞同时开始，
   不会出现「logo 还挂在中间、对话页已经铺满」的割裂感 */
.ai-page__chat--enter {
  animation: ai-page-chat-in 720ms cubic-bezier(0.22, 0.61, 0.36, 1) var(--chat-enter-delay, 0ms) both;
}

@keyframes ai-page-chat-in {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

/* 语音提词：落点与第一条用户气泡完全一致（气泡顶边就是内容上内边距的下沿），
   这样文字收成气泡时原地接管，不会上下跳。
   z-index 要盖过顶部毛玻璃（1）、又低于头部（1010），文字才不会被模糊层吃掉 */
.voice-typewriter {
  position: absolute;
  top: var(--chat-top-inset, 300rpx);
  right: 40rpx;
  left: 40rpx;
  z-index: 1005;
  pointer-events: none;
}

.voice-typewriter__body,
.voice-typewriter__caret {
  color: #0d0d0d;
  font-size: 32rpx; // 16px
  font-weight: 500;
  line-height: 48rpx;
}

.voice-typewriter__body {
  word-break: break-all;
}

/* 打字光标：靠闪烁给出「正在说」的节奏 */
.voice-typewriter__caret {
  margin-left: 4rpx;
  animation: voice-caret-blink 1s steps(1) infinite;
}

@keyframes voice-caret-blink {
  0%,
  50% {
    opacity: 1;
  }

  50.01%,
  100% {
    opacity: 0;
  }
}

.ai-page--dark .voice-typewriter__body,
.ai-page--dark .voice-typewriter__caret {
  color: #f2f3f5;
}

// 一键回到底部：只剩 arrow-down.png 图本身（白底圆钮 / 阴影 / 描边全部去掉），水平居中。
// bottom 由行内样式给：composerBottomInset（输入栏高 + 键盘抬起）+ 24rpx 间隙
/* 一键回到底部：只剩 arrow-down.png 图本身（白底圆钮 / 阴影 / 描边全部去掉），水平居中 */
.chat-scroll-bottom {
  position: absolute;
  left: 50%;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: translateX(-50%);
}

/* 箭头：直接用设计给的 arrow-down.png，显示框 64×64px（= 128rpx，1px = 2rpx） */
.chat-scroll-bottom__chevron {
  display: block;
  width: 128rpx; // 64px
  height: 128rpx; // 64px
}

// 头部悬浮：不占布局高度，消息可以滚到它下面，透过 .ai-page__top-fade 的毛玻璃淡出；
// 同时要盖住消息列表和输入栏：历史抽屉、操作菜单都挂在它的层叠上下文里，
// 留在 z-index:1 会被后面的兄弟节点盖掉（气泡压在抽屉上就是这个原因）。
// 这里必须是 1010：历史抽屉（内部 1000）的层级帽由这一层决定，
// 底部 slot 抽屉是 1002，小于它就会被压住（附件弹窗 1020 仍在其上）
.ai-page__chat > .ai-page__header {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  z-index: 1010;
}

// 顶部毛玻璃渐隐（对应设计稿 722:152「回答」头部底板）：
// 不铺白色底 —— 透明 + 背后模糊，消息滚到头部下面还能看见字，只是被虚化；
// 「渐变」体现在模糊强度上：上沿最糊，往下渐弱到完全清晰，接住正文，没有硬边。
// 高度 = 刘海安全区 + 300rpx（与 --chat-top-inset 一致，消息正好从渐隐下沿起步）。
.ai-page__top-fade {
  position: absolute;
  z-index: 1;
  top: 0;
  right: 0;
  left: 0;
  height: calc(constant(safe-area-inset-top) + 300rpx);
  height: calc(env(safe-area-inset-top) + 300rpx);
  pointer-events: none;
  // 只模糊、不遮挡（老内核拿不到 backdrop-filter 时，退化成下面那层极淡的雾，文字照样看得见）
  backdrop-filter: blur(16rpx); // 8px
  -webkit-backdrop-filter: blur(16rpx);
  // 模糊强度按 mask 的 alpha 渐变：0% 满强度 → 45% 约七成 → 100% 完全清晰
  mask-image: linear-gradient(180deg, #000 0%, rgba(0, 0, 0, 0.7) 45%, rgba(0, 0, 0, 0) 100%);
  -webkit-mask-image: linear-gradient(180deg, #000 0%, rgba(0, 0, 0, 0.7) 45%, rgba(0, 0, 0, 0) 100%);
  // 极淡一层同色雾：顶部文字比正文稍淡一点，但不至于被吃掉
  background: linear-gradient(
    180deg,
    rgba(250, 250, 250, 0.34) 0%,
    rgba(250, 250, 250, 0.18) 48%,
    rgba(250, 250, 250, 0) 100%
  );
}

.ai-chat-glow {
  position: absolute;
  z-index: 0;
  pointer-events: none;
  border-radius: 0;
  filter: none;
}

.ai-chat-glow--blue {
  top: 0;
  left: 0;
  width: 392rpx;
  height: 234rpx;
  background: radial-gradient(
    ellipse 196rpx 117rpx at 0 0,
    rgba(123, 167, 217, 0.12) 0%,
    rgba(123, 167, 217, 0) 100%
  );
}

.ai-chat-glow--red {
  top: 0;
  right: 0;
  width: 602rpx;
  height: 234rpx;
  background: radial-gradient(
    ellipse 301rpx 117rpx at 100% 0,
    rgba(254, 0, 0, 0.1) 0%,
    rgba(254, 0, 0, 0) 100%
  );
}

.session-loading {
  position: absolute;
  left: 0;
  right: 0;
  top: 180rpx;
  bottom: 200rpx;
  z-index: 15;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.session-loading__spinner {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  border: 6rpx solid rgba(95, 103, 117, 0.2);
  border-top-color: #c8201e;
  animation: session-spin 0.9s linear infinite;
}

@keyframes session-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* Share sheet (495:759) */
/* 分享面板必须盖住 header（1010）：历史抽屉与设置弹层都挂在 header 的层叠上下文里 */
.share-sheet-modal {
  position: fixed;
  inset: 0;
  z-index: 1030;
  pointer-events: none;
}

.share-sheet {
  position: absolute;
  pointer-events: auto;
  right: 0;
  bottom: 0;
  left: 0;
  box-sizing: border-box;
  border-top: 2rpx solid #eeeeee;
  border-radius: 32rpx 32rpx 0 0;
  background: #ffffff;
  box-shadow: 0 -12rpx 32rpx rgba(0, 0, 0, 0.1);
  padding: 40rpx 60rpx 32rpx;
}

.share-sheet__title {
  display: block;
  height: 40rpx;
  font-family: "PingFang SC";
  font-size: 28rpx;
  font-weight: 700;
  line-height: 40rpx;
  color: #1a1a1a;
}

.share-sheet__options {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-top: 40rpx;
}

.share-sheet__option {
  width: 112rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18rpx;
}

.share-sheet__option--disabled {
  opacity: 0.35;
  pointer-events: none;
}

.share-sheet__option-icon {
  width: 112rpx;
  height: 112rpx;
  border-radius: 50%;
  background: #f2f2f2;
  display: flex;
  align-items: center;
  justify-content: center;
}

.share-sheet__option-icon-img {
  width: 56rpx;
  height: 56rpx;
}

.share-sheet__option-label {
  height: 40rpx;
  font-family: "PingFang SC";
  font-size: 26rpx;
  font-weight: 700;
  line-height: 40rpx;
  color: #1a1a1a;
  text-align: center;
  white-space: nowrap;
}

.share-sheet__divider {
  height: 2rpx;
  margin-top: 34rpx;
  background: #e4e4e4;
}

.share-sheet__cancel-btn {
  height: 40rpx;
  margin-top: 28rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.share-sheet__cancel-text {
  font-family: "PingFang SC";
  font-size: 28rpx;
  font-weight: 500;
  line-height: 40rpx;
  color: #999999;
}

/* Share Poster Modal */
/* 海报弹窗同样要盖住 header（1010） */
.share-poster-modal {
  position: fixed;
  inset: 0;
  z-index: 1030;
  display: flex;
  align-items: center;
  justify-content: center;
}

.share-poster-modal__mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
}

.share-poster-modal__card {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: transparent;
  display: flex;
  flex-direction: column;
}

.share-poster-modal__content {
  flex: 1;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 30rpx 42rpx 0;
  box-sizing: border-box;
  overflow: hidden;
}

.share-poster-modal__img-wrap {
  width: 100%;
  height: 100%;
}

.share-poster-modal__loading {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.share-poster-modal__loading-content {
  width: 200rpx;
  height: 200rpx;
  border-radius: 30rpx;
  background: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16rpx;
}

.share-poster-modal__loading-spinner {
  border-top-color: #c8201e;
}

.share-poster-modal__loading-text {
  font-size: 24rpx;
  line-height: 32rpx;
  color: #5f6775;
}

.share-poster-modal__bottom {
  padding: 40rpx 60rpx 32rpx;
  background: #fff;
  box-shadow: 0 -4rpx 42rpx rgba(0, 0, 0, 0.0601);
  display: flex;
  flex-direction: column;
  border-radius: 32rpx 32rpx 0 0;
}

.share-poster-modal__bottom-action-wrap {
  display: flex;
  align-items: flex-start;
  gap: 61.333rpx;
}

.share-poster-modal__option {
  width: 112rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18rpx;
}

.share-poster-modal__option-icon {
  width: 112rpx;
  height: 112rpx;
  border-radius: 50%;
  background: #f2f2f2;
  display: flex;
  align-items: center;
  justify-content: center;
}

.share-poster-modal__option-icon-img {
  width: 56rpx;
  height: 56rpx;
}

.share-poster-modal__option-label {
  height: 40rpx;
  font-family: "PingFang SC";
  font-size: 26rpx;
  font-weight: 700;
  line-height: 40rpx;
  color: #1a1a1a;
  text-align: center;
  white-space: nowrap;
}

.share-poster-modal__divider {
  height: 2rpx;
  margin-top: 34rpx;
  background: #e4e4e4;
}

.share-poster-modal__cancel {
  height: 40rpx;
  margin-top: 28rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.share-poster-modal__cancel-text {
  font-family: "PingFang SC";
  font-size: 28rpx;
  font-weight: 500;
  line-height: 40rpx;
  color: #999999;
}

.share-poster {
  width: 656rpx;
  margin: 0 auto;
  background: #ffffff;
  border-radius: 24rpx;
  padding: 24rpx 30rpx 30rpx;
  box-sizing: border-box;
}

.share-poster-modal__img {
  width: 100%;
  max-width: 656rpx;
  height: auto;
  display: block;
  margin: 0 auto;
  border-radius: 24rpx;
}

.share-poster-modal__scroll-img {
  flex: 1;
  width: 100%;
  height: 100%;
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.share-poster-modal__scroll-img ::v-deep ::-webkit-scrollbar {
  display: none;
}

.share-poster-modal__img-center {
  display: flex;
  min-height: 100%;
  box-sizing: border-box;
  align-items: center;
  justify-content: center;
  padding: 32rpx 0;
}
.share-poster-hidden {
  position: fixed;
  z-index: -1;
  top: 0;
  left: -9999px;
  pointer-events: none;
}

/* ===== 深色主题：首页问答态（Ardot 1193:2097「日常运营助手-老板-个性觉醒」） =====
   只替换底色与材质，间距 / 圆角 / 字号两稿一致，不做改动：
   - 页面底 1193:2122：#1A1A1A（不是纯黑，浅色稿的 #FAFAFA 一一对应）
   - 顶部渐隐 1193:2129;722:341 Rectangle 152：#1A1A1A 100% → 0% 竖向渐变
   - 角落光晕 1193:2123 Blue Glow TL / 1193:2124 Red Glow TR：深色稿 visible = false
   - 设备线稿 1193:2125 Frame 85：深色稿 visible = false */
.ai-page--dark {
  background: #1a1a1a;

  .ai-page__chat {
    background: #1a1a1a;
  }

  // 渐隐材质换成深色页面底：上沿完全盖住滚上来的内容，往下渐透
  .ai-page__top-fade {
    background: linear-gradient(
      180deg,
      #1a1a1a 0%,
      rgba(26, 26, 26, 0.7) 45%,
      rgba(26, 26, 26, 0) 100%
    );
  }

  // 浅色底上的彩色雾放到深底上会泛白，深色稿里这两个光晕本身就是关掉的
  .ai-chat-glow {
    display: none;
  }

  .ai-page__backdrop {
    display: none;
  }
}
</style>
