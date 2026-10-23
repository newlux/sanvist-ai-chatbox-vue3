<script setup lang="ts">
import type {
  AskSlotPayload,
  AskSlotSubmitPayload,
  AssistantNavigationPayload,
  GuideStepItem,
  GuideStepPayload,
  GuideStepSelectEvent,
  GuideSuggestionPayload,
} from "@/api/chat/types";
import type { TodayListenBroadcast } from "@/api/listen-broadcast/types";
import type { AttachmentSource } from "@/hooks/useComposerAttachments";
import type { ChatMessageAttachment } from "@/stores/chat-types";
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
import AiChatNav from "@/components/ai-chat-nav/index.vue";
import AiGuideStepSheet from "@/components/ai-guide-step-sheet/index.vue";
import AiGuideSuggestionSheet from "@/components/ai-guide-suggestion-sheet/index.vue";
import AiMessageList from "@/components/ai-message-list/index.vue";
import ShareConversationPoster from "@/components/ai-share-poster/index.vue";
import AiSlotDrawer from "@/components/ai-slot-drawer/index.vue";
import AiWelcome from "@/components/ai-welcome/index.vue";
import { AI_ASK_WELCOME_DONE_KEY, LISTEN_REPORT_CURRENT_DATE_KEY, LISTEN_REPORT_DATE_KEY } from "@/config";
import { useChatFeedback } from "@/hooks/useChatFeedback";
import { useChatSend } from "@/hooks/useChatSend";
import { useChatShare } from "@/hooks/useChatShare";
import { useChatViewport } from "@/hooks/useChatViewport";
import { useComposerAttachments } from "@/hooks/useComposerAttachments";
import { useRealtimeTts } from "@/hooks/useRealtimeTts";
import { DEFAULT_CHAT_SCOPE, provideChatScope, useChatStore, useSessionStore, useUserStore } from "@/stores";
import { saveCurrentListenReportDate } from "@/utils/listen-report";
import { createLogger } from "@/utils/logger";
import { closeWebview, isMpaasReady, onNativeEvent } from "@/utils/platform/mpaas";
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
const sharePosterWrap = ref<unknown>(null);
/** 输入栏实例：步骤卡拍照后把附件挂进输入栏并聚焦，不再直接发送；页面级长按录音也走它 */
const chatInputRef = ref<{
  appendAttachments?: (meta: ChatMessageAttachment[]) => void;
  focusTextInput?: () => void;
  startGlobalVoiceHold?: (clientY: number) => void;
  updateGlobalVoiceHold?: (clientY: number) => void;
  endGlobalVoiceHold?: () => void;
  cancelGlobalVoiceHold?: () => void;
} | null>(null);
const navActiveKey = ref("");
const shareSheetBottomInset = ref("");
const pageStage = ref<"welcome" | "chat">("welcome");
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
  composerDockOffset,
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
  // 导航与输入栏始终固定在底部；无论是否显示首页快捷问题，都预留导航实际高度。
  return `calc(${composerBottomInset.value} + 88rpx)`;
});
const navOffsetStyle = computed(() => ({ bottom: composerDockOffset.value }));
const askSlotQueue = ref<AskSlotPayload[]>([]);
const askSlotDrawerVisible = ref(false);
/** 追问卡实时高度（px）：卡片弹出时给消息列表加底部间距，最后一条内容不会被盖住 */
const askSlotDrawerHeight = ref(0);
const assistantNavigationPayload = ref<AssistantNavigationPayload | null>(null);
const assistantNavigationVisible = ref(false);
let repairSummaryPollingTimer: ReturnType<typeof setTimeout> | null = null;
let repairSummaryPollingAttempts = 0;
const REPAIR_SUMMARY_POLL_INTERVAL_MS = 5_000;
const REPAIR_SUMMARY_MAX_ATTEMPTS = 30;

function onAssistantNavigationOpen(payload: AssistantNavigationPayload) {
  if (payload.target !== "maintenance_assistant") return;
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

function onAssistantNavigationConfirm(payload: AssistantNavigationPayload) {
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
        assistantCallbackConversationId: summary.repairConversationId,
      });
      // 快速问答没有状态字段，首次获取结果后直接回流，不进入轮询。
      if (!data.status) {
        applySummary();
        await sendAssistantCallback(summaryPayload, { aiMsgId, waitingText: "维修助手-快速问答" });
        return;
      }
      // 故障诊断：状态为 Completed，或回流已带回 repairConversationId 时结束轮询并回流。
      if (data.status === "Completed" || summary.repairConversationId) {
        clearRepairSummaryPolling();
        applySummary();
        await sendAssistantCallback(summaryPayload, { aiMsgId, waitingText: "维修助手-快速问答" });
        return;
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
  sendQuickPrompt(query);
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
  sendQuickPrompt(query);
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

function onNavItemClick(item: { key?: string; title?: string; subagent?: string; mode?: string; url?: string }) {
  if (item?.mode === "inline") {
    const subagent = String(item?.subagent || "");
    if (!subagent) return;
    const nextKey = navActiveKey.value === item.key ? "" : String(item.key || "");
    navActiveKey.value = nextKey;
    chatStore.setSubagent(nextKey ? subagent : "");
    return;
  }

  const targetUrl = String(item?.url || "");
  if (targetUrl === "/pages/podcast/index") {
    enterListenReport();
    return;
  }
  if (targetUrl) {
    void navigateToScene(targetUrl);
  }
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

function goToChat() {
  try {
    uni.setStorageSync(AI_ASK_WELCOME_DONE_KEY, true);
  } catch (error) {
    logger.error("caught error", error);
  }
  pageStage.value = "chat";
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
 * 页面级长按录音：首页除灵动岛之外，任意位置按住 300ms 都能开口说话。
 * 手势判定留在页面（要排除灵动岛、输入框、语音按钮自身的手势），
 * 录音 / 识别 / 面板视觉全部复用输入栏里的 useVoiceInput，不另写一套。
 */
const GLOBAL_HOLD_MS = 300;
/** 按住后移动超过这个距离按「滑动列表」处理，不长按录音 */
const GLOBAL_HOLD_MOVE_PX = 12;
/**
 * 这些区域自带长按行为，页面不再抢：语音按钮（同一套手势）、输入框（系统选择 / 粘贴）、
 * 用户气泡文本（长按出复制菜单）、历史会话列表（长按重命名）。
 */
const GLOBAL_HOLD_EXCLUDE_SELECTOR = [
  ".input-bar__voice-hold",
  ".voice-confirm",
  "textarea",
  "input",
  ".ai-bubble-v2__user-content",
  ".history-drawer",
].join(", ");

/** 这些浮层打开时不接管页面手势，避免在弹层上长按误触录音 */
const globalHoldBlocked = computed(() =>
  shareSheetVisible.value
  || sharePosterVisible.value
  || askSlotDrawerVisible.value
  || guideStepSheetVisible.value
  || badFeedbackSheetVisible.value,
);

let globalHoldTimer: ReturnType<typeof setTimeout> | null = null;
let globalHoldStarted = false;
let globalHoldStartX = 0;
let globalHoldStartY = 0;

function readHoldPointer(e: any) {
  const touch = e?.touches?.[0] ?? e?.changedTouches?.[0];
  return {
    x: Number(touch?.clientX ?? e?.clientX),
    y: Number(touch?.clientY ?? e?.clientY),
  };
}

/** 灵动岛本体不接管长按：它在 header 上是独立浮层，按在岛上不该起录音 */
function isInsideIsland(x: number, y: number) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || typeof document === "undefined") return false;
  const island = document.querySelector(".chat-header__island");
  if (!island) return false;
  const rect = island.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function clearGlobalHold() {
  if (globalHoldTimer) {
    clearTimeout(globalHoldTimer);
    globalHoldTimer = null;
  }
}

function onChatTouchStart(e: any) {
  // 触屏环境只认 touch 事件：触摸后浏览器还会补一套 mousedown/mouseup，避免重复计时
  if (e?.type === "mousedown" && typeof window !== "undefined" && "ontouchstart" in window) return;
  if (pageStage.value !== "chat" || globalHoldStarted || globalHoldBlocked.value) return;
  // 新的一次按压：清掉可能残留的上一次计时（某些元素 stop 冒泡会漏掉 touchend）
  clearGlobalHold();
  const target = e?.target as HTMLElement | null;
  if (target?.closest?.(GLOBAL_HOLD_EXCLUDE_SELECTOR)) return;
  const { x, y } = readHoldPointer(e);
  if (isInsideIsland(x, y)) return;
  globalHoldStartX = x;
  globalHoldStartY = y;
  globalHoldTimer = setTimeout(() => {
    globalHoldTimer = null;
    globalHoldStarted = true;
    chatInputRef.value?.startGlobalVoiceHold?.(globalHoldStartY);
  }, GLOBAL_HOLD_MS);
}

function onChatTouchMove(e: any) {
  const { x, y } = readHoldPointer(e);
  if (!globalHoldStarted) {
    // 还没到 300ms：位移超过阈值按滑动处理，放弃这次长按
    if (Number.isFinite(x) && Number.isFinite(y)
      && (Math.abs(x - globalHoldStartX) > GLOBAL_HOLD_MOVE_PX
        || Math.abs(y - globalHoldStartY) > GLOBAL_HOLD_MOVE_PX)) {
      clearGlobalHold();
    }
    return;
  }
  if (Number.isFinite(y)) chatInputRef.value?.updateGlobalVoiceHold?.(y);
}

function onChatTouchEnd() {
  clearGlobalHold();
  if (!globalHoldStarted) return;
  globalHoldStarted = false;
  chatInputRef.value?.endGlobalVoiceHold?.();
}

function onChatTouchCancel() {
  clearGlobalHold();
  if (!globalHoldStarted) return;
  globalHoldStarted = false;
  chatInputRef.value?.cancelGlobalVoiceHold?.();
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
  clearGlobalHold();
  clearRepairSummaryPolling();
  stopNativeResume();
  uni.$off("listen-report-marked", refreshListenReportState);
  cancelActiveStream();
  realtimeTts.stop();
});
</script>

<template>
  <view class="ai-page">
    <!-- 欢迎页 -->
    <AiWelcome v-if="pageStage === 'welcome'" @start-chat="goToChat" />

    <!-- 问答页：整页接管长按录音（灵动岛 / 输入框 / 语音按钮自身除外） -->
    <view
      v-else
      class="ai-page__chat"
      :style="chatViewportStyle"
      @touchstart="onChatTouchStart"
      @touchmove="onChatTouchMove"
      @touchend="onChatTouchEnd"
      @touchcancel="onChatTouchCancel"
      @mousedown="onChatTouchStart"
      @mousemove="onChatTouchMove"
      @mouseup="onChatTouchEnd"
    >
      <view class="ai-chat-glow ai-chat-glow--blue" />
      <view class="ai-chat-glow ai-chat-glow--red" />
      <!-- 设备线稿背景图：跟着用户选的机型走（履带吊 / 混凝土泵车） -->
      <AiChatBackdrop />
      <!-- Header -->
      <AiChatHeader
        v-model:sessions="sessions"
        class="ai-page__header"
        :load-sessions="getAISessionList"
        :selected-session-id="aiSessionId"
        :generating="isLoading"
        :share-mode="shareSheetVisible"
        :share-select-all-disabled="shareSelectAllDisabled"
        :share-all-checked="shareAllChecked"
        :share-selected-round-count="shareSelectedRoundCount"
        @back="backToWelcome"
        @new-conversation="startNewConversation"
        @session-click="onSessionClick"
        @session-delete="onSessionDelete"
        @session-delete-batch="onSessionDeleteBatch"
        @session-rename="onSessionRename"
        @share-select-all="onShareSelectAll"
      />
      <AiMessageList
        :key="aiSessionId || 'new-conversation'"
        :messages="messages"
        :quick-prompts="localizedQuickPrompts"
        :show-quick-prompts="showQuickPrompts"
        :scroll-into-view="scrollIntoView"
        :reply-end-token="replyEndToken"
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
        @quick-prompt="sendQuickPrompt"
        @suggestion-tap="sendQuickPrompt"
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
        @pinned-change="chatStore.setPinnedToBottom"
      />
      <AiSlotDrawer
        :slots="askSlotQueue"
        :visible="askSlotDrawerVisible"
        @close="closeAskSlotDrawer"
        @submit="onAskSlotSubmit"
        @height-change="onAskSlotDrawerHeightChange"
      />
      <AiAssistantNavigationSheet
        v-model:visible="assistantNavigationVisible"
        :payload="assistantNavigationPayload"
        @confirm="onAssistantNavigationConfirm"
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
      <AiChatNav
        :active-key="navActiveKey"
        :style="navOffsetStyle"
        @item-click="onNavItemClick"
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
        v-else
        ref="chatInputRef"
        v-model="inputText"
        :is-loading="isLoading"
        :keyboard-height="keyboardHeight"
        :voice-keyboard-height="voiceKeyboardHeight"
        bottom-gradient
        :compact-voice-listening="true"
        :speaking="realtimeTts.playing.value"
        @send="sendMessage"
        @stop="stopGenerating"
        @voice-start="stopRealtimeTtsOnVoiceStart"
        @voice-restart="stopRealtimeTtsOnVoiceStart"
        @recognize-begin="beginAsrPlaceholder"
        @recognize-fail="discardAsrPlaceholder"
        @toggle-quick-list="toggleQuickList"
        @input-focus="setTextInputFocused(true)"
        @input-blur="setTextInputFocused(false)"
        @voice-input-focus="setVoiceInputFocused(true)"
        @voice-input-blur="setVoiceInputFocused(false)"
        @dock-height-change="setInputDockHeight"
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
}

// 头部要盖住消息列表和输入栏：历史抽屉、操作菜单都挂在它的层叠上下文里，
// 留在 z-index:1 会被后面的兄弟节点盖掉（气泡压在抽屉上就是这个原因）
.ai-page__chat > .ai-page__header {
  z-index: 30;
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
.share-sheet-modal {
  position: fixed;
  inset: 0;
  z-index: 50;
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
.share-poster-modal {
  position: fixed;
  inset: 0;
  z-index: 50;
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
</style>
