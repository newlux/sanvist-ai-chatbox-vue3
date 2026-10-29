<script setup lang="ts">
import { onHide, onLoad, onShow, onUnload } from "@dcloudio/uni-app";
import { storeToRefs } from "pinia";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { AskSlotPayload, AskSlotSubmitPayload, GanttViewPayload, GuideStepItem, GuideStepPayload, GuideSuggestionPayload, Identifier } from "@/api/chat/types";
import type { ChatMessageAttachment } from "@/stores/chat-types";
import type { AiBlock } from "@/utils/ai-stream";
import { runBlockingWorkflow } from "@/api/chat";
import { getTodayAwakeningPrompt } from "@/api/user-role";
import AiBadFeedbackSheet from "@/components/ai-bad-feedback-sheet/index.vue";
import GanttBlock from "@/components/ai-bubble-v2/blocks/GanttBlock.vue";
import AiChatBackdrop from "@/components/ai-chat-backdrop/index.vue";
import AiChatHeader from "@/components/ai-chat-header/index.vue";
import AiChatInput from "@/components/ai-chat-input/index.vue";
import AiChatNav from "@/components/ai-chat-nav/index.vue";
import AiGanttEntryCard from "@/components/ai-gantt-entry-card/index.vue";
import AiGuideStepSheet from "@/components/ai-guide-step-sheet/index.vue";
import AiGuideSuggestionSheet from "@/components/ai-guide-suggestion-sheet/index.vue";
import AiMessageList from "@/components/ai-message-list/index.vue";
import AiSlotDrawer from "@/components/ai-slot-drawer/index.vue";
import ShareConversationPoster from "@/components/ai-share-poster/index.vue";
import AiTaskExceptionCard from "@/components/ai-task-exception-card/index.vue";
import { AI_ASK_WELCOME_DONE_KEY } from "@/config";
import { pickTaskWelcomeQuestions, TASK_WELCOME_COPY } from "@/config/task-welcome";
import { useChatFeedback } from "@/hooks/useChatFeedback";
import { useChatSend } from "@/hooks/useChatSend";
import { useChatShare } from "@/hooks/useChatShare";
import { useChatTts } from "@/hooks/useChatTts";
import { useChatViewport } from "@/hooks/useChatViewport";
import { useComposerAttachments, type AttachmentSource } from "@/hooks/useComposerAttachments";
import { useRealtimeTts } from "@/hooks/useRealtimeTts";
import { useSafeArea } from "@/hooks/useSafeArea";
import { provideChatScope, useChatStore, useSessionStore, useUserStore } from "@/stores";
import { hasGanttCard } from "@/utils/gantt-card";
import { openGanttView } from "@/utils/gantt-navigation";
import { isWebEnvironment } from "@/utils/landscape-device";
import { createLogger } from "@/utils/logger";
import { setLandscapeFullscreen } from "@/utils/platform/mpaas";
import { backFromScene } from "@/utils/scene-navigation";
import { consumePendingScheduleAsk } from "@/utils/schedule-ask";
import { consumePendingHistorySession, getSessionId, navigateToSessionScene, peekPendingHistorySession, readSessionIdFromOptions } from "@/utils/session-scene";
import { resolveExceptionSummary, type TaskExceptionCard } from "@/utils/task-exception";
import { getTaskIdentity, type TaskIdentity } from "@/utils/task-identity";

/**
 * 任务协同页（基于首页 home 的聊天 UI：Header 历史会话 + 消息列表 + 快捷入口 + 输入栏）。
 *
 * 与首页 / 听汇报的区别：
 * - 独立会话域 "task"，不与首页主会话互相污染；
 * - 复用首页 useChatSend 对话链路，发送时固定透传 inputs.scene=TEST；
 * - 每次进入起一轮干净会话（与作业指导一致），返回再进时重新开一轮；
 * - 初始化静默问一句「今天任务有哪些」，只把回复里的卡片铺进对话区（问题与回复文本都不展示）；
 * - 例外：在「任务协同初始化页」选过 step 接口下发的身份（如 DISPATCH-02）时，首屏改为调用
 *   POST /proxy/v1/workflows/run 工作流查异常（inputs.query_type=查异常 / user_id=所选身份 /
 *   role_id=OWNER），把返回的异常信息渲染成「异常情况摘要」卡（Ardot 350:2199，替代任务入口卡）；
 *   接口结构目前不稳定，解析不出时用 utils/task-exception 里的 mock 兜底。
 */
defineOptions({ name: "AiTaskPage" });

const logger = createLogger("task-page");
const { t, locale } = useI18n();

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
// 提前到 useChatSend 之前：onAiAnswerDelta 回调里要用实时 TTS 做流式听播（与作业指导页一致）。
const { onTtsClick: onHistoryTtsClick, releaseAudio: stopHistoryTts, activeMessageId: historyTtsMessageId } = useChatTts(chatScope);
const realtimeTts = useRealtimeTts(chatScope);
const { sendMessage, sendSilentMessage, sendAskSlotSelection, beginAsrPlaceholder, discardAsrPlaceholder, stopGenerating, cancelActiveStream } = useChatSend(chatScope, {
  // 任务协同下发的场景标识：TASK（早期下发过 TEST，两者在历史会话里都按任务协同归类，见 utils/session-scene）
  scene: "TASK",
  // 同首页 / 作业指导：问答完成、答案文字开始渲染就自动听播（不等 workflow_finished / message_end）：
  // 第一块 answer 文字到达即开播，后续文字流式增量续播，音频按原文顺序排队播放。
  onAiAnswerDelta({ aiMsgId, delta, ended }) {
    const index = chatStore.messages.findIndex(item => item.id === aiMsgId);
    if (index < 0) return;
    realtimeTts.feedAnswerDelta(chatStore.messages[index], delta, ended);
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

/** 进入页面自动问的初始化问题（跟随当前语言） */
const initialCardQuery = computed(() => t("task-initial-query"));
/**
 * 初始化那一轮在服务端建的会话 id：先暂存，等用户真正提问时再写回 store 续上。
 * 初始化请求本身不改会话态（不写 aiSessionId、不刷新会话列表、不重建消息列表），
 * 页面就停在原地等卡片，不会像发了一轮对话那样跳走。
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

/** 初始化下发的 gantt 入口卡（只留 card 数据，页面按欢迎态自己渲染，不进消息列表） */
const initialGanttPayload = ref<GanttViewPayload | null>(null);
/** 上次初始化请求的时间：onShow 与 onLoad 挨着触发，用它隔开，避免首次进入重复请求 */
let initialCardsRequestedAt = 0;

/**
 * 初始化卡片：静默调一次对话接口，只取回复里的 gantt 入口卡（card 数据）。
 *
 * 其它数据（回答正文 / 思考过程 / 表格 / 追问 / 建议等）一律丢弃：
 * 不写 messages、不碰 showQuickPrompts、不触发滚动，页面结构与 showSceneWelcome 都不变，
 * 卡片只是欢迎态里多铺一张入口卡。
 *
 * 只认卡片数据：整包里没有可展示的 card（或 card.visible === false）就置空，欢迎态整卡不渲染。
 */
function applyInitialCards(blocks: AiBlock[] = []) {
  // 取最后一个 gantt 块：快照按流式逐步补齐，越靠后越完整
  const ganttList = (blocks || []).filter(block => block?.type === "gantt");
  const payload = ganttList[ganttList.length - 1]?.payload as GanttViewPayload | undefined;
  initialGanttPayload.value = hasGanttCard(payload) ? (payload as GanttViewPayload) : null;
}

async function loadInitialCards() {
  initialCardsRequestedAt = Date.now();
  await sendSilentMessage({
    text: initialCardQuery.value,
    // 后台拉卡片：不改会话态，页面停在原处等数据
    keepSession: true,
    onSessionId: (conversationId) => {
      pendingInitSessionId.value = conversationId;
    },
    onBlocks: blocks => applyInitialCards(blocks),
  });
}

/** 「查异常」的 inputs.query_type 固定值 */
const EXCEPTION_QUERY = "查异常";
/** 「查异常」固定按 OWNER 取数（与网关 guest-role 头一致） */
const EXCEPTION_ROLE_ID = "OWNER";
/**
 * 待机态铺哪一套欢迎内容（卡片 + 建议问题），全页只认这一个状态：
 *
 * - `exception`：由「任务协同初始化页（pages/task-init）」的引导流程进来（入口 URL 带 from=init）
 *   且那次选过身份 —— 首屏问「查异常」，铺异常摘要卡，建议问题用接口随包下发的 suggestions；
 * - `gantt`：新建页面 / 宿主独立窗口 / 听播异常条目直接进，以及点「新对话」——
 *   不问异常，静默问「今天任务有哪些」，铺甘特图入口卡，建议问题用本地按身份取的兜底文案。
 *
 * 不能凭「有没有身份」判断入口：身份是落本地存储的，选过一次之后就一直在，
 * 直接进本页也会被误判成引导流程。
 */
const welcomeCardKind = ref<"exception" | "gantt">("gantt");

/**
 * 异常情况摘要卡片（Ardot 350:2151 / 节点 350:2199）：
 * 只在 run 接口真的返回可解析的数据后才铺（替代甘特图入口卡）。
 * 进页面时是 null —— 请求中 / 接口失败都不渲染，不再用设计稿样张顶替。
 */
const exceptionCard = ref<TaskExceptionCard | null>(null);
/**
 * 异常卡片随卡片一起下发的建议问题（outputs 里的 data.suggestions）：
 * 铺在「你还可以这么问」里，替代本地按身份取的兜底问题。
 * 没下发（接口挂了 / 老结构）时保持空数组，页面自动回落兜底文案。
 */
const exceptionSuggestions = ref<string[]>([]);

/**
 * run 接口的 language：跟随当前界面语言（历史抽屉里的「中 / EN」切的就是同一个 i18n locale），
 * 中文传 zh-CN、英文（及其它语言）传 en-US。
 */
function runLanguage() {
  return String(locale.value || "").toLowerCase().startsWith("en") ? "en-US" : "zh-CN";
}

/**
 * 首屏「查异常」：身份来自 /flow/steps?module=TASK 的 IDENTITY 选项（如 DISPATCH-02）时走这里。
 *
 * 走 Dify 工作流而不是对话接口（POST /proxy/v1/workflows/run，blocking 一次性返回）：
 *   inputs = { query_type: 查异常, user_id: 所选身份, role_id: OWNER, language: zh-CN / en-US }
 *   user   = 当前用户标识（游客态兜底 guest）
 * 工作流没有 query / conversation，业务结果整包在 data.outputs 里
 * （`{ component: '<COMPONENT>{"scene":"task","type":"exception","data":{...}}</COMPONENT>' }`，
 * 由 utils/task-exception 拆外壳后取 data 里的 title / exceptionObject / description / suggestions）。
 * 数据回来之前待机区不铺卡：解析不出内容就保持 null，页面上不会出现占位卡片。
 */
async function loadExceptionInfo(identity: TaskIdentity) {
  initialCardsRequestedAt = Date.now();
  try {
    const result = await runBlockingWorkflow({
      inputs: {
        query_type: EXCEPTION_QUERY,
        user_id: identity.code,
        role_id: EXCEPTION_ROLE_ID,
        language: runLanguage(),
      },
      user: String(userStore.userId || "").trim() || "guest",
      // 网关按 guest-role 头鉴权：与 inputs.role_id 保持一致
      guestRole: EXCEPTION_ROLE_ID,
    });
    const summary = resolveExceptionSummary(result?.data?.outputs);
    exceptionCard.value = summary.card;
    exceptionSuggestions.value = summary.suggestions;
    logger.info("task exception info loaded", { identity: identity.code, outputs: result?.data?.outputs });
  }
  catch (error) {
    // 接口挂了就保持空态：不铺卡片，建议问题回落到本地兜底文案
    logger.warn("failed to load task exception info", { identity: identity.code, error });
  }
}

/**
 * 甘特图（横屏调度视图）右下角输入条发来的问题：回到本页后取出来，直接发在作业协同会话里（发完即清）。
 * 两条返回路径（navigateBack / 关掉场景窗口）都会走 onShow，所以在这里消费；
 * 先按需切会话再发，避免问题落到别的会话。
 */
function startPendingScheduleAsk() {
  const text = consumePendingScheduleAsk();
  if (text) {
    sendTaskMessage({ text });
    return;
  }
  // 没有待发问题：回到本页仍停在欢迎态就重拉一次入口卡（不缓存、不复用旧数据）。
  // 与 onLoad 的请求隔开 800ms：首次进入 onShow 紧跟 onLoad，不该重复请求。
  // 待机态是异常卡时首屏走的是「查异常」，这里不再补拉甘特图入口卡。
  if (showSceneWelcome.value && welcomeCardKind.value !== "exception" && Date.now() - initialCardsRequestedAt > 800) void loadInitialCards();
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
  guideStepSheetVisible.value = true;
  // 这一轮的核对卡：按本轮第一步定位（每轮回答各带一张自己的卡）
  guideStepCardStepId.value = String(payload?.steps?.[0]?.id || "");
  // 步骤卡弹出：把这一步的核对卡滚到对话区顶部
  nextTick(() => focusGuideStepCardAtTop());
}

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
 * 从本页打开横屏调度视图的时间戳（0 表示没开过）。
 *
 * onShow 里要兜底把方向复原成竖屏，但「刚点开、宿主转场还没结束」时也可能收到 onShow：
 * 这时如果直接发 `landscapeFullscreen(false)`，正好会把刚申请到的横屏关掉
 * （日志里表现成 true / false 各一次）。所以只在「确实离开超过一段时间后再回来」才复原。
 */
let landscapeSceneOpenedAt = 0;
/** onShow 复原方向的最小间隔：小于这个时长视为「还在开窗过程中」，不动方向 */
const LANDSCAPE_RETURN_GUARD_MS = 800;

/**
 * 点甘特入口卡（AI 下发的 gantt 积木）：按 viewType 分流（见 utils/gantt-navigation）。
 * - personal → 竖屏个人任务详情页（pages/task-detail），明细挂在整包的 payload 字段里；
 * - schedule / pre / replan → 各自横屏视图；
 * 数据一律先落本地存储、再由目标页 onLoad 取走（目标页可能是独立场景窗口）。
 */
function onGanttOpen(payload: GanttViewPayload) {
  // 只有横屏页需要回来时复原方向；personal 是竖屏页，不参与。
  // 网页环境不做横屏转换（见 utils/landscape-device），也就没有「回来要复原的方向」。
  if (String(payload?.viewType || "").trim().toLowerCase() !== "personal" && !isWebEnvironment()) {
    landscapeSceneOpenedAt = Date.now();
  }
  openGanttView(payload);
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
const showSceneWelcome = computed(() => !messages.value.length && !isSessionSwitching.value);
/**
 * 待机引导文案（Ardot 350:2151）：问候 + 卡片 +「你还可以这么问」，见 config/task-welcome。
 *
 * - 卡片：引导流程（task-init）进来铺异常摘要卡（数据见 loadExceptionInfo）；
 *   其它入口 / 新增对话铺初始化对话（「今天任务有哪些」）回复里的 gantt 入口卡，见 applyInitialCards，
 *   没有卡片数据时 initialGanttPayload 为 null，整卡不渲染。
 * - 建议问题：异常卡片随包下发了 suggestions（如「两个工地的泵车需求冲突在哪里？」）就直接用，
 *   没下发（接口挂了 / 老结构 / 非异常入口）仍按身份（调度员 / 操作手）取本地兜底 key 再翻译。
 */
const taskWelcome = computed(() => {
  // 建议问题（task-welcome__question）只认当前待机态：
  // 异常态用接口下发的 suggestions；其余（新建页面 / 新对话）一律走本地按身份的兜底文案
  const exceptionQuestions = welcomeCardKind.value === "exception" ? exceptionSuggestions.value : [];
  return {
    title: t(TASK_WELCOME_COPY.titleKey),
    content: t(TASK_WELCOME_COPY.contentKey),
    questions: exceptionQuestions.length
      ? exceptionQuestions
      : pickTaskWelcomeQuestions(userStore.visitorRole).map(key => t(key)),
  };
});

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
  if (!chatStore.messages.length && !chatStore.aiSessionId && !pendingInitSessionId.value) {
    uni.showToast({ title: t("already-new-conversation"), icon: "none" });
    return;
  }
  // 正在生成时切走：先掐掉在途请求，否则回包会继续往新会话里写
  cancelActiveStream();
  pendingInitSessionId.value = null;
  // 新对话不复用上一轮的入口卡，等新数据回来再铺；异常卡片与它下发的建议问题也一起撤掉，
  // 待机态切回 gantt：甘特图入口卡 + 本地兜底建议问题（不沿用上一轮的接口 suggestions）
  initialGanttPayload.value = null;
  exceptionCard.value = null;
  exceptionSuggestions.value = [];
  welcomeCardKind.value = "gantt";
  chatStore.resetConversation();
  chatListKey.value += 1;
  nextTick(() => chatStore.scrollToBottom(true));
  // 新对话同样是「打开就铺卡片」：重新静默拉一次
  void loadInitialCards();
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
  // 切到历史会话：初始化那轮暂存的会话不再续用，欢迎态的入口卡也不再显示
  pendingInitSessionId.value = null;
  initialGanttPayload.value = null;
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
  syncWindowHeight();
  // 入口来源：只有 task-init 引导流程会带 from=init（见 ai-task-init 的 finish）
  const fromInit = String(options?.from ?? "").trim() === "init";
  const sessionId = readSessionIdFromOptions(options) || peekPendingHistorySession("TASK");
  if (sessionId) {
    void openLocalHistory(consumePendingHistorySession("TASK") || sessionId, true);
    return;
  }
  // 进入即起一轮干净会话（返回首页再进会重新开一轮）；发送场景由 useChatSend 固定为 TEST。
  chatStore.resetConversation();
  chatStore.showQuickPrompts = false;
  chatStore.showQuickList = false;
  // 引导流程进来且那次选过身份（task-init 下发，如 DISPATCH-02）：首屏问「查异常」，
  // 拿到的异常信息渲染成异常摘要卡，建议问题用接口随包下发的 suggestions；
  // 其它入口（新建页面 / 宿主独立窗口 / 听播异常条目直接进）一律走甘特图入口卡 + 本地兜底建议问题，
  // 静默问一句「今天任务有哪些」，只把回复里的 gantt 卡铺进对话区（不缓存、每次重新请求）。
  const identity = getTaskIdentity();
  const usesException = fromInit && Boolean(identity);
  welcomeCardKind.value = usesException ? "exception" : "gantt";
  if (usesException && identity) void loadExceptionInfo(identity);
  else void loadInitialCards();
});

onMounted(() => {
  syncWindowHeight();
  loadAwakeningPrompt();
});

onShow(() => {
  // 从横屏调度视图返回的兜底复原：正常路径由横屏页的 leaveToChat → exitLandscape 等竖屏恢复，
  // 但宿主手势关窗 / 系统返回键 / webview 被直接销毁时那段异步流程可能没跑完，
  // 回到这里就会停在横屏里（键盘弹出后布局全乱）。
  // 只在本页确实开过横屏页、且已经离开超过 LANDSCAPE_RETURN_GUARD_MS 时才复原：
  // 开窗转场期间的 onShow 不能动方向，否则会把刚申请到的横屏立刻关掉。
  if (landscapeSceneOpenedAt && Date.now() - landscapeSceneOpenedAt > LANDSCAPE_RETURN_GUARD_MS) {
    landscapeSceneOpenedAt = 0;
    setLandscapeFullscreen(false);
  }
  syncWindowHeight();
  const sessionId = consumePendingHistorySession("TASK");
  // 有心跳转的会话就先切过去，再补发甘特图里问的问题，避免问错会话
  if (sessionId) {
    void openLocalHistory(sessionId, true).then(startPendingScheduleAsk);
    return;
  }
  // 从调度视图等页面回到本页：补发甘特图里问的问题；没有就刷新一次入口卡
  startPendingScheduleAsk();
});

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
      <!-- 设备线稿背景图：跟着用户选的机型走（履带吊 / 混凝土泵车） -->
      <AiChatBackdrop />
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
      <!-- 待机引导（Ardot 350:2151）：问候 + 任务入口卡 +「你还可以这么问」问题列表 -->
      <view v-if="showSceneWelcome" class="task-welcome">
        <text class="task-welcome__title">
          {{ taskWelcome.title }}
        </text>
        <text class="task-welcome__desc">
          {{ taskWelcome.content }}
        </text>
        <!-- 异常情况摘要卡（Ardot 350:2199）：只有待机态是 exception（task-init 引导流程进来且选过身份）才铺，替代任务入口卡 -->
        <view v-if="welcomeCardKind === 'exception' && exceptionCard" class="task-welcome__entry">
          <AiTaskExceptionCard :data="exceptionCard" />
        </view>
        <!-- 任务入口卡（AiGanttEntryCard）：只渲染初始化对话返回的卡片数据，没有就整卡不渲染 -->
        <view v-else-if="initialGanttPayload" class="task-welcome__entry">
          <GanttBlock
            :payload="initialGanttPayload"
            card-only
            @open="openGanttView"
          />
        </view>
        <text class="task-welcome__label">
          {{ t("overview-more-questions") }}
        </text>
        <view class="task-welcome__list">
          <view
            v-for="question in taskWelcome.questions"
            :key="question"
            class="task-welcome__row"
            @tap="onTaskQuickPrompt(question)"
          >
            <text class="task-welcome__question">
              {{ question }}
            </text>
          </view>
        </view>
      </view>
      <AiMessageList
        :key="chatListKey"
        top-inset="var(--chat-top-inset, 300rpx)"
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
        @guide-suggestion-open="onGuideSuggestionOpen"
        @ask-slot-open="onAskSlotOpen"
        @gantt-open="onGanttOpen"
        @tts-click="onTtsClick"
        @feedback-change="onFeedbackChange"
        @share-click="onShareClick"
        @copy-click="onCopyMessage"
        @select-toggle="onShareSelectToggle"
        @scroll-top="onScrollTop"
        @pinned-change="onPinnedChange"
      />
      <!-- 一键回到底部（与首页一致）：离底时出现，贴底自动隐藏；
           位置 = 输入栏高（含键盘抬起）+ 72rpx 底部导航 + 24rpx 间隙，不压住输入栏 -->
      <view
        v-if="showScrollToBottom"
        class="chat-scroll-bottom"
        :style="{ bottom: `calc(${composerBottomInset} + 96rpx)` }"
        @tap="onScrollToBottomTap"
      >
        <view class="chat-scroll-bottom__chevron" />
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
        v-else
        ref="chatInputRef"
        v-model="inputText"
        :is-loading="isLoading"
        :keyboard-height="keyboardHeight"
        :voice-keyboard-height="voiceKeyboardHeight"
        bottom-gradient
        :compact-voice-listening="true"
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
        @dock-height-change="setInputDockHeight"
      />

      <!-- 追问卡片（作业协同 type=ask / ai问问 type=slot）：单选点即作答，多选选完确认提交；
           作业协同不提供「其他输入」入口，只允许在选项里作答 -->
      <AiSlotDrawer
        :slots="askSlotQueue"
        scene="task"
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

/* ===== 待机引导（Ardot 350:2151）=====
   画板 375×812：标题 y=74 / 说明 123 / 入口卡 180 /「你还可以这么问」331 / 问题列表 356，
   左右留白 20（40rpx）。

   顶部留白按需求放大（参考 index 首页待机态）：头部是流内元素（状态栏 0 + 栏高 50），
   而灵动岛（92）+ 下方「SANI」胶囊是绝对定位浮在内容之上，换算到内容区：
   岛底 ≈ 84rpx、胶囊底 ≈ 136rpx。设计稿的 148rpx 让标题顶只比胶囊低 12rpx（6px），
   视觉上贴着 logo；这里抬到 216rpx，标题距胶囊底约 80rpx（40px），
   与首页待机态那种「标题离顶部留白」的观感一致。 */
.task-welcome {
  position: relative;
  z-index: 1;
  // 头部改成悬浮后不占布局，这里把它的实际高度补回来，欢迎区仍从头部下方起步
  // （216rpx 与作业指导页 .guide-welcome 同一档）
  padding: calc(var(--chat-header-height) + 216rpx) 40rpx 0;
}

.task-welcome__title {
  display: block;
  color: #0d0d0d;
  font-family: "PingFang SC";
  font-size: 56rpx; // 28
  font-weight: 700;
  line-height: 82rpx; // 41
}

.task-welcome__desc {
  display: block;
  margin-top: 16rpx; // 8
  color: #0d0d0d;
  font-family: "PingFang SC";
  font-size: 28rpx; // 14
  font-weight: 400;
  line-height: 44rpx; // 22
}

/* 任务入口卡（AiGanttEntryCard）：间距沿用设计稿里异常摘要卡那一档（13） */
.task-welcome__entry {
  margin-top: 26rpx; // 13
}

.task-welcome__label {
  display: block;
  margin-top: 54rpx; // 27
  color: #8e8e8e;
  font-family: "PingFang SC";
  font-size: 30rpx; // 15
  font-weight: 500;
  line-height: 46rpx; // 23
}

/* 问题列表：行内 16 上下内边距（行高 52），行间 1px #EFEFEF，末行下描边 #E8E8E8 */
.task-welcome__list {
  margin-top: 4rpx; // 2
  border-bottom: 1px solid #e8e8e8;
}

.task-welcome__row {
  padding: 32rpx 0; // 16
  border-top: 1px solid #efefef;

  &:first-child {
    border-top: 0;
  }

  &:active {
    opacity: 0.6;
  }
}

.task-welcome__question {
  display: block;
  color: #0d0d0d;
  font-family: "PingFang SC";
  font-size: 28rpx; // 14
  font-weight: 400;
  line-height: 40rpx; // 20
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
  /* 形成层叠上下文：机型背景图（AiChatBackdrop）是 z-index: -1，
     不隔离时负层会被本元素的 #fafafa 底色盖住，选了机型也看不到图 */
  isolation: isolate;
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

// 一键回到底部（与首页同一套）：白底圆钮 + 细线下箭头，浮在输入栏上方右侧。
// bottom 由行内样式给：composerBottomInset（输入栏高 + 键盘抬起）+ 72rpx 导航高 + 24rpx 间隙
.chat-scroll-bottom {
  position: absolute;
  right: 32rpx;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 76rpx;
  height: 76rpx;
  border: 1px solid rgba(51, 51, 51, 0.08);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 4rpx 16rpx rgba(15, 126, 238, 0.12);
  -webkit-backdrop-filter: blur(20rpx);
  backdrop-filter: blur(20rpx);
}

.chat-scroll-bottom__chevron {
  width: 20rpx;
  height: 20rpx;
  border-right: 1px solid #333333;
  border-bottom: 1px solid #333333;
  transform: translateY(-6rpx) rotate(45deg);
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
