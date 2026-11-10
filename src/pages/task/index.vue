<script setup lang="ts">
import { onHide, onLoad, onShow, onUnload } from "@dcloudio/uni-app";
import { storeToRefs } from "pinia";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { AskSlotPayload, AskSlotSubmitPayload, GanttViewPayload, GuideStepItem, GuideStepPayload, GuideStepSelectEvent, GuideSuggestionPayload, Identifier } from "@/api/chat/types";
import type { ChatMessageAttachment, UiChatMessage } from "@/stores/chat-types";
import { getTodayAwakeningPrompt } from "@/api/user-role";
import arrowDownIcon from "@/assets/img/arrow-down.png";
import arrowDownDarkIcon from "@/assets/img/arrow-down-dark.png";
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
import AiVoiceQueryBar from "@/components/ai-voice-query-bar/index.vue";
import AiWelcome from "@/components/ai-welcome/index.vue";
import { AI_ASK_WELCOME_DONE_KEY } from "@/config";
import { useChatFeedback } from "@/hooks/useChatFeedback";
import { useChatSend } from "@/hooks/useChatSend";
import { useChatShare } from "@/hooks/useChatShare";
import { useChatTts } from "@/hooks/useChatTts";
import { useChatViewport } from "@/hooks/useChatViewport";
import { useComposerAttachments, type AttachmentSource } from "@/hooks/useComposerAttachments";
import { useRealtimeTts } from "@/hooks/useRealtimeTts";
import { useSafeArea } from "@/hooks/useSafeArea";
import { useVoiceQuery } from "@/hooks/useVoiceQuery";
import { useWelcomeStage, WELCOME_LISTEN_HOLD_MS } from "@/hooks/useWelcomeStage";
import { provideChatScope, useChatStore, useSessionStore, useSystemStore, useUserStore } from "@/stores";
import { probeDemoModeData } from "@/utils/demo-data-probe";
import { openGanttView } from "@/utils/gantt-navigation";
import { consumeOfflineGanttAsk, shouldUseOfflineGantt } from "@/utils/gantt-offline";
import { createLogger } from "@/utils/logger";
import { onNativeEvent } from "@/utils/platform/mpaas";
import { backFromScene } from "@/utils/scene-navigation";
import { consumePendingScheduleAsk } from "@/utils/schedule-ask";
import { consumePendingHistorySession, getSessionId, navigateToSessionScene, peekPendingHistorySession, readSessionIdFromOptions } from "@/utils/session-scene";
import { isWelcomeDone, markWelcomeDone } from "@/utils/welcome-done";

/**
 * 任务协同页（基于首页 home 的聊天 UI：Header 历史会话 + 消息列表 + 快捷入口 + 输入栏）。
 *
 * 与首页 / 听汇报的区别：
 * - 独立会话域 "task"，不与首页主会话互相污染；
 * - 复用首页 useChatSend 对话链路，发送时固定透传 inputs.scene=TEST；
 * - 每次进入起一轮干净会话（与作业指导一致），返回再进时重新开一轮；
 * - 首屏不再预拉入口卡 / 异常摘要卡，初始态只渲染 logo，等用户主动提问。
 */
defineOptions({ name: "AiTaskPage" });

const logger = createLogger("task-page");
const { t } = useI18n();

const chatScope = provideChatScope("task");
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
const sessionStore = useSessionStore();
/** 外观（设置弹层 → 深色）：与首页同一套暗色底色 + 顶部渐隐，组件靠 :dark 各自切样式 */
const systemStore = useSystemStore();
const isDark = computed(() => systemStore.isDark);
/** 一键回到底部的箭头：深色模式换 arrow-down-dark.png（浅色箭头压在暗底上看不清） */
const scrollBottomIcon = computed(() => (isDark.value ? arrowDownDarkIcon : arrowDownIcon));
const chatHeader = ref<{ reloadSessions?: () => Promise<void> } | null>(null);
/** 输入栏实例：步骤卡拍照后把附件挂进输入栏并聚焦，不再直接发送 */
const chatInputRef = ref<{
  appendAttachments?: (meta: ChatMessageAttachment[]) => void;
  focusTextInput?: () => void;
} | null>(null);
const sharePosterWrap = ref<unknown>(null);
const shareSheetBottomInset = ref("");

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
 * 欢迎态 → 对话态：与首页同一套起飞动画。
 * 进页面先是整屏「Hey,SANI」欢迎层，点语音 / 键盘后中间 logo 飞到头部灵动岛、对话页淡入。
 */
const {
  stage: pageStage,
  leaving: welcomeLeaving,
  landed: welcomeLanded,
  logoStyle: welcomeLogoStyle,
  showWelcome,
  chatEnterDelayMs,
  goToChat,
  enterChatNow,
  backToWelcome,
} = useWelcomeStage();
/** 对话页整体淡入：保留原有 chatViewportStyle，只加一个动画延迟变量 */
const chatEnterStyle = computed(() => ({
  ...chatViewportStyle.value,
  "--chat-enter-delay": `${chatEnterDelayMs.value}ms`,
}));
// 提前到 useChatSend 之前：onAiAnswerDelta 回调里要用实时 TTS 做流式听播（与作业指导页一致）。
const { onTtsClick: onHistoryTtsClick, releaseAudio: stopHistoryTts, activeMessageId: historyTtsMessageId } = useChatTts(chatScope);
const realtimeTts = useRealtimeTts(chatScope);
const { sendMessage, sendAskSlotSelection, beginAsrPlaceholder, discardAsrPlaceholder, stopGenerating, cancelActiveStream } = useChatSend(chatScope, {
  // 任务协同下发的场景标识：TASK（早期下发过 TEST，两者在历史会话里都按任务协同归类，见 utils/session-scene）
  scene: "TASK",
  // 同首页 / 作业指导：问答完成、答案文字开始渲染就自动听播（不等 workflow_finished / message_end）：
  // 第一块 answer 文字到达即开播，后续文字流式增量续播，音频按原文顺序排队播放。
  // 多步骤卡（guide-step）的回答与作业指导页同一套处理：正文不渲染也不播报（见 ai-bubble-v2 的 contentBlocks）。
  onAiAnswerDelta({ aiMsgId, delta, ended }) {
    const index = chatStore.messages.findIndex(item => item.id === aiMsgId);
    if (index < 0) return;
    const message = chatStore.messages[index];
    if ((message.blocks || []).some(block => block?.type === "guide-step")) {
      const key = String(message.messageId ?? message.id);
      if (String(realtimeTts.playingMessageKey.value ?? "") === key) realtimeTts.stop();
      return;
    }
    realtimeTts.feedAnswerDelta(message, delta, ended);
  },
  // 与首页同一套滚动：发送时只登记本轮的提问（消息列表据此加大顶部呼吸位），
  // 回答边写边贴底跟随，本轮提问顶到头部下沿就停住（见 ai-message-list 的 alignToReplyEnd）
  alignSentMessageToTop: true,
});

/** 停掉本页两套听播引擎（实时流式 + 历史整段）：换交互 / 离开页面时统一走这里。 */
function stopSceneTts() {
  realtimeTts.stop();
  stopHistoryTts();
}

/**
 * 「点击说话」语音链路（录音条 + 实时字幕）：与首页同一套实现。
 * 占位气泡走本页的 beginAsrPlaceholder，发送走 sendTaskMessage（会先续上初始化会话）。
 */
const {
  voiceQueryActive,
  voiceLevel,
  voiceSeconds,
  voiceFinishing,
  startVoiceQuery,
  stopVoiceQuery,
  cancelVoiceQuery,
  resetVoiceQuery,
} = useVoiceQuery({
  beginPlaceholder: () => {
    beginAsrPlaceholder();
    const id = chatStore.messages.find(item => item.role === "user" && item.asrPending)?.id || "";
    if (id) {
      chatStore.setPinnedToBottom(true);
      chatStore.setPinMessage(id);
      chatStore.setCapRoundAtTop(true);
      chatStore.pinMessageToTop(id);
    }
    return id;
  },
  patchPlaceholder: (id, text) => chatStore.patchMessageById(id, { content: text }),
  pinPlaceholder: id => chatStore.pinMessageToTop(id),
  discardPlaceholder: () => discardAsrPlaceholder(),
  submit: text => sendTaskMessage({ text }),
  // 开口前先掐掉正在播的回答，避免外放被麦克风收进 ASR
  onStart: () => stopSceneTts(),
});

/**
 * 页面统一发送入口：直接走真实接口（首次提问前先续上初始化那一轮的会话）。
 * 发送瞬间同步停掉旧播报，避免旧答案还念着就切到新一轮。
 */
function sendTaskMessage(payload?: Parameters<typeof sendMessage>[0]) {
  applyPendingInitSession();
  stopSceneTts();
  void sendMessage(payload);
}

// 「再次发起其他提问 / 切换会话 / 停止生成」时立刻停掉正在进行的听播（同作业指导页）：
// activeRequestSeq 在新请求开始和取消/重置时都会变化，一个 watcher 兜底覆盖全部入口。
watch(() => chatStore.activeRequestSeq, () => {
  stopSceneTts();
});

/**
 * 初始化那一轮在服务端建的会话 id：先暂存，等用户真正提问时再写回 store 续上。
 * （新建对话改走工作流后不再产生初始化会话，这里只是保留兼容逻辑，恒为 null。）
 */
const pendingInitSessionId = ref<Identifier | null>(null);
/**
 * 消息列表的 key：只在真正切会话（打开历史 / 新对话）时递增。
 * 初始化拉卡片、首轮建立会话都不再重建列表，页面不会闪一下或像跳了一页。
 */
const chatListKey = ref(0);

/** 初次真正提问前把初始化会话续上，避免多出一个空会话 */
function applyPendingInitSession() {
  if (!pendingInitSessionId.value) return;
  if (!chatStore.aiSessionId) chatStore.aiSessionId = pendingInitSessionId.value;
  pendingInitSessionId.value = null;
}

/**
 * 甘特图（横屏调度视图）右下角输入条发来的问题：回到本页后取出来，直接发在作业协同会话里（发完即清）。
 * 两条返回路径（navigateBack / 关掉场景窗口）都会走 onShow，所以在这里消费；
 * 先按需切会话再发，避免问题落到别的会话。
 */
async function startPendingScheduleAsk() {
  // 站内甘特把问题写在本地存储；离线包跨容器只能走 demo 数据桥，两边都取一次
  const offlineAsk = shouldUseOfflineGantt() ? await consumeOfflineGanttAsk() : "";
  const text = consumePendingScheduleAsk() || offlineAsk;
  if (text) {
    sendTaskMessage({ text });
    return;
  }
  // 没有待发问题就什么都不用做：新版首屏不再预拉入口卡 / 异常摘要卡，
  // 初始态只渲染 logo 等用户主动提问，这里没有需要补刷的数据。
  // （这里原先会「重拉入口卡」，但 loadInitialCards / welcomeCardKind / initialCardsRequestedAt
  //   在改版时已经删掉了，只留下这行引用，onShow 一进就抛 ReferenceError。）
}

/**
 * 甘特（站内页 / 安卓离线包容器）关闭后，宿主 webview 不一定会走 onShow
 * （独立 H5 容器与宿主是两套界面栈），因此在原生 resume / 页面重新可见时补一次：
 * 只消费待发问题，没有就什么都不做，不像 startPendingScheduleAsk 那样顺带刷新入口卡。
 *
 * 两条来源都要取：站内甘特写本地存储，安卓 openH5Container 的离线包走 demo 数据桥。
 */
async function flushOfflineGanttAsk() {
  const localAsk = consumePendingScheduleAsk();
  const offlineAsk = shouldUseOfflineGantt() ? await consumeOfflineGanttAsk() : "";
  const text = localAsk || offlineAsk;
  if (text) sendTaskMessage({ text });
}

const stopNativeResume = onNativeEvent("resume", () => {
  void flushOfflineGanttAsk();
});

/**
 * 安卓 WebView 里 openH5Container 关闭后，宿主页面既不必然走 onShow、也不一定收到原生 resume，
 * 「页面重新可见」是唯一稳定的信号：用它补一次消费。
 * 只取离线包回传的问题（取完即清 + 内部互斥），重复触发无副作用。
 */
function handleHostVisible() {
  if (typeof document === "undefined" || document.visibilityState !== "visible") return;
  void flushOfflineGanttAsk();
}
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
  // 追问卡（单选点即作答 / 多选确认提交）弹出时同样让出卡片高度
  if (askSlotDrawerVisible.value && askSlotDrawerHeight.value > 0) {
    return `${askSlotDrawerHeight.value}px`;
  }
  // 导航、输入栏都是 fixed，列表要用 padding 把最后一条抬到它们上方
  if (showQuickPrompts.value) return `calc(${composerBottomInset.value} + 72rpx)`;
  return composerBottomInset.value;
});
const navOffsetStyle = computed(() => ({ bottom: composerDockOffset.value }));
/** 指导步骤卡片（COMPONENT scene=guide / type=step）：随回答自动弹起，选完即回发下一轮 */
const guideStepPayload = ref<GuideStepPayload | null>(null);
const guideStepSheetVisible = ref(false);
/** 步骤卡片实时高度（px）：卡片展开时把列表底部 padding 顶起来，最后一条回答不会被盖住 */
const guideStepSheetHeight = ref(0);
/**
 * 当前要显示的那张核对卡属于哪一步（步骤 id）：多步骤卡每轮各带一张，
 * 按 id 定位到最新一轮，避免新一轮的卡被算到第一张卡的位置上。
 */
const guideStepCardStepId = ref("");
/**
 * 多步骤卡改为气泡内联展示（标题 + 进度 + 步骤标题 + 讲解 + 确认问题 + A/B/C 选项），
 * 不再弹底部白板。需要回退到白板时把这里改成 false。
 */
const INLINE_STEP_CARD = true;
/** 核对卡要顶到对话区顶部还缺的底部间距（px，由消息列表量出来） */
const guideStepCardSpace = ref(0);

/**
 * 把当前显示的那张核对卡（对话区的 .chat-box__card）顶到对话区最上方。
 * 步骤卡出现、翻页、卡片高度变化后都用它：卡片顶在上方才整张可见。
 */
function focusGuideStepCardAtTop() {
  const stepId = String(guideStepCardStepId.value || "").trim();
  if (stepId) chatStore.focusStepBlock(stepId);
}

/**
 * 追问卡片（COMPONENT scene=task / type=ask，与 scene=ask / type=slot 同一套数据）：
 * 单选点一下就作答；多选 / 一屏多题才出底部「确认提交」，把所选拼成答案发出去。
 * 队列按 slot_name 去重：同一题重复下发时以后来的为准。
 */
const askSlotQueue = ref<AskSlotPayload[]>([]);
const askSlotDrawerVisible = ref(false);
/** 追问卡实时高度（px）：卡片弹出时给消息列表加底部间距，最后一条内容不会被盖住 */
const askSlotDrawerHeight = ref(0);

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
  // 追问卡作答也是用户真正提问：先续上初始化那一轮的会话
  applyPendingInitSession();
  sendAskSlotSelection(payload);
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

/**
 * 自动弹层：生成中先挂起，等 loading 变 false 后再计时 5s。
 *
 * 排期时记下当前请求序号：这一轮被「停止生成 / 重新发送 / 切会话」作废后
 * （activeRequestSeq 会变，见 stores/modules/chat 的 nextRequestSeq / invalidateActiveRequest），
 * 到点也不再弹 —— 否则旧卡片会在新一轮对话上盖出来。只丢弃这一张卡片，不影响请求本身。
 */
function scheduleAutoOpen(open: () => void) {
  const requestSeq = chatStore.activeRequestSeq;
  pendingAutoOpen = () => {
    if (chatStore.activeRequestSeq !== requestSeq) return;
    open();
  };
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

/**
 * 用户中断 / 重新发送 / 切换会话时立刻作废待弹的选项卡片：
 * activeRequestSeq 在新请求开始、取消（停止生成）、重置会话时都会变，
 * 一个 watcher 覆盖全部入口；只清「延时弹卡」的定时器，不碰在途请求。
 */
watch(() => chatStore.activeRequestSeq, () => {
  clearAutoOpenTimer();
});

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
  // 内联卡片模式：卡片就在对话里，只定位到第一步，不弹白板
  if (!INLINE_STEP_CARD) guideStepSheetVisible.value = true;
  // 这一轮的核对卡：按本轮第一步定位（每轮回答各带一张自己的卡）
  guideStepCardStepId.value = String(payload?.steps?.[0]?.id || "");
  // 步骤卡弹出：把这一步的核对卡滚到对话区顶部
  nextTick(() => focusGuideStepCardAtTop());
}

/**
 * 多步骤卡的回答不渲染气泡（见 ai-bubble-v2 的 hideBody），卡片组件因此不会挂载，
 * 自动弹起改在这里盯最后一条 AI 消息的 guide-step 块：出现即排期（生成结束后再等 5s），
 * 同一张卡只弹一次；历史消息的块不带 auto_open，不会触发。
 *
 * 去重键必须是「消息 + 块」：块 id 按内容生成（guide-step-<标题>），
 * 同一个问题问两次块 id 完全相同，只用块 id 会把第二次的卡误判成「弹过了」，
 * 白板就仍停在上一次那张卡翻到的步骤上（下标、语音、滚动全错位）。
 */
const autoOpenedStepCardIds = new Set<string>();
watch(
  () => {
    const list = chatStore.messages;
    const last = list[list.length - 1];
    if (!last || last.role !== "ai") return null;
    const block = (last.blocks || []).find(item => item?.type === "guide-step" && item.payload?.auto_open === true);
    if (!block) return null;
    // 优先本地 id（消息一创建就有、不会中途变），服务端 messageId 兜底
    const messageKey = String(last.id || last.messageId || "");
    const blockKey = String(block.id || "");
    return { key: `${messageKey}::${blockKey}`, payload: block.payload as GuideStepPayload };
  },
  (current) => {
    if (!current || !current.key) return;
    if (autoOpenedStepCardIds.has(current.key)) return;
    autoOpenedStepCardIds.add(current.key);
    // 白板还开着：新卡一出现就立刻切到它（换内容 + 归零下标 + 滚动），
    // 别干等 5 秒还停在上一张卡的步骤上。
    if (guideStepSheetVisible.value) {
      openGuideStepSheet(current.payload);
      return;
    }
    scheduleAutoOpen(() => openGuideStepSheet(current.payload));
  },
);

function onGuideStepSubmit(query: string) {
  guideStepSheetVisible.value = false;
  sendTaskMessage({ text: query });
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

/** 步骤卡片展开 / 翻页时，只显示这一步对应的核对卡，并把它顶到对话区顶部 */
function onGuideStepChange(step: GuideStepItem | null) {
  const stepId = String(step?.id || "").trim();
  if (!stepId) return;
  const steps = guideStepPayload.value?.steps || [];
  const index = steps.findIndex(item => String(item?.id || "") === stepId);
  if (index >= 0) guideStepCardStepId.value = stepId;
  nextTick(() => focusGuideStepCardAtTop());
}

/** 按 step_id 取这一轮的步骤：先看本页缓存的卡，取不到再从消息里的 guide-step 块反查 */
function resolveGuideSteps(stepId: string): GuideStepItem[] {
  const id = String(stepId || "").trim();
  const local = (guideStepPayload.value?.steps || []) as GuideStepItem[];
  if (local.some(step => String(step?.id || "") === id)) return local;
  for (let index = chatStore.messages.length - 1; index >= 0; index -= 1) {
    const blocks = chatStore.messages[index]?.blocks || [];
    for (const block of blocks) {
      if (block?.type !== "guide-step") continue;
      const steps = Array.isArray(block.payload?.steps) ? block.payload.steps as GuideStepItem[] : [];
      if (!id || steps.some(step => String(step?.id || "") === id)) return steps;
    }
  }
  return [];
}

/**
 * 点卡片里的 A（确认学会，下一步）：只把对话里这张卡切到下一步，不发对话。
 * 卡片是气泡内联的（不再弹白板），所以这里只更新「当前展示哪一步」。
 */
function onGuideCheckStepSelect(event: GuideStepSelectEvent) {
  const target = Math.max(1, Math.round(Number(event?.index) || 1));
  const steps = resolveGuideSteps(event?.stepId || "");
  if (!steps.length) return;
  const index = Math.min(target, steps.length) - 1;
  const nextStepId = String(steps[index]?.id || event?.stepId || "");
  // 真换了步骤才停旧语音：新一步的卡挂载后会按翻页标记接着播（见 GuideCheckBlock 的 onMounted）；
  // 目标步和当前步是同一个时卡不会重挂载，停了就再也起不来，所以这里保持原语音
  if (nextStepId && nextStepId !== String(guideStepCardStepId.value || "")) realtimeTts.stop();
  guideStepCardStepId.value = nextStepId;
  nextTick(() => focusGuideStepCardAtTop());
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
  sendTaskMessage({ text: query });
}

function onGuideSuggestionHeightChange(height: number) {
  guideSuggestionSheetHeight.value = height;
}

/** 点击追问后先移除它所属回答的追问列表，再按普通问题走完整发送链路。 */
function onTaskSuggestionTap(suggestion: string, messageIndex: number) {
  const message = chatStore.messages[messageIndex];
  if (message?.role === "ai" && Array.isArray(message.blocks)) {
    const blockIndex = message.blocks.findIndex(block => block.type === "suggestion");
    if (blockIndex >= 0) message.blocks.splice(blockIndex, 1);
  }
  sendTaskMessage({ text: suggestion });
}

/** 欢迎页/快捷问题列表点进来的问题：与输入框发送走同一个入口 */
function onTaskQuickPrompt(text: string) {
  sendTaskMessage({ text });
}

/** 甘特图入口卡开关：暂时屏蔽（schedule-gantt 页代码保留不动），改回 true 即恢复 */
const SHOW_GANTT_ENTRY_CARD = false;

/** 甘特图入口卡：进入当天任务甘特图（横屏页，只渲染 AI 下发的 rows，没有数据即空视图） */
function onGanttEntryTap() {
  uni.navigateTo({ url: "/pages/schedule-gantt/index" });
}

/**
 * 点甘特入口卡（AI 下发的 gantt 积木）：按 viewType 分流（见 utils/gantt-navigation）。
 * - personal → 竖屏个人任务详情页（pages/task-detail），明细挂在整包的 payload 字段里；
 * - schedule / pre / replan → 各自横屏视图（方向由宿主容器给，前端不再申请转屏）；
 * 数据一律先落本地存储、再由目标页 onLoad 取走（目标页可能是独立场景窗口）。
 */
function onGanttOpen(payload: GanttViewPayload) {
  // openGanttView 现在会先等 bridge（最多 BRIDGE_WAIT_MS）再分流，异步结果自行兜底，这里不等
  void openGanttView(payload);
}
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

/**
 * 播报入口：新生成消息走实时 TTS，历史消息播已合成的整段语音。
 * `textOverride` 是「要念的文本不在消息正文里」时的覆盖文案（步骤小结 step_summary）。
 */
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
  if (historyTtsMessageId.value === messageId && !stepId) {
    stopHistoryTts();
    return;
  }

  realtimeTts.stop();
  stopHistoryTts();
  if (msg.ttsPlaybackMode === "realtime") {
    void realtimeTts.togglePlay(msg, stepId, textOverride);
    return;
  }
  void onHistoryTtsClick(index);
}

const localizedQuickPrompts = computed(() => chatStore.quickPrompts.map(item => t(item)));
/** 初始态：没有任何消息且不在切会话。此时页面只渲染 logo，等第一条语音/文字进来自然让位 */
watch(() => chatStore.messages.length, (length) => {
  // 会话里已经有内容（历史会话 / 甘特图带回来的提问 / 语音占位气泡）：不再停在欢迎层
  if (length) enterChatNow();
  void nextTick(() => chatStore.scrollToBottom());
});

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

/**
 * 欢迎层「点击说话」：起飞的同时把语音会话跑起来，
 * 用户在飞行动画里开口也不会丢（ready 前的音频由会话自己缓存）。
 */
function onWelcomeStart() {
  markWelcomeDone();
  void startVoiceQuery();
  void goToChat({ holdMs: WELCOME_LISTEN_HOLD_MS });
}

/** 欢迎层「键盘」：同一套抛物线把 logo 送上去，落位后再聚焦输入框（键盘由此弹出） */
async function onWelcomeText() {
  markWelcomeDone();
  await goToChat();
  chatInputRef.value?.focusTextInput?.();
}

function startNewConversation() {
  // 已经是一轮空白会话就别再重置了，重复点击给个明确反馈
  if (!chatStore.messages.length && !chatStore.aiSessionId && !pendingInitSessionId.value) {
    uni.showToast({ title: t("already-new-conversation"), icon: "none" });
    return;
  }
  // 正在生成时切走：先掐掉在途请求，否则回包会继续往新会话里写
  cancelActiveStream();
  pendingInitSessionId.value = null;
  chatStore.resetConversation();
  chatListKey.value += 1;
  nextTick(() => chatStore.scrollToBottom(true));
  // 新对话重新回到整屏欢迎层（与刚进页面一致）
  backToWelcome();
}

function onBack() {
  backFromScene();
}

/**
 * 长按顶部三角图标 5 秒：回到首页初始「你好三一」页。
 * 首页本身是「初始页 / 对话页」两个态（pageStage）：清掉「欢迎页已完成」标记后重载首页，
 * 首页 onLoad 的 syncPageStage 才会落到 welcome 态（否则会因标记残留 / 旧实例仍停在对话态）。
 */
function onRestartToStart() {
  try {
    uni.removeStorageSync(AI_ASK_WELCOME_DONE_KEY);
  } catch (error) {
    logger.warn("failed to clear welcome flag", error);
  }
  uni.redirectTo({ url: "/pages/index/index" });
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
  // 打开历史会话是「直接进对话」，不播欢迎层的起飞动画
  enterChatNow();
  // 切到历史会话：初始化那轮暂存的会话不再续用
  pendingInitSessionId.value = null;
  chatListKey.value += 1;
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
  if (navigateToSessionScene(session, "TASK")) return;
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

/**
 * 一键回到底部（与首页一致）：没贴底时出现，回到底部（含发送后强制贴底）自动消失。
 * 分享选择态、贴底卡片（步骤卡 / 建议卡 / 追问卡）展开时不显示，避免和这些浮层抢位置。
 */
const showScrollToBottom = computed(
  () =>
    !shareSheetVisible.value
    && !guideStepSheetVisible.value
    && !guideSuggestionSheetVisible.value
    && !askSlotDrawerVisible.value
    && !pinnedToBottom.value
    && (messages.value?.length || 0) > 0,
);

function onScrollToBottomTap() {
  // 落点是「真末尾」（含最后一条消息的操作栏 / 参考来源），不能用 scrollToBottom：
  // 本页开着 stopAtReplyEnd，那条落点会把尾部操作栏留在输入栏下面，看起来没到底
  chatStore.jumpToBottom();
}

/**
 * 消息列表上报贴底状态，不能直接绑 setPinnedToBottom：
 * 用户自己滑回底部时要把本轮的「提问封顶」一起撤掉，
 * 否则下一帧内容长高，对齐又会把视图拽回提问那边（表现为「滑到底又弹回去」）。
 */
function onPinnedChange(pinned: boolean) {
  chatStore.setPinnedToBottom(pinned);
  // 封顶模式下「滚到底」就是回到本轮提问的落点，撤封顶会把视图再拽回顶部（见首页同函数）
  if (pinned && chatStore.capRoundAtTop) return;
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
  // 临时自检（排查 saveDemoModeData 异常用）：写一段几百字符的 JSON 再读回比对，
  // 日志前缀 [demo-probe]；排查完把 utils/demo-data-probe 的开关关掉并删除这两行
  void probeDemoModeData("task-onload");
  syncWindowHeight();
  const sessionId = readSessionIdFromOptions(options) || peekPendingHistorySession("TASK");
  if (sessionId) {
    void openLocalHistory(consumePendingHistorySession("TASK") || sessionId, true);
    return;
  }
  // 进入即起一轮干净会话（返回首页再进会重新开一轮）；发送场景由 useChatSend 固定为 TEST。
  chatStore.resetConversation();
  chatStore.showQuickPrompts = false;
  chatStore.showQuickList = false;
  // 已完成过 SANI 唤醒（首页对话态 / 本页欢迎层起飞都会置位）→ 直达对话态，
  // 不再铺整屏欢迎层：老用户从首页快捷入口切过来体验更顺。
  // 注：不判断 isVisitor —— App 启动即 setVisitor(true)（游客恒定态），加它会导致永远跳过不了。
  if (isWelcomeDone()) enterChatNow();
});

onMounted(() => {
  syncWindowHeight();
  loadAwakeningPrompt();
  // 安卓离线包（openH5Container）关容器回来时靠它消费待发问题
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", handleHostVisible);
});

onShow(() => {
  // 注：横屏调度视图的方向由宿主容器自己管（openH5Container 打开就是全屏横屏），
  // 回到本页不再需要复原方向，所以这里没有 landscapeFullscreen(false) 的兜底。
  syncWindowHeight();
  const sessionId = consumePendingHistorySession("TASK");
  // 有心跳转的会话就先切过去，再补发甘特图里问的问题，避免问错会话
  if (sessionId) {
    void openLocalHistory(sessionId, true).then(startPendingScheduleAsk);
    return;
  }
  // 从调度视图等页面回到本页：补发甘特图里问的问题
  startPendingScheduleAsk();
});

onHide(() => {
  stopSceneTts();
  clearAutoOpenTimer();
  // 页面被盖住时正在录音：直接断流，别让麦克风在后台继续采
  resetVoiceQuery();
});

onUnload(() => {
  cancelActiveStream();
  stopSceneTts();
  clearAutoOpenTimer();
  stopNativeResume();
  if (typeof document !== "undefined") document.removeEventListener("visibilitychange", handleHostVisible);
});
</script>

<template>
  <view class="ai-page" :class="{ 'ai-page--dark': isDark }" :style="safeAreaStyle">
    <!-- 欢迎层：与首页初始页同款（Hey,SANI + logo + 点击说话 / 键盘）；
         起飞动画期间继续挂载，logo 滑到顶部灵动岛再收起 -->
    <AiWelcome
      v-if="showWelcome"
      :leaving="welcomeLeaving"
      :landed="welcomeLanded"
      :logo-style="welcomeLogoStyle"
      :dark="isDark"
      @start-chat="onWelcomeStart"
      @start-text="onWelcomeText"
    />
    <!-- 对话页：与欢迎层同时存在，整体淡入 -->
    <view
      v-if="pageStage === 'chat'"
      class="ai-page__chat ai-page__chat--enter"
      :style="chatEnterStyle"
    >
      <view class="ai-chat-glow ai-chat-glow--blue" />
      <view class="ai-chat-glow ai-chat-glow--red" />
      <!-- 设备线稿背景图：跟着用户选的机型走（履带吊 / 混凝土泵车） -->
      <AiChatBackdrop class="ai-page__backdrop" />
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
        :voice-listening="voiceQueryActive"
        restartable
        @back="onBack"
        @restart="onRestartToStart"
        @new-conversation="startNewConversation"
        @session-click="onSessionClick"
        @session-delete="onSessionDelete"
        @session-delete-batch="onSessionDeleteBatch"
        @session-rename="onSessionRename"
        @share-select-all="onShareSelectAll"
      />
      <AiMessageList
        :key="chatListKey"
        top-inset="var(--chat-top-inset, 300rpx)"
        :dark="isDark"
        :messages="messages"
        :quick-prompts="localizedQuickPrompts"
        :show-quick-prompts="showQuickPrompts"
        :show-business-overview="false"
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
        :compact-guide-card="true"
        @card-space-change="onGuideStepCardSpaceChange"
        @content-grow="chatStore.scrollToBottom()"
        :awakening="userStore.awakeningPrompt"
        :awakening-loading="awakeningLoading"
        :pinned-to-bottom="pinnedToBottom"
        :realtime-tts-message-key="realtimeTts.playingMessageKey.value"
        :realtime-tts-playing="realtimeTts.playing.value"
        @quick-prompt="onTaskQuickPrompt"
        @suggestion-tap="onTaskSuggestionTap"
        @guide-step-open="onGuideStepOpen"
        @guide-check-step-select="onGuideCheckStepSelect"
        @step-card-ready="focusGuideStepCardAtTop"
        @guide-suggestion-open="onGuideSuggestionOpen"
        @ask-slot-open="onAskSlotOpen"
        @ask-slot-submit="onAskSlotSubmit"
        @gantt-open="onGanttOpen"
        @tts-click="onTtsClick"
        @tts-stop="stopSceneTts"
        @feedback-change="onFeedbackChange"
        @share-click="onShareClick"
        @copy-click="onCopyMessage"
        @select-toggle="onShareSelectToggle"
        @scroll-top="onScrollTop"
        @pinned-change="onPinnedChange"
      />
      <!-- 一键回到底部（与首页一致）：离底时出现，贴底自动隐藏；
           垂直位置 = 输入栏高（含键盘抬起）+ 24rpx 间隙；水平居中，只放 arrow-down.png -->
      <view
        v-if="showScrollToBottom"
        class="chat-scroll-bottom"
        :style="{ bottom: `calc(${composerBottomInset} + 24rpx)` }"
        @tap="onScrollToBottomTap"
      >
        <image
          class="chat-scroll-bottom__chevron"
          :src="scrollBottomIcon"
          mode="aspectFit"
        />
      </view>
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
        v-else-if="!voiceQueryActive"
        ref="chatInputRef"
        v-model="inputText"
        :dark="isDark"
        :is-loading="isLoading"
        :keyboard-height="keyboardHeight"
        :voice-keyboard-height="voiceKeyboardHeight"
        bottom-gradient
        :compact-voice-listening="true"
        :tap-to-talk="true"
        @send="sendTaskMessage"
        @stop="stopGenerating"
        @voice-start="stopSceneTts"
        @voice-restart="stopSceneTts"
        @recognize-begin="beginAsrPlaceholder"
        @recognize-fail="discardAsrPlaceholder"
        @toggle-quick-list="toggleQuickList"
        @input-focus="setTextInputFocused(true)"
        @input-blur="setTextInputFocused(false)"
        @voice-input-focus="setVoiceInputFocused(true)"
        @voice-input-blur="setVoiceInputFocused(false)"
        @voice-query-start="startVoiceQuery"
        @dock-height-change="setInputDockHeight"
      />

      <!-- 点击说话录音中：输入栏换成「取消 / 声纹 / 计时 + 发送」这一条（与首页同稿） -->
      <AiVoiceQueryBar
        v-else
        :level="voiceLevel"
        :seconds="voiceSeconds"
        :busy="voiceFinishing"
        :dark="isDark"
        @cancel="cancelVoiceQuery"
        @submit="stopVoiceQuery"
      />

      <!-- 追问卡片（作业协同 type=ask / ai问问 type=slot）：单选点即作答，多选选完确认提交；
           作业协同不提供「其他输入」入口，只允许在选项里作答 -->
      <AiSlotDrawer
        :slots="askSlotQueue"
        scene="task"
        :dark="isDark"
        :visible="askSlotDrawerVisible"
        @close="closeAskSlotDrawer"
        @submit="onAskSlotSubmit"
        @height-change="onAskSlotDrawerHeightChange"
      />
      <AiGuideStepSheet
        v-model:visible="guideStepSheetVisible"
        :payload="guideStepPayload"
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
  /* 形成层叠上下文：机型背景图（AiChatBackdrop）是 z-index: -1，
     不隔离时负层会被本元素的 #fafafa 底色盖住，选了机型也看不到图 */
  isolation: isolate;
  // 顶部毛玻璃层的高度 = 悬浮头部在内容里的占位（与首页对话页同一个值）
  --chat-top-inset: calc(constant(safe-area-inset-top) + 300rpx);
  --chat-top-inset: calc(env(safe-area-inset-top) + 300rpx);
  // 悬浮头部不占布局，需要给「欢迎区」补回来的实际头部高度：状态栏占位 + 栏高 50px
  --chat-header-height: calc(max(var(--safe-top-px, 0px), env(safe-area-inset-top)) + 100rpx);
}

/* 欢迎层 → 对话页：整页淡入。
   延迟由 --chat-enter-delay 控制（语音起飞会等 listen.gif 扩散），
   让淡入跟起飞同时开始，不会出现「logo 还挂在中间、对话页已经铺满」的割裂感 */
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

// 头部悬浮（与首页对话页一致）：不占布局高度，消息可以滚到它下面，透过 .ai-page__top-fade 的毛玻璃淡出；
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
  height: 200rpx;
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

// 一键回到底部（与首页同一套）：只剩 arrow-down.png 图本身（白底圆钮 / 阴影 / 描边全部去掉），水平居中。
// bottom 由行内样式给：composerBottomInset（输入栏高 + 键盘抬起）+ 24rpx 间隙
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

/* Share sheet */
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

/* ===== 深色主题（与首页问答态同一口径）=====
   只替换底色与材质，间距 / 圆角 / 字号两稿一致：
   - 页面底 #1A1A1A（对应浅色 #FAFAFA）
   - 顶部渐隐换成深色页面底
   - 角落光晕与设备线稿在深色稿里是关掉的 */
.ai-page--dark {
  background: #1a1a1a;

  .ai-page__chat {
    background: #1a1a1a;
  }

  .ai-page__top-fade {
    background: linear-gradient(
      180deg,
      rgba(26, 26, 26, 0.34) 0%,
      rgba(26, 26, 26, 0.18) 48%,
      rgba(26, 26, 26, 0) 100%
    );
  }

  .ai-chat-glow {
    display: none;
  }

  /* 边缘流光在深色下同样保留：色值、厚度、流动都与浅色一致 */

  .ai-page__backdrop {
    display: none;
  }
}
</style>
