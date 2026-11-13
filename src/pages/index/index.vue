<script setup lang="ts">
import { createSpeechEndDetector } from "@/utils/asr/speech-end-detector";
import AiVoiceHoldOverlay from "@/components/ai-voice-hold-overlay/index.vue";
import { useDuplexVoice } from "@/hooks/useDuplexVoice";
import { useVoiceQueryGesture } from "@/hooks/useVoiceQueryGesture";
import type {
  AskSlotOption,
  AskSlotPayload,
  AskSlotSubmitPayload,
  GuideStepItem,
  GuideStepPayload,
  GuideStepSelectEvent,
  GuideSuggestionPayload,
} from "@/api/chat/types";
import type { TodayListenBroadcast } from "@/api/listen-broadcast/types";
import type { AttachmentSource } from "@/hooks/useComposerAttachments";
import type { ChatMessageAttachment, UiChatMessage } from "@/stores/chat-types";
import type { AsrStreamSession } from "@/utils/asr/asr-stream-session";
import type { PcmCapture } from "@/utils/asr/pcm-capture";
import type { RepairCaseReport } from "@/utils/repair-callback";
import { onHide, onLoad, onShow, onUnload } from "@dcloudio/uni-app";
import { storeToRefs } from "pinia";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { chatMessageAnchorDomId } from "@/stores/modules/chat";
import { animateVoiceMessageArrival, readVoiceMessageOrigin } from "@/utils/voice-message-motion";
import { recognizeSpeechByBase64, recognizeSpeechByUpload, recognizeSpeechByUrl } from "@/api/chat";
import { getConversationSummary } from "@/api/conversation-summary";
import { getTodayListenBroadcast } from "@/api/listen-broadcast";
import { getRepairInformationState } from "@/api/repair";
import { getTodayAwakeningPrompt } from "@/api/user-role";
import arrowDownIcon from "@/assets/img/arrow-down.png";
import arrowDownDarkIcon from "@/assets/img/arrow-down-dark.png";
import AiAssistantNavigationSheet from "@/components/ai-assistant-navigation-sheet/index.vue";
import AiBadFeedbackSheet from "@/components/ai-bad-feedback-sheet/index.vue";
import AiChatBackdrop from "@/components/ai-chat-backdrop/index.vue";
import AiChatHeader from "@/components/ai-chat-header/index.vue";
import AiChatInput from "@/components/ai-chat-input/index.vue";
import AiChatNav from "@/components/ai-chat-nav/index.vue";
import AiGuideStepSheet from "@/components/ai-guide-step-sheet/index.vue";
import AiGuideSuggestionSheet from "@/components/ai-guide-suggestion-sheet/index.vue";
import AiMessageList from "@/components/ai-message-list/index.vue";
import AiPartsJumpSheet from "@/components/ai-parts-jump-sheet/index.vue";
import ShareConversationPoster from "@/components/ai-share-poster/index.vue";
import AiSlotDrawer from "@/components/ai-slot-drawer/index.vue";
import AiVoiceQueryBar from "@/components/ai-voice-query-bar/index.vue";
import AiVoiceTranscript from "@/components/ai-voice-transcript/index.vue";
import AiWelcome from "@/components/ai-welcome/index.vue";
import { AI_ASK_WELCOME_DONE_KEY } from "@/config";
import { useChatFeedback } from "@/hooks/useChatFeedback";
import { useAssistantNavigation } from "@/hooks/useAssistantNavigation";
import { useChatSend } from "@/hooks/useChatSend";
import { useChatShare } from "@/hooks/useChatShare";
import { useChatViewport } from "@/hooks/useChatViewport";
import { useComposerAttachments } from "@/hooks/useComposerAttachments";
import { useSafeArea } from "@/hooks/useSafeArea";
import { useRealtimeTts } from "@/hooks/useRealtimeTts";
import { DEFAULT_CHAT_SCOPE, provideChatScope, useChatStore, useSessionStore, useSettingsStore, useSystemStore, useUserStore } from "@/stores";
import { isAsrStreamSupported, openAsrStreamSession } from "@/utils/asr/asr-stream-session";
import { isNativePcmStreamSupported, startNativePcmCapture } from "@/utils/asr/native-pcm-stream";
import { isPcmCaptureSupported, startPcmCapture } from "@/utils/asr/pcm-capture";
import { exitMiniProgram } from "@/utils/exit-mini-program";
import { saveCurrentListenReportDate } from "@/utils/listen-report";
import { createLogger } from "@/utils/logger";
import { openPartsAssistant } from "@/utils/parts-h5";
import { ensureNativePermission, getMicrophoneVolume, isMpaasReady, onNativeEvent, permissionDeniedMessage } from "@/utils/platform/mpaas";
import { getRepairConversationId } from "@/utils/repair-bridge";
import { clearPendingRepairCallback, consumePendingRepairCallback, parseRepairCallbackSummary, parseRepairCaseReport, repairCaseReportStatusText } from "@/utils/repair-callback";
import { openRepairAssistant } from "@/utils/repair-h5";
import { clearReturnToWelcome, consumeReturnToWelcome, markReturnToWelcome, navigateToScene } from "@/utils/scene-navigation";
import { consumePendingHistorySession, getSessionId, navigateToSessionScene, peekPendingHistorySession, readSessionIdFromOptions } from "@/utils/session-scene";
import VoiceRecorder from "@/utils/voiceRecorder.js";

defineOptions({ name: "AiChatPage" });
const logger = createLogger("chat-page");
const { t } = useI18n();
const { safeAreaStyle } = useSafeArea();
const userStore = useUserStore();
provideChatScope(DEFAULT_CHAT_SCOPE);
const chatStore = useChatStore(DEFAULT_CHAT_SCOPE);
// 新会话首包只补齐服务端 ID，不重建消息列表；切换已有会话或清空时才重建。
const chatListKey = ref(0);
watch(() => chatStore.aiSessionId, (next, previous) => {
  if (previous != null && previous !== "" && String(next ?? "") !== String(previous)) {
    chatListKey.value += 1;
  }
});
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
/** 一键回到底部的箭头：深色模式换 arrow-down-dark.png（浅色箭头压在暗底上看不清） */
const scrollBottomIcon = computed(() => (isDark.value ? arrowDownDarkIcon : arrowDownIcon));
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
  composerDockOffset,
  syncWindowHeight,
  setInputDockHeight,
  setTextInputFocused,
  setVoiceInputFocused,
} = useChatViewport();
/**
 * 纯净模式（设置弹层 → 纯净模式）：关闭时底部才露出快捷入口胶囊
 * （作业指导 / 任务协同 / 维修助理 / 配件助手 / 听汇报），打开后整条导航不渲染
 * —— 纯净模式即「界面只留对话」，胶囊入口属于要收起来的那部分。
 */
const settingsStore = useSettingsStore();
const { pureMode } = storeToRefs(settingsStore);
/** 底部快捷入口当前高亮的智能体 key（内联智能体如配件助手点一下切换） */
const navActiveKey = ref("");
/** 快捷入口贴输入栏正上方：输入栏高度（含键盘抬起）由 useChatViewport 给 */
const navOffsetStyle = computed(() => ({ bottom: composerDockOffset.value }));
// 提前到 useChatSend 之前：onAiAnswerDelta 回调里要用它做流式听播。
const realtimeTts = useRealtimeTts();
const duplex = useDuplexVoice({
  cancelManual() {
    return resetVoiceQuery();
  },
  submit: text => { void sendMessage({ text, markPreviousStopped: true }); },
  setGain: gain => realtimeTts.setPlaybackGain(gain),
  sessionId: () => chatStore.aiSessionId,
});
const { active: duplexActive, starting: duplexStarting, listening: duplexListening, transcript: duplexTranscript } = duplex;
const duplexStatus = computed(() => {
  if (duplexStarting.value) return t('duplex-starting');
  return duplexActive.value ? duplexTranscript.value || t('duplex-listening') : '';
});

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
  void duplex.stop();
  realtimeTts.stop();
}

/** 停掉本页听播：步骤卡确认完最后一步、切到小结的瞬间由消息列表触发 */
function stopSceneTts() {
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

/**
 * 录音态底部面板（设计稿 1204:467 录动态）是否展开。
 * 设计稿这一屏底部只有「水面 + 提示行 + 声纹」，底部导航与「一键回到底部」都要让位，
 * 否则它们会盖在水面上（AiChatNav / .chat-scroll-bottom 的层级都在面板之上）。
 */
const voicePanelOpen = ref(false);
/**
 * 底部快捷入口是否展示：纯净模式关闭才显示（打开就整条不渲染），
 * 录音面板 / 录音条展开时让位
 */
const navVisible = computed(() => !pureMode.value && !voicePanelOpen.value && !voiceQueryActive.value);

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
  /**
   * 录音中：输入栏已经被 fixed 的录音条顶掉，底部快捷入口也一起收起，
   * 这时的 composerBottomInset 还是输入栏那一帧量到的旧值。
   * 录音条胶囊的顶边固定在「安全区 + 160rpx」（bottom 72rpx + 高 88rpx），
   * 旧值一旦比它小，滚到底时最后一行就压在胶囊后面；取两者较大值，两种情况都不吃亏。
   */
  if (voiceQueryActive.value) {
    return `max(${composerBottomInset.value}, calc(env(safe-area-inset-bottom) + 184rpx))`;
  }
  // 纯净模式关闭时底部多了一条快捷入口：给列表多留 88rpx（导航 72rpx + 顶部间距 16rpx）
  if (navVisible.value) return `calc(${composerBottomInset.value} + 88rpx)`;
  // 底部只剩输入栏
  return composerBottomInset.value;
});
/**
 * 「按住说话」录音中：输入栏把录音态透出来，顶部灵动岛据此把常态动图换成 sani-logo-sm.gif。
 * 只在录音期间为 true（松手进识别 / 取消 / 发送都会回落），思考 / 回答的状态图逻辑不受影响。
 */
const voiceListening = ref(false);
const askSlotQueue = ref<AskSlotPayload[]>([]);
const askSlotDrawerVisible = ref(false);
/** 追问卡实时高度（px）：卡片弹出时给消息列表加底部间距，最后一条内容不会被盖住 */
const askSlotDrawerHeight = ref(0);
const { assistantNavigationPayload, assistantNavigationVisible, onAssistantNavigationOpen, onAssistantNavigationConfirm } = useAssistantNavigation(sendUserPrompt);
/** 底部「配件助手」点击后的地址输入弹层 */
const partsJumpVisible = ref(false);
let repairSummaryPollingTimer: ReturnType<typeof setTimeout> | null = null;
let repairSummaryPollingAttempts = 0;
const REPAIR_SUMMARY_POLL_INTERVAL_MS = 5_000;
const REPAIR_SUMMARY_MAX_ATTEMPTS = 30;

/** 点维修助理回流卡：pushWindow 直达三方维修 H5 的详情页；已生成的回流结果看过就不再重复拉取。 */
function onAssistantCallbackOpen(conversationId: string) {
  const id = String(conversationId || "").trim();
  if (!id) return;
  logger.info("维修助理回流卡点「看详情」", { conversationId: id });
  clearPendingRepairCallback();
  void openRepairAssistant({
    chatConversationId: id,
    // 降级回本地壳页时要把会话 id 带上，壳页据此拼 `/repair/{id}`
    fallbackUrl: `/pages/repair/index?conversationId=${encodeURIComponent(id)}`,
  });
}

/**
 * 进入配件助手：与维修助理同一套口径 —— pushWindow 直达三方 H5，
 * 参数一致、只有地址不同（见 config 的 PARTS_ASSISTANT_EMBED_URL），
 * 原生容器不可用时才降级到本地壳页 `/pages/parts/index?url=...`。
 */
function enterPartsAssistant() {
  void openPartsAssistant();
}

function clearRepairSummaryPolling() {
  if (!repairSummaryPollingTimer) return;
  clearTimeout(repairSummaryPollingTimer);
  repairSummaryPollingTimer = null;
}

function startRepairSummaryCallback() {
  const task = consumePendingRepairCallback();
  if (!task) {
    logger.debug("没有待消费的维修助理回调任务，跳过回流摘要轮询");
    return;
  }
  logger.info("开始轮询维修助理回流摘要", task);

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
    // 文案都走词条：切中英文后新推出来的卡片跟着变（已落到消息里的文案不会再改）
    waitingText: t("repair-callback-title"),
    assistantCallbackTitle: t("repair-callback-title"),
    // 状态文案由气泡统一补「...」，这里只写标题本体，避免卡片上出现重复省略号
    processStatus: { phase: "thinking", title: t("repair-callback-status-diagnosing") },
  });
  chatStore.scrollToBottom(true);

  /**
   * 已经补到卡片上的维修助理会话 ID。
   * 诊断中没有回填明细，但 ID 一到位就要让卡片可点（气泡只按这个字段决定是否显示右箭头），
   * 所以要单独记一份，避免每轮都重复 patch，也避免 Completed 回包没带 ID 时把它覆盖成空。
   *
   * 初值取三方页在通道里回传过的会话 id（conversation_created）：
   * 摘要接口这次没带回 id 时，卡片照样能点进详情。
   */
  let patchedConversationId = getRepairConversationId();

  const poll = async () => {
    repairSummaryPollingAttempts += 1;
    try {
      const data = await getConversationSummary(task);
      const summaryPayload = JSON.stringify(data);
      const summary = parseRepairCallbackSummary(summaryPayload);
      const status = String(data.status || "");
      const conversationId = String(summary.repairConversationId || patchedConversationId || "").trim();
      // 真机排查：每次轮询的状态与是否带回会话 id
      logger.debug("回流摘要返回", {
        attempt: repairSummaryPollingAttempts,
        status: status || "(空)",
        conversationId: conversationId || "(空)",
      });

      /**
       * 会话 ID 一到位就先补到卡片上（气泡只按这个字段决定是否渲染右箭头）：
       * 不用等报告生成完，用户随时能点进维修助理看诊断详情。
       */
      if (conversationId && conversationId !== patchedConversationId) {
        patchedConversationId = conversationId;
        chatStore.patchMessageById(aiMsgId, { assistantCallbackConversationId: conversationId });
      }

      /** 结果就绪：把卡片标题 / 副标题 / 明细 / 会话 ID 补齐，再走回流接口。 */
      const finish = async (details: Array<{ label: string; value: string }>, statusText: string, reason: string) => {
        clearRepairSummaryPolling();
        chatStore.patchMessageById(aiMsgId, {
          assistantCallbackTitle: summary.title,
          assistantCallbackStatus: statusText,
          assistantCallbackDetails: details,
          assistantCallbackConversationId: patchedConversationId,
        });
        logger.info("回流摘要已就绪，回填卡片并回流", {
          attempt: repairSummaryPollingAttempts,
          reason,
          status: status || "(无 status)",
          conversationId: patchedConversationId || "(空)",
          details: details.map(item => `${item.label}:${item.value}`),
        });
        await sendAssistantCallback(summaryPayload, { aiMsgId, waitingText: t("repair-callback-quick-qa") });
      };

      /**
       * 案例报告：明细一律取三方「案例报告状态」，四项固定四行，没值的那行是「待识别」。
       * 拿不到（没会话 ID / 接口失败）就当四项全空，卡片照样出，不空着等。
       */
      let caseReport: RepairCaseReport | null = null;
      if (conversationId) {
        try {
          caseReport = parseRepairCaseReport(await getRepairInformationState(conversationId));
        }
        catch (error) {
          logger.warn("案例报告状态查询失败，本轮按未填全处理", { conversationId, status }, error);
        }
      }

      /**
       * 卡片不等四项齐全：拿到多少先摆多少。
       * 副标题只在四项全有值时才是「案例报告生成已完成」，缺任何一项就传空 —— 气泡那边空文案整行不渲染。
       */
      if (caseReport) {
        chatStore.patchMessageById(aiMsgId, {
          assistantCallbackTitle: summary.title,
          assistantCallbackStatus: repairCaseReportStatusText(caseReport),
          assistantCallbackDetails: caseReport.details,
        });
      }

      /** 四项齐全：定稿回流。 */
      if (caseReport?.ready) {
        await finish(caseReport.details, repairCaseReportStatusText(caseReport), "案例报告四项已齐");
        return;
      }

      /**
       * 回流数据没有 status（历史口径里的快速问答）：首次取到就是结果，直接回流。
       * 卡片形态不再分快问快答 / 机型诊断，有三方案例报告就按报告出，副标题同样只在四项齐全时给。
       */
      if (!status) {
        await finish(
          caseReport?.details || summary.details,
          caseReport ? repairCaseReportStatusText(caseReport) : summary.statusText,
          "无 status（快速问答）",
        );
        return;
      }

      /**
       * 拿不到三方状态的兜底：退回旧口径 status=Completed 就算结束，
       * 明细按四项全空渲染（全「待识别」），避免三方接口一抖动，卡片就永远等不到回流。
       */
      if (!caseReport && status === "Completed") {
        await finish(parseRepairCaseReport(null).details, "", `status=${status}`);
        return;
      }

      // 缺哪一项一眼能看出来：日志里逐行打 label:value，值还是「待识别」的就是三方没填的
      logger.debug("案例报告还没生成完，继续轮询", {
        attempt: repairSummaryPollingAttempts,
        status,
        hasConversationId: Boolean(conversationId),
        details: caseReport?.details.map(item => `${item.label}:${item.value}`) || [],
      });
    }
    catch (error) {
      logger.error("回流摘要接口失败", { attempt: repairSummaryPollingAttempts }, error);
    }

    if (repairSummaryPollingAttempts >= REPAIR_SUMMARY_MAX_ATTEMPTS) {
      clearRepairSummaryPolling();
      logger.warn("回流摘要轮询次数用尽，标记为未完成", { attempts: repairSummaryPollingAttempts });
      chatStore.patchMessageById(aiMsgId, {
        content: t("repair-callback-timeout"),
        loading: false,
        processStatus: { phase: "failed", title: t("repair-callback-status-failed") },
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

/**
 * 内联追问卡（气泡里排在回答下方的选项）点中某项：
 * 不本地改选中态，直接把这一项当成一次提问再发给 chat-messages，
 * 等接口返回后由服务端下发的数据决定选中结果。
 */
function onAskSlotPick(payload: { slot: AskSlotPayload; option: AskSlotOption }) {
  sendAskSlotSelection({ slot: payload.slot, selectedOptions: [payload.option] });
}

/** 指导步骤卡片（COMPONENT scene=guide / type=step）：单步点一下进入下一轮，多步选好后确认回发。 */
const guideStepPayload = ref<GuideStepPayload | null>(null);
/**
 * 当前要顶到对话区顶部的那张核对卡属于哪一步（步骤 id）：多步骤卡每轮各带一张，
 * 按 id 从最新一轮往回找，避免新一轮的卡被算到第一张卡的位置上。
 */
const guideStepCardStepId = ref("");
/**
 * 多步骤卡改为气泡内联展示（标题 + 进度 + 步骤标题 + 讲解 + 确认问题 + A/B/C 选项），
 * 不再弹底部白板。需要回退到白板时把这里改成 false。
 */
const INLINE_STEP_CARD = true;

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
  // 内联卡片：卡片就在对话里，只定位到第一步，不弹白板
  if (INLINE_STEP_CARD) {
    guideStepCardStepId.value = String(payload?.steps?.[0]?.id || "");
    return;
  }
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
  const nextStepId = String(steps[index]?.id || payload?.stepId || "");
  // 真换了步骤才停旧语音：新一步的卡挂载后会按翻页标记接着播（见 GuideCheckBlock 的 onMounted）；
  // 目标步和当前步是同一个时卡不会重挂载，停了就再也起不来，所以这里保持原语音
  if (nextStepId && nextStepId !== String(guideStepCardStepId.value || "")) realtimeTts.stop();
  guideStepCardStepId.value = nextStepId;
  guideStepRequestedIndex.value = index;
  // 内联卡片模式：卡片自己翻页，只切对话里那张卡，不弹白板
  if (INLINE_STEP_CARD) return;
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
/**
 * 多步骤卡的回答只播当前这一步；翻页后换了步骤要念新的一步。
 * 只认属于这条消息的核对卡：一个对话里有多轮步骤条时，页面级的「当前步」可能是别的一轮停留的步骤，
 * 直接拿来用会把这条消息念成另一轮的内容。
 */
function resolveActiveStepId(msg: UiChatMessage | undefined) {
  const cards = (msg?.blocks || []).filter(block => block?.type === "guide-check");
  if (!cards.length) return "";
  const current = String(guideStepCardStepId.value || "");
  if (current && cards.some(card => String(card.payload?.step_id || "") === current)) return current;
  return String(cards[0]?.payload?.step_id || "");
}

function onTtsClick(index: number, textOverride = "") {
  const msg = chatStore.messages[index];
  const messageId = msg?.messageId;
  if (messageId == null || msg?.sessionId == null) return;
  // 小结这类「要念的文本不在消息正文里」的播报用独立判重键，免得和步骤播报互相停
  const stepId = textOverride ? "summary" : resolveActiveStepId(msg);

  const sameRealtimeTarget = realtimeTts.playingMessageId.value === messageId
    && String(realtimeTts.playingStepId.value || "") === stepId;
  if (sameRealtimeTarget) {
    realtimeTts.stop();
    return;
  }

  realtimeTts.stop();
  void realtimeTts.togglePlay(msg, stepId, textOverride);
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
  // demo 页是纯展示场景：只清空当前会话，不退回首屏
  if (isDemoPage) {
    cancelActiveStream();
    chatStore.resetConversation();
    nextTick(() => chatStore.scrollToBottom(true));
    return;
  }
  /**
   * 与「首次打开」严格对齐：不留在对话页的空会话，而是退回 Hey,SANI 首屏。
   * 复用回到初始页的那套复位（掐在途请求 / 听播 / 浮层、清「已进过对话」标记、
   * 复位起飞动画与 stage），否则 onShow 的 syncPageStage 会立刻把页面拽回对话。
   */
  onRestartToStart();
}

/**
 * 快捷入口：听汇报 / 作业指导 / 任务协同都走专属页（url 优先）。
 * 听汇报跳转前先记下当天早报日期，供播报页判断是否已收听。
 *
 * 带 `?direct=1`：概览卡「去收听」与底部胶囊「听汇报」都直接进播报页起播，
 * 跳掉播报页里「选助手 → 选汇报内容」那一步（风格设置页）。
 * 播报页的偏好设置入口仍在，用户想改偏好可以自己进去。
 */
function enterListenReport() {
  saveCurrentListenReportDate(listenBroadcast.value?.bizDate);
  void navigateToScene("/pages/podcast/index?direct=1");
}

/** 从入口项的 `/pages/parts/index?url=...` 里取三方地址（URLSearchParams 会自动解码） */
function readPartsEmbedUrl(route: string) {
  const query = route.split("?")[1] || "";
  if (!query) return "";
  return new URLSearchParams(query).get("url") || "";
}

/**
 * 配件助手跳转：弹层里填的是完整地址，作为 pushWindow 的目标地址（不校验域名），
 * 参数与维修助理一致，由 utils/parts-h5 统一补上。
 */
function onPartsJump(url: string) {
  const target = String(url || "").trim();
  if (!target) return;
  void openPartsAssistant({ url: target });
}

/**
 * 音频卡片「去收听」：跳转前固定本次早报日期。
 */
function onGoListenReport() {
  enterListenReport();
}

/**
 * 底部快捷入口点击（仅纯净模式关闭时可见）：
 * - mode=inline（配件助手）：就地切换智能体，再点一次取消；
 * - 听汇报：先固定当天早报日期，再进播报页（与卡片入口同一套逻辑）；
 * - 其余 page 入口（含作业指导 / 任务协同）：navigateToScene 到对应的场景页，
 *   mPaaS 下 pushWindow 新开一个 webview，Web 下退化为 navigateTo。
 */
function onNavItemClick(item: { key?: string; subagent?: string; mode?: string; url?: string }) {
  if (item?.mode === "inline") {
    const subagent = String(item?.subagent || "");
    if (!subagent) return;
    const nextKey = navActiveKey.value === item.key ? "" : String(item.key || "");
    navActiveKey.value = nextKey;
    chatStore.setSubagent(nextKey ? subagent : "");
    return;
  }

  const targetUrl = String(item?.url || "");
  if (!targetUrl) return;
  // 从初始页跳出去的：场景页的返回键要回到 Hey,SANI，而不是对话页（见 markReturnToWelcome）
  if (pageStage.value === "welcome") markReturnToWelcome();
  if (targetUrl === "/pages/podcast/index") {
    enterListenReport();
    return;
  }
  // 维修助理：pushWindow 直达三方 H5，本地壳页只做兜底（与对话内跳转同一套口径）
  if (targetUrl === "/pages/repair/index") {
    void openRepairAssistant();
    return;
  }
  // 配件助手：同一套口径，地址由入口项带过来（缺省用 config 里的地址）
  if (targetUrl.startsWith("/pages/parts/index")) {
    void openPartsAssistant({ url: readPartsEmbedUrl(targetUrl) });
    return;
  }
  void navigateToScene(targetUrl);
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

/** 落位后 listen.gif 在岛内再呼吸多久，然后交回空闲态 sani-logo-sm.gif */
const WELCOME_LISTEN_IDLE_MS = 900;

/**
 * 岛内是否处在「从初始页飞进来」的 listen 态。
 *
 * 落位后切上去，让飞过来的 listen 图有一段延续；播完（WELCOME_LISTEN_IDLE_MS）
 * 就交回空闲态 sani-logo-sm.gif —— listen.gif 现在是「回答中 / 播报中」的状态图，
 * 空闲时留在上面会让人以为还在播报。
 */
const islandListenFromWelcome = ref(false);
/**
 * 「识别中...」实时转写文字的出场闸门（文字铺在问答页顶部那一条上，不再是消息气泡）。
 * 从初始页起飞时先关上：这行文字要等中间图标飞进灵动岛、落位动效彻底收尾之后才出现，
 * 否则它会和图标动效叠在一起（看起来像被图标压住半截）。
 * 对话页里直接说话不经过起飞，保持 true 立即显示。
 */
const asrTipReady = ref(true);
/** 上面这段延续的收尾定时器（回初始页 / 卸载要清掉） */
let islandListenIdleTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 初始页「点击说话」→ 立刻起飞，录音期间的实时转写（WS 流式 ASR）铺在问答页顶部那一条上。
 *
 * 不往消息列表插「识别中」用户气泡，改成一条浮在提问落点上的纯文字（见 .voice-live）：
 * - 开口先把上一轮的提问顶到头部下沿（历史回复整体往上拉走），
 *   再让列表把那条提问临时隐藏、把位置让给实时文字 —— 实时文字背后不会压着任何正文；
 * - 文字从左往右长出来，跟打字一样，说完才收成正式提问气泡；
 * - 只露最后两行（定高裁顶、文字压底），再长就把旧的顶走；整块上提一行并铺一层页面底色渐隐，
 *   把头部留白条里透出来的上一条回答一起盖住；
 * - 让位的高度跟着实时文字走（voiceTopPad），两行封顶后是固定值；
 * - 说完（静音 1.5s / 点 ↑）后按原有规则把提问气泡顶到头部下沿，回答从它下面长出来。
 */
const voiceQueryActive = ref(false);
/** 本轮实时转写文本：录音期间逐字刷新，只长在顶部那条文字上，不进消息列表 */
const voiceTranscript = ref("");
/** 实时文字的实测高度（px）：两行封顶后是定值（含底部渐隐带），列表按它让位 */
const voiceLiveHeight = ref(0);
let cancelVoiceArrival: (() => void) | null = null;
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
/** 一直没听到人声的兜底：别让麦克风空转 */
const VOICE_NO_SPEECH_MS = 8000;
let voiceNoSpeechTimer: ReturnType<typeof setTimeout> | null = null;
let voiceHeard = false;
const speechEndDetector = createSpeechEndDetector({
  onSilence: stopVoiceQuery,
  isPaused: () => voiceHoldActive.value,
});
/**
 * 本轮走哪条录音链路。
 * - stream：WebAudio 采集 + WebSocket 流式 ASR，能逐字出文字（iOS / 普通浏览器）；
 * - native：mPaaS 原生录音（microphoneStart/End）+ 整段识别，不出 partial，但在
 *   Android WebView 这种「拿不到可用音频」的容器里是唯一能用的那条线。
 * 优先 stream，采集起不来（getUserMedia 失败 / 1.2s 没有回调 / 采到静音）自动降级到 native。
 */
let voiceBackend: "stream" | "native" = "stream";
let nativeVoiceStartup: Promise<void> | null = null;
/** 原生录音器：只有降级后才创建 */
let nativeVoiceRecorder: VoiceRecorderInstance | null = null;
/** 原生通道的音量轮询：没有 partial，声纹和静音收尾全靠它 */
let nativeLevelTimer: ReturnType<typeof setInterval> | null = null;
/** 每轮只降级一次，避免两条链路互相打架 */
let voiceDegraded = false;
/** 原生通道这一轮听到的最大音量：排查「有没有真的收到声音」时打日志用 */
let nativePeakLevel = 0;
/** 原生通道整段识别的最长等待：超时就当没识别到，别把录音条一直挂在「识别中」 */
const NATIVE_RECOGNIZE_TIMEOUT_MS = 30_000;
/** 原生录音的硬上限：只做兜底，正常收尾靠用户点发送（↑） */
const NATIVE_MAX_RECORD_MS = 60_000;

/** 原生录音回传的音频形态：容器里一般给 audioUrl，也有的直接回 base64 */
interface NativeRecorderAudio {
  audioUrl?: string;
  audioBase64?: string;
  mimeType?: string;
  tempFilePath?: string;
}

/**
 * VoiceRecorder 在 utils 下是 .js（构造时按环境返回原生 / 浏览器实现），
 * 声明文件里看不到实例方法，这里补一份本地结构，免得整页用 any。
 */
interface VoiceRecorderInstance {
  start: (options?: { sampleRate?: number; timeSlice?: number }) => Promise<{ success?: boolean; error?: string; data?: NativeRecorderAudio } | undefined>;
  stop: () => Promise<{ success?: boolean; error?: string; data?: NativeRecorderAudio } | undefined>;
  cancel?: () => void;
  release?: () => void;
}

/**
 * 字幕组件上报高度；收起时同步收回列表留白。
 */
watch(
  () => voiceQueryActive.value && asrTipReady.value,
  (visible) => {
    if (!visible) voiceLiveHeight.value = 0;
  },
  { flush: "post" },
);

/** 收掉这一轮录音：实时文字与底部录音条一起退场，列表让出的高度同时归零 */
function resetVoiceQuery() {
  cancelVoiceArrival?.();
  cancelVoiceArrival = null;
  // 序号自增：正在 await 权限 / 采集的启动流程据此自行作废
  voiceSeq += 1;
  voiceQueryActive.value = false;
  voiceTranscript.value = "";
  voiceLiveHeight.value = 0;
  voiceFinishing.value = false;
  voiceLevel.value = 0;
  voiceSeconds.value = 0;
  voiceHeard = false;
  speechEndDetector.reset();
  if (voiceNoSpeechTimer) {
    clearTimeout(voiceNoSpeechTimer);
    voiceNoSpeechTimer = null;
  }
  if (voiceTickTimer) {
    clearInterval(voiceTickTimer);
    voiceTickTimer = null;
  }
  const captureReleased = voiceCapture?.stop();
  voiceCapture = null;
  voiceSession?.close();
  voiceSession = null;
  // 降级到原生录音的那一轮：停轮询、放掉录音器（正常收尾时 finishNativeVoiceQuery 已经置空）
  stopNativeLevelPolling();
  if (nativeVoiceRecorder) {
    try {
      (nativeVoiceRecorder.release ?? nativeVoiceRecorder.cancel)?.call(nativeVoiceRecorder);
    }
    catch (error) {
      logger.warn("native recorder release failed", error);
    }
    nativeVoiceRecorder = null;
  }
  voiceBackend = "stream";
  voiceDegraded = false;
  // 「按住说话」那条入口仍会在列表里落占位气泡：收尾时一并撤掉（录音提问这条路已经没有占位了）
  discardAsrPlaceholder();
  // 一句话都没发出去（取消 / 识别失败 / 权限被拒）：把问候与快捷提问放回来，
  // 口径与撤销占位气泡时一致 —— 录音期间只是暂时收起，不代表真的发了消息
  if (!chatStore.messages.length) {
    chatStore.showQuickPrompts = true;
    chatStore.showQuickList = true;
  }
  return captureReleased;
}

function failVoiceQuery(title: string) {
  resetVoiceQuery();
  uni.showToast({ title, icon: "none" });
}

/** 保留实时字幕的文字起点，发送后把同一段文字平滑移入右侧胶囊。 */
async function submitRecognizedVoice(query: string) {
  const origin = readVoiceMessageOrigin(typeof document === "undefined"
    ? null : document.querySelector(".voice-live__text"));
  resetVoiceQuery();
  if (!query) {
    uni.showToast({ title: t("no-speech-recognized"), icon: "none" });
    return;
  }
  const seq = voiceSeq;
  sendQuickPrompt(query);
  const messageId = chatStore.pinMessageId;
  await nextTick();
  await nextTick();
  if (seq !== voiceSeq || !messageId || typeof document === "undefined") return;
  const body = document.getElementById(chatMessageAnchorDomId(messageId))
    ?.querySelector<HTMLElement>(".ai-bubble-v2__body") || null;
  cancelVoiceArrival = animateVoiceMessageArrival(body, origin);
}

/**
 * 实时文字的落点锚：上一轮登记过的那条提问（`pinMessageId`），
 * 取不到（或已经不在当前会话里）就退回最后一条用户消息。
 * 拿不到锚点时（第一次提问 / 空会话）不滚动：落点本来就是空的。
 */
function resolveVoiceAnchorId() {
  const pinned = String(chatStore.pinMessageId || "");
  const messages = chatStore.messages || [];
  if (pinned && messages.some(item => String(item?.id ?? "") === pinned)) return pinned;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user" && !message.asrPending) return String(message.id || "");
  }
  return "";
}

async function startVoiceQuery() {
  const duplexRelease = duplex.stop();
  const pendingVoiceSeq = voiceSeq;
  await duplexRelease;
  if (pendingVoiceSeq !== voiceSeq) return;
  /**
   * 按下「点击说话」的第一件事：把正在播的语音掐掉。
   * 一是用户要开口了，播报继续响会盖住他；二是外放的声音会被麦克风原样收进 ASR，
   * 识别结果里就会混进上一段回答。
   * 「按住说话」那条入口走的是 useVoiceInput，另在 @voice-start / @voice-restart 上
   * 挂了同样的 stopRealtimeTtsOnVoiceStart（那个入口不会经过这里）。
   */
  realtimeTts.stop();

  const seq = ++voiceSeq;
  voiceFinishing.value = false;
  voiceLevel.value = 0;
  voiceSeconds.value = 0;
  voiceHeard = false;
  speechEndDetector.reset();
  voiceQueryActive.value = true;
  voiceTranscript.value = "";
  // 开口了就把问候 / 快捷提问收起（以前是插占位气泡时顺带清掉的）
  chatStore.showQuickPrompts = false;
  chatStore.showQuickList = false;

  /**
   * 开口第一件事：把上一轮的提问顶到头部下沿。
   *
   * 不这么做的话，多轮对话里实时文字会压在上面那些历史正文上 ——
   * 文字是浮在落点上的，落点下面原本就是上一轮的回复文字。
   * 顶上去之后，落点上只剩那条提问气泡，列表再把它临时隐藏（voiceTopPad），
   * 实时文字背后就干净了；上方的历史整体被拉走、留在头部渐隐里。
   * 不插消息、不改内容，只借用 pin 的那套滚动定位。
   */
  const anchorId = resolveVoiceAnchorId();
  if (anchorId) {
    chatStore.setPinnedToBottom(true);
    chatStore.setCapRoundAtTop(true);
    chatStore.pinMessageToTop(anchorId);
  }

  // 底部录音条的计时：从进入问答页就开始走，和真实录音时长对齐
  if (voiceTickTimer) clearInterval(voiceTickTimer);
  voiceTickTimer = setInterval(() => {
    voiceSeconds.value += 1;
  }, 1000);

  /**
   * 音频从哪来（Android 与 iOS 同一口径）：
   * - 容器里有 `pcmStreamStart`（mPaaS bridge 已注入）：用宿主原生推流，
   *   16k 裸 PCM 由原生抛过来，后面的 WebSocket 流式 ASR 一点不变 —— 实时文字照常；
   * - 没有 bridge（浏览器 / 宿主未注入）才用 WebAudio 自己采；
   * - 两条都不行（没有 WebSocket / 没有 WebAudio 且没有原生推流）才退到整段识别。
   *
   * 之前这里按 UA 限定 Android，iOS 只能走 WebAudio；宿主两端现在都实现了同一套
   * `pcmStreamStart` / `pcmStreamData`，改为只按 bridge 是否就绪判断，两端行为一致。
   */
  const useNativePcm = isNativePcmStreamSupported();
  if (!isAsrStreamSupported() || (!useNativePcm && !isPcmCaptureSupported())) {
    await (nativeVoiceStartup = startNativeVoiceQuery(seq));
    return;
  }

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
        if (seq !== voiceSeq) return;
        if (!voiceFinishing.value) {
          speechEndDetector.observeTranscript(text);
          if (text.trim()) voiceHeard = true;
        }
        // partial 是「完整文本的当前版本」：整体替换顶部那条实时文字，不要自己拼接
        voiceTranscript.value = text;
      },
      onFinal(text) {
        if (seq !== voiceSeq) return;
        const query = String(text).trim();
        void submitRecognizedVoice(query);
      },
      onError() {
        // 通道层失败（握手被网关拦、服务未部署）和「没听清」要分开提示，
        // 否则用户会以为是自己说话的问题
        if (seq === voiceSeq) failVoiceQuery(t("welcome-voice-unavailable"));
      },
    });
    voiceSession = session;

    const capture = useNativePcm
      ? await startNativePcmCapture({
        onFrame: frame => session.pushFrame(frame),
        onLevel: onVoiceLevel,
        // 原生推流中途报错：换整段识别那条线，别让这一轮白说
        onError: message => degradeToNativeVoice(`pcm-stream:${message}`),
      })
      : await startPcmCapture({
        onFrame: frame => session.pushFrame(frame),
        onLevel: onVoiceLevel,
        // 采集起来了但拿不到可用音频（没回调 / 采到静音）：这一轮降到原生录音，别让用户白说一句
        onUnavailable: reason => degradeToNativeVoice(reason),
      });
    if (seq !== voiceSeq) {
      capture.stop();
      return;
    }
    voiceCapture = capture;

    /**
     * 8s 没人说话就自己收尾，别让麦克风空转。
     * 原生 PCM 推流这条不启用：宿主给的是哪一档音量不确定（可能偏小），
     * 一旦电平没过阈值就会被判成「没人说话」、在你还在说的时候把录音掐掉。
     * 这条通道的收尾交给「说过话后静音 1.5s」和用户点 ↑。
     */
    if (!useNativePcm) {
      voiceNoSpeechTimer = setTimeout(() => {
        voiceNoSpeechTimer = null;
        if (!voiceHeard && !voiceHoldActive.value) stopVoiceQuery();
      }, VOICE_NO_SPEECH_MS);
    }
  }
  catch (error) {
    // getUserMedia 三档全挂（Android WebView 常见）：不掉到「录音启动失败」，先换原生录音
    logger.warn("voice query start failed, fallback to native recorder", error);
    if (seq === voiceSeq) degradeToNativeVoice("capture-failed");
  }
}

/** 停掉原生通道的音量轮询 */
function stopNativeLevelPolling() {
  if (nativeLevelTimer) {
    clearInterval(nativeLevelTimer);
    nativeLevelTimer = null;
  }
}

/**
 * 流式这条路走不通时，把这一轮原地换成原生录音。
 * 顶部那条实时文字和列表让位都不动，这里只换采集通道：不撤文字、不重置序号，
 * 用户看到的就是「识别中…」继续在那儿，声纹继续跳，说完照样出文本。
 */
function degradeToNativeVoice(reason: string) {
  if (voiceDegraded || !voiceQueryActive.value) return;
  voiceDegraded = true;
  const seq = voiceSeq;
  logger.warn("[voice] 流式采集不可用，降级到原生录音", { reason, mpaasReady: isMpaasReady() });
  // 流式那一路彻底扔掉：采集停掉、WebSocket 关掉，否则两边一起抢麦克风
  voiceCapture?.stop();
  voiceCapture = null;
  voiceSession?.close();
  voiceSession = null;
  // 重新计时：原生录音是从现在才开始收的
  if (voiceTickTimer) {
    clearInterval(voiceTickTimer);
    voiceTickTimer = null;
  }
  voiceSeconds.value = 0;
  voiceLevel.value = 0;
  voiceHeard = false;
  speechEndDetector.reset();
  voiceTickTimer = setInterval(() => {
    voiceSeconds.value += 1;
  }, 1000);
  nativeVoiceStartup = startNativeVoiceQuery(seq);
}

/**
 * 原生录音通道：mPaaS microphoneStart/End + 整段识别。
 * 和「按住说话」完全同一条线（VoiceRecorder 在容器里自动选 NativeVoiceRecorder），
 * 唯一差别是没有 partial —— 录音期间只有声纹和计时，说完才一次性出文本。
 */
async function startNativeVoiceQuery(seq: number) {
  voiceBackend = "native";

  voiceHeard = false;
  speechEndDetector.reset();
  try {
    const granted = await ensureNativePermission("record_audio");
    if (seq !== voiceSeq) return;
    if (!granted) {
      failVoiceQuery(permissionDeniedMessage("record_audio"));
      return;
    }

    const recorder = new VoiceRecorder() as unknown as VoiceRecorderInstance;
    const started = await recorder.start();
    if (seq !== voiceSeq) {
      (recorder.release ?? recorder.cancel)?.call(recorder);
      return;
    }
    if (!started?.success) {
      logger.warn("[voice-native] 录音启动失败", started);
      failVoiceQuery(t("record-start-failed"));
      return;
    }

    nativeVoiceRecorder = recorder;
    nativePeakLevel = 0;
    logger.warn("[voice-native] 录音已开始", { seq, mpaasReady: isMpaasReady() });
    /**
     * 原生录音拿不到 partial，电平只用来驱动声纹。
     * 注意这里不能喂给 onVoiceLevel：那里面带了「静音 1.5s 自动收尾」，
     * 而 microphoneVolume 在部分容器里恒为 0 / 拿不到，一喂就等于用户话没说完就被掐掉。
     * 收尾统一交给用户点发送（↑ → stopVoiceQuery）。
     */
    stopNativeLevelPolling();
    voiceLevel.value = 0;
    let polling = false;
    nativeLevelTimer = setInterval(() => {
      if (seq !== voiceSeq || polling) return;
      polling = true;
      void getMicrophoneVolume()
        .then((level) => {
          if (seq !== voiceSeq || typeof level !== "number") return;
          if (level > nativePeakLevel) nativePeakLevel = level;
          const normalized = Math.min(1, Math.max(0, level / 0.15));
          voiceLevel.value += (normalized - voiceLevel.value) * 0.35;
        })
        .catch(() => {})
        .finally(() => {
          polling = false;
        });
    }, 120);

    // 只留一个硬上限兜底：用户忘了点发送时别让麦克风一直开着
    if (voiceNoSpeechTimer) clearTimeout(voiceNoSpeechTimer);
    voiceNoSpeechTimer = setTimeout(() => {
      voiceNoSpeechTimer = null;
      stopVoiceQuery();
    }, NATIVE_MAX_RECORD_MS);
  }
  catch (error) {
    logger.warn("native voice query start failed", error);
    if (seq === voiceSeq) failVoiceQuery(t("record-start-failed"));
  }
}

/** 带超时的整段识别：接口挂了也要把录音条收掉，不能一直挂在「识别中」 */
function requestNativeRecognition(audio: NativeRecorderAudio) {
  const request = audio.audioUrl
    ? recognizeSpeechByUrl({ audioUrl: audio.audioUrl })
    : audio.audioBase64
      ? recognizeSpeechByBase64({ audioBase64: audio.audioBase64, mimeType: audio.mimeType })
      : audio.tempFilePath
        ? recognizeSpeechByUpload({ filePath: audio.tempFilePath, timeout: NATIVE_RECOGNIZE_TIMEOUT_MS })
        : Promise.reject(new Error("no audio"));

  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("recognize timeout")), NATIVE_RECOGNIZE_TIMEOUT_MS);
  });
  return Promise.race([request, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** 原生录音是异步启动的：用户手快点发送时会赶上"还没 start 完"，等一下它 */
async function waitNativeRecorderReady(timeoutMs = 800) {
  const deadline = Date.now() + timeoutMs;
  while (!nativeVoiceRecorder && Date.now() < deadline) {
    await new Promise<void>(resolve => setTimeout(resolve, 50));
  }
  return nativeVoiceRecorder;
}

/** 原生通道收尾：停录音 → 整段识别 → 文本回填到占位气泡上再发问 */
async function finishNativeVoiceQuery() {
  const seq = voiceSeq;
  const recorder = nativeVoiceRecorder ?? await waitNativeRecorderReady();
  nativeVoiceRecorder = null;
  stopNativeLevelPolling();
  if (!recorder) {
    resetVoiceQuery();
    return;
  }

  let audio: NativeRecorderAudio = {};
  try {
    const stopped = await recorder.stop();
    if (seq !== voiceSeq) return;
    if (!stopped?.success) {
      logger.warn("native recorder stop failed", stopped?.error);
      failVoiceQuery(t("no-audio-recorded"));
      return;
    }
    audio = stopped.data || {};
  }
  catch (error) {
    logger.warn("native recorder stop threw", error);
    if (seq === voiceSeq) failVoiceQuery(t("no-audio-recorded"));
    return;
  }

  logger.warn("[voice-native] 录音结束", {
    seconds: voiceSeconds.value,
    peakLevel: Number(nativePeakLevel.toFixed(3)),
    hasUrl: Boolean(audio.audioUrl),
    hasBase64: Boolean(audio.audioBase64),
    hasFile: Boolean(audio.tempFilePath),
  });
  const recognizeStart = Date.now();
  try {
    const result = await requestNativeRecognition(audio);
    if (seq !== voiceSeq) return;
    logger.warn("[voice-native] 识别返回", {
      chars: String(result?.text || "").length,
      costMs: Date.now() - recognizeStart,
    });
    const query = String(result?.text || "").trim();
    await submitRecognizedVoice(query);
  }
  catch (error) {
    logger.warn("native recognition failed", error);
    if (seq === voiceSeq) failVoiceQuery(t("asr-no-content-retry"));
  }
}

/** 说完了：先停采集再发 finish，等 final 回来才落成气泡 */
function stopVoiceQuery() {
  if (!voiceQueryActive.value || voiceFinishing.value) return;
  voiceFinishing.value = true;
  speechEndDetector.reset();
  // 计时停在这里：底部条要显示「最终录了几秒」，不要再涨
  if (voiceTickTimer) {
    clearInterval(voiceTickTimer);
    voiceTickTimer = null;
  }
  // 原生通道：停录音 → 整段识别 → 回填文本（没有 finish/final 那套）
  if (voiceBackend === "native") {
    const seq = voiceSeq;
    // 降级或授权还在启动时也记住发送，不能在 recorder 尚未赋值时丢掉本轮。
    void Promise.resolve(nativeVoiceStartup).then(() => {
      if (seq === voiceSeq && voiceQueryActive.value) void finishNativeVoiceQuery();
    });
    return;
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
  const normalized = Math.min(1, Math.max(0, level / 0.15));
  voiceLevel.value += (normalized - voiceLevel.value) * 0.35;
  if (voiceQueryActive.value && !voiceFinishing.value) {
    voiceHeard = speechEndDetector.observeLevel(level);
  }
}

function onWelcomeDuplexToggle() {
  duplex.toggle();
  void goToChat({ holdMs: 0 });
}

/**
 * 初始页「点击说话」的落地动作：起飞的同时把语音会话跑起来，
 * 用户在飞行动画里开口也不会丢（ready 前的音频由会话自己缓存）。
 */
function onWelcomeStart() {
  // 先关掉「识别中」文字再起飞：语音链路是异步的，慢一点就会抢在动效前面冒出文字
  asrTipReady.value = false;
  const recording = startVoiceQuery();
  void goToChat();
  return recording;
}

/**
 * 初始页「键盘」：不在点键盘时跳走 —— AiWelcome 在原地展开文本输入框，
 * 用户填完点发送才走这里：先起一轮问答，再用同一条抛物线进对话页（不换 listen.gif、不等扩散峰值）。
 * 顺序与「点击说话」一致（先发起再起飞），用户不用等动画走完才看到回答开始。
 */
function onWelcomeTextSend(text: string) {
  const content = text.trim();
  if (!content) return;
  void sendMessage({ text: content });
  void goToChat({ holdMs: 0 });
}

/** 对话页淡入延迟：语音起飞要等 listen.gif 扩散到最大，文字起飞（holdMs = 0）立即淡入 */
const chatEnterDelayMs = ref(CHAT_ENTER_DELAY_MS);
/** 对话页把淡入推迟到起飞那一刻（保留原有 chatViewportStyle，只加一个动画延迟变量） */
const chatEnterStyle = computed(() => ({
  ...chatViewportStyle.value,
  "--chat-enter-delay": `${chatEnterDelayMs.value}ms`,
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
async function goToChat(options?: { holdMs?: number }) {
  if (welcomeLeaving.value) return;
  if (pageStage.value === "chat") return;

  // 已经进对话页，「从初始页跳出去」的标记就用不上了，清掉免得之后误伤
  clearReturnToWelcome();

  // holdMs：起飞前先等多久（语音等 listen.gif 扩散到最大，文字发送传 0 立即起飞）
  const holdMs = Math.max(0, options?.holdMs ?? WELCOME_LISTEN_HOLD_MS);
  chatEnterDelayMs.value = holdMs > 0 ? CHAT_ENTER_DELAY_MS : 0;

  try {
    uni.setStorageSync(AI_ASK_WELCOME_DONE_KEY, true);
  } catch (error) {
    logger.error("caught error", error);
  }

  // 起飞前先量欢迎页 logo 的中心（量飞行层，sani / listen 两张图都在它里面），
  // 随后欢迎层让位、对话页开始渲染
  const from = readClientRect(".welcome__logo-fly");
  const startedAt = performance.now();
  // 起飞开始就关掉「识别中」文字，等落位动效走完再放出来
  asrTipReady.value = false;
  welcomeLeaving.value = true;
  pageStage.value = "chat";

  await waitChatLayoutSettled();
  const to = readClientRect(".chat-header__island-logo");

  // 等 listen.gif 扩散到最大再起飞：动图还在涨的时候就走，会显得后半段被吃掉
  const holdRemain = holdMs - (performance.now() - startedAt);
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
      // 同一时刻放行「识别中...」文字：图标已经落位，文字再出现不会跟动效打架
      asrTipReady.value = true;
      // 只延续一小段，随后交回空闲态 sani-logo-sm.gif
      if (islandListenIdleTimer) clearTimeout(islandListenIdleTimer);
      islandListenIdleTimer = setTimeout(() => {
        islandListenIdleTimer = null;
        islandListenFromWelcome.value = false;
      }, WELCOME_LISTEN_IDLE_MS);
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

/**
 * 头部右上角那颗房子按钮：关闭当前小程序（交回宿主）。
 * 游客态的听播临时态由本页自己收掉，其余（清身份 / 清听播存储 / popWindow / 退栈兜底）
 * 与作业指导、任务协同页共用一份实现，见 utils/exit-mini-program。
 */
function backToWelcome() {
  if (userStore.isVisitor) listenBroadcast.value = null;
  exitMiniProgram();
}

/**
 * 回到初始页（三个入口共用：长按顶部三角图标 5 秒、历史抽屉里的「新建对话」、
 * 从初始页跳出去的场景页返回）。
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
  if (islandListenIdleTimer) {
    clearTimeout(islandListenIdleTimer);
    islandListenIdleTimer = null;
  }
  islandListenFromWelcome.value = false;
  asrTipReady.value = true;
  welcomeLeaving.value = false;
  welcomeLanded.value = false;
  welcomeLogoStyle.value = {};
  chatEnterDelayMs.value = CHAT_ENTER_DELAY_MS;
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
  // 已有对话继续展示；新进入不再因旧的唤醒标记跳过欢迎首页。
  if (isDemoPage || chatStore.messages.length) {
    pageStage.value = "chat";
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

/**
 * 一键回到底部的垂直位置：输入栏高（含键盘抬起）+ 24rpx 间隙。
 *
 * 底部快捷入口（作业指导 / 任务协同 / 维修助理）展示时，整条导航贴在输入栏正上方
 * （72rpx 高 + 16rpx 上间距 = 88rpx），箭头必须再让开这一段，否则会压在胶囊上。
 * 用 max() 兼容键盘抬起：navigation 只跟 dock 走，键盘弹起时输入栏更高，取大的那个。
 */
const scrollBottomStyle = computed(() => {
  const clearance = navVisible.value
    ? `max(${composerBottomInset.value}, calc(${composerDockOffset.value} + 88rpx))`
    : composerBottomInset.value;
  return { bottom: `calc(${clearance} + 24rpx)` };
});

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
  /**
   * 封顶模式下「滚到底」就是回到本轮提问的落点，不代表用户要看最新内容：
   * 这一拍撤封顶会连带收回垫白、把视图又拽回顶部（表现为「滑到底跳一下」）。
   * 真正的「回到底部」走 jumpToBottom，它自己会撤封顶。
   */
  if (pinned && chatStore.capRoundAtTop) return;
  if (pinned) chatStore.setCapRoundAtTop(false);
}

/**
 * 内容长高后的贴底跟随。
 *
 * 录音期间一律不跟：实时文字是逐字长出来的，每长一点就贴一次底，
 * 钉在顶部的那条实时气泡会被一路拽到下面去。此时只让气泡自己向下生长。
 */
function onMessageContentGrow() {
  if (voiceQueryActive.value) return;
  chatStore.scrollToBottom();
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
  /**
   * 初始页就要按服务端 `/settings` 决定是否开纯净模式（顶部三颗图标 + 底部胶囊入口的显隐）。
   * App.vue 的 onLaunch 已经拉过一次且不 await，这里只在「还没拿到」时补一次；
   * store 里做了并发去重，两处同时在飞也只会发一个 `GET /settings`。
   */
  if (!settingsStore.loaded) void settingsStore.load();
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
  logger.info("原生 resume：从场景窗口回到本页，尝试消费维修助理回调");
  refreshListenReportState();
  // 维修助理是独立场景窗口：关窗回到本页时原 webview 一直在，不会经历 onHide/onShow，
  // 只靠 onShow 消费回调会漏，这里在原生 resume 上补一次（重复调用有 pending 判空，安全）。
  startRepairSummaryCallback();
});

onShow(() => {
  syncWindowHeight();
  const sessionId = consumePendingHistorySession("ASK", "PODCAST");
  if (sessionId) {
    // 显式打开某个历史会话：优先级最高，顺手把「回初始页」标记作废
    clearReturnToWelcome();
    pageStage.value = "chat";
    void openLocalHistory(sessionId, true);
  }
  else if (consumeReturnToWelcome()) {
    /**
     * 从初始页（Hey,SANI）跳出去的场景页回来了：navigateBack / 关场景窗口会回到这个实例，
     * 听汇报关播报、关窗失败兜底则是 redirectTo 新建一个实例 —— 两种情况都要与「首次打开」一致。
     * 直接复用回到初始页的那套复位（同时退出 demo 态、清「已进过对话」标记），
     * 否则紧接着的 syncPageStage 又会按标记把页面落回对话。
     * 已经在 onLoad 里按 sessionId 打开某个历史会话时不动它（显式意图优先）。
     */
    if (!chatStore.aiSessionId) onRestartToStart();
  }
  else {
    syncPageStage();
  }
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
  speechEndDetector.reset();
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
  if (islandListenIdleTimer) {
    clearTimeout(islandListenIdleTimer);
    islandListenIdleTimer = null;
  }
  islandListenFromWelcome.value = false;
  asrTipReady.value = true;
});
const voiceHoldActive = ref(false);
const voiceHoldCancelPending = ref(false);
const startWelcomeVoiceFromGesture = useVoiceQueryGesture({
  active: voiceQueryActive,
  holding: voiceHoldActive,
  cancelPending: voiceHoldCancelPending,
  start: onWelcomeStart,
  send: stopVoiceQuery,
  cancel: cancelVoiceQuery,
});
const startVoiceQueryFromGesture = useVoiceQueryGesture({
  active: voiceQueryActive,
  holding: voiceHoldActive,
  cancelPending: voiceHoldCancelPending,
  start: startVoiceQuery,
  send: stopVoiceQuery,
  cancel: cancelVoiceQuery,
});
</script>

<template>
  <view class="ai-page" :class="{ 'ai-page--dark': isDark }" :style="safeAreaStyle">
    <AiVoiceHoldOverlay
      :active="voiceHoldActive"
      :cancel-pending="voiceHoldCancelPending"
      :dark="isDark"
    />
    <AiChatHeader
      v-if="!pureMode || pageStage === 'chat'"
      :show-island="pageStage === 'chat'"
      :duplex-status="duplexStatus"
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
      :voice-listening="voiceListening || voiceQueryActive || duplexListening"
      :listen-idle="islandListenFromWelcome"
      restartable
      round-buttons
      @back="backToWelcome"
      @restart="onRestartToStart"
      @new-conversation="startNewConversation"
      @session-click="onSessionClick"
      @session-delete="onSessionDelete"
      @session-delete-batch="onSessionDeleteBatch"
      @session-rename="onSessionRename"
      @share-select-all="onShareSelectAll"
    />

    <!-- 欢迎页：起飞动画期间继续挂载，logo 滑到顶部再收起 -->
    <AiWelcome
      v-if="showWelcome || voiceHoldActive"
      :leaving="welcomeLeaving || !showWelcome"
      :landed="welcomeLanded || !showWelcome"
      :logo-style="welcomeLogoStyle"
      :dark="isDark"
      inline-input
      :keyboard-height="keyboardHeight"
      duplex-enabled
      :duplex-active="duplexActive"
      :duplex-starting="duplexStarting"
      @duplex-toggle="onWelcomeDuplexToggle"
      @start-chat="startWelcomeVoiceFromGesture"
      @send-text="onWelcomeTextSend"
    >
      <!-- 初始页也带底部胶囊入口：与对话页同一口径，纯净模式关闭时才出现 -->
      <template #nav>
        <AiChatNav
          v-if="!pureMode"
          flow
          :dark="isDark"
          @item-click="onNavItemClick"
        />
      </template>
    </AiWelcome>

    <!-- 问答页：与欢迎层同时存在，整体淡入 -->
    <view
      v-if="pageStage === 'chat'"
      class="ai-page__chat ai-page__chat--enter"
      :class="{ 'ai-page__chat--duplex': duplexStatus && !shareSheetVisible }"
      :style="chatEnterStyle"
    >
      <view class="ai-chat-glow ai-chat-glow--blue" />
      <view class="ai-chat-glow ai-chat-glow--red" />
      <!-- 设备线稿背景图：跟着用户选的机型走（履带吊 / 混凝土泵车）；深色下隐藏（见 .ai-page--dark） -->
      <AiChatBackdrop class="ai-page__backdrop" />
      <!-- 顶部白色渐变：页面上沿由白向下渐隐，压住线稿背景与滚上来的内容 -->
      <view class="ai-page__top-fade" />
      <!-- 顶部菜单统一由页面根节点的 AiChatHeader 渲染，避免两套按钮叠加。 -->
      <AiMessageList
        :key="chatListKey"
        top-inset="var(--chat-top-inset, 300rpx)"
        :dark="isDark"
        :asr-tip-ready="asrTipReady"
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
        :voice-top-pad="voiceLiveHeight"
        :step-card-step-id="guideStepCardStepId"
        :pin-step-card="guideStepSheetVisible"
        @card-space-change="onGuideStepCardSpaceChange"
        @content-grow="onMessageContentGrow"
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
        @ask-slot-pick="onAskSlotPick"
        @ask-slot-submit="onAskSlotSubmit"
        @assistant-navigation-open="onAssistantNavigationOpen"
        @assistant-navigation-confirm="onAssistantNavigationConfirm"
        @assistant-callback-open="onAssistantCallbackOpen"
        @guide-step-open="onGuideStepOpen"
        @guide-suggestion-open="onGuideSuggestionOpen"
        @guide-check-step-select="onGuideCheckStepSelect"
        @step-card-ready="focusGuideStepCardAtTop"
        @tts-click="onTtsClick"
        @tts-stop="stopSceneTts"
        @feedback-change="onFeedbackChange"
        @share-click="onShareClick"
        @copy-click="onCopyMessage"
        @select-toggle="onShareSelectToggle"
        @listen-report="onGoListenReport"
        @scroll-top="onScrollTop"
        @pinned-change="onPinnedChange"
      />
      <!-- 录音中的实时转写：铺在提问气泡的同一个落点（头部下沿）上，纯文字、没有气泡外壳，
           文字从左往右长出来；说完才收成正式提问气泡。
           点下说话时会先把上一轮提问顶到这个落点（历史回复整体往上拉走），
           再由列表把那条提问临时隐藏、把位置让给这段文字（voiceTopPad 同步它的高度），
           所以实时文字背后不会有任何正文，下面的回复也只按文字长短往下让位。
           只露最后两行：超出的旧文字被裁在框顶外，最新的始终贴在下面；
           外框那层页面底色渐隐负责盖住头部留白条里透出来的上一条回答 -->
      <AiVoiceTranscript
        v-if="voiceQueryActive && asrTipReady"
        :text="voiceTranscript"
        :dark="isDark"
        @height-change="voiceLiveHeight = $event"
      />
      <!-- 一键回到底部：离底时出现，贴底自动隐藏；
           垂直位置 = 输入栏高（含键盘抬起）+ 24rpx 间隙，底部胶囊展示时再让开 88rpx（见 scrollBottomStyle）；
           水平居中，只放 arrow-down.png（无白底 / 阴影，见 .chat-scroll-bottom） -->
      <view
        v-if="showScrollToBottom && !voicePanelOpen"
        class="chat-scroll-bottom"
        :style="scrollBottomStyle"
        @tap="onScrollToBottomTap"
      >
        <image
          class="chat-scroll-bottom__chevron"
          :src="scrollBottomIcon"
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
      <!-- 跳转确认层：维修助理已改成消息流内联卡，这里只剩配件助手（拍照 / 上传 / 首页） -->
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
        v-else
        :voice-query-active="voiceQueryActive"
        duplex-enabled
        :duplex-active="duplexActive"
        :duplex-starting="duplexStarting"
        @duplex-toggle="duplex.toggle"
        ref="chatInputRef"
        v-model="inputText"
        :dark="isDark"
        :is-loading="isLoading"
        :keyboard-height="keyboardHeight"
        :voice-keyboard-height="voiceKeyboardHeight"
        :compact-voice-listening="true"
        :tap-to-talk="true"
        @send="sendMessage"
        @voice-query-start="startVoiceQueryFromGesture"
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
        v-if="voiceQueryActive && !shareSheetVisible"
        :level="voiceLevel"
        :seconds="voiceSeconds"
        :busy="voiceFinishing"
        :hold-to-send="voiceHoldActive"
        :cancel-pending="voiceHoldCancelPending"
        :dark="isDark"
        @cancel="cancelVoiceQuery"
        @submit="stopVoiceQuery"
      />

      <!-- 纯净模式关闭时的底部快捷入口：听汇报 / 作业指导 / 任务协同 / 维修助理 / 配件助手；
           打开纯净模式（或录音面板展开）时整条导航不渲染 -->
      <AiChatNav
        :visible="navVisible"
        :active-key="navActiveKey"
        :dark="isDark"
        :style="navOffsetStyle"
        @item-click="onNavItemClick"
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
  position: relative;
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
  // 210rpx（105px）略高于 200rpx（100px）的实色头部：首条内容贴着头部下沿起步，
  // 上一轮回答的尾巴不会在灵动岛下面露出一截被裁掉的字
  --chat-top-inset: calc(constant(safe-area-inset-top) + 210rpx);
  --chat-top-inset: calc(env(safe-area-inset-top) + 210rpx);
}

.ai-page__chat--duplex {
  --chat-top-inset: max(calc(env(safe-area-inset-top, 0px) + 300rpx), calc(var(--safe-top-px, 0px) + 260rpx));
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
.ai-page > .ai-page__header {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  z-index: 1010;
  height: 200rpx;
}

// 顶部毛玻璃渐隐（对应设计稿 722:152「回答」头部底板）：
// 不铺白色底 —— 透明 + 背后模糊，消息滚到头部下面还能看见字，只是被虚化；
// 「渐变」体现在模糊强度上：上沿最糊，往下渐弱到完全清晰，接住正文，没有硬边。
// 高度 = 刘海安全区 + 210rpx（与 --chat-top-inset 一致，消息正好从渐隐下沿起步）。
.ai-page__top-fade {
  position: absolute;
  z-index: 1;
  top: 0;
  right: 0;
  left: 0;
  height: var(--chat-top-inset);
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

/* 切历史会话时弹出的那个 loading 环：配色对齐播报页「正在加载偏好」的环
   （pages/podcast/index.vue 的 .preference-loading__indicator），同一套四色渐变
   #3D21CD → #1999FE → #C067FA → #FD90C4；环宽仍保持 6rpx（3px），
   用 padding 留环宽、mask 挖空中间。选择器限定在 .session-loading 内，
   分享海报复用同一个环时不跟着变色 */
.session-loading .session-loading__spinner {
  box-sizing: border-box;
  padding: 6rpx;
  border: 0;
  background-image: linear-gradient(90deg, #3d21cd 0%, #1999fe 48.72%, #c067fa 76%, #fd90c4 100%);
  /* 先写标准属性、再用 -webkit- 兜底：老 WebView 只认前缀版本 */
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
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

  /* 边缘流光在深色下同样保留：色值、厚度、流动都与浅色一致，
     不做深色专用替换（深底下同样的紫/蓝更显，无需再调） */

  .ai-page__backdrop {
    display: none;
  }
}
</style>
