<script setup lang="ts">
import type { TodayListenBroadcast } from "@/api/listen-broadcast/types";
import type { UiChatMessage } from "@/stores/chat-types";
import moment from "moment";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import iconWaveForm from "@/assets/img/icon-waveform.svg";
import { guideStepCardDomId } from "@/utils/guide-content";
import { isListenReportListened } from "@/utils/listen-report";
import type { GuideStepSelectEvent } from "@/api/chat/types";
import AiBlockRenderer from "../ai-bubble-v2/AiBlockRenderer.vue";
import AiBubbleV2 from "../ai-bubble-v2/index.vue";

defineOptions({
  name: "AiMessageList",
});

const props = defineProps({
  messages: {
    type: Array as () => UiChatMessage[],
    default: () => [],
  },
  scrollIntoView: {
    type: String,
    default: "",
  },
  quickPrompts: {
    type: Array,
    default: () => [],
  },
  showQuickPrompts: {
    type: Boolean,
    default: true,
  },
  /** 空会话时是否展示首页式业务概览（问候/摘要/早报/可继续问）。独立业务页可关闭。 */
  showBusinessOverview: {
    type: Boolean,
    default: true,
  },
  showQuickList: {
    type: Boolean,
    default: true,
  },
  selectedIndexes: {
    type: Array,
    default: () => [],
  },
  selectMode: {
    type: Boolean,
    default: false,
  },
  suppressHighlight: {
    type: Boolean,
    default: false,
  },
  bottomInset: {
    type: String,
    default: "",
  },
  /** 当前要顶到对话区顶部的核对卡（多步骤卡）属于哪一步：按它从最新一轮往回找那张卡 */
  stepCardStepId: {
    type: String,
    default: "",
  },
  /** 步骤卡（底部白板）是否展开：展开时要保证核对卡能顶到对话区最上方 */
  pinStepCard: {
    type: Boolean,
    default: false,
  },
  awakening: {
    type: Object,
    default: null,
  },
  awakeningLoading: {
    type: Boolean,
    default: false,
  },
  listenBroadcast: {
    type: Object as () => TodayListenBroadcast | null,
    default: null,
  },
  listenBroadcastLoading: {
    type: Boolean,
    default: false,
  },
  listenReportRefreshKey: {
    type: Number,
    default: 0,
  },
  realtimeTtsMessageKey: {
    type: null,
    default: null,
  },
  realtimeTtsPlaying: {
    type: null,
    default: false,
  },
  /** 外部（发送、切会话）强制回到底部时会置回 true，组件内的跟随状态要跟着复位 */
  pinnedToBottom: {
    type: Boolean,
    default: true,
  },
  /** 滚动请求令牌：自增一次 = 一次请求，列表量完 DOM 后按 px 把内容末尾（不含参考来源）落到对话区底边 */
  replyEndToken: {
    type: Number,
    default: 0,
  },
});

const emit = defineEmits([
  "scroll-top",
  "pinned-change",
  "quick-prompt",
  "suggestion-tap",
  "ask-slot-open",
  "assistant-navigation-open",
  "assistant-callback-open",
  "guide-step-open",
  "guide-suggestion-open",
  "guide-check-step-select",
  "gantt-open",
  "tts-click",
  "share-click",
  "feedback-change",
  "copy-click",
  "select-toggle",
  "listen-report",
  /** 把核对卡顶到对话区最上方还需要补多少底部间距（px），由页面并进 bottomInset */
  "card-space-change",
  /** 贴底状态下内容长高了（图片、图表等后加载的内容撑开高度）：页面据此再贴一次底 */
  "content-grow",
]);

const FALLBACK_OVERVIEW = {
  userName: "杜老板",
  greetingSuffix: "，你好。",
  summary: "7月28日至8月3日设备作业126小时，较前期增加12%，先看整体变化吧！",
};

const overview = computed(() => {
  const data = props.awakening;
  const userName = data?.userName || FALLBACK_OVERVIEW.userName;
  const summary = data?.content || FALLBACK_OVERVIEW.summary;
  return { userName, greetingSuffix: FALLBACK_OVERVIEW.greetingSuffix, summary };
});

const listenBroadcastTitle = computed(() => props.listenBroadcast?.title?.trim() || "");
const listenBroadcastDate = computed(() => {
  const bizDate = props.listenBroadcast?.bizDate;
  const date = moment(bizDate, "YYYY-MM-DD", true);
  return date.isValid() ? date.format("MMDD") : "";
});
function resolvePositive(message: UiChatMessage) {
  if (typeof message?.positive === "boolean") return message.positive;
  if (message?.feedbackValue === "good") return true;
  if (message?.feedbackValue === "bad") return false;
  return null;
}

function isActiveRealtimeTts(message: UiChatMessage) {
  return props.realtimeTtsMessageKey != null
    && String(message.id ?? message.messageId) === String(props.realtimeTtsMessageKey);
}

function isMessageDisabled(index: number, message: UiChatMessage) {
  const list = Array.isArray(props.messages) ? props.messages : [];
  if (message?.role === "ai") return Boolean(message.interrupted);
  return message?.role === "user" && Boolean(
    list[index + 1]?.role === "ai" && list[index + 1].interrupted,
  );
}

function findConversationGroup(aiIndex) {
  const list = Array.isArray(props.messages) ? props.messages : [];
  const group = [aiIndex];
  for (let index = aiIndex - 1; index >= 0; index -= 1) {
    if (list[index]?.role === "user") {
      group.unshift(index);
      break;
    }
  }
  return group;
}
// 用滚动方向而不是高度差判断是否贴底：
// 流式追加时列表高度一直在变，量高度既要额外查询节点，又容易误判。
// 向上滑一定距离即视为用户在看历史，滚到底（scrolltolower）再恢复跟随。
/**
 * 消息区在固定底部 UI（输入栏 / 底部卡片）之外再留的空隙（px）：贴底时最后一条不贴着输入栏。
 * 页面传来的 bottomInset 只表示「被盖住」的高度，空隙由这里加（见 listPadStyle）。
 * 空隙不能算进「被盖住」里，否则回复末尾会把参考来源的头几个像素留在空隙中，看着像被输入栏裁了一半。
 */
const MESSAGE_LIST_EXTRA_GAP_PX = 16;
const UNPIN_SCROLL_UP_PX = 12;
let lastScrollTop = 0;

/** 绑给 scroll-view 的像素滚动位置：只在「落到内容末尾」时赋值，不回写 @scroll 的值 */
const scrollTopPx = ref(0);

/**
 * H5：取节点最近的「真正在滚」的祖先。
 * uni 的 scroll-view 在 H5 会渲染好几层 div，`scroll-top` 的变化不会落到内层滚动容器上，
 * 所以真要定位得自己找那个 overflow 生效、且确实溢出（scrollHeight 大于 clientHeight）的祖先。
 */
function findScrollableAncestor(node: Element | null): HTMLElement | null {
  let current = node?.parentElement || null;
  while (current) {
    const overflowY = getComputedStyle(current).overflowY;
    const scrollable = overflowY === "auto" || overflowY === "scroll";
    const overflows = current.scrollHeight > current.clientHeight + 1;
    if (scrollable && overflows) return current as HTMLElement;
    current = current.parentElement;
  }
  return null;
}

function setPinned(pinned: boolean) {
  if (pinned === props.pinnedToBottom) return;
  emit("pinned-change", pinned);
}

/**
 * 用户手势标记：@scroll 在 H5 里「程序化改 scrollTop」也会派发，
 * 自动对齐往回上方收的时候（回复里冒出参考来源、图片后加载撑高）会被当成用户在翻历史，
 * 把「贴底跟随」关掉——表现就是「生成到一半，后面还有内容却不跟着滚了」。
 * 所以只在真的有触摸 / 滚轮手势时才取消跟随。
 */
const USER_GESTURE_IDLE_MS = 1200;
let userScrollGesture = false;
let gestureReleaseTimer: ReturnType<typeof setTimeout> | null = null;
let gestureBound: HTMLElement | null = null;

function markUserScrollGesture() {
  userScrollGesture = true;
  if (gestureReleaseTimer) clearTimeout(gestureReleaseTimer);
  // 撤手后的惯性滚动还会继续派发 scroll，晚一点再把手势标记收回
  gestureReleaseTimer = setTimeout(() => {
    gestureReleaseTimer = null;
    userScrollGesture = false;
  }, USER_GESTURE_IDLE_MS);
}

/** H5：在列表外层挂手势监听（触摸 / 滚轮事件从内层滚动容器冒泡上来） */
function bindScrollGesture() {
  // #ifdef H5
  const list = document.querySelector(".msg-list") as HTMLElement | null;
  if (!list || list === gestureBound) return;
  gestureBound?.removeEventListener("touchstart", markUserScrollGesture);
  gestureBound?.removeEventListener("touchmove", markUserScrollGesture);
  gestureBound?.removeEventListener("wheel", markUserScrollGesture);
  gestureBound = list;
  list.addEventListener("touchstart", markUserScrollGesture, { passive: true });
  list.addEventListener("touchmove", markUserScrollGesture, { passive: true });
  list.addEventListener("wheel", markUserScrollGesture, { passive: true });
  // #endif
}

function onScroll(e: { detail?: { scrollTop?: number } }) {
  const scrollTop = Number(e?.detail?.scrollTop) || 0;
  // 只认用户手势：程序化的上移（自动对齐收回）不能把跟随关掉
  if (userScrollGesture && scrollTop < lastScrollTop - UNPIN_SCROLL_UP_PX) setPinned(false);
  lastScrollTop = scrollTop;
}

function onScrollToLower() {
  setPinned(true);
}

function onScrollTop() {
  emit("scroll-top");
}

/**
 * 落到「回复内容末尾（不含参考来源）」。
 *
 * 口径按需求：以内容块容器 `.ai-content-blocks` 的高度减去参考来源 `.guide-source-block` 的高度为准
 * ——参考来源整段留在对话区下方之外，可视区最后一条就是回复正文（含参考图）。
 *
 * 滚动位置不用 @scroll 记（H5 的 uni scroll-view 不保证派发滚动事件），改由 rect 反推：
 * `.msg-list__inner` 是滚动内容原点，`列表顶 − 内容顶` = 当前 scrollTop；
 * 目标 =（内容块容器底边 − 其中参考来源总高）− 对话区高。量不到容器就退回贴底。
 *
 * 对齐边分两种（见 visibleHeight / coveredVisibleHeight）：
 * - 贴底：内容下面是空白留白，用「留白边」（含那 16px 空隙），最后一条抬到空隙之上；
 * - 回复末尾：内容下面是参考来源，用「遮挡边」（不含空隙），尾巴才能整段藏到输入栏后面。
 */
/** 上一次对齐时已有的用户消息条数：变多说明刚发过消息，这次要强制落到回复位置（允许上拉） */
let lastUserMessageCount = 0;

/**
 * 输入框遮挡的高度：输入栏是 fixed 覆盖在列表下方的，
 * 页面用列表底部留白（padding-bottom = 输入栏高度）把内容顶上来，这里要减掉这段才不会被输入框挡住。
 */
function reservedBottomHeight() {
  // #ifdef H5
  const inner = document.querySelector(".msg-list__inner");
  if (inner) return Number.parseFloat(getComputedStyle(inner).paddingBottom) || 0;
  // #endif
  return 0;
}

/**
 * 真正被固定 UI 盖住的高度 = 底部留白 − 额外空隙。
 *
 * 留白下面是空的时候（贴底），最后一条抬到留白之上就行，那 16px 空隙是白送的；
 * 留白下面要是还有内容（参考来源），就得把内容藏到「固定 UI 顶边」为止，
 * 否则它的头几个像素会正好落在空隙里，看着像被输入栏裁掉一行。
 */
function occludedBottomHeight() {
  return Math.max(0, reservedBottomHeight() - MESSAGE_LIST_EXTRA_GAP_PX);
}

/**
 * @param forceUp 刚发过消息（强制回底）：允许把视图往上拉到落点；
 *                自动跟随时只往下，不打断用户看历史
 */
function alignToReplyEnd(forceUp = false) {
  // 用户已经上翻看历史了就别再拽下去（贴底状态下才会由 store 请求这里）
  if (!props.pinnedToBottom) return;
  uni.createSelectorQuery()
    .select(".msg-list")
    .boundingClientRect()
    .select(".msg-list__inner")
    .boundingClientRect()
    .selectAll(".ai-content-blocks")
    .boundingClientRect()
    .selectAll(".guide-source-block")
    .boundingClientRect()
    .exec((rects) => {
      const listRect = (Array.isArray(rects) ? rects[0] : null) as { top?: number; height?: number } | null;
      const innerRect = (Array.isArray(rects) ? rects[1] : null) as { top?: number; height?: number } | null;
      const blockRects = (Array.isArray(rects) ? rects[2] : null) as Array<{ top?: number; bottom?: number }> | null;
      const sourceRects = (Array.isArray(rects) ? rects[3] : null) as Array<{ top?: number; height?: number }> | null;
      const listTop = Number(listRect?.top);
      const listHeight = Number(listRect?.height);
      const innerTop = Number(innerRect?.top);
      const contentHeight = Number(innerRect?.height);
      if (!Number.isFinite(listTop) || !listHeight || !Number.isFinite(innerTop)) return;

      // 有效可视高度：扣掉被输入框遮住的那段（含多留的空隙，贴底时用得上）
      const visibleHeight = Math.max(0, listHeight - reservedBottomHeight());
      // 藏尾巴时用的可视高度：只扣被盖住的那段，回复末尾正好落在固定 UI 顶边
      const coveredVisibleHeight = Math.max(0, listHeight - occludedBottomHeight());

      const lastBlocks = blockRects?.length ? blockRects[blockRects.length - 1] : null;
      const blocksTop = Number(lastBlocks?.top);
      const blocksBottom = Number(lastBlocks?.bottom);
      // 只算落在最后一个内容块容器里的参考来源（其它回答的不算）
      const sourcesHeight = (sourceRects || []).reduce((sum, rect) => {
        const top = Number(rect?.top);
        const inLastBlocks = Number.isFinite(blocksTop)
          && Number.isFinite(blocksBottom)
          && top >= blocksTop - 1
          && top <= blocksBottom + 1;
        return inLastBlocks ? sum + (Number(rect?.height) || 0) : sum;
      }, 0);

      // 目标：内容末尾（容器底边 − 参考来源高）落在「有效可视区」底边
      const lastSourceTop = Number(sourceRects?.[sourceRects.length - 1]?.top);
      let target: number;
      if (forceUp) {
        // 刚发出去：强制回到最新内容（自己的消息 + 等待回复的占位）底部
        target = contentHeight - visibleHeight;
      }
      else if (Number.isFinite(blocksBottom)) {
        // 内容块底边 − 其中参考来源总高
        target = blocksBottom - sourcesHeight - innerTop - coveredVisibleHeight;
      }
      else if (Number.isFinite(lastSourceTop)) {
        // 正文在卡片里（步骤卡问答，气泡隐藏、没有内容块容器）：以最后一块参考来源顶部为准
        target = lastSourceTop - innerTop - coveredVisibleHeight;
      }
      else {
        // 没有参考来源：贴底，与原逻辑一致
        target = contentHeight - visibleHeight;
      }
      if (!Number.isFinite(target)) return;

      const currentScrollTop = Math.max(0, listTop - innerTop);
      const next = Math.max(0, Math.round(target));
      // 落点是绝对值：不在落点上就对齐（发送后、以及回复里出现参考来源时，都可能要往上收回来）
      if (next === Math.round(currentScrollTop)) return;
      scrollTopPx.value = next;
      // #ifdef H5
      // uni 的 scroll-top 落不到内层滚动容器上，这里再直接操作一次 DOM
      const scroller = findScrollableAncestor(document.querySelector(".msg-list__inner"));
      if (scroller) scroller.scrollTop = next;
      // #endif
    });
}

watch(
  () => props.replyEndToken,
  async () => {
    // 用户消息变多 = 刚发出去一轮，这一批对齐（含下面的补量）都允许上拉
    const userCount = (props.messages || []).filter(message => message?.role === "user").length;
    const forceUp = userCount > lastUserMessageCount;
    lastUserMessageCount = userCount;
    const token = props.replyEndToken;
    await nextTick();
    alignToReplyEnd(forceUp);
    // 参考图 / 字体 / 底部间距是渲染后才撑开高度的，补量几次（目标是绝对值，重复量不会回撤）
    [150, 450, 900].forEach(delay => setTimeout(() => {
      // 流式期间每帧都可能刷新 token：过期的补量拿的是旧 DOM 量出来的位置，
      // 照它滚会把已经对齐好的视口来回拉扯（也会顺带把「贴底跟随」误关掉）
      if (props.replyEndToken !== token) return;
      alignToReplyEnd(forceUp);
    }, delay));
  },
  { flush: "post" },
);

/**
 * 贴底时内容长高要重新贴底。
 *
 * 参考图（mode="widthFix"）、markdown 里的图、echarts、字体都是**渲染完才撑开高度**的：
 * 贴底那一刻量到的还是旧高度，图加载完就留在可视区下面（表现为「只滚到文字末尾、图片看不见」）。
 * 这里观察内容容器的高度：长高且仍贴着底时通知页面再贴一次底；用户上翻看历史时不动。
 */
let contentObserver: ResizeObserver | null = null;
let lastContentHeight = 0;

function observeContentHeight() {
  // #ifdef H5
  if (contentObserver || typeof ResizeObserver === "undefined") return;
  const inner = document.querySelector(".msg-list__inner");
  if (!inner) return;
  lastContentHeight = inner.clientHeight;
  contentObserver = new ResizeObserver(() => {
    const height = inner.clientHeight;
    if (Math.abs(height - lastContentHeight) < 1) return;
    const grew = height > lastContentHeight;
    lastContentHeight = height;
    if (grew && props.pinnedToBottom) emit("content-grow");
  });
  contentObserver.observe(inner);
  // #endif
}

onMounted(() => {
  nextTick(() => {
    observeContentHeight();
    bindScrollGesture();
  });
});

onBeforeUnmount(() => {
  contentObserver?.disconnect();
  contentObserver = null;
  // #ifdef H5
  if (gestureReleaseTimer) clearTimeout(gestureReleaseTimer);
  gestureReleaseTimer = null;
  gestureBound?.removeEventListener("touchstart", markUserScrollGesture);
  gestureBound?.removeEventListener("touchmove", markUserScrollGesture);
  gestureBound?.removeEventListener("wheel", markUserScrollGesture);
  gestureBound = null;
  // #endif
});

function onQuickPrompt(prompt) {
  emit("quick-prompt", prompt);
}

function onSuggestionTap(suggestion, messageIndex: number) {
  emit("suggestion-tap", suggestion, messageIndex);
}

function onAskSlotOpen(payload, messageIndex: number) {
  emit("ask-slot-open", payload, messageIndex);
}

/** 跳转确认块（维修助手）：只透传 payload，由页面决定是否开弹框 */
function onAssistantNavigationOpen(payload) {
  emit("assistant-navigation-open", payload);
}

/** 点调度视图入口卡：整包数据交给页面（存数据 + 跳横屏调度视图） */
function onGanttOpen(payload) {
  emit("gantt-open", payload);
}

function onGuideStepOpen(payload) {
  emit("guide-step-open", payload);
}

function onGuideSuggestionOpen(payload) {
  emit("guide-suggestion-open", payload);
}

/** 点核对卡步骤条某一段：交给页面切步骤 + 打开底部白板 */
function onGuideCheckStepSelect(payload: GuideStepSelectEvent) {
  emit("guide-check-step-select", payload);
}

function onTtsClick(index) {
  emit("tts-click", index);
}

function onSelectToggle(index) {
  const list = Array.isArray(props.messages) ? props.messages : [];
  const message = list[index];
  if (!message || isMessageDisabled(index, message)) return;

  const group = message.role === "ai"
    ? findConversationGroup(index)
    : list[index + 1]?.role === "ai" && !list[index + 1].interrupted
      ? [index, index + 1]
      : [index];
  emit("select-toggle", { group, index });
}

function onShareClick(index, message) {
  if (message?.interrupted) return;
  emit("share-click", {
    index,
    msg: message,
    group: findConversationGroup(index),
  });
}

function onFeedbackChange(index, message, value) {
  emit("feedback-change", { index, msg: message, value: value || "" });
}

function onCopyClick(index, message) {
  emit("copy-click", { index, msg: message });
}

const listenedReport = ref(isListenReportListened(props.listenBroadcast?.bizDate));

watch([
  () => props.listenBroadcast?.bizDate,
  () => props.listenReportRefreshKey,
], ([bizDate]) => {
  listenedReport.value = isListenReportListened(bizDate);
}, { immediate: true });

/** “去收听”：仅在整段播放完成后标记已收听。 */
function onListenReport() {
  emit("listen-report", listenedReport.value);
}
/**
 * 与气泡的 hideBody 同一个判断（见 ai-bubble-v2）：带步骤卡的回答正文（含参考来源）不展示。
 * 正文没被隐藏时，参考来源留在气泡里，不能再往卡片里塞一份。
 */
function hidesBody(message: UiChatMessage) {
  return message?.role === "ai"
    && !message?.loading
    && (message?.blocks || []).some(block => block?.type === "guide-step");
}

/** 参考来源：低端安卓 WebView 不支持 flatMap，这里手写合并 */
function collectSourceEvidence(blocks: NonNullable<UiChatMessage["blocks"]>) {
  const evidence: unknown[] = [];
  blocks.forEach((block) => {
    if (block?.type !== "source") return;
    const list = Array.isArray(block.payload?.evidence) ? block.payload.evidence : [];
    evidence.push(...list);
  });
  return evidence;
}

/**
 * 一轮问答对应哪张核对卡（步骤详情卡）的 key：优先用消息 id，没有就退回下标。
 * 一轮里 expand 出来的多张详情卡是「同一份指导的每一步各一张」，但界面上每轮只展示其中一张。
 */
function stepCardMessageKey(message: UiChatMessage, messageIndex: number) {
  const id = String(message?.id || "").trim();
  return id || `idx-${messageIndex}`;
}

/** 这条消息里有没有那一步的核对卡 */
function hasStepCardOf(message: UiChatMessage, stepId: string) {
  return (message?.blocks || []).some(block => block?.type === "guide-check"
    && String(block.payload?.step_id || "") === stepId);
}

/** 列表里有核对卡的那几轮 */
function stepCardMessages() {
  const messages = Array.isArray(props.messages) ? props.messages : [];
  return messages
    .map((message, index) => ({ message, index }))
    .filter(item => (item.message?.blocks || []).some(block => block?.type === "guide-check"));
}

/**
 * 每一轮各自展示的那张核对卡（按 step_id 记）。
 *
 * 一轮里每步都有一张详情卡，但一个问答只显示一张：默认是本轮第一张（也就是这一轮正在讲的那一步）；
 * 底部白板翻页 / 点步骤条时，页面把「当前这一步」传进来，切成**最新那一轮**里这一步的卡——
 * 同一份指导重复触发时，一张卡只被一轮认领，不会每轮都冒出来一张同名卡；
 * 历史轮次停在自己展示的那张，不被后来的轮次拉走。
 */
const stepCardShownStepId = ref<Record<string, string>>({});
/** 这次切卡落在哪一轮：量卡片高度、顶到对话区顶部都按它定位 */
const stepCardActiveKey = ref("");

function assignStepCard(key: string, stepId: string) {
  stepCardActiveKey.value = key;
  if (stepCardShownStepId.value[key] === stepId) return;
  stepCardShownStepId.value = { ...stepCardShownStepId.value, [key]: stepId };
}

/** 把「当前这一步」落到最新那一轮上（没有那一步就保持不动） */
function selectStepCard(stepId: string) {
  const target = String(stepId || "").trim();
  if (!target) return;
  const rounds = stepCardMessages();
  for (let index = rounds.length - 1; index >= 0; index -= 1) {
    const { message, index: messageIndex } = rounds[index];
    if (!hasStepCardOf(message, target)) continue;
    assignStepCard(stepCardMessageKey(message, messageIndex), target);
    return;
  }
}

watch(
  () => [props.stepCardStepId, stepCardMessages().length],
  () => selectStepCard(String(props.stepCardStepId || "")),
  { immediate: true, flush: "post" },
);

/**
 * 一轮问答的独立卡片栈：只渲染这一轮当前展示的那一张核对卡（一个问答 = 一张卡）。
 *
 * 多轮作业指导各留一张自己的卡（N 轮 N 张，1:1），历史那一轮不再被后来的轮次顶掉。
 *
 * 渲染不改 block（保持对象身份稳定，历史卡片不会因为父组件重渲染而整片重画）；
 * 卡片在 DOM 上的唯一 id 由模板给 AiBlockRenderer 传 domId（guideStepCardDomId，并进所属消息 id）：
 * block id 只按内容生成（`guide-check-<step_id>`），同一份指导重复触发时多轮卡片会撞 id，
 * 而 scroll-into-view / 选择器定位只认第一个同 id 元素。
 *
 * 带步骤卡的回答气泡正文不展示（见 hideBody），所以同一条回答的参考来源（source 组件）
 * 要挪进这张卡里：卡片里的顺序是 正文 → 该步骤参考图 → 参考来源。
 */
function standaloneBlocks(message: UiChatMessage, messageIndex: number) {
  const blocks = (message?.blocks || []).filter(Boolean);
  const cards = blocks.filter(block => block.type === "guide-check");
  if (!cards.length) return [];

  const shownStepId = String(stepCardShownStepId.value[stepCardMessageKey(message, messageIndex)] || "");
  const card = (shownStepId
    ? cards.find(item => String(item.payload?.step_id || "") === shownStepId)
    : null) || cards[0];

  const evidence = hidesBody(message) ? collectSourceEvidence(blocks) : [];
  if (!evidence.length) return [card];
  return [{ ...card, payload: { ...card.payload, sources: evidence } }];
}

/**
 * 调度视图入口卡（gantt 积木）：与核对卡一样独立于回答气泡——
 * 气泡里不渲染（见 ai-bubble-v2 的 STANDALONE_BLOCK_TYPES），这里在气泡下方单独成卡，
 * 版式沿用欢迎态那张入口卡（左右 20px、与气泡卡间距 13px，见 pages/task 的 .task-scene-welcome-entry）。
 *
 * 【暂时屏蔽】卡片渲染入口统一由 SHOW_GANTT_BLOCK 控制，改回 true 即恢复。
 */
const SHOW_GANTT_BLOCK = false;

function ganttBlocks(message: UiChatMessage) {
  if (!SHOW_GANTT_BLOCK) return [];
  return (message?.blocks || []).filter(block => block?.type === "gantt");
}

const listPadStyle = computed(() =>
  (props.bottomInset
    ? { paddingBottom: `calc(${props.bottomInset} + ${MESSAGE_LIST_EXTRA_GAP_PX}px)` }
    : {}),
);

/**
 * 当前要顶到对话区顶部的那张核对卡的 DOM id：切卡落在哪一轮，就顶那一轮正在展示的那张。
 * 与 standaloneBlocks 用同一份选择状态，保证「量高度的那张」就是「滚上去的那张」。
 */
const stepCardTargetId = computed(() => {
  const rounds = stepCardMessages();
  if (!rounds.length) return "";
  const key = stepCardActiveKey.value;
  const active = key
    ? rounds.find(item => stepCardMessageKey(item.message, item.index) === key)
    : null;
  const round = active || rounds[rounds.length - 1];
  const card = standaloneBlocks(round.message, round.index)[0];
  if (!card?.id) return "";
  return guideStepCardDomId(round.message?.id, card.id);
});

/**
 * 把当前这张核对卡顶到对话区最上方需要补的底部间距：对话区高度 − 卡片高度。
 *
 * 为什么必须补：scroll-into-view 就是把元素顶部对到容器顶部（uni 里是直接赋 scrollTop），
 * 而滚动最多到「内容末尾 + 底部间距」，间距不够时会被浏览器夹在偏下的位置，看着就像没滚。
 * 卡片比可视区还高时量出来是 0，此时贴底已经是卡片顶部能到的最高位置。
 */
function measureCardPinSpace() {
  return new Promise<number>((resolve) => {
    const targetId = stepCardTargetId.value;
    if (!targetId) {
      resolve(0);
      return;
    }
    uni.createSelectorQuery()
      .select(".msg-list")
      .boundingClientRect()
      .select(`#${targetId}`)
      .boundingClientRect()
      .exec((rects) => {
        const listRect = Array.isArray(rects) ? rects[0] as { height?: number } | null : null;
        const cardRect = Array.isArray(rects) ? rects[1] as { height?: number } | null : null;
        const viewport = Number(listRect?.height) || 0;
        const card = Number(cardRect?.height) || 0;
        resolve(viewport && card ? Math.max(0, viewport - card) : 0);
      });
  });
}

watch(
  () => [props.pinStepCard, props.stepCardStepId],
  async () => {
    if (!props.pinStepCard) {
      emit("card-space-change", 0);
      return;
    }
    // 等这一轮 DOM 更新完（翻页后的新卡片、新间距）量出来才准
    await nextTick();
    emit("card-space-change", await measureCardPinSpace());
  },
  { flush: "post" },
);
</script>

<template>
  <view class="ai-message-list">
    <scroll-view
      class="msg-list"
      scroll-y
      :scroll-into-view="scrollIntoView"
      :scroll-top="scrollTopPx"
      :scroll-with-animation="false"
      @scroll="onScroll"
      @scrolltolower="onScrollToLower"
      @scrolltoupper="onScrollTop"
    >
      <view class="msg-list__inner" :style="listPadStyle">
        <view v-if="showQuickPrompts && showBusinessOverview" class="business-overview">
          <!-- 首页问候、摘要、早报与问题列表加载骨架 -->
          <view v-if="awakeningLoading" class="business-overview__skeleton">
            <view class="business-overview__skeleton-title business-overview__skeleton-block" />
            <view class="business-overview__skeleton-summary">
              <view class="business-overview__skeleton-line business-overview__skeleton-block" />
              <view class="business-overview__skeleton-line business-overview__skeleton-line--short business-overview__skeleton-block" />
            </view>
            <view v-if="showQuickList" class="business-overview__report business-overview__report--skeleton">
              <view class="business-overview__skeleton-sound business-overview__skeleton-block" />
              <view class="business-overview__skeleton-report-info">
                <view class="business-overview__skeleton-report-title business-overview__skeleton-block" />
                <view class="business-overview__skeleton-report-date business-overview__skeleton-block" />
              </view>
              <view class="business-overview__skeleton-listen business-overview__skeleton-block" />
            </view>
            <view v-if="showQuickList" class="business-overview__skeleton-questions">
              <view class="business-overview__skeleton-question-title business-overview__skeleton-block" />
              <view v-for="index in 2" :key="`question-skeleton-${index}`" class="business-overview__skeleton-question">
                <view class="business-overview__skeleton-question-line business-overview__skeleton-block" />
              </view>
            </view>
          </view>
          <template v-else>
            <view class="business-overview__title">
              <text>
                {{ overview.userName }}
              </text>
              <text>{{ overview.greetingSuffix }}</text>
            </view>
            <text class="business-overview__summary">
              {{ overview.summary }}
            </text>

            <!-- 早报接口独立请求时保留 120rpx 卡片骨架 -->
            <view
              v-if="showQuickList && listenBroadcastLoading"
              class="business-overview__report business-overview__report--skeleton"
            >
              <view class="business-overview__skeleton-sound business-overview__skeleton-block" />
              <view class="business-overview__skeleton-report-info">
                <view class="business-overview__skeleton-report-title business-overview__skeleton-block" />
                <view class="business-overview__skeleton-report-date business-overview__skeleton-block" />
              </view>
              <view class="business-overview__skeleton-listen business-overview__skeleton-block" />
            </view>
            <view
              v-else-if="showQuickList && listenBroadcast"
              class="business-overview__report"
            >
              <view class="business-overview__sound" aria-hidden="true">
                <image :src="iconWaveForm" mode="aspectFit" />
              </view>
              <view class="business-overview__report-info">
                <text class="business-overview__report-title">
                  {{ listenBroadcastTitle }}
                </text>
                <text class="business-overview__report-date">
                  （{{ listenBroadcastDate }} 早报）
                </text>
              </view>
              <view
                class="business-overview__listen"
                :class="{ 'business-overview__listen--listened': listenedReport }"
                @tap="onListenReport"
              >
                {{ listenedReport ? '已收听' : '去收听' }}
              </view>
            </view>

            <view v-if="showQuickList" class="business-overview__questions">
              <text class="business-overview__questions-title">
                你还可以这么问
              </text>
              <view
                v-for="(prompt, index) in quickPrompts"
                :key="`${index}-${prompt}`"
                class="business-overview__question"
                @tap="onQuickPrompt(prompt)"
              >
                {{ prompt }}
              </view>
            </view>
          </template>
        </view>

        <view class="chat-box">
          <!-- 对话内容 -->
          <view v-for="(msg, index) in messages" :key="index">
            <AiBubbleV2
              :role="msg.role"
              :content="msg.content"
              :blocks="msg.blocks || []"
              :loading="msg.loading"
              :tts-enabled="!!msg.ttsEnabled"
              :tts-loading="isActiveRealtimeTts(msg) ? !Boolean(realtimeTtsPlaying) : !!msg.ttsLoading"
              :tts-playing="isActiveRealtimeTts(msg) ? Boolean(realtimeTtsPlaying) : !!msg.ttsPlaying"
              :show-actions="msg.role === 'ai' && !msg.loading && !msg.interrupted && !msg.assistantCallbackTitle"
              :waiting-text="msg.waitingText"
              :assistant-callback-title="msg.assistantCallbackTitle"
              :assistant-callback-status="msg.assistantCallbackStatus || ''"
              :assistant-callback-details="msg.assistantCallbackDetails || []"
              :assistant-callback-conversation-id="msg.assistantCallbackConversationId || ''"
              :attachments="msg.attachments || []"
              :interrupted="!!msg.interrupted"
              :duration-ms="msg.durationMs"
              :process-status="msg.processStatus"
              :process-subtitle="msg.processSubtitle"
              :positive="resolvePositive(msg)"
              :selected="selectedIndexes.includes(index)"
              :suppress-highlight="suppressHighlight"
              :select-mode="selectMode"
              :disabled="isMessageDisabled(index, msg)"
              :no-answer-group="!!msg.noAnswerGroup"
              :asr-pending="!!msg.asrPending"
              @suggestion-tap="onSuggestionTap($event, index)"
              @ask-slot-open="onAskSlotOpen($event, index)"
              @assistant-navigation-open="onAssistantNavigationOpen"
              @assistant-callback-open="emit('assistant-callback-open', $event)"
              @guide-step-open="onGuideStepOpen"
              @guide-suggestion-open="onGuideSuggestionOpen"
              @guide-check-step-select="onGuideCheckStepSelect"
              @gantt-open="onGanttOpen"
              @tts-click="onTtsClick(index)"
              @share-click="onShareClick(index, msg)"
              @select-toggle="onSelectToggle(index)"
              @feedback-change="onFeedbackChange(index, msg, $event)"
              @copy-click="onCopyClick(index, msg)"
            />
            <!-- 核对/步骤卡独立成卡，不放进回答气泡；一轮问答一张，多轮各留一张 -->
            <view
              v-for="block in standaloneBlocks(msg, index)"
              :key="block.id"
              class="chat-box__card"
            >
              <!-- domId 并进消息 id：同一份指导重复触发时 block id 会撞，滚动定位要能区分是哪一轮 -->
              <AiBlockRenderer
                :block="block"
                :dom-id="guideStepCardDomId(msg?.id, block.id)"
                @guide-check-step-select="onGuideCheckStepSelect"
              />
            </view>
            <!-- 调度视图入口卡：同样独立于回答气泡，紧跟在气泡下方 -->
            <view
              v-for="block in ganttBlocks(msg)"
              :key="`gantt-${block.id}`"
              class="chat-box__card chat-box__card--gantt"
            >
              <AiBlockRenderer :block="block" @gantt-open="onGanttOpen" />
            </view>
          </view>
        </view>
      </view>
      <!-- 底部锚点用于流式输出时触发滚动到底部，不额外制造底部间距 -->
      <view id="msg-bottom-anchor-a" style="height: 1px" />
      <view id="msg-bottom-anchor-b" style="height: 1px" />
    </scroll-view>
  </view>
</template>

<style lang="scss" scoped>
.ai-message-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.msg-list {
  flex: 1;
  min-height: 0;
  box-sizing: border-box;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
.msg-list__inner {
  box-sizing: border-box;
}
.chat-box {
  padding: 40rpx 40rpx 0;
}
/* 独立于回答气泡的卡片（核对/步骤卡） */
.chat-box__card {
  margin: 24rpx 0;
}

/* 调度视图入口卡（4708:743）：跟随气泡时上方留 13px，左右 20px 由 .chat-box 的 padding 提供 */
.chat-box__card--gantt {
  margin: 13px 0 0;
}
.business-overview {
  padding: 148rpx 40rpx 0;
}

@keyframes business-overview-skeleton-pulse {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 0.9; }
}

.business-overview__skeleton {
  display: flex;
  flex-direction: column;
}

.business-overview__skeleton-block {
  background: #f2f3f5;
  border-radius: 8rpx;
  animation: business-overview-skeleton-pulse 1.2s ease-in-out infinite;
}

.business-overview__skeleton-title {
  width: 360rpx;
  height: 68rpx;
}

.business-overview__skeleton-summary {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  padding-top: 24rpx;
}

.business-overview__skeleton-line {
  width: 100%;
  height: 32rpx;
}

.business-overview__skeleton-line--short {
  width: 72%;
}

.business-overview__report--skeleton {
  pointer-events: none;
}

.business-overview__skeleton-sound {
  width: 40rpx;
  height: 40rpx;
  flex: 0 0 40rpx;
  border-radius: 20rpx;
}

.business-overview__skeleton-report-info {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 36rpx;
  padding-left: 32rpx;
}

.business-overview__skeleton-report-title {
  width: 150rpx;
  height: 36rpx;
}

.business-overview__skeleton-report-date {
  width: 162rpx;
  height: 36rpx;
}

.business-overview__skeleton-listen {
  width: 134rpx;
  height: 64rpx;
  flex: 0 0 134rpx;
  border-radius: 32rpx;
}

.business-overview__skeleton-questions {
  display: flex;
  flex-direction: column;
  padding-top: 66rpx;
}

.business-overview__skeleton-question-title {
  width: 240rpx;
  height: 36rpx;
  margin-bottom: 16rpx;
}

.business-overview__skeleton-question {
  display: flex;
  height: 100rpx;
  align-items: center;
  border-top: 1px solid #efefef;
}

.business-overview__skeleton-question:last-child {
  border-bottom: 1px solid #efefef;
}

.business-overview__skeleton-question-line {
  width: 72%;
  height: 36rpx;
}

.business-overview__title {
  display: block;
  color: #1a1a1a;
  font-size: 56rpx;
  font-weight: 700;
  line-height: 68rpx;
}

.business-overview__title-name {
  color: #c8201e;
}

.business-overview__summary {
  display: block;
  margin-top: 24rpx;
  color: #6b6b6b;
  font-size: 28rpx;
  line-height: 44rpx;
}

.business-overview__report {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 120rpx;
  margin-top: 48rpx;
  padding: 0 32rpx;
  box-sizing: border-box;
  background: #fff;
  border: 1px solid #efefef;
  border-radius: 32rpx;
  box-shadow: 0 4rpx 16rpx rgb(0 0 0 / 4%);
}

.business-overview__sound {
  display: flex;
  align-items: center;
  gap: 6rpx;
  width: 40rpx;
  height: 40rpx;
  uni-image {
    width: 100%;
    height: 100%;
  }
}

.business-overview__sound-bar {
  display: block;
  width: 4rpx;
  background: #6b6b6b;
  border-radius: 4rpx;
}

.business-overview__sound-bar--short { height: 8rpx; }
.business-overview__sound-bar--middle { height: 20rpx; }
.business-overview__sound-bar--tall { height: 32rpx; }

.business-overview__report-info {
  display: flex;
  align-items: center;
  flex: 1;
  margin-left: 32rpx;
  gap: 36rpx;
}

.business-overview__report-title {
  color: #1a1a1a;
  font-size: 30rpx;
  font-weight: 700;
  line-height: 36rpx;
  white-space: nowrap;
}

.business-overview__report-date {
  color: #6b6b6b;
  font-size: 30rpx;
  line-height: 36rpx;
  white-space: nowrap;
}

.business-overview__listen {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 134rpx;
  height: 64rpx;
  color: #fff;
  font-size: 26rpx;
  font-weight: 700;
  line-height: 32rpx;
  background: #c8201e;
  border-radius: 32rpx;
  transition: background-color 0.2s ease;
}

.business-overview__listen--listened {
  color: #6b6b6b;
  background: #f2f3f5;
}

.business-overview__questions {
  margin-top: 66rpx;
}

.business-overview__questions-title {
  display: block;
  color: #999;
  font-size: 30rpx;
  margin-bottom: 16rpx;
}

.business-overview__question {
  display: flex;
  align-items: center;
  padding: 32rpx 0;
  color: #1a1a1a;
  font-size: 30rpx;
  line-height: 36rpx;
  border-top: 1px solid #efefef;
}

.business-overview__question:last-child {
  border-bottom: 1px solid #efefef;
}

.business-overview__report:active,
.business-overview__question:active {
  opacity: 0.72;
}
</style>
