<script setup lang="ts">
import { useI18n } from "vue-i18n";
import actionBatchDeleteIcon from "@/assets/img/icon-history-action-batch-delete.svg";
import actionDeleteIcon from "@/assets/img/icon-history-action-delete.svg";
import actionEditIcon from "@/assets/img/icon-history-action-edit.svg";
import autoTtsOffIcon from "@/assets/img/icon-tts-auto-off.png";
import autoTtsOffSvgIcon from "@/assets/img/icon-tts-auto-off.svg";
import autoTtsOnIcon from "@/assets/img/icon-tts-auto-on.png";
import listenLogoGif from "@/assets/img/listen.gif";
import minimizeIcon from "@/assets/img/min_icon.png";
import saniLogoSmGif from "@/assets/img/sani-logo-sm.gif";
import tellLogoGif from "@/assets/img/tell.gif";
import thinkLogoGif from "@/assets/img/think.gif";
import AiSettingsSheet from "@/components/ai-settings-sheet/index.vue";
import { useIframeMinimize } from "@/hooks/useIframeMinimize";
import { useSafeArea } from "@/hooks/useSafeArea";
import { useChatStore, useSettingsStore, useSystemStore } from "@/stores";
import { createLogger } from "@/utils/logger";
import { getSessionSceneLabel, isPodcastSession } from "@/utils/session-scene";

/** 历史会话条目：字段与网关 Conversation 对齐，这里只取用到的几个 */
interface SessionItem {
  id?: string | number;
  sessionId?: string | number;
  name?: string;
  inputs?: Record<string, unknown>;
  createdAt?: number;
  updatedAt?: number;
}

defineOptions({ name: "AiChatHeader" });
const props = defineProps({
  sessions: { type: Array, default: () => [] },
  loadSessions: { type: Function, default: undefined },
  selectedSessionId: { type: [String, Number], default: "" },
  generating: { type: Boolean, default: false },
  /** 欢迎首页只显示菜单栏，三角图仍由居中的欢迎层展示。 */
  showIsland: { type: Boolean, default: true },
  duplexStatus: { type: String, default: "" },
  shareMode: { type: Boolean, default: false },
  shareSelectAllDisabled: { type: Boolean, default: false },
  shareAllChecked: { type: Boolean, default: false },
  shareSelectedRoundCount: { type: Number, default: 0 },
  backOnly: { type: Boolean, default: false },
  /**
   * 左侧按钮显示「返回」箭头（emit back），替掉默认的历史对话抽屉按钮。
   * 作业指导、任务协同两种纯净模式下都传 true：左侧返回上一页，右侧仍返回宿主首页。
   * （与 backOnly 的区别：backOnly 连右侧按钮和语音播报开关一起收掉，这里只换左侧。）
   */
  backOnLeft: { type: Boolean, default: false },
  /**
   * 右侧最右那颗按钮点击时 emit close，由页面决定行为
   * （作业指导 / 任务协同 = 调原生 goHome 回宿主首页）。
   * 图标沿用回首页那颗房子（icon-home.svg）。
   */
  closeOnRight: { type: Boolean, default: false },
  /**
   * 左右图标做成白底圆形按钮（任务协同页的设计稿口径）：
   * 88rpx 白圆 + 轻微投影，图标仍是原来的 44~48rpx。
   * 不传时保持原来的裸图标（首页 / 作业指导页不变）。
   */
  roundButtons: { type: Boolean, default: false },
  /**
   * 头部底色透明（首页对话页用）：页面把它做成悬浮层，消息可以滚到头部下面，
   * 由页面顶部的毛玻璃层负责渐隐；其它页面保持原来的实底渐变。
   */
  plainBg: { type: Boolean, default: false },
  /**
   * 长按灵动岛 5 秒回到初始页（首页对话页开）。
   * 默认关：作业指导 / 任务协同也用这个头部，那边的岛保持纯展示、不吃触摸事件。
   */
  restartable: { type: Boolean, default: false },
  /**
   * 录音中（按住说话，或初始页「点击说话」那条语音提问链路）。
   * 只有首页对话页绑定：录音时岛内叠上 sani-logo-sm.gif，其余页面不受影响。
   */
  voiceListening: { type: Boolean, default: false },
  /**
   * 从初始页飞进来的那一段：岛内先继续放 listen.gif（和飞过来的那张图同一张），
   * 让「中间放大 → 顶部落位」是同一张动图在延续，不出现落位后换回三角图的硬切。
   * 由首页在起飞后打开、播完这一段再关掉，其它页面不传。
   */
  listenIdle: { type: Boolean, default: false },
  /**
   * 自动听播（TTS）播放中：首页把 useRealtimeTts 的 playing 透进来。
   * 回答中 → 播报结束这一整段岛内都走 sani-logo-sm.gif，生成结束后由它续上。
   */
  realtimeTtsPlaying: { type: Boolean, default: false },
});
const emit = defineEmits([
  "back",
  "close",
  "clear",
  "new-conversation",
  "session-click",
  "session-delete",
  "session-delete-batch",
  "session-rename",
  "update:sessions",
  "share-select-all",
  "restart",
]);

/**
 * 头部只区分「思考中 / 回答中」两态（Ardot 722:69 浅色思考中 / 722:489 浅色回答中）：
 * - 最后一条 AI 消息还没有 answer 正文 → 思考中：图标放大 + 渐变环自转，文案「正在思考中..」
 * - 一旦出现 answer 正文 → 回答中：图标回落到原尺寸，文案「正在回答中..」
 * 不传 scope，沿 provide 链取页面自己的那份 store（首页 / 智能体页各自独立）。
 */
const chatStore = useChatStore();
const systemStore = useSystemStore();
/**
 * 语音播报总开关（头部回主页按钮左边那颗喇叭）：
 * 只管「回答边出边自动播报」，气泡里手动点的播报按钮不受它影响。
 * 开关本身落在 settings store（本机 storage 持久化），这里只负责渲染与切换。
 */
const settingsStore = useSettingsStore();
const autoTtsEnabled = computed(() => settingsStore.autoTtsEnabled);

function onToggleAutoTts() {
  settingsStore.setAutoTtsEnabled(!autoTtsEnabled.value);
}
/**
 * 深色只有一个作用域：首页对话页的悬浮头部（plainBg）。
 * 作业指导 / 任务协同也复用这个头部，但那些页面还是浅色稿，
 * 跟着外观偏好一起变深会变成「深色头 + 浅色页」，所以这里再限一层 plainBg。
 * 分享选择态是白底文字条，同理先不跟深色走。
 */
const darkPlain = computed(() => props.plainBg && !props.shareMode && systemStore.isDark);
/**
 * 自动播报开关图标：关闭态在深色下换 icon-tts-auto-off.svg（#6B6B6B 线稿 + 斜杠缺口）。
 * 走这张图时不能套头部的统一反相，否则线稿会被整片染白、缺口糊掉，见样式里 tts-switch--off 的 filter: none。
 */
const autoTtsIcon = computed(() => {
  if (autoTtsEnabled.value) return autoTtsOnIcon;
  return darkPlain.value ? autoTtsOffSvgIcon : autoTtsOffIcon;
});
const answering = computed(() => {
  if (!props.generating) return false;
  const list = chatStore.messages;
  const message = list[list.length - 1];
  if (!message || message.role !== "ai") return false;
  return (message.blocks || []).some(
    block => block.type === "answer" && String(block.payload?.content || "").trim().length > 0,
  );
});
/**
 * 思考中 = 生成已开始但还没吐出 answer 正文；一出现正文就转「回答中」，生成结束回到常态。
 */
const thinking = computed(() => props.generating && !answering.value);
/**
 * 播报中 = 已出字进入「回答中」，一直到自动听播（TTS）放完为止。
 * 生成结束后 answering 会落回 false，由 realtimeTtsPlaying 续上，两段相接就是完整的播报期。
 */
const telling = computed(() => answering.value || props.realtimeTtsPlaying);
/** 录音中（按住说话 / 初始页「点击说话」那条语音链路） */
const recording = computed(() => props.voiceListening);
/**
 * 岛内动图按状态分四层，各自作为叠图靠 opacity 交叉溶解（绝不切常态图的 src，换源是硬切）：
 *   空闲            → sani-logo-sm.gif（常驻底层；96×85，与旧常态图 300×267 同比例同裁切）
 *   正在思考        → think.gif
 *   正在回答 / 自动播报 → tell.gif
 *   语音输入（点击说话 → 录音中）→ listen.gif
 * 优先级：语音输入 > 回答/播报 > 思考 > 从初始页飞入那一段，同一时刻只亮一层。
 * 动图不分深浅色：listen.gif / tell.gif 只此一套，透明底，深浅两种头部都直接叠。
 */
// 替代图加载成功后才隐藏常态图；资源缺失或尚未解码时仍保留可见的三角图。
const stateGifLoaded = ref({ listen: false, tell: false, think: false });
const answeringGifOn = computed(() => !recording.value && telling.value && stateGifLoaded.value.tell);
const thinkingGifOn = computed(() => !recording.value && !telling.value && thinking.value && stateGifLoaded.value.think);
/** 从初始页飞入那一段（落位时是同一张图在延续）；有状态时让位给状态图 */
const listeningGifOn = computed(
  () => !telling.value && !recording.value && !thinking.value && props.listenIdle,
);
/** 语音输入层：录音中与飞入段共用同一张 listen.gif */
const listenSayGifOn = computed(() => (recording.value || listeningGifOn.value) && stateGifLoaded.value.listen);
/** 有任意状态图亮着：底层常驻图淡出 */
const islandAnyGifOn = computed(
  () => listenSayGifOn.value || answeringGifOn.value || thinkingGifOn.value,
);

const logger = createLogger("chat-header");
const { t, locale } = useI18n();
const duplexDisplayText = computed(() => {
  const status = props.duplexStatus.trim();
  if (!status) return '';
  return `${status.replace(/(?:\.{3,}|…)+$/, '')}...`;
});
const { safeTopPx, safeAreaStyle } = useSafeArea();
/**
 * 抽屉顶部的「中 / EN」开关已下线（设计稿 309:3088 的位置让给了品牌头像），
 * 现在挂到齿轮弹层的「语言」分段上：只切换本应用可见的文案语言，
 * 不改宿主语言、不落存储、不触发其他业务逻辑。
 */
const isEnglishLocale = computed(() => String(locale.value || "").toLowerCase().startsWith("en"));
/**
 * 设置弹层「语言」分段的双向绑定：get 读全局 locale（宿主注入的 Lang 已生效），
 * set 走 systemStore.setLanguage —— 同时改 i18n 与 header，保证两边一致
 */
const settingsLanguage = computed<"zh_CN" | "en_US">({
  get: () => (isEnglishLocale.value ? "en_US" : "zh_CN"),
  set: (value) => {
    if (String(locale.value) === value) return;
    void systemStore.setLanguage(value);
  },
});
/** 齿轮弹层开关（设计稿 722:2800「设置」） */
const isSettingsSheetOpen = ref(false);

function onOpenSettingsSheet() {
  // 设置接管遮罩前先关闭历史抽屉，避免关闭设置后还残留上一层遮罩。
  closeDrawer();
  isSettingsSheetOpen.value = true;
}
/** PC 端内嵌时头部露出「最小化」，替换原来的「回到首页」图标 */
const { canMinimize, onMinimize } = useIframeMinimize();
const historyPopup = ref();
const sessionPaging = ref();
const historyLoading = ref(false);
const historySearchKeyword = ref("");
const showActionMenu = ref(false);
const actionSession = ref(null);
const editingMode = ref(false);
const selectedIds = ref([]);
/** 设计稿 309:3165：删除 / 批量删除的二次确认弹窗状态（target 为单条，ids 为批量快照） */
const deleteConfirmVisible = ref(false);
const deleteConfirmTarget = ref<SessionItem | null>(null);
const deleteConfirmIds = ref<Array<string | number>>([]);
const actionMenuTop = ref(220);
const renamingId = ref("");
const renameValue = ref("");
const ignoreNextLongPressReleaseTap = ref(false);
const isSessionListScrolling = ref(false);
let sessionScrollIdleTimer;
let historyReloadTimer;

const sessionList = computed({
  get: () => (props.sessions || []).filter(session => !isPodcastSession(session)),
  set: sessions => emit("update:sessions", sessions),
});
const actionMenuStyle = computed(() => ({ top: `${actionMenuTop.value}px` }));
const filteredSessionList = computed(() => {
  const keyword = historySearchKeyword.value.trim().toLowerCase();
  if (!keyword) return sessionList.value;
  return sessionList.value.filter(session => String(session?.name || "").toLowerCase().includes(keyword));
});

/**
 * 历史会话按时间分组：今天 / 昨天 / 7 天内 / 30 天内 / 更早按月份。
 * 时间取 updatedAt，缺失时退回 createdAt；接口给的是秒级时间戳。
 */
function readSessionTime(session: SessionItem) {
  const raw = Number(session?.updatedAt || session?.createdAt || 0);
  if (!raw) return 0;
  return raw < 1e12 ? raw * 1000 : raw;
}

function startOfDay(date: Date | number) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

function resolveSessionGroup(time: number, todayStart: number) {
  if (!time) return { key: "unknown", title: "", labelKey: "history-group-earlier", order: 900 };
  const dayDiff = Math.floor((todayStart - startOfDay(new Date(time))) / 86400000);
  if (dayDiff <= 0) return { key: "today", title: "", labelKey: "history-group-today", order: 0 };
  if (dayDiff === 1) return { key: "yesterday", title: "", labelKey: "history-group-yesterday", order: 1 };
  if (dayDiff < 7) return { key: "week", title: "", labelKey: "history-group-week", order: 2 };
  if (dayDiff < 30) return { key: "month", title: "", labelKey: "history-group-month", order: 3 };
  const date = new Date(time);
  const label = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  // 月份分组按时间倒序排在固定分组之后
  return { key: `m-${label}`, title: label, labelKey: "", order: 1000 - (date.getFullYear() * 12 + date.getMonth()) };
}

const groupedSessionList = computed(() => {
  const todayStart = startOfDay(new Date());
  const groups = new Map();
  filteredSessionList.value.forEach((session) => {
    const group = resolveSessionGroup(readSessionTime(session), todayStart);
    if (!groups.has(group.key)) {
      // 分组标题只做展示层翻译，标题文案不参与筛选 / 排序逻辑
      groups.set(group.key, {
        key: group.key,
        title: group.labelKey ? t(group.labelKey) : group.title,
        order: group.order,
        sessions: [],
      });
    }
    groups.get(group.key).sessions.push(session);
  });
  return [...groups.values()].sort((a, b) => a.order - b.order);
});

const statusbarStyle = computed(() => ({
  height: `${safeTopPx.value}px`,
}));

const historyDrawerStyle = computed(() => ({
  paddingTop: `calc(${safeTopPx.value}px + 32rpx)`,
}));

function getSessionKey(session: SessionItem) {
  return session?.id || "";
}

function onBackTap() {
  emit("back");
}
/** 右上角「关闭当前小程序」：把关闭动作交给页面（页面负责 popWindow / 兜底返回） */
function onCloseTap() {
  emit("close");
}
function onShareSelectAllTap() {
  if (!props.shareSelectAllDisabled) emit("share-select-all");
}
function openHistoryDrawer() {
  historyLoading.value = true;
  historyPopup.value?.open?.("left");
  clearTimeout(historyReloadTimer);
  historyReloadTimer = setTimeout(() => {
    sessionPaging.value?.reload?.();
  }, 300);
}
async function onSessionQuery(pageNo: number, pageSize: number) {
  try {
    const result = await props.loadSessions?.(pageNo, pageSize);
    sessionPaging.value?.completeByNoMore?.(result?.data || [], !result?.hasMore);
  } catch (error) {
    logger.error("load sessions failed", error);
    sessionPaging.value?.complete?.(false);
  } finally {
    historyLoading.value = false;
  }
}
function closeDrawer() {
  clearTimeout(historyReloadTimer);
  closeActionMenu();
  historyPopup.value?.close?.("left");
}
function resetDrawerState() {
  closeActionMenu();
  editingMode.value = false;
  selectedIds.value = [];
  renamingId.value = "";
  renameValue.value = "";
  actionSession.value = null;
}
function onNewConversationTap() {
  resetDrawerState();
  emit("new-conversation");
  closeDrawer();
}

function closeActionMenu() {
  showActionMenu.value = false;
  actionSession.value = null;
  ignoreNextLongPressReleaseTap.value = false;
}

function onSessionListScroll() {
  isSessionListScrolling.value = true;
  closeActionMenu();
  if (sessionScrollIdleTimer) clearTimeout(sessionScrollIdleTimer);
  sessionScrollIdleTimer = setTimeout(() => {
    isSessionListScrolling.value = false;
  }, 120);
}

function onSessionLongPress(session: SessionItem, event: any) {
  if (isSessionListScrolling.value || editingMode.value) return;
  if (renamingId.value) commitRename();
  actionSession.value = session || null;
  ignoreNextLongPressReleaseTap.value = true;
  const point = event?.changedTouches?.[0] || event?.touches?.[0] || event?.detail || {};
  const y = Number(point.clientY || point.pageY || event?.clientY || 220);
  let top = y + 18;
  try {
    const info = uni.getSystemInfoSync();
    const windowHeight = info?.windowHeight || 667;
    const menuHeight = 137;
    const minTop = 88;
    if (top + menuHeight > windowHeight - 20) top = y - menuHeight - 18;
    top = Math.max(minTop, Math.min(top, windowHeight - menuHeight - 20));
  } catch {
    top = Math.max(88, top);
  }
  actionMenuTop.value = top;
  showActionMenu.value = true;
}

function consumeLongPressReleaseTap() {
  if (!ignoreNextLongPressReleaseTap.value) return false;
  ignoreNextLongPressReleaseTap.value = false;
  return true;
}

function onActionMenuMaskTap() {
  if (consumeLongPressReleaseTap()) return;
  closeActionMenu();
}

function onDrawerTap() {
  if (showActionMenu.value) {
    onActionMenuMaskTap();
    return;
  }
  if (renamingId.value) commitRename();
}

function onHistoryPopupChange(event) {
  if (!event?.show) closeActionMenu();
}

function onRenameTap() {}

function onSessionTap(session: SessionItem) {
  if (consumeLongPressReleaseTap()) return;
  if (editingMode.value) {
    const id = getSessionKey(session);
    if (!id) return;
    selectedIds.value = selectedIds.value.includes(id)
      ? selectedIds.value.filter(item => item !== id)
      : [...selectedIds.value, id];
    return;
  }
  if (showActionMenu.value || renamingId.value) return;
  emit("session-click", session);
  closeDrawer();
}
function isSelected(id: string | number) {
  return selectedIds.value.includes(id);
}
/** 设计稿 309:3165：先弹确认框，确认后再执行原有的删除 emit */
function openDeleteConfirm(session: SessionItem | null, ids: Array<string | number> = []) {
  deleteConfirmTarget.value = session;
  deleteConfirmIds.value = ids;
  deleteConfirmVisible.value = true;
}
function cancelDeleteConfirm() {
  deleteConfirmVisible.value = false;
  deleteConfirmTarget.value = null;
  deleteConfirmIds.value = [];
}
function confirmDelete() {
  const session = deleteConfirmTarget.value;
  const ids = [...deleteConfirmIds.value];
  cancelDeleteConfirm();
  if (session && getSessionKey(session)) {
    emit("session-delete", session);
    return;
  }
  if (!ids.length) return;
  emit("session-delete-batch", ids);
  cancelMultiSelect();
}
function deleteOne() {
  const session = actionSession.value;
  closeActionMenu();
  if (session && getSessionKey(session)) openDeleteConfirm(session);
}
function renameOne() {
  const session = actionSession.value;
  closeActionMenu();
  const id = getSessionKey(session);
  if (!session || !id) return;
  renamingId.value = id;
  renameValue.value = session.name || "";
}

function onRenameInput(event: { detail: { value: string } }) {
  renameValue.value = String(event?.detail?.value || "");
}

function commitRename() {
  const id = renamingId.value;
  if (!id) return;
  const target = props.sessions.find(session => getSessionKey(session) === id);
  const name = renameValue.value.trim();
  if (target && name && name !== (target.name || ""))
    emit("session-rename", { ...target, name });

  renamingId.value = "";
  renameValue.value = "";
}

function onRenameBlur() {}

function enterMultiSelect() {
  closeActionMenu();
  if (renamingId.value) commitRename();
  editingMode.value = true;
  selectedIds.value = [];
}
function cancelMultiSelect() {
  editingMode.value = false;
  selectedIds.value = [];
}
function deleteSelected() {
  if (selectedIds.value.length) {
    openDeleteConfirm(null, [...selectedIds.value]);
    return;
  }
  cancelMultiSelect();
}

/**
 * 长按灵动岛回到初始页（只有首页对话页开 restartable 时生效）。
 * 5 秒本身已经是「明显有意为之」的时长，但首页这块岛压在消息列表上方，
 * 上下滑列表、惯性滚动时手指很容易停在岛附近 —— 所以再叠四层防误触：
 * 1) 起手静置 300ms 才起算：轻点、擦碰连进度环都不会亮，也不会白等 5 秒；
 * 2) 位移按直线距离判定（≤12px）：原来逐轴判断，斜向要走到 12√2≈17px 才算滑动，
 *    斜着拖列表会误触发，改成欧氏距离后各方向一致；
 * 3) 按住期间只要页面 / 列表发生滚动就取消：惯性滚动时手指几乎不动，
 *    光靠位移阈值挡不住，这是最容易误触的场景；
 * 4) 多指按下（第二根手指 / 手掌）、切后台、窗口失焦：一律取消。
 * 触发后立刻复位视觉与监听，避免同一次按压被重复触发。
 */
const ISLAND_LONG_PRESS_MS = 5000;
/** 判定为滑动的手指位移（px）：与首页整页长按录音的阈值保持一致 */
const ISLAND_MOVE_TOLERANCE_PX = 12;
/** 起手静置时长（ms）：短于此值的按压视作轻点 / 擦碰，不点亮进度环也不计时 */
const ISLAND_PRESS_ARM_MS = 300;
let islandPressTimer: ReturnType<typeof setTimeout> | null = null;
/** 起手静置计时器：还没起算时只有它在跑，页面不会出现进度环 */
let islandArmTimer: ReturnType<typeof setTimeout> | null = null;
let islandPressOrigin = { x: 0, y: 0 };
/** 已起算：驱动那圈 5 秒走满的进度环，取消 / 计时结束都会复位 */
const islandPressing = ref(false);

/** 任意滚动（含 scroll-view 内部滚动）：capture 阶段兜住，直接取消长按 */
function onIslandScrollGuard() {
  if (islandArmTimer || islandPressTimer) clearIslandPressTimer();
}

/** 切后台 / 熄屏：回来时不该还停在一半的进度环上 */
function onIslandVisibilityGuard() {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    clearIslandPressTimer();
  }
}

function attachIslandGuards() {
  if (typeof window === "undefined") return;
  // scroll 不冒泡，但捕获阶段会经过 window，能兜住页面与列表容器的滚动
  window.addEventListener("scroll", onIslandScrollGuard, true);
  window.addEventListener("blur", clearIslandPressTimer);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onIslandVisibilityGuard);
  }
}

function detachIslandGuards() {
  if (typeof window === "undefined") return;
  window.removeEventListener("scroll", onIslandScrollGuard, true);
  window.removeEventListener("blur", clearIslandPressTimer);
  if (typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", onIslandVisibilityGuard);
  }
}

function clearIslandPressTimer() {
  islandPressing.value = false;
  if (islandArmTimer) {
    clearTimeout(islandArmTimer);
    islandArmTimer = null;
  }
  if (islandPressTimer) {
    clearTimeout(islandPressTimer);
    islandPressTimer = null;
  }
  detachIslandGuards();
}

function readPressPoint(e: any) {
  const point = e?.touches?.[0] || e?.changedTouches?.[0] || e;
  return { x: Number(point?.clientX ?? 0), y: Number(point?.clientY ?? 0) };
}

/** 走满 5 秒：先复位环与监听再回传，避免这一次按压还能被 touchend 再取消一次 */
function finishIslandPress() {
  islandPressTimer = null;
  islandPressing.value = false;
  detachIslandGuards();
  emit("restart");
}

function onIslandPressStart(e: any) {
  if (!props.restartable) return;
  // 录音中岛内已经不是常态图，这会儿按下去大概率是想结束说话，不接管
  if (props.voiceListening) return;
  // 多指 / 手掌误碰直接忽略
  if (Array.isArray(e?.touches) && e.touches.length > 1) return;
  islandPressOrigin = readPressPoint(e);
  // 先归零上一轮（同时摘下上一轮的监听），再进入静置阶段
  clearIslandPressTimer();
  attachIslandGuards();
  islandArmTimer = setTimeout(() => {
    islandArmTimer = null;
    // 进度环与 5 秒计时同时起步，环走满时刚好触发
    islandPressing.value = true;
    islandPressTimer = setTimeout(finishIslandPress, ISLAND_LONG_PRESS_MS);
  }, ISLAND_PRESS_ARM_MS);
}

/** 位移超阈值 / 多指：一律当滑动或误碰处理，取消长按 */
function onIslandPressMove(e: any) {
  if (!islandArmTimer && !islandPressTimer) return;
  if (Array.isArray(e?.touches) && e.touches.length > 1) {
    clearIslandPressTimer();
    return;
  }
  const point = readPressPoint(e);
  const offsetX = point.x - islandPressOrigin.x;
  const offsetY = point.y - islandPressOrigin.y;
  // 斜向 12px 也要挡住：用直线距离而不是逐轴比较
  if (Math.hypot(offsetX, offsetY) > ISLAND_MOVE_TOLERANCE_PX) {
    clearIslandPressTimer();
  }
}

onBeforeUnmount(() => {
  clearTimeout(sessionScrollIdleTimer);
  clearTimeout(historyReloadTimer);
  clearIslandPressTimer();
});
</script>

<template>
  <!-- 分享选择态是「文字 + 勾选」条，保留原来的实底渐隐，避免文字压在滚动内容上看不清 -->
  <view
    class="ai-chat-header"
    :style="safeAreaStyle"
    :class="{
      'ai-chat-header--plain': plainBg && !shareMode,
      'ai-chat-header--dark': darkPlain,
      'ai-chat-header--duplex': showIsland && !shareMode && duplexStatus,
      'ai-chat-header--round': roundButtons && !shareMode,
    }"
  >
    <view class="chat-header">
      <!-- 状态栏占位：动态读取真实机型状态栏高度 -->
      <view class="chat-header__statusbar" :style="statusbarStyle" />

      <!-- 头部（设计稿 722:69：50px 高、左右 20px、图标 24×24 垂直居中）；灵动岛是浮层，不参与这一行的布局 -->
      <view class="chat-header__bar">
        <template v-if="!shareMode">
          <view v-if="props.backOnly || props.backOnLeft" class="chat-header__icon-btn" @tap="onBackTap">
            <image
              src="@/assets/img/voice-assistant/voice-back.svg"
              mode="aspectFit"
              class="chat-header__icon-back-img"
            />
          </view>

          <view v-else class="chat-header__icon-btn" @tap="openHistoryDrawer">
            <view class="chat-header__icon-history">
              <image
                src="@/assets/img/icon-list.svg"
                mode="aspectFit"
                class="chat-header__icon-history-img"
              />
            </view>
          </view>

          <!-- 顶部中间「灵动岛」+ 下方状态胶囊
               Ardot 722:69（浅色思考中）/ 722:489（浅色回答中）：胶囊只在生成中出现
               未生成时只留圆形灵动岛，胶囊整体不渲染 -->
          <view v-if="showIsland" class="chat-header__island-wrap">
            <view
              class="chat-header__island"
              :class="{ 'chat-header__island--thinking': thinking }"
            >
              <!-- 圆形玻璃底盘（.chat-header__island-glass）与 1px 白描边已按需求去掉，
                   容器只作为呼吸动画的载体 + 图标的定位基准，本身不再有任何可见形状 -->
              <!-- 长按进度环：按住才出现，5s 走满一圈；松手 / 滑动 / 计时结束都会卸载，
                   卸载即复位，下次按住重新从 0 开始 -->
              <view
                v-if="props.restartable && islandPressing"
                class="chat-header__press-ring"
              >
                <svg class="chat-header__press-ring-svg" viewBox="0 0 72 72">
                  <circle class="chat-header__press-ring-track" cx="36" cy="36" r="34" />
                  <circle class="chat-header__press-ring-arc" cx="36" cy="36" r="34" />
                </svg>
              </view>
              <!-- 岛内三角图标：动态 GIF（原 header-island-logo.png 的动画版），空闲 sani-logo-sm.gif；
                   空闲 sm / 思考 think / 回答·播报 tell 主题图 / 录音 tell 四层同位置叠图 淡入，
                   不做 src / mode 切换，位置一律不动 -->
              <!-- 长按 5 秒回到初始页：只有 restartable（首页对话页）碰触摸事件，
                   其它页面的岛保持纯展示、不抢触摸；热区就是三角图本身（62×62） -->
              <!-- 空闲态动图：有状态图亮起时只淡出、不卸载，长按热区与定位基准始终挂在它身上。
                   这是 sani-logo-sm.gif，绝不在这里换 src —— 换源是硬切，没有过渡；
                   状态图各自作为上层叠图淡入淡出，切换才是柔和交叉溶解 -->
              <image
                class="chat-header__island-logo"
                :class="{
                  'chat-header__island-logo--restartable': props.restartable,
                  'chat-header__island-logo--faded': islandAnyGifOn,
                }"
                :src="saniLogoSmGif"
                mode="aspectFit"
                @touchstart="onIslandPressStart"
                @touchmove="onIslandPressMove"
                @touchend="clearIslandPressTimer"
                @touchcancel="clearIslandPressTimer"
                @mousedown="onIslandPressStart"
                @mousemove="onIslandPressMove"
                @mouseup="clearIslandPressTimer"
                @mouseleave="clearIslandPressTimer"
              />
              <!-- 语音输入整段（点击说话起飞 → 录音中 → 松手结束）：listen.gif，
                   3840×3840 透明画布（三角约占中间 40%），深浅色共用一套，直接叠在头部上；
                   纯展示层，不吃触摸，避免抢走长按回首页的手势 -->
              <image
                class="chat-header__island-logo chat-header__island-logo--listen-say"
                :class="{ 'chat-header__island-logo--listen-say-on': listenSayGifOn }"
                :src="listenLogoGif"
                mode="aspectFit"
                @load="stateGifLoaded.listen = true"
                @error="stateGifLoaded.listen = false"
              />
              <!-- 回答中 / 语音播报：tell.gif（同规格透明画布，图形居中，深浅色共用） -->
              <image
                class="chat-header__island-logo chat-header__island-logo--tell-play"
                :class="{ 'chat-header__island-logo--tell-play-on': answeringGifOn }"
                :src="tellLogoGif"
                mode="aspectFit"
                @load="stateGifLoaded.tell = true"
                @error="stateGifLoaded.tell = false"
              />
              <!-- think.gif：正在思考（768×384 画布，留白用 aspectFill 裁掉，换算见 --think 注释） -->
              <image
                class="chat-header__island-logo chat-header__island-logo--think"
                :class="{ 'chat-header__island-logo--think-on': thinkingGifOn }"
                :src="thinkLogoGif"
                mode="aspectFill"
                @load="stateGifLoaded.think = true"
                @error="stateGifLoaded.think = false"
              />
            </view>
            <view v-if="duplexDisplayText" class="chat-header__duplex-status" role="status">
              <view class="chat-header__duplex-lines">
                <view class="chat-header__duplex-text">{{ duplexDisplayText }}</view>
              </view>
            </view>
          </view>

          <!-- 右侧按钮组：语音播报总开关 + 回主页。必须成组，否则 bar 的 space-between
               会把这个新增按钮甩到正中间（灵动岛下面）去 -->
          <view class="chat-header__right">
            <!-- 语音播报总开关：紧挨在「回主页」左边。开 = 自动播报回答，关 = 不自动播报；
                 只掐自动这条链路，气泡里手动点的播报按钮照常可用 -->
            <view
              v-if="!props.backOnly"
              class="chat-header__icon-btn chat-header__tts-switch"
              @tap="onToggleAutoTts"
            >
              <image :src="autoTtsIcon" mode="aspectFit" class="chat-header__icon-tts-img" />
            </view>

            <!-- 返回主页（任务协同 / 作业指导页固定走这一颗）：点击 emit close，
                 页面里调原生 goHome 回宿主首页。图标沿用 house（icon-home.svg） -->
            <view v-if="props.closeOnRight" class="chat-header__icon-btn" @tap="onCloseTap">
              <view class="chat-header__icon-atlas">
                <image
                  src="@/assets/img/icon-home.svg"
                  mode="aspectFit"
                  class="chat-header__icon-atlas-img"
                />
              </view>
            </view>
            <view v-else-if="canMinimize" class="chat-header__icon-btn" @tap="onMinimize">
              <image
                :src="minimizeIcon"
                mode="aspectFit"
                class="chat-header__icon-minimize-img"
              />
            </view>
            <view v-else-if="!props.backOnly" class="chat-header__icon-btn" @tap="onBackTap">
              <view class="chat-header__icon-atlas">
                <image
                  src="@/assets/img/icon-home.svg"
                  mode="aspectFit"
                  class="chat-header__icon-atlas-img"
                />
              </view>
            </view>
            <view v-else class="chat-header__icon-spacer" />
          </view>
        </template>

        <template v-else>
          <!-- Figma 41139:396：左侧 Check All（checkbox + 文案），右侧已选轮次提示 -->
          <view
            class="chat-header__check-all"
            :class="{
              'chat-header__check-all--disabled': shareSelectAllDisabled,
            }"
            @tap="onShareSelectAllTap"
          >
            <image
              v-if="shareSelectAllDisabled"
              class="chat-header__check-icon"
              src="@/assets/img/icon-checkDisabled.svg"
              mode="aspectFit"
            />
            <image
              v-else-if="shareAllChecked"
              class="chat-header__check-icon"
              src="@/assets/img/icon-checked.svg"
              mode="aspectFit"
            />
            <image
              v-else
              class="chat-header__check-icon"
              src="@/assets/img/icon-check.svg"
              mode="aspectFit"
            />
            <text class="chat-header__check-all-text">
              {{ t("share-select-all") }}
            </text>
          </view>

          <view class="chat-header__share-title-wrap">
            <text class="chat-header__share-title">
              {{ t("share-selected-rounds", { count: shareSelectedRoundCount }) }}
            </text>
          </view>
        </template>
      </view>

      <!-- Left drawer (40834-437) -->
      <uni-popup
        ref="historyPopup"
        type="left"
        :animation="true"
        :background-color="darkPlain ? '#0D0D0D' : '#ffffff'"
        :mask-background-color="darkPlain ? 'rgba(13, 13, 13, 0.4)' : 'rgba(0, 0, 0, 0.4)'"
        :safe-area="false"
        :is-mask-click="true"
        @change="onHistoryPopupChange"
      >
        <view
          class="history-drawer"
          :class="{ 'history-drawer--batch-delete': editingMode }"
          :style="historyDrawerStyle"
          @tap="onDrawerTap"
        >
          <!-- 设计稿 309:3052 顶部：左侧头像 44×44（x22~66），右侧搜索框 224×44（x80~304），间距 14 -->
          <view class="history-drawer__toolbar">
            <image
              class="history-drawer__avatar"
              src="@/assets/img/header-island-logo.png"
              mode="aspectFit"
            />
            <view class="history-drawer__search">
              <image src="@/assets/img/icon-history-search.svg" mode="aspectFit" class="history-drawer__search-icon" />
              <input
                v-model="historySearchKeyword"
                class="history-drawer__search-input"
                :placeholder="t('history-search-placeholder')"
                :maxlength="80"
              >
            </view>
          </view>
          <view class="history-drawer__session-history">
            <text class="history-drawer__session-history-label">
              {{ t("history-title") }}
            </text>
          </view>
          <z-paging
            ref="sessionPaging"
            v-model="sessionList"
            class="history-drawer__list-wrap"
            :auto="false"
            :fixed="false"
            :use-page-scroll="false"
            :default-page-size="20"
            :refresher-enabled="false"
            :loading-more-enabled="true"
            :show-loading-more-no-more-view="false"
            :empty-view-text="t('history-empty-session')"
            @query="onSessionQuery"
            @scroll="onSessionListScroll"
          >
            <view v-if="historyLoading" class="history-drawer__loading" :aria-label="t('history-loading')">
              <view class="history-drawer__loading-spinner" />
              <text class="history-drawer__loading-text">
                {{ t("history-loading") }}
              </text>
            </view>
            <view v-else class="history-drawer__list">
              <view
                v-for="group in groupedSessionList"
                :key="group.key"
                class="history-drawer__group"
              >
                <view class="history-drawer__group-title">
                  <text class="history-drawer__group-title-text">
                    {{ group.title }}
                  </text>
                </view>
                <view
                  v-for="session in group.sessions"
                  :key="getSessionKey(session)"
                  class="history-drawer__row"
                  :class="{ 'history-drawer__row--editing': editingMode }"
                  @longpress.stop="onSessionLongPress(session, $event)"
                  @tap.stop="onSessionTap(session)"
                >
                  <input
                    v-if="renamingId === getSessionKey(session)"
                    class="history-drawer__rename-input"
                    :value="renameValue"
                    :focus="true"
                    :maxlength="80"
                    confirm-type="send"
                    @tap.stop="onRenameTap"
                    @input="onRenameInput"
                    @confirm="commitRename"
                    @blur="onRenameBlur"
                  >
                  <view
                    v-else
                    class="history-drawer_item"
                    :class="{
                      'history-drawer_item_current':
                        !editingMode && String(getSessionKey(session)) === String(selectedSessionId),
                      'history-drawer_item_active': editingMode && isSelected(getSessionKey(session)),
                    }"
                  >
                    <text class="history-drawer_item-label">
                      {{ session.name || t("history-untitled") }}
                    </text>
                    <text class="history-drawer_item-tag">
                      {{ getSessionSceneLabel(session) }}
                    </text>
                  </view>
                  <view v-if="editingMode" class="history-drawer__check">
                    <!-- 批量删除勾选框：历史列表内用 #0D0D0D 黑底，避免与分享态红色图标互相影响 -->
                    <image
                      v-if="isSelected(getSessionKey(session))"
                      src="@/assets/img/icon-checked-dark.svg"
                      alt=""
                      class="history-drawer__check-img"
                    />
                    <image
                      v-else
                      src="@/assets/img/icon-check.svg"
                      alt=""
                      class="history-drawer__check-img"
                    />
                  </view>
                </view>
              </view>
            </view>
            <template #empty>
              <view class="history-drawer__empty">
                <text class="history-drawer__empty-text">
                  {{ t("history-empty") }}
                </text>
              </view>
            </template>
          </z-paging>

          <!-- 设计稿 309:3052 底部一行：左「新建对话」136×44（x18~154），右齿轮 32×32（x265~297） -->
          <view class="history-drawer__footer">
            <view class="history-drawer__new-conversation">
              <view class="history-drawer__new-conversation-item" @tap.stop="onNewConversationTap">
                <image
                  src="@/assets/img/icon-new-conversation.svg"
                  mode="aspectFit"
                  class="history-drawer__new-conversation-item-icon"
                />
                <text class="history-drawer__new-conversation-item-label">
                  {{ t("history-new-conversation") }}
                </text>
              </view>
            </view>
            <!-- 设计稿 722:2798 齿轮：点开设置弹层（722:2800），语言切换就在里面 -->
            <image
              class="history-drawer__settings"
              src="@/assets/img/icon-history-settings.svg"
              mode="aspectFit"
              @tap.stop="onOpenSettingsSheet"
            />
          </view>

          <view v-if="editingMode" class="history-drawer__multi-footer">
            <view class="history-drawer__multi-btn" @tap="cancelMultiSelect">
              <text class="history-drawer__multi-btn-text">
                {{ t("cancel") }}
              </text>
            </view>
            <view
              class="history-drawer__multi-btn history-drawer__multi-btn--danger"
              @tap="deleteSelected"
            >
              <text class="history-drawer__multi-btn-text history-drawer__multi-btn-text--danger">
                {{ t("history-delete-count", { count: selectedIds.length }) }}
              </text>
            </view>
          </view>
          <view v-if="showActionMenu" class="history-action-menu-mask" @tap.stop="onActionMenuMaskTap" />
          <view v-if="showActionMenu" class="history-action-menu" :style="actionMenuStyle" @tap.stop>
            <view class="history-action-menu__item" @tap="deleteOne">
              <view class="history-action-menu__icon-delete">
                <image
                  :src="actionDeleteIcon"
                  mode="aspectFit"
                  class="history-action-menu__icon-img"
                />
              </view>
              <text class="history-action-menu__text history-action-menu__text--danger">
                {{ t("history-delete") }}
              </text>
            </view>
            <view class="history-action-menu__item" @tap="renameOne">
              <view class="history-action-menu__icon-rename">
                <image
                  :src="actionEditIcon"
                  mode="aspectFit"
                  class="history-action-menu__icon-img"
                />
              </view>
              <text class="history-action-menu__text">
                {{ t("history-rename") }}
              </text>
            </view>
            <view class="history-action-menu__item" @tap="enterMultiSelect">
              <view class="history-action-menu__icon-multiple">
                <image
                  :src="actionBatchDeleteIcon"
                  mode="aspectFit"
                  class="history-action-menu__icon-img"
                />
              </view>
              <text class="history-action-menu__text">
                {{ t("history-batch-delete") }}
              </text>
            </view>
          </view>
        </view>
      </uni-popup>

      <!-- 设计稿 309:3165 弹窗确认：历史会话删除 / 批量删除的二次确认 -->
      <view v-if="deleteConfirmVisible" class="history-delete-confirm" @tap.stop="cancelDeleteConfirm">
        <view class="history-delete-confirm__card" @tap.stop>
          <text class="history-delete-confirm__title">
            {{ t("history-delete-confirm-title") }}
          </text>
          <text class="history-delete-confirm__desc">
            {{ t("history-delete-confirm-desc") }}
          </text>
          <view class="history-delete-confirm__actions">
            <view
              class="history-delete-confirm__btn history-delete-confirm__btn--ghost"
              @tap.stop="cancelDeleteConfirm"
            >
              <text class="history-delete-confirm__btn-text history-delete-confirm__btn-text--ghost">
                {{ t("cancel") }}
              </text>
            </view>
            <view class="history-delete-confirm__btn" @tap.stop="confirmDelete">
              <text class="history-delete-confirm__btn-text">
                {{ t("confirm") }}
              </text>
            </view>
          </view>
        </view>
      </view>

      <!-- 设计稿 722:2800「设置」：历史抽屉底部齿轮点开的弹层，语言切换在这里 -->
      <AiSettingsSheet
        v-model:visible="isSettingsSheetOpen"
        v-model:language="settingsLanguage"
        :dark="darkPlain"
      />
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ai-chat-header {
  position: relative;
  flex: 0 0 auto;
  /* z-index 会创建层叠上下文：历史抽屉写在内部的 1000 只是这个上下文里的排序，
     真正与外层比较的是这里的值。底部 slot 抽屉是页面级 1002，
     所以这里必须高于它，历史抽屉才能盖住（附件弹窗 1020 仍在其上） */
  z-index: 1010;
  // 顶部由实色自上而下渐隐到全透明：内容滚到头部下方时柔和淡出，不再是硬边切断
  background: linear-gradient(
    180deg,
    #fafafa 0%,
    rgba(250, 250, 250, 0.92) 45%,
    rgba(250, 250, 250, 0) 100%
  );
  // 设计稿头部无投影：不加 box-shadow，底部靠渐变自然淡出
}

/* 悬浮头部：实色背景覆盖状态栏和完整岛图标，外围由页面的毛玻璃层渐隐。 */
.ai-chat-header--plain {
  // 页面给头部固定了 200rpx，但岛图标位于「状态栏 + 160rpx」内。
  // iOS 安全区较高时图标会伸出实色背景；最小高度必须包含同一份安全区。
  min-height: calc(var(--safe-top-px, 0px) + 160rpx);
  min-height: calc(max(var(--safe-top-px, 0px), env(safe-area-inset-top, 0px)) + 160rpx);
  background: #fafafa;
}

.ai-chat-header--duplex {
  min-height: calc(var(--safe-top-px, 0px) + 252rpx);
  min-height: calc(max(var(--safe-top-px, 0px), env(safe-area-inset-top, 0px)) + 252rpx);
}

/* ===== 深色主题：首页问答态头部（Ardot 1193:2097 → 1193:2129 Component 2） =====
   渐隐底色 722:341 换成页面底 #0D0D0D；左右图标 722:342 / 722:345 在深色稿里是白线，
   svg / 位图统一 filter 反白：不新增资源，也不影响浅色稿（浅色下不加这个类） */
.ai-chat-header--plain.ai-chat-header--dark {
  // background: linear-gradient(
  //   180deg,
  //   #0d0d0d 0%,
  //   rgba(13, 13, 13, 0.92) 10%,
  //   rgba(13, 13, 13, 0) 100%
  // );
  background: #0d0d0d;

  .chat-header__icon-history-img,
  .chat-header__icon-atlas-img,
  .chat-header__icon-back-img,
  .chat-header__icon-tts-img {
    filter: brightness(0) invert(1);
  }

  // 自动播报「关闭态」深色下走 icon-tts-auto-off.svg（#6B6B6B 线稿 + 斜杠缺口），
  // 套反相会被整片染白、缺口糊掉，所以这一种情况免掉反相
  .chat-header__tts-switch--off .chat-header__icon-tts-img {
    filter: none;
  }
}

:deep(.uni-popup) {
  z-index: 1000 !important;
}

:deep(.uni-popup__wrapper.left) {
  width: 644rpx !important;
  max-width: 86vw;
  height: 100vh;
  box-sizing: border-box;
  overflow: hidden;
}

.chat-header {
  position: sticky;
  top: 0;
  z-index: 10;
}

.chat-header__statusbar {
  // 内嵌 APP 的 webview 里 uni 拿不到 statusBarHeight（H5 恒为 0），
  // 刘海高度只能靠 CSS 环境变量兜底，两者取大的那个
  min-height: constant(safe-area-inset-top);
  min-height: env(safe-area-inset-top);
}

/* ===== 头git 部行：设计稿 722:69 头部 50px 高、左右 20px、图标 24×24 垂直居中 =====
   行高 50px（100rpx）已含竖向余量，所以只留左右 20px（40rpx）内边距，
   竖向由 align-items: center 居中，不再用 padding 上下凑位置 */
.chat-header__bar {
  position: relative; // 灵动岛以这一行为定位基准做浮动
  height: 100rpx; // 50px
  display: flex;
  align-items: center;
  padding: 0 40rpx; // 左右各 20px；上下的 (50-24)/2=13px 由 align-items 居中承担
  box-sizing: border-box;
  gap: 12rpx; // 6px
  justify-content: space-between;
}

.chat-header__icon-btn {
  width: 48rpx;
  height: 48rpx;
  display: flex;
  align-items: center;
  justify-content: center;

  &:active {
    opacity: 0.75;
  }
}

/* 右侧按钮组（语音播报总开关 + 回主页）：成组后才不会把新增按钮挤到 bar 中间 */
.chat-header__right {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 12rpx; // 6px，与 bar 的 gap 一致
}

/* 三个助手共用 44×44 的点击热区和间距；图标不铺圆形背景。 */
.ai-chat-header--round {
  .chat-header__bar {
    gap: 20rpx; // 10px：圆与圆之间比裸图标（6px）略宽
  }

  .chat-header__icon-btn {
    width: 84rpx; // 42px 外径（含圆形描边）
    height: 84rpx;
    box-sizing: border-box; // 保证 84rpx 含描边
    border-radius: 50%;
    border: 2rpx solid #efefef; // 1px 描边
    background: #fff; // 填充
    box-shadow: none;
  }

  .chat-header__right {
    gap: 16rpx; // 8px：喇叭与关闭两颗圆之间的间距
  }

  // 按压只改变图标透明度，点击热区与间距保持不变。
  .chat-header__icon-btn:active {
    opacity: 0.7;
  }
}

/* 深色描边与填充。 */
.ai-chat-header--round.ai-chat-header--dark {
  .chat-header__icon-btn {
    border-color: #303030;
    background: #212121;
    box-shadow: none;
  }
}

.chat-header__icon-spacer {
  width: 48rpx;
  height: 48rpx;
  flex: 0 0 48rpx;
}

/* ===== 顶部中间「灵动岛」：Ardot 722:2498（等待中）/ 722:489（回答中）→ Group 133 =====
   按需求只保留岛内的三角图标，圆形部分全部去掉：
    · 圆形玻璃底盘（.chat-header__island-glass：1204 那套透明底 + 背景模糊 2 + 圆角裁切）不再渲染
    · 容器的 1px 白描边 / 圆角 / 圆形外投影 / overflow 裁切一并移除
   容器仍是 80×80（160rpx），只是由「圆」变成透明容器：
    · 继续作为「思考中」呼吸放大（→ 100px / 200rpx，设计稿 722:96 Group 134）的动画载体
    · 继续作为 Logo 的定位基准，下方状态胶囊的落位不受影响
   Logo 62×62（722:340 / 页面实例 1187:41;722:340）：相对外沿 左 9 / 上 5.2，投影 0 3 9 rgba(0,0,0,.14)

   浮动定位：绝对定位浮在状态栏下沿，向下悬在内容之上，
   不占布局、不撑高头部，也不改变两侧按钮的位置（pointer-events: none 不拦截点击）；
   top 略为负值：整组（三角 + 下方状态胶囊）比设计稿再往上收一点，
   与对话内容一起上移，头部下沿下面不会再露出正文的一截字 */
.chat-header__island-wrap {
  position: absolute;
  top: -8rpx;
  left: 50%;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  transform: translateX(-50%);
  pointer-events: none;
}

/* 双工模式状态条（开启中 / 聆听中 / 实时转写）：
   文字与录音时的实时提词同色（ai-voice-transcript 的 .voice-live__text 浅色 #0d0d0d），
   不再用原来的蓝灰 #526a80 */
.chat-header__duplex-status {
  display: flex;
  align-items: center;
  justify-content: center;
  width: min(76vw, 640rpx);
  height: 76rpx;
  margin-top: 8rpx;
  color: #0d0d0d;
  font-size: 26rpx;
  line-height: 38rpx;
  text-align: center;
}

.chat-header__duplex-lines {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

// 文本按自然高度排版并贴底，新增一行时只把最早的一行推出可视区。
.chat-header__duplex-text {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  line-height: 38rpx;
  overflow-wrap: break-word;
  overflow-wrap: anywhere;
}

/* 深色：与实时提词 .voice-live--dark .voice-live__text 同色 #f2f3f5 */
.ai-chat-header--dark .chat-header__duplex-status {
  color: #f2f3f5;
}

.chat-header__island {
  position: relative;
  width: 160rpx; // 80px（722:338 Group 133 / 722:339 Ellipse 55 的实际尺寸）
  height: 160rpx;
  box-sizing: border-box;
  // 圆形已去掉：不再有描边 / 圆角 / 圆形外投影，也不再裁剪内层
  // 独立合成层：呼吸缩放过程中保持独立图层，避免 WebView 反复重绘
  transform: translateZ(0);
  // 缩放过渡做柔：480ms + 两端平滑的缓动曲线，变大/变小都不是硬切
  transition: transform 480ms cubic-bezier(0.4, 0, 0.2, 1);
}

/* 首页对话页：三角图要接住长按，父层 .chat-header__island-wrap 是 pointer-events: none，
   这里单独放开；同时禁掉系统长按菜单（按 5 秒会被 WebView 当成选字 / 呼出菜单） */
.chat-header__island-logo--restartable {
  pointer-events: auto;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
}

/* 长按进度环：144rpx（72px）套在 124rpx（62px）的三角图上，
   logo 中心 = (9+31, 5.2+31) = (40, 36.2) → 环左上角 (40-36, 36.2-36) = (4, 0.2) */
.chat-header__press-ring {
  position: absolute;
  top: 0;
  left: 8rpx;
  width: 144rpx;
  height: 144rpx;
  pointer-events: none;
  // 独立合成层：进度环每帧都在变 dashoffset，别带着下面的 GIF 一起重绘
  transform: translateZ(0);
}

.chat-header__press-ring-svg {
  display: block;
  width: 100%;
  height: 100%;
  // 从 12 点方向开始走，而不是 3 点
  transform: rotate(-90deg);
  // 环本身很细，加一点同色外发光，白底上才看得清
  filter: drop-shadow(0 0 6rpx rgba(124, 108, 255, 0.55));
}

.chat-header__press-ring-track,
.chat-header__press-ring-arc {
  fill: none;
  stroke-width: 2;
}

.chat-header__press-ring-track {
  stroke: rgba(124, 108, 255, 0.16);
}

/* 周长 = 2π × 34 ≈ 213.63：dashoffset 从满值走到 0 就是「走满一圈」 */
.chat-header__press-ring-arc {
  stroke: #7c6cff;
  stroke-linecap: round;
  stroke-dasharray: 213.63;
  stroke-dashoffset: 213.63;
  animation: island-press-ring 5s linear forwards;
}

@keyframes island-press-ring {
  from {
    stroke-dashoffset: 213.63;
  }

  to {
    stroke-dashoffset: 0;
  }
}

/* 只有「思考中」呼吸放大：160rpx → 200rpx（设计稿 80px → 100px）循环；
   一旦出字（回答中）就回落到原始 160rpx（80px），其他状态尺寸不变 */
.chat-header__island--thinking {
  // 呼吸节奏放慢：1.6s → 2.2s（一轮放大+回落），起伏更舒缓
  animation: island-breathe 2.2s ease-in-out infinite;
}

/* 呼吸动效：两端平滑、无跳变；translateZ(0) 保持独立合成层，
   避免 WebView 在缩放过程中重新裁剪圆角。
   峰值按设计稿 722:96 Group 134 = 100px = 200rpx：
   基数 160rpx，200 / 160 = 1.25 */
@keyframes island-breathe {
  0%,
  100% {
    transform: translateZ(0) scale(1); // 160rpx（80px）
  }

  50% {
    transform: translateZ(0) scale(1.25); // 200rpx（100px）
  }
}

/* 圆形玻璃底盘整层删除：原来它负责圆形轮廓、透明底 + BACKGROUND_BLUR 2 与圆角裁切，
   现在圆形不再需要，容器本身已是透明的，只剩 Logo */

.chat-header__island-logo {
  position: absolute;
  z-index: 1;
  // 设计稿 722:340：图相对圆外沿 左 9 / 上 5.2。
  // 描边去掉后绝对定位原点就是容器的外沿，直接用设计稿原值，不再减 1px
  top: 10.4rpx; // 5.2px
  left: 18rpx; // 9px
  width: 124rpx; // 62px（722:340 实测 62×62）
  height: 124rpx;
  // 图片本身是透明背景 GIF（96×85，内容已裁到图案边界），这里再显式声明一次透明底，
  // 防止 image 组件/内核给它补上默认白底而露出方形
  background-color: transparent;
  border: 0;
  // 阴影必须跟随图案轮廓：box-shadow 会沿图片的方形盒子铺开，看起来就是一个「方图标」
  filter: drop-shadow(0 6rpx 18rpx rgba(0, 0, 0, 0.14)); // 0 3 9 rgba(0,0,0,.14)
  // 换图（常态 ⇄ 思考中）走交叉淡入 + 缩放过渡，260ms 起缓停缓，避免尺寸硬跳
  transition:
    opacity 0.26s ease,
    transform 0.26s cubic-bezier(0.22, 0.61, 0.36, 1);
}

/* 常态图在思考中淡出，但保留在原位：长按热区不动，位置不抖 */
.chat-header__island-logo--faded {
  opacity: 0;
}

/* 语音输入整段（点击说话起飞 → 录音中 → 松手结束）与回答中 / 自动播报：
   listen.gif / tell.gif 一套素材、不分深浅色。画布 3840×3840 且透明，三角约占中间 40%
   （与 sani-logo-sm 已裁到图案边界的 96×85 不同，同一尺寸的盒子里图案会小一半多），按图案宽度对齐：
   1) 124rpx 的盒子 aspectFit 后图案宽 = 124 × 0.4 ≈ 49.6rpx，要撑满 124rpx → 放大 2.49 倍；
   2) 图案中心在画布中心，放大后右移 / 下移各约 2rpx 复位；
   3) drop-shadow 会被 transform 一起放大，这里按 1/2.49 折回去，保持 0 3px 9px rgba(0,0,0,.14)。
   过渡：与常态图交叉溶解 —— 起始 2.36 倍 / 全透明，命中后淡入并缓升到 2.49 倍。 */
.chat-header__island-logo--listen-say,
.chat-header__island-logo--tell-play {
  z-index: 2;
  opacity: 0;
  pointer-events: none;
  transform: translate(2rpx, 2rpx) scale(2.36);
  filter: drop-shadow(0 2.4rpx 7.2rpx rgba(0, 0, 0, 0.14));
  transition:
    opacity 0.22s cubic-bezier(0.22, 0.61, 0.36, 1),
    transform 0.22s cubic-bezier(0.22, 0.61, 0.36, 1);
}

.chat-header__island-logo--listen-say-on,
.chat-header__island-logo--tell-play-on {
  opacity: 1;
  transform: translate(2rpx, 2rpx) scale(2.49);
  transition:
    opacity 0.34s cubic-bezier(0.22, 0.61, 0.36, 1),
    transform 0.34s cubic-bezier(0.22, 0.61, 0.36, 1);
}

/* think.gif（正在思考）：画布由 3840×1920 等比优化为 768×384，图案只占中间（宽约 40%、高约 68%），两侧是透明留白。
   1) 留白用 aspectFill 裁掉，图案正好撑满 62×62 的位；
   2) 换算下来图案仍比原图小约 15%（340/400 的缩放差），要放大到 1.18 才与原图视觉等大；
   3) 图案中心在画布上偏下约 2.5%（y 210 / 400），上移 3rpx 让中心仍落在原位置。 */
.chat-header__island-logo--think {
  z-index: 3;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-3rpx) scale(1);
}

.chat-header__island-logo--think-on {
  opacity: 1;
  transform: translateY(-3rpx) scale(1.18);
}

// --- icons (用 CSS 近似 Figma 形状，后续可替换为 svg 资源) ---
.chat-header__icon-history {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.chat-header__icon-line {
  height: 4rpx;
  background: #23324f;
  border-radius: 4rpx;
}

.chat-header__icon-line--long {
  width: 30rpx;
}

.chat-header__icon-line--short {
  width: 22rpx;
}

.chat-header__icon-atlas {
  display: flex;
  align-items: center;
  justify-content: center;
}

.chat-header__icon-history-img {
  width: 48rpx;
  height: 48rpx;
}
.chat-header__icon-back-img {
  width: 48rpx;
  height: 48rpx;
}
.chat-header__icon-atlas-img {
  width: 46rpx;
  height: 44rpx;
}
.chat-header__icon-minimize-img {
  width: 40rpx;
  height: 40rpx;
}

/* 语音播报总开关（回主页左边）：24×24（48rpx），与其他头部图标同尺寸同色值；
   关闭态只靠「喇叭 + ×」图标区分，再压一点透明度让状态更好辨 */
.chat-header__icon-tts-img {
  width: 48rpx;
  height: 48rpx;
}

.chat-header__tts-switch--off .chat-header__icon-tts-img {
  opacity: 0.6;
}

.chat-header__check-all {
  display: flex;
  align-items: center;
  gap: 12rpx; // 6px
  padding: 0;
}
.chat-header__check-all--disabled {
  opacity: 0.55;
}
.chat-header__check-icon {
  width: 32rpx; // 16px
  height: 32rpx; // 16px
}
.chat-header__check-all-text {
  font-family: PingFang SC;
  font-weight: 400;
  font-size: 28rpx; // 14px
  line-height: 54rpx; // 27px (1.928em)
  color: #2f323c; // APP font/二级标题
}
.chat-header__share-title-wrap {
  flex: 1;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  padding-left: 50rpx; // 25px
  box-sizing: border-box;
}
.chat-header__share-title {
  font-family: PingFang SC;
  font-weight: 400;
  font-size: 28rpx; // 14px
  line-height: 36rpx; // 18px (1.285em)
  color: #1f2937; // Font/二级标题
  text-align: center;
}

// ---- Left drawer (40834-437) ----
.history-drawer {
  width: 100%;
  max-width: none;
  height: 100vh;
  box-sizing: border-box;
  padding: 32rpx 36rpx;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.history-drawer__top {
  display: none;
}

.history-drawer__title {
  font-size: 32rpx;
  font-weight: 600;
  color: #232323;
}

.history-drawer__loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16rpx;
  min-height: 160rpx;
  color: #999999;
}
.history-drawer__loading-spinner {
  width: 28rpx;
  height: 28rpx;
  box-sizing: border-box;
  border: 4rpx solid #e0e0e0;
  border-top-color: #999999;
  border-radius: 50%;
  animation: history-drawer-loading-spin 0.8s linear infinite;
}
.history-drawer__loading-text {
  font-size: 26rpx;
  line-height: 36rpx;
}
@keyframes history-drawer-loading-spin {
  to { transform: rotate(360deg); }
}
.history-drawer__list {
  display: flex;
  flex-direction: column;
  padding: 0;
}

/* 设计稿 309:3052 历史列表：行高 46px（92rpx），首条(182) → 第二条(233) 间隔 5px（10rpx） */
.history-drawer__group {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

// 设计稿 309:3052 的列表是连续条目、不带「今天 / 昨天」这类日期分组标题，
// 这里只隐藏标题节点，分组数据与排序逻辑保持不变
.history-drawer__group-title {
  display: none;
}

.history-drawer__group-title-text {
  font-size: 24rpx;
  line-height: 34rpx;
  color: #9aa0aa;
}

/* 空态：z-paging 的空视图，设计稿 309:3052 未画，按列表区垂直居中处理
   与「历史对话」标题的 16px 间距用 padding-top 承担，不引入 margin */
.history-drawer__empty {
  display: flex;
  min-height: 360rpx;
  align-items: center;
  justify-content: center;
  padding: 32rpx;
  box-sizing: border-box;
}

.history-drawer__empty-text {
  color: #999999;
  font-size: 28rpx;
  line-height: 40rpx;
}
.history-drawer__row {
  display: flex;
  align-items: center;
  cursor: pointer;
  -webkit-touch-callout: none; /* 禁止系统默认菜单 */
  user-select: none;
}
.history-drawer__row--editing {
  background: #f9f9f9;
  border-radius: 16rpx;
  padding: 0 20rpx;
  gap: 12rpx;
}
.history-drawer__row--editing .history-drawer_item {
  padding-left: 0;
  padding-right: 0;
}
/* 设计稿 309:3052 列表行：46px（92rpx）高、左右内边距 16px（32rpx）
   —— 抽屉本身已有 18px 左右留白，文字落在 x=34（18 + 16），选中条落在 x=18 起、宽 286 */
.history-drawer_item {
  height: 92rpx;
  padding: 0 32rpx;
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  gap: 16rpx; // 标题与场景标签的 8px 间距，由 flex gap 承担
  box-sizing: border-box;
}
/* 设计稿 309:3094 / 309:3064 / 309:3053：14px（28rpx）/ Regular(400) / #0D0D0D，行高 20px（40rpx） */
.history-drawer_item-label {
  overflow: hidden;
  min-width: 0;
  flex: 1;
  color: #0D0D0D;
  font-size: 28rpx;
  font-weight: 400;
  line-height: 40rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 历史列表每条只保留标题，不再展示「任务 / 指导 / 问答」这类场景标签 */
.history-drawer_item-tag {
  display: none;
  flex-shrink: 0;
  height: 36rpx;
  padding: 0 12rpx;
  border-radius: 8rpx;
  background: #eef1f5;
  color: #8a919c;
  font-size: 20rpx;
  font-weight: 500;
  line-height: 36rpx;
  white-space: nowrap;
}

.history-drawer__rename-input {
  padding: 0 16rpx;
  box-sizing: border-box;
  font-size: 28rpx;
  color: #1f2937;
  border-radius: 16rpx;
  background: #f9f9f9;
  width: 100%;
  height: 96rpx;
}
/* 设计稿 309:3101 选中条：286×46、圆角 8px（16rpx）、底色 #F5F5F5（无描边、无阴影） */
.history-drawer_item_active {
  border-radius: 16rpx;
  background: #F5F5F5;
}
.history-drawer_item_active .history-drawer_item-label {
  color: #0D0D0D;
}

/* 当前会话与批量选择态同一套选中样式，统一走设计稿的 #F5F5F5 */
.history-drawer_item_current {
  border-radius: 16rpx;
  background: #F5F5F5;
}
.history-drawer__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 18rpx 18rpx;
  box-sizing: border-box;
  border-radius: 16rpx;
  background: #f9f9f9;
}

.history-drawer__item-label {
  font-size: 26rpx;
  color: #232323;
  font-weight: 600;
}

.history-drawer__item-right {
  width: 20rpx;
  height: 20rpx;
  border-right: 4rpx solid #232323;
  border-top: 4rpx solid #232323;
  transform: rotate(45deg);
  opacity: 0.35;
}

.history-drawer__icon-img {
  width: 40rpx;
  height: 36rpx;
}

/* 设计稿 309:3052 顶部行：头像 44px（88rpx）+ 间距 14px（28rpx）+ 搜索框 224px（448rpx）= 286px
   头像落在 x=22，比抽屉 18px 内边距再右移 4px（8rpx） */
.history-drawer__toolbar {
  display: flex;
  align-items: center;
  gap: 28rpx;
  padding-left: 8rpx;
  /* 搜索框底(126) → 「历史对话」标题顶(150) 的 24px 由标题自身的 padding-top 承担 */
}

/* 设计稿 857:105：44×44（88rpx）品牌头像，无圆角，阴影 0 3 9 rgba(0,0,0,0.14)
   图源是透明底 PNG，阴影必须用 filter: drop-shadow 沿图形轮廓投；
   用 box-shadow 会画出一个 44×44 的矩形灰块，看上去像多了个白底 */
.history-drawer__avatar {
  width: 88rpx;
  height: 88rpx;
  flex-shrink: 0;
  filter: drop-shadow(0 6rpx 18rpx rgba(0, 0, 0, 0.14));
}
/* 设计稿 309:3059：224×44（448×88rpx）/ 圆角 10px（20rpx）/ 描边 1px（2rpx）#E0E0E0 / 内边距 12px（24rpx） */
.history-drawer__search {
  display: flex;
  width: 448rpx;
  flex: 0 0 448rpx;
  height: 88rpx;
  align-items: center;
  gap: 6rpx;
  padding: 0 24rpx;
  border: 2rpx solid #e0e0e0;
  border-radius: 20rpx;
  box-sizing: border-box;
  background: #ffffff;
}
/* 语言切换（设计稿 309:3088）暂时不上屏：抽屉顶部的这个位置现在是品牌头像，
   中 / EN 开关后续放到点击齿轮弹出的设置弹框里，以下样式保留给弹框复用 */
/* 设计稿 309:3088：轨道 66×32（132×64rpx）/ 圆角 18px（36rpx）/ 底 #F3F3F3 */
.history-drawer__lang {
  position: relative;
  display: flex;
  width: 132rpx;
  height: 64rpx;
  flex: 0 0 132rpx;
  align-items: center;
  border-radius: 36rpx;
  background: #F3F3F3;
}
/* 设计稿 309:3092：白圆 28×28（56×56rpx），距轨道左 4px（8rpx）、上 2px（4rpx） */
.history-drawer__lang-thumb {
  position: absolute;
  z-index: 0;
  top: 4rpx;
  left: 8rpx;
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  background: #FFFFFF;
  transition: transform 0.2s ease;
}
.history-drawer__lang-thumb--en {
  transform: translateX(60rpx);
}
/* 设计稿 309:3090 / 309:3091：14px（28rpx）/ Medium(500)，选中 #0D0D0D、未选中 #8E8E8E */
.history-drawer__lang-text {
  position: relative;
  z-index: 1;
  width: 66rpx;
  flex: 0 0 66rpx;
  /* 上下补内边距把命中区域撑满轨道（40 + 12×2 = 64rpx），文字视觉位置不变 */
  padding: 12rpx 0;
  color: #8E8E8E;
  font-size: 28rpx;
  font-weight: 500;
  line-height: 40rpx;
  text-align: center;
  box-sizing: border-box;
  transition: color 0.2s ease;
}
.history-drawer__lang-text--on {
  color: #0D0D0D;
}
.history-drawer__search-icon {
  width: 36rpx;
  height: 36rpx;
}
.history-drawer__search-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  box-sizing: border-box;
  background: transparent;
  font-size: 28rpx;
  color: #1a1a1a;
  line-height: 40rpx;
}
.history-drawer__search-input::placeholder {
  color: #999999;
}
/* 设计稿 309:3052 底部一行：左「新建对话」、右齿轮，两端对齐；
   下 9px（18rpx）补足按钮底距屏幕 25px（抽屉已留 16px），上方空白由 z-paging（flex: 1）撑开；
   右 7px（14rpx）= 齿轮右边缘(297) 到内容区右边(304)，用父级 padding 让位，不用子元素 margin */
.history-drawer__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18rpx 14rpx 18rpx 0;
}
.history-drawer__new-conversation {
  padding: 0;
}
/* 设计稿 722:2798 是 32×32（64rpx），实际按 26×26（52rpx）收小一点；
   右边缘仍由 footer 的右侧 padding 让出 7px（14rpx），不额外加 margin */
.history-drawer__settings {
  width: 52rpx;
  height: 52rpx;
  flex-shrink: 0;
}
.history-drawer--batch-delete .history-drawer__toolbar,
.history-drawer--batch-delete .history-drawer__footer {
  display: none;
}
/* 设计稿 309:3071：136×44（272×88rpx）/ 圆角 10px（20rpx）/ 白底 + 1px（2rpx）#E0E0E0 描边 */
.history-drawer__new-conversation-item {
  display: flex;
  width: 272rpx;
  height: 88rpx;
  align-items: center;
  justify-content: flex-start;
  /* 图标左内边距 22px（44rpx），图标与文案间距 10px（20rpx） */
  gap: 20rpx;
  padding: 0 0 0 44rpx;
  border: 2rpx solid #e0e0e0;
  border-radius: 20rpx;
  box-sizing: border-box;
  background: #ffffff;
}
/* 设计稿 309:3066：16px（32rpx）/ Regular(400) / #0D0D0D */
.history-drawer__new-conversation-item-label {
  font-size: 32rpx;
  font-weight: 400;
  color: #0D0D0D;
  line-height: 46rpx;
}
/* 设计稿 309:3067：18×18（36rpx）加号图标 */
.history-drawer__new-conversation-item-icon {
  width: 36rpx;
  height: 36rpx;
  flex-shrink: 0;
}
/* 设计稿 309:3099「历史对话」小节标题：
   上 24px（48rpx）= 搜索框底(126) → 标题顶(150)；下 12px（24rpx）= 标题底(170) → 首条选中条(182) */
.history-drawer__session-history {
  padding: 48rpx 0 24rpx;
}
.history-drawer--batch-delete .history-drawer__session-history {
  padding-top: 0;
}
/* 设计稿 309:3099：14px（28rpx）/ Regular(400) / #5D5D5D，行高 20px（40rpx） */
.history-drawer__session-history-label {
  font-size: 28rpx;
  font-weight: 400;
  color: #5D5D5D;
  line-height: 40rpx;
}
.history-drawer__list-wrap {
  flex: 1;
  min-height: 0;
}

.history-drawer__check {
  width: 32rpx;
  height: 32rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 32rpx;
}
.history-drawer__check-img {
  width: 32rpx;
  height: 32rpx;
  display: block;
}

.history-drawer__check--on {
  border-color: #0D0D0D;
  background: #0D0D0D;
}

.history-drawer__check-mark {
  color: #ffffff;
  font-size: 18rpx;
  line-height: 1;
  font-weight: 600;
}

.history-drawer__multi-footer {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 16rpx 16rpx 0;
  justify-content: space-between;
}

/* 批量删除态（设计稿未画）：按钮文案 16px（32rpx）/ Semibold(600)；
   次要色取浅色稿二级文字 #5D5D5D，删除红取品牌红 #C8201E（与全项目一致） */
.history-drawer__multi-btn-text {
  color: #5D5D5D;
  font-size: 32rpx;
  font-weight: 600;
  line-height: 46rpx;
}

.history-drawer__multi-btn-text--danger {
  color: #C8201E;
  font-size: 32rpx;
  font-weight: 600;
  line-height: 46rpx;
}

.history-action-menu-mask {
  position: fixed;
  inset: 0;
  z-index: 1199;
}

/* ===== 长按菜单（设计稿 309 系未画，沿用同一套暗色/浅色体系推）=====
   卡片 336×274rpx（168×137px），圆角 8px（16rpx），内边距 18px / 16px（36rpx / 32rpx）。
   三项之间的 17px（34rpx）间距交给父级 flex 的 gap，不用相邻兄弟 margin 堆叠 */
.history-action-menu {
  position: fixed;
  left: 36rpx;
  z-index: 1200;
  display: flex;
  flex-direction: column;
  gap: 34rpx;
  width: 336rpx;
  height: 274rpx;
  box-sizing: border-box;
  border: 0;
  border-radius: 16rpx;
  background: #ffffff;
  // 浮层投影：x 0 / y -2px（-4rpx）/ 模糊 21px（42rpx）/ 扩散 0 / rgba(0,0,0,.06)
  box-shadow: 0 -4rpx 42rpx rgba(0, 0, 0, 0.06);
  padding: 36rpx 32rpx;
}

/* 单项：行高 22px（44rpx），图标 16×16（32rpx）与文字间距 8px（16rpx） */
.history-action-menu__item {
  display: flex;
  align-items: center;
  height: 44rpx;
  gap: 16rpx;
}

.history-action-menu__text {
  font-size: 28rpx;
  font-weight: 400;
  line-height: 40rpx;
  color: #1a1a1a;
}

.history-action-menu__text--danger {
  color: #c8201e;
}
.history-action-menu__icon-img {
  display: block;
  width: 32rpx;
  height: 32rpx;
  flex: 0 0 32rpx;
  object-fit: contain;
}

/* ===== 设计稿 309:3165 弹窗确认：历史会话删除 / 批量删除二次确认 =====
   遮罩 #0D0D0D @40%；卡片 313×168（626×336rpx）、圆角 14px（28rpx）、无阴影 */
.history-delete-confirm {
  position: fixed;
  z-index: 2000;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(13, 13, 13, 0.4);
}

/* 卡片内边距：上 29px（58rpx）/ 左右 28px（56rpx）/ 下 21px（42rpx） */
.history-delete-confirm__card {
  display: flex;
  width: 626rpx;
  flex-direction: column;
  align-items: center;
  padding: 58rpx 56rpx 42rpx;
  border-radius: 28rpx;
  box-sizing: border-box;
  background: #FFFFFF;
}

/* 设计稿 309:3167：16px（32rpx）/ Medium(500) / #0D0D0D */
.history-delete-confirm__title {
  color: #0D0D0D;
  font-size: 32rpx;
  font-weight: 500;
  line-height: 46rpx;
}

/* 设计稿 309:3172：标题底到说明 8px（16rpx）；14px（28rpx）/ Regular / #8F8F8F */
.history-delete-confirm__desc {
  padding-top: 16rpx;
  color: #8F8F8F;
  font-size: 28rpx;
  font-weight: 400;
  line-height: 40rpx;
  text-align: center;
}

/* 设计稿：说明底到按钮 19px（38rpx）；两按钮 123×48（246×96rpx），间距 11px（22rpx） */
.history-delete-confirm__actions {
  display: flex;
  width: 100%;
  padding-top: 38rpx;
  gap: 22rpx;
}

/* 设计稿 309:3171：确认按钮底 #0D0D0D，圆角 25px（50rpx） */
.history-delete-confirm__btn {
  display: flex;
  height: 96rpx;
  flex: 1 1 0;
  align-items: center;
  justify-content: center;
  border-radius: 50rpx;
  background: #0D0D0D;
}

/* 设计稿 309:3174：取消按钮底 #F3F3F3 */
.history-delete-confirm__btn--ghost {
  background: #F3F3F3;
}

/* 设计稿 309:3170 / 309:3175：16px（32rpx）/ Medium(500)，确认白字、取消黑字 */
.history-delete-confirm__btn-text {
  color: #FFFFFF;
  font-size: 32rpx;
  font-weight: 500;
  line-height: 46rpx;
}

.history-delete-confirm__btn-text--ghost {
  color: #0D0D0D;
}

/* ===== 深色主题：历史记录抽屉（Ardot 1193:3855「历史对话」）=====
   只换材质与文字色，抽屉宽 322、搜索框 223×44、列表行 46 高、底部按钮 136×44、
   头像 44×44 与全部间距都和浅色稿（309:3052）一致，一律不动：
   - 抽屉底板 1193:3856：#0D0D0D（uni-popup 的 background-color 同步换掉）
   - 遮罩 1193:3902：rgba(13,13,13,0.4)
   - 搜索框 1193:3878：底 #0D0D0D + 1px #303030 描边；占位文字 1193:3874 #8F8F8F
   - 放大镜 1193:3875：描边 #8E8E8E
   - 小节标题 1193:3885：#5D5D5D（两稿同值，显式写一遍）
   - 列表文字 1193:3868：#FFFFFF；当前 / 选中条 1193:3869：286×46 / r8 / #212121
   - 新建对话 1193:3858：底 #0D0D0D + 1px #303030，文案 16px #FFFFFF，图标 #FFFFFF
   - 齿轮 1193:3879：32×32，#FFFFFF
   批量删除 / 长按菜单 / 二次确认设计稿没画，按同一暗色体系推（卡 #212121、描边 #303030、
   主按钮黑白反转），已在下面标注 */
.ai-chat-header--plain.ai-chat-header--dark {
  .history-drawer {
    background: #0d0d0d;
  }

  // 搜索框：底 #0D0D0D + 1px（2rpx）#303030 描边（浅色稿是 #E0E0E0，宽度不变）
  .history-drawer__search {
    border-color: #303030;
    background: #0d0d0d;
  }

  .history-drawer__search-input {
    color: #ffffff;
  }

  .history-drawer__search-input::placeholder {
    color: #8f8f8f;
  }

  // 放大镜 1193:3875 描边 #8E8E8E（原图标 #999）：压黑再反相到 0.557 ≈ #8E8E8E
  .history-drawer__search-icon {
    filter: brightness(0) invert(0.557);
  }

  .history-drawer__session-history-label {
    color: #5d5d5d;
  }

  // 列表文字 1193:3868 / 14px / #FFFFFF
  .history-drawer_item-label,
  .history-drawer_item_active .history-drawer_item-label {
    color: #ffffff;
  }

  // 当前会话 + 批量选中条 1193:3869：#212121
  .history-drawer_item_current,
  .history-drawer_item_active,
  .history-drawer__row--editing {
    background: #212121;
  }

  .history-drawer__rename-input {
    color: #ffffff;
    background: #212121;
  }

  // 新建对话 1193:3858：底 #0D0D0D + 1px #303030
  .history-drawer__new-conversation-item {
    border-color: #303030;
    background: #0d0d0d;
  }

  .history-drawer__new-conversation-item-label {
    color: #ffffff;
  }

  // 加号 / 齿轮图标都是深色线条，深底反相成白（1193:3859 / 1193:3879）
  .history-drawer__new-conversation-item-icon,
  .history-drawer__settings {
    filter: brightness(0) invert(1);
  }

  .history-drawer__loading,
  .history-drawer__empty-text {
    color: #8f8f8f;
  }

  .history-drawer__loading-spinner {
    border-color: #303030;
    border-top-color: #8f8f8f;
  }

  // ---- 批量删除态（设计稿未画）：勾选框与主题一起反转 ----
  .history-drawer__check--on {
    border-color: #ffffff;
    background: #ffffff;
  }

  .history-drawer__check-mark {
    color: #0d0d0d;
  }

  .history-drawer__multi-btn-text {
    color: #ffffff;
  }

  // ---- 长按菜单（设计稿未画）：#212121 卡 + 白字，删除保留品牌红 ----
  .history-action-menu {
    background: #212121;
    box-shadow: 0 -4rpx 42rpx rgba(0, 0, 0, 0.6);
  }

  .history-action-menu__text {
    color: #ffffff;
  }

  // ---- 二次确认弹窗（设计稿未画）：卡 #212121，主按钮白底黑字，次按钮 #303030 ----
  .history-delete-confirm__card {
    background: #212121;
  }

  .history-delete-confirm__title {
    color: #ffffff;
  }

  .history-delete-confirm__btn {
    background: #ffffff;
  }

  .history-delete-confirm__btn-text {
    color: #1a1a1a;
  }

  .history-delete-confirm__btn--ghost {
    background: #303030;
  }

  .history-delete-confirm__btn-text--ghost {
    color: #ffffff;
  }
}
</style>
