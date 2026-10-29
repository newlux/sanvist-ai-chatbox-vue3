<script setup lang="ts">
import { onHide, onLoad, onShow, onUnload } from "@dcloudio/uni-app";
import { storeToRefs } from "pinia";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { GuideStepItem, GuideStepPayload, GuideStepSelectEvent, GuideSuggestionPayload } from "@/api/chat/types";
import type { ChatMessageAttachment } from "@/stores/chat-types";
import { getRecommendedGuideQuestions } from "@/api/guide";
import { getTodayAwakeningPrompt } from "@/api/user-role";
import AiBadFeedbackSheet from "@/components/ai-bad-feedback-sheet/index.vue";
import AiChatHeader from "@/components/ai-chat-header/index.vue";
import AiChatInput from "@/components/ai-chat-input/index.vue";
import AiGuideStepSheet from "@/components/ai-guide-step-sheet/index.vue";
import AiGuideSuggestionSheet from "@/components/ai-guide-suggestion-sheet/index.vue";
import AiMessageList from "@/components/ai-message-list/index.vue";
import ShareConversationPoster from "@/components/ai-share-poster/index.vue";
import { useChatFeedback } from "@/hooks/useChatFeedback";
import { useChatSend } from "@/hooks/useChatSend";
import { useChatShare } from "@/hooks/useChatShare";
import { useChatTts } from "@/hooks/useChatTts";
import { useChatViewport } from "@/hooks/useChatViewport";
import { useComposerAttachments, type AttachmentSource } from "@/hooks/useComposerAttachments";
import { useRealtimeTts } from "@/hooks/useRealtimeTts";
import { useSafeArea } from "@/hooks/useSafeArea";
import { provideChatScope, useChatStore, useSessionStore, useUserStore } from "@/stores";
import { createLogger } from "@/utils/logger";
import { backFromScene } from "@/utils/scene-navigation";
import { consumePendingHistorySession, getSessionId, navigateToSessionScene, peekPendingHistorySession, readSessionIdFromOptions } from "@/utils/session-scene";

/**
 * 作业指导页（基于首页 home 的聊天 UI：Header 历史会话 + 消息列表 + 快捷入口 + 输入栏）。
 *
 * 与首页 / 听汇报的区别：
 * - 独立会话域 "guide"，不与首页主会话互相污染；
 * - 复用首页 useChatSend 对话链路，发送时固定透传 inputs.scene=GUIDE；
 * - 每次进入起一轮干净会话（与听汇报一致），返回再进时重新开一轮。
 */
defineOptions({ name: "AiGuidePage" });

const logger = createLogger("guide-page");
const { t } = useI18n();

const chatScope = provideChatScope("guide");
const userStore = useUserStore();
const chatStore = useChatStore(chatScope);
// 注入 --safe-top-px：悬浮头部的高度补偿（--chat-header-height）要按真实状态栏算
const { safeAreaStyle } = useSafeArea();
/**
 * 自动滚动的落点：回复内容末尾（不含参考来源）——参考来源不被贴底滚进视野，
 * 以内容块容器高度减去参考来源高度为准（见 ai-message-list 的 alignToReplyEnd）。
 * 回复里没有参考来源时，表现与原来的贴底一致。
 */
chatStore.setStopAtReplyEnd(true);
/**
 * 待机引导（Ardot 347:5392）：标题是固定问候语（操作手，你好。），
 * 其余文案不再写死在前端 JSON，而是用推荐页带过来的 deviceModel / experience / modelExperience 调
 * GET /recommended-questions/guide，用返回的 greeting 与 questions 动态渲染。
 * 没有这三个参数（例如从用户中心直接进入）时不展示引导区，只留聊天界面。
 */
/** 待机态取几条推荐问题（与推荐页一致，取一屏够看的量） */
const GUIDE_WELCOME_QUESTION_COUNT = 3;
const guideGreeting = ref("");
const guideQuestions = ref<string[]>([]);
/** 引导区拉取中：期间不渲染（避免先闪一屏空文案再变成接口文案） */
const guideWelcomeLoading = ref(false);
/** 推荐页带过来的上下文：机型 + 两轮经验 */
const guideRecommendContext = ref({ deviceModel: "", experience: "", modelExperience: "" });
const sessionStore = useSessionStore();
const chatHeader = ref<{ reloadSessions?: () => Promise<void> } | null>(null);
/** 输入栏实例：步骤卡拍照后把附件挂进输入栏并聚焦，不再直接发送 */
const chatInputRef = ref<{
  appendAttachments?: (meta: ChatMessageAttachment[]) => void;
  focusTextInput?: () => void;
} | null>(null);
const sharePosterWrap = ref<unknown>(null);
const shareSheetBottomInset = ref("");
/**
 * 机型选中值（modelKey）：在「选择体验的设备」页选好后写进 store，
 * 本页不再弹卡片，直接读 store；未选择时不下发，选中后每次对话都作为 inputs.device_model 透传。
 */
const selectedDeviceModel = computed(() => userStore.selectedDeviceModelKey);
/** 指导步骤卡片（COMPONENT scene=guide / type=step）：随回答自动弹起，选完即回发下一轮 */
const guideStepPayload = ref<GuideStepPayload | null>(null);
const guideStepSheetVisible = ref(false);
/** 底部步骤白板实例：点核对卡步骤条时用它直接切到对应步 */
const guideStepSheetRef = ref<{ goToStep: (index: number) => void } | null>(null);
/** 请求白板显示的步骤下标（0 起）：点核对卡步骤条时带上，展开时按它定位 */
const guideStepRequestedIndex = ref(0);
/** 步骤卡片实时高度（px）：卡片展开时把列表底部 padding 顶起来，最后一条回答不会被盖住 */
const guideStepSheetHeight = ref(0);
/**
 * 当前要显示的那张核对卡属于哪一步（步骤 id）。
 *
 * 不用「第几张」：多步骤卡会被反复触发，每轮回答各带一张卡，序号法会把新一轮的卡
 * 算到第一张卡的位置上。按步骤 id 交给消息列表定位，重复触发时取最新那一轮的卡。
 */
const guideStepCardStepId = ref("");
/** 核对卡要顶到对话区顶部还缺的底部间距（px，由消息列表量出来） */
const guideStepCardSpace = ref(0);

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
// 提前到 useChatSend 之前：onAiAnswerDelta 回调里要用实时 TTS 做流式听播。
const { onTtsClick: onHistoryTtsClick, releaseAudio: stopHistoryTts, activeMessageId: historyTtsMessageId } = useChatTts(chatScope);
const realtimeTts = useRealtimeTts(chatScope);
const { sendMessage: sendChatMessage, sendQuickPrompt, beginAsrPlaceholder, discardAsrPlaceholder, stopGenerating, cancelActiveStream } = useChatSend(chatScope, {
  scene: "GUIDE",
  // 发送后强制回底（走 scrollToBottom(true)，不再传 keepScrollOnSend 保留阅读位置）；
  // 回复里的核对卡仍由 focusStepBlock 在卡片出现 / 翻页时顶到对话区最上方（见 onGuideStepOpen）。
  // 机型在「选择体验的设备」页、讲解模式在「选择身份」页，各自写进 store，这里每次发送时现取，
  // 避免切会话或来回进出页面后带上旧值
  getExtraInputs: () => ({
    ...(selectedDeviceModel.value ? { device_model: selectedDeviceModel.value } : {}),
    ...(userStore.operatorRole?.roleKey ? { operator_role: userStore.operatorRole.roleKey } : {}),
  }),
  // 同首页：问答完成、答案文字开始渲染就自动听播（不等 workflow_finished / message_end）：
  // 第一块 answer 文字到达即开播，后续文字流式增量续播，音频按原文顺序排队播放。
  onAiAnswerDelta({ aiMsgId, delta, ended }) {
    const index = chatStore.messages.findIndex(item => item.id === aiMsgId);
    if (index < 0) return;
    realtimeTts.feedAnswerDelta(chatStore.messages[index], delta, ended);
  },
});

/** 停掉本页两套听播引擎（实时流式 + 历史整段）：换交互 / 离开页面时统一走这里。 */
function stopSceneTts() {
  realtimeTts.stop();
  stopHistoryTts();
}

/**
 * 发送新消息（文字会话 / 语音确认发送共用 @send 出口）时立刻停掉正在进行的听播。
 * 同步停、不依赖 activeRequestSeq watcher —— 发出去的瞬间就安静。
 */
function sendMessage(payload?: Parameters<typeof sendChatMessage>[0]) {
  stopSceneTts();
  return sendChatMessage(payload);
}

/**
 * 按住说话 / 再次识别按下的瞬间停掉听播。此时录音刚开始、请求还没发出，
 * activeRequestSeq watcher 不会动 —— 但旧播报继续响会盖住用户对着麦克风说话，
 * 还会被录进 ASR 里，必须按下即停。
 */
function stopSceneTtsOnVoiceStart() {
  stopSceneTts();
}

// 「再次发起其他提问 / 切换会话 / 停止生成」时立刻停掉正在进行的听播（同首页）：
// activeRequestSeq 在新请求开始和取消/重置时都会变化，一个 watcher 兜底覆盖全部入口。
watch(() => chatStore.activeRequestSeq, () => {
  stopSceneTts();
});



/**
 * 作业指导是「核对卡顶到对话区最上方」的阅读方式，所以核对卡一旦置顶就不能再被流式追加拽走：
 * 关掉「贴底跟随」这件事只在 focusGuideStepCardAtTop 里做（见下），也就是真的把某张核对卡
 * 顶到对话区顶部时才关。
 *
 * 不能像以前那样「请求一开始就一律关掉」：发送时那次强制回底（scrollToBottom(true)）会因此作废
 * ——消息列表量 DOM 对齐时 pinned 已经是 false，回复只在可视区外面往下写，表现就是「回复不滚动」。
 * 用户自己滑到底部时，列表会重新上报 pinned（@pinned-change），跟随照旧。
 */
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
} = useChatShare(sharePosterWrap, chatScope);
const { badFeedbackSheetVisible, onFeedbackChange, onBadFeedbackConfirm, onBadFeedbackClose } = useChatFeedback(chatScope);
/** 步骤卡「拍照」入口专用：独立实例，选完一张图直接把文件交给 sendMessage */
const photoPicker = useComposerAttachments();

const messageBottomInset = computed(() => {
  if (shareSheetVisible.value) return shareSheetBottomInset.value;
  // 步骤卡 / 追问卡贴底展开：列表底部既要让开卡片高度，也要留够把核对卡顶到对话区最上方的间距
  if (guideStepSheetVisible.value && guideStepSheetHeight.value > 0) {
    return `${Math.max(guideStepSheetHeight.value, guideStepCardSpace.value)}px`;
  }
  if (guideSuggestionSheetVisible.value && guideSuggestionSheetHeight.value > 0) {
    return `${guideSuggestionSheetHeight.value}px`;
  }
  // 导航、输入栏都是 fixed，列表要用 padding 把最后一条抬到它们上方
  if (showQuickPrompts.value) return `calc(${composerBottomInset.value} + 72rpx)`;
  return composerBottomInset.value;
});
const navOffsetStyle = computed(() => ({ bottom: composerDockOffset.value }));

/**
 * 把当前显示的那张核对卡（对话区的 .chat-box__card）顶到对话区最上方。
 * 步骤卡出现、翻页、卡片高度变化后都用它：卡片顶在上方才整张可见。
 */
function focusGuideStepCardAtTop() {
  // 顶成功了才关掉贴底跟随：卡片还没渲染出来（focusStepBlock 没命中）时保持跟随，
  // 否则流式回答会停在可视区外面，看着就是「回复不滚动」。
  const stepId = String(guideStepCardStepId.value || "").trim();
  if (stepId && chatStore.focusStepBlock(stepId)) chatStore.setPinnedToBottom(false);
}

/**
 * 自动弹层的延时：答案生成结束后再等 5s 再弹，避免答案刚出来就被浮层盖住。
 * 定时器必须放在页面层——生成结束时气泡正文会被整体卸载（见 ai-bubble-v2 的 hideBody），
 * 挂在卡片组件里的定时器会跟着组件一起销毁，卡片就永远等不到自动弹起。
 */
const AUTO_OPEN_DELAY_MS = 5000;
let autoOpenTimer: ReturnType<typeof setTimeout> | null = null;
let pendingAutoOpen: (() => void) | null = null;

function armAutoOpenTimer() {
  if (!pendingAutoOpen || autoOpenTimer) return;
  autoOpenTimer = setTimeout(() => {
    autoOpenTimer = null;
    const run = pendingAutoOpen;
    pendingAutoOpen = null;
    run?.();
  }, AUTO_OPEN_DELAY_MS);
}

/** 自动弹层：生成中先挂起，等 loading 变 false 后再计时 5s */
function scheduleAutoOpen(open: () => void) {
  pendingAutoOpen = open;
  if (isLoading.value) return;
  armAutoOpenTimer();
}

watch(isLoading, (loading) => {
  if (!loading) armAutoOpenTimer();
});

function clearAutoOpenTimer() {
  if (autoOpenTimer) {
    clearTimeout(autoOpenTimer);
    autoOpenTimer = null;
  }
  pendingAutoOpen = null;
}

/** 步骤卡片：单步是多轮追问（点一下直接发），多步选好后确认，统一按普通问题发送。 */
function onGuideStepOpen(payload: GuideStepPayload, auto = false) {
  // 自动弹起：等答案生成结束再延时；手动点卡片立即打开
  if (auto) {
    scheduleAutoOpen(() => openGuideStepSheet(payload));
    return;
  }
  openGuideStepSheet(payload);
}

/** 真正打开步骤卡白板（自动 / 手动共用） */
function openGuideStepSheet(payload: GuideStepPayload) {
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

/** 点击追问后先移除它所属回答的追问列表，再按普通问题走完整发送链路。 */
function onGuideSuggestionTap(suggestion: string, messageIndex: number) {
  const message = chatStore.messages[messageIndex];
  if (message?.role === "ai" && Array.isArray(message.blocks)) {
    const blockIndex = message.blocks.findIndex(block => block.type === "suggestion");
    if (blockIndex >= 0) message.blocks.splice(blockIndex, 1);
  }
  sendQuickPrompt(suggestion);
}

/**
 * 多轮追问卡（COMPONENT scene=guide / type=suggestion）：options 是并行分支，
 * 点哪一项就把那一项作为下一轮提问发出去（与按顺序推进的步骤卡区分开）。
 */
const guideSuggestionPayload = ref<GuideSuggestionPayload | null>(null);
const guideSuggestionSheetVisible = ref(false);
/** 追问卡实时高度（px）：同步骤卡，展开时给列表底部让位 */
const guideSuggestionSheetHeight = ref(0);

function onGuideSuggestionOpen(payload: GuideSuggestionPayload, auto = false) {
  // 自动弹起：等答案生成结束再延时；手动点文本立即打开
  if (auto) {
    scheduleAutoOpen(() => openGuideSuggestionSheet(payload));
    return;
  }
  openGuideSuggestionSheet(payload);
}

function openGuideSuggestionSheet(payload: GuideSuggestionPayload) {
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

/** 新生成消息实时播放，历史消息播放已合成的整段语音。 */
function onTtsClick(index: number) {
  const msg = chatStore.messages[index];
  const messageId = msg?.messageId;
  if (messageId == null || msg?.sessionId == null) return;

  if (realtimeTts.playingMessageId.value === messageId) {
    realtimeTts.stop();
    return;
  }
  if (historyTtsMessageId.value === messageId) {
    stopHistoryTts();
    return;
  }

  realtimeTts.stop();
  stopHistoryTts();
  if (msg.ttsPlaybackMode === "realtime") {
    void realtimeTts.togglePlay(msg);
    return;
  }
  void onHistoryTtsClick(index);
}

const localizedQuickPrompts = computed(() => chatStore.quickPrompts.map(item => t(item)));
/** 有 greeting 或有推荐问题时才渲染引导区（接口没给就走纯聊天界面） */
const hasGuideWelcome = computed(() => Boolean(guideGreeting.value) || guideQuestions.value.length > 0);
const showSceneWelcome = computed(() => (
  !messages.value.length && !isSessionSwitching.value && !guideWelcomeLoading.value && hasGuideWelcome.value
));

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

function onBack() {
  backFromScene();
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
  if (navigateToSessionScene(session, "GUIDE")) return;
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
  if (!await confirmModal(t("delete-conversation-title"), t("delete-conversation-desc"))) return;
  try {
    await sessionStore.removeSession(id);
    await chatHeader.value?.reloadSessions?.();
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
  if (!await confirmModal(t("delete-conversations-title"), t("delete-conversations-desc"))) return;
  try {
    await sessionStore.removeSessions(uniqueIds);
    await chatHeader.value?.reloadSessions?.();
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

async function onScrollTop() {
  if (!chatStore.aiSessionId) return;
  try {
    await sessionStore.loadMoreHistory(chatStore);
  } catch (error) {
    logger.error("failed to load more history", error);
    uni.showToast({ title: t("load-history-failed"), icon: "none" });
  }
}

/** query 值解码：uni 一般已解码，H5 直开 URL / 宿主拼参时可能还是编码态，这里兜一次 */
function decodeQueryValue(value: string) {
  const text = String(value || "").trim();
  if (!/%[0-9A-F]{2}/i.test(text)) return text;
  try {
    return decodeURIComponent(text).trim();
  }
  catch {
    return text;
  }
}

/** 从 onLoad options 或当前 URL 里取一个 query 参数 */
function readQueryValue(options: Record<string, unknown> | null | undefined, key: string) {
  const raw = options?.[key];
  if (raw != null && String(raw).trim()) return decodeQueryValue(String(raw));

  if (typeof location === "undefined") return "";
  const search = new URLSearchParams(location.search || "");
  const fromSearch = search.get(key);
  if (fromSearch) return decodeQueryValue(fromSearch);
  const hash = String(location.hash || "");
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  return query ? decodeQueryValue(new URLSearchParams(query).get(key) || "") : "";
}

/** 推荐页带过来的上下文：机型 + 两轮经验（决定待机态拉哪一套文案） */
function readGuideRecommendContext(options?: Record<string, unknown> | null) {
  return {
    deviceModel: readQueryValue(options, "deviceModel"),
    experience: readQueryValue(options, "experience"),
    modelExperience: readQueryValue(options, "modelExperience"),
  };
}

/**
 * 待机态动态文案：GET /recommended-questions/guide（greeting + questions）。
 * 机型 / 经验缺一个就不发请求，引导区不展示（例如从用户中心直接进来）。
 */
async function loadGuideRecommend() {
  const { deviceModel, experience, modelExperience } = guideRecommendContext.value;
  if (!deviceModel || !experience) return;

  guideWelcomeLoading.value = true;
  try {
    const data = await getRecommendedGuideQuestions({
      deviceModel,
      experience,
      ...(modelExperience ? { modelExperience } : {}),
      count: GUIDE_WELCOME_QUESTION_COUNT,
      offset: 0,
    });
    guideGreeting.value = String(data?.greeting || "").trim();
    guideQuestions.value = (Array.isArray(data?.questions) ? data.questions : [])
      .map(item => String(item || "").trim())
      .filter(Boolean);
  }
  catch (error) {
    logger.warn("failed to load guide recommended questions", error);
  }
  finally {
    guideWelcomeLoading.value = false;
  }
}

/** 推荐页带过来的问题：onLoad 记下来，等 onMounted 把视口同步完再发 */
let pendingQuestion = "";

onLoad((options) => {
  syncWindowHeight();
  const sessionId = readSessionIdFromOptions(options) || peekPendingHistorySession("GUIDE");
  if (sessionId) {
    void openLocalHistory(consumePendingHistorySession("GUIDE") || sessionId, true);
    return;
  }
  // 进入即起一轮干净会话（返回首页再进会重新开一轮）；发送场景由 useChatSend 固定为 GUIDE。
  chatStore.resetConversation();
  chatStore.showQuickPrompts = false;
  chatStore.showQuickList = false;
  pendingQuestion = readQueryValue(options, "question");
  guideRecommendContext.value = readGuideRecommendContext(options);
  void loadGuideRecommend();
});

onMounted(() => {
  syncWindowHeight();
  loadAwakeningPrompt();
  const question = pendingQuestion;
  pendingQuestion = "";
  if (question) sendQuickPrompt(question);
});

onShow(() => {
  syncWindowHeight();
  const sessionId = consumePendingHistorySession("GUIDE");
  if (sessionId) void openLocalHistory(sessionId, true);
});

// 离开页面时停止听播：navigateTo 进入别的页面时本页只是被压栈隐藏、组件并不卸载，
// 两个 TTS hook 自带的 onBeforeUnmount 清理不会触发，必须挂在 onHide / onUnload 上。
onHide(() => {
  stopSceneTts();
  clearAutoOpenTimer();
});
onUnload(() => {
  cancelActiveStream();
  stopSceneTts();
  clearAutoOpenTimer();
});
</script>

<template>
  <view class="ai-page" :style="safeAreaStyle">
    <view class="ai-page__chat" :style="chatViewportStyle">
      <view class="ai-chat-glow ai-chat-glow--blue" />
      <view class="ai-chat-glow ai-chat-glow--red" />
      <!-- 顶部毛玻璃渐隐：与首页对话页同一层，状态栏 / 头部区域半透明，内容滚上来只会被虚化 -->
      <view class="ai-page__top-fade" />
      <!-- Header：悬浮在内容之上（不占布局），消息可以滚到它下面，由 .ai-page__top-fade 做毛玻璃渐隐 -->
      <AiChatHeader
        ref="chatHeader"
        v-model:sessions="sessions"
        class="ai-page__header"
        plain-bg
        :load-sessions="getAISessionList"
        :selected-session-id="aiSessionId"
        :generating="isLoading"
        :share-mode="shareSheetVisible"
        :share-select-all-disabled="shareSelectAllDisabled"
        :share-all-checked="shareAllChecked"
        :share-selected-round-count="shareSelectedRoundCount"
        @back="onBack"
        @new-conversation="startNewConversation"
        @session-click="onSessionClick"
        @session-delete="onSessionDelete"
        @session-delete-batch="onSessionDeleteBatch"
        @session-rename="onSessionRename"
        @share-select-all="onShareSelectAll"
      />
      <!-- 待机引导（Ardot 347:5392）：标题 + greeting + 推荐问题；
           greeting / 问题来自 /recommended-questions/guide，标题是固定问候语 -->
      <view v-if="showSceneWelcome" class="guide-welcome">
        <text class="guide-welcome__title">
          {{ t("guide-welcome-title") }}
        </text>
        <text v-if="guideGreeting" class="guide-welcome__greeting">
          {{ guideGreeting }}
        </text>
        <template v-if="guideQuestions.length">
          <text class="guide-welcome__label">
            {{ t("guide-welcome-ask-label") }}
          </text>
          <view class="guide-welcome__list">
            <view
              v-for="question in guideQuestions"
              :key="question"
              class="guide-welcome__row"
              @tap="sendQuickPrompt(question)"
            >
              <text class="guide-welcome__question">
                {{ question }}
              </text>
            </view>
          </view>
        </template>
      </view>
      <AiMessageList
        :key="aiSessionId || 'new-conversation'"
        top-inset="var(--chat-top-inset, 300rpx)"
        :messages="messages"
        :quick-prompts="localizedQuickPrompts"
        :show-quick-prompts="showQuickPrompts"
        :show-business-overview="false"
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
        :pinned-to-bottom="pinnedToBottom"
        :realtime-tts-message-key="realtimeTts.playingMessageKey.value"
        :realtime-tts-playing="realtimeTts.playing.value"
        @quick-prompt="sendQuickPrompt"
        @suggestion-tap="onGuideSuggestionTap"
        @guide-step-open="onGuideStepOpen"
        @guide-suggestion-open="onGuideSuggestionOpen"
        @guide-check-step-select="onGuideCheckStepSelect"
        @tts-click="onTtsClick"
        @feedback-change="onFeedbackChange"
        @share-click="onShareClick"
        @copy-click="onCopyMessage"
        @select-toggle="onShareSelectToggle"
        @scroll-top="onScrollTop"
        @pinned-change="chatStore.setPinnedToBottom"
      />
      <view v-if="isSessionSwitching" class="session-loading">
        <view class="session-loading__spinner" />
      </view>

      <view v-if="shareSheetVisible" class="share-sheet-modal">
        <view class="share-sheet" @tap.stop>
          <text class="share-sheet__title">
            {{ t("share-to") }}
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

      <!-- 分享图片预览/生成 -->
      <view v-else-if="sharePosterVisible" class="share-poster-modal">
        <view class="share-poster-modal__mask" @tap="closeSharePosterModal" />
        <view class="share-poster-modal__card" @tap.stop>
          <view class="share-poster-modal__content">
            <view v-if="sharePosterGenerating" class="share-poster-modal__loading">
              <view class="share-poster-modal__loading-content">
                <view class="session-loading__spinner share-poster-modal__loading-spinner" />
                <text class="share-poster-modal__loading-text">
                  {{ t("share-poster-generating") }}
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
                  {{ t("share-save-image") }}
                </text>
              </view>
              <view class="share-poster-modal__option" @tap="onCopySharePoster">
                <view class="share-poster-modal__option-icon">
                  <image class="share-poster-modal__option-icon-img" :src="iconCopyImage" mode="aspectFit" />
                </view>
                <text class="share-poster-modal__option-label">
                  {{ t("share-copy-image") }}
                </text>
              </view>
            </view>
            <view class="share-poster-modal__divider" />
            <view class="share-poster-modal__cancel" @tap="closeSharePosterModal">
              <text class="share-poster-modal__cancel-text">
                {{ t("cancel") }}
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
        :compact-voice-listening="true"
        @send="sendMessage"
        @stop="stopGenerating"
        @voice-start="stopSceneTtsOnVoiceStart"
        @voice-restart="stopSceneTtsOnVoiceStart"
        @recognize-begin="beginAsrPlaceholder"
        @recognize-fail="discardAsrPlaceholder"
        @toggle-quick-list="toggleQuickList"
        @input-focus="setTextInputFocused(true)"
        @input-blur="setTextInputFocused(false)"
        @voice-input-focus="setVoiceInputFocused(true)"
        @voice-input-blur="setVoiceInputFocused(false)"
        @dock-height-change="setInputDockHeight"
      />

      <!-- 回答里的指导步骤卡片：选中步骤后自动收起并带上选择回发下一轮 -->
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

      <AiBadFeedbackSheet
        :visible="badFeedbackSheetVisible"
        @close="onBadFeedbackClose"
        @confirm="onBadFeedbackConfirm"
      />
    </view>
  </view>
</template>

<style lang="scss" scoped>
$color-text-primary: #1a1a1a;
$color-text-secondary: #6b6b6b;
$color-text-muted: #bababa;
$color-red-accent: #ff0000;
$color-red-btn: #fe0000;
$color-bg-phone: #fafafa;
$color-bg-voice: #f5f5f5;
$color-border-light: #efefef;
$color-white: #ffffff;

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
  // 顶部毛玻璃层的高度 = 悬浮头部在内容里的占位（与首页对话页同一个值）
  --chat-top-inset: calc(constant(safe-area-inset-top) + 300rpx);
  --chat-top-inset: calc(env(safe-area-inset-top) + 300rpx);
  // 悬浮头部不占布局，需要给「欢迎区」补回来的实际头部高度：状态栏占位 + 栏高 50px
  --chat-header-height: calc(max(var(--safe-top-px, 0px), env(safe-area-inset-top)) + 100rpx);
}

// 头部悬浮（与首页对话页一致）：不占布局高度，消息可以滚到它下面，透过 .ai-page__top-fade 的毛玻璃淡出；
// 同时要盖住消息列表和输入栏：历史抽屉、操作菜单都挂在它的层叠上下文里，
// 留在 z-index:1 会被后面的兄弟节点盖掉（气泡压在抽屉上就是这个原因）
.ai-page__chat > .ai-page__header {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  z-index: 30;
}

// 顶部毛玻璃渐隐（与首页对话页同一层）：透明 + 背后模糊，状态栏与头部区域是半透明的，
// 内容滚到头部下面还能看见字，只是被虚化；「渐变」体现在模糊强度上，没有硬边。
.ai-page__top-fade {
  position: absolute;
  z-index: 1;
  top: 0;
  right: 0;
  left: 0;
  height: calc(constant(safe-area-inset-top) + 300rpx);
  height: calc(env(safe-area-inset-top) + 300rpx);
  pointer-events: none;
  backdrop-filter: blur(16rpx); // 8px
  -webkit-backdrop-filter: blur(16rpx);
  mask-image: linear-gradient(180deg, #000 0%, rgba(0, 0, 0, 0.7) 45%, rgba(0, 0, 0, 0) 100%);
  -webkit-mask-image: linear-gradient(180deg, #000 0%, rgba(0, 0, 0, 0.7) 45%, rgba(0, 0, 0, 0) 100%);
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

/* ===== 待机引导（Ardot 347:5392）=====
   画板 375×812：标题 y=178，往下依次是 greeting（说明）、「你可以这么问」与问题列表，
   左右留白 20（40rpx）。

   顶部留白与作业协同页（pages/task/index.vue 的 .task-welcome）对齐：
   头部悬浮在内容之上（状态栏 + 栏高 50px，见 --chat-header-height），灵动岛（92）+ 下方
   「SANI」胶囊是绝对定位浮在内容之上，换算到内容区岛底 ≈ 84rpx、胶囊底 ≈ 136rpx。
   设计稿的 148rpx 会让标题顶只比胶囊低 12rpx（6px），视觉上贴着 logo；
   这里沿用 216rpx（头部高度之外），标题距胶囊底约 80rpx（40px）。 */
.guide-welcome {
  position: relative;
  z-index: 1;
  // 头部改成悬浮后不占布局，这里把它的实际高度补回来，欢迎区仍从头部下方起步
  // （216rpx 是原来「头部之下」再让出的距离，与作业协同页 .task-welcome 同一档）
  padding: calc(var(--chat-header-height) + 216rpx) 40rpx 0;
}

/* 固定问候语（Ardot 347:5392 Greeting Title）：28px Bold #0D0D0D，行高 41 */
.guide-welcome__title {
  display: block;
  color: #0d0d0d;
  font-family: "Source Han Sans CN", "PingFang SC", sans-serif;
  font-size: 56rpx; // 28
  font-weight: 700;
  line-height: 82rpx; // 41
}

/* 接口返回的 greeting（Ardot 347:5392 Greeting Sub）：14px Regular #5D5D5D，行高 22；
   与标题间距 13px —— 设计稿里问候语本身就是说明文案，不再是标题 */
.guide-welcome__greeting {
  display: block;
  margin-top: 26rpx; // 13
  color: #5d5d5d;
  font-family: "PingFang SC";
  font-size: 28rpx; // 14
  font-weight: 400;
  line-height: 44rpx; // 22
}

.guide-welcome__label {
  display: block;
  margin-top: 32rpx; // 16
  color: #8f8f8f;
  font-family: "PingFang SC";
  font-size: 28rpx; // 14
  font-weight: 500;
  line-height: 40rpx; // 20
}

/* 问题列表：首尾各一道 1px 分隔线，行高 52（上下内边距 16） */
.guide-welcome__list {
  margin-top: 28rpx; // 14
  border-top: 1px solid #f3f3f3;
  border-bottom: 1px solid #f3f3f3;
}

.guide-welcome__row {
  padding: 32rpx 0; // 16
  border-bottom: 1px solid #f3f3f3;

  &:last-child {
    border-bottom: 0;
  }

  &:active {
    opacity: 0.6;
  }
}

.guide-welcome__question {
  display: block;
  color: #0d0d0d;
  font-family: "PingFang SC";
  font-size: 28rpx; // 14
  font-weight: 400;
  line-height: 40rpx; // 20
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

/* Share sheet */
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
