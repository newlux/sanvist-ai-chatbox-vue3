<script setup lang="ts">
import { useI18n } from "vue-i18n";
import actionBatchDeleteIcon from "@/assets/img/icon-history-action-batch-delete.svg";
import actionDeleteIcon from "@/assets/img/icon-history-action-delete.svg";
import actionEditIcon from "@/assets/img/icon-history-action-edit.svg";
import minimizeIcon from "@/assets/img/min_icon.png";
import { useIframeMinimize } from "@/hooks/useIframeMinimize";
import { useSafeArea } from "@/hooks/useSafeArea";
import { setLocale } from "@/i18n";
import { useChatStore } from "@/stores";
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
  shareMode: { type: Boolean, default: false },
  shareSelectAllDisabled: { type: Boolean, default: false },
  shareAllChecked: { type: Boolean, default: false },
  shareSelectedRoundCount: { type: Number, default: 0 },
  backOnly: { type: Boolean, default: false },
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
});
const emit = defineEmits([
  "back",
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
const answering = computed(() => {
  if (!props.generating) return false;
  const list = chatStore.messages;
  const message = list[list.length - 1];
  if (!message || message.role !== "ai") return false;
  return (message.blocks || []).some(
    block => block.type === "answer" && String(block.payload?.content || "").trim().length > 0,
  );
});
const thinking = computed(() => props.generating && !answering.value);

const logger = createLogger("chat-header");
const { t, locale } = useI18n();
/**
 * 灵动岛下方的长条胶囊只在生成过程中出现：
 * 未出字「思考中」→ 出字后「正在回答」，其余状态整个胶囊不渲染。
 */
const statusText = computed(() =>
  answering.value ? t("chat-status-generating") : t("chat-status-thinking"),
);
const { safeTopPx } = useSafeArea();
/** 设计稿 309:3088：抽屉顶部的「中 / EN」切换，复用全局 i18n locale（默认 zh_CN） */
const isEnglishLocale = computed(() => String(locale.value || "").toLowerCase().startsWith("en"));
/** 只切换本组件可见的文案语言，不改宿主语言、不落存储、不触发其他业务逻辑 */
function onSelectLanguage(target: "zh_CN" | "en_US") {
  if (String(locale.value) === target) return;
  void setLocale(target);
}
function onToggleLanguage() {
  onSelectLanguage(isEnglishLocale.value ? "zh_CN" : "en_US");
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
 * 5 秒是「明显有意为之」的时长：短按 / 误触都不会触发，所以按下即开始计时，
 * 手指移动超过阈值（视作滑动）或松手就取消，不需要额外的进度反馈。
 */
const ISLAND_LONG_PRESS_MS = 5000;
/** 判定为滑动的手指位移（px）：与首页整页长按录音的阈值保持一致 */
const ISLAND_MOVE_TOLERANCE_PX = 12;
let islandPressTimer: ReturnType<typeof setTimeout> | null = null;
let islandPressOrigin = { x: 0, y: 0 };
/** 按住中：驱动那圈 5 秒走满的进度环，松手 / 滑动 / 计时结束都会复位 */
const islandPressing = ref(false);

function clearIslandPressTimer() {
  islandPressing.value = false;
  if (!islandPressTimer) return;
  clearTimeout(islandPressTimer);
  islandPressTimer = null;
}

function readPressPoint(e: any) {
  const point = e?.touches?.[0] || e?.changedTouches?.[0] || e;
  return { x: Number(point?.clientX ?? 0), y: Number(point?.clientY ?? 0) };
}

function onIslandPressStart(e: any) {
  if (!props.restartable) return;
  islandPressOrigin = readPressPoint(e);
  // 先归零上一轮，再点亮进度环（clearIslandPressTimer 会把 islandPressing 压回 false）
  clearIslandPressTimer();
  islandPressing.value = true;
  islandPressTimer = setTimeout(() => {
    islandPressTimer = null;
    emit("restart");
  }, ISLAND_LONG_PRESS_MS);
}

/** 手指一移动就当滑动处理：避免用户上下滑消息列表时误触发 */
function onIslandPressMove(e: any) {
  if (!islandPressTimer) return;
  const point = readPressPoint(e);
  if (
    Math.abs(point.x - islandPressOrigin.x) > ISLAND_MOVE_TOLERANCE_PX
    || Math.abs(point.y - islandPressOrigin.y) > ISLAND_MOVE_TOLERANCE_PX
  ) {
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
  <view class="ai-chat-header" :class="{ 'ai-chat-header--plain': plainBg && !shareMode }">
    <view class="chat-header">
      <!-- 状态栏占位：动态读取真实机型状态栏高度 -->
      <view class="chat-header__statusbar" :style="statusbarStyle" />

      <!-- 头部（Figma: 50px, padding 13/16）；灵动岛是浮层，不参与这一行的布局 -->
      <view class="chat-header__bar">
        <template v-if="!shareMode">
          <view v-if="props.backOnly" class="chat-header__icon-btn" @tap="onBackTap">
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
          <view class="chat-header__island-wrap">
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
              <!-- 岛内三角图标：动态 GIF（原 header-island-logo.png 的动画版），
                   只换图源，尺寸 / 投影 / 状态环等一律不动 -->
              <!-- 长按 5 秒回到初始页：只有 restartable（首页对话页）碰触摸事件，
                   其它页面的岛保持纯展示、不抢触摸；热区就是三角图本身（62×62） -->
              <image
                class="chat-header__island-logo"
                :class="{ 'chat-header__island-logo--restartable': props.restartable }"
                src="@/assets/img/sani-logo.gif"
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
            </view>
            <!-- 长条胶囊：仅「思考中 / 正在回答」两个生成态展示，其余状态不出现 -->
            <view v-if="props.generating" class="chat-header__status-pill">
              <view class="chat-header__status-pill-border" />
              <!-- 胶囊只留一行：思考中「思考中」/ 出字后「正在回答」 -->
              <text class="chat-header__status-text">
                {{ statusText }}
              </text>
            </view>
          </view>

          <view v-if="canMinimize" class="chat-header__icon-btn" @tap="onMinimize">
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
        background-color="#ffffff"
        mask-background-color="rgba(0, 0, 0, 0.4)"
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
          <!-- 设计稿 309:3058 + 309:3088：搜索框与语言切换并排（203 + 17 + 66 = 286） -->
          <view class="history-drawer__toolbar">
            <view class="history-drawer__search">
              <image src="@/assets/img/icon-history-search.svg" mode="aspectFit" class="history-drawer__search-icon" />
              <input
                v-model="historySearchKeyword"
                class="history-drawer__search-input"
                :placeholder="t('history-search-placeholder')"
                :maxlength="80"
              >
            </view>
            <view class="history-drawer__lang" @tap.stop="onToggleLanguage">
              <view
                class="history-drawer__lang-thumb"
                :class="{ 'history-drawer__lang-thumb--en': isEnglishLocale }"
              />
              <text
                class="history-drawer__lang-text"
                :class="{ 'history-drawer__lang-text--on': !isEnglishLocale }"
                @tap.stop="onSelectLanguage('zh_CN')"
              >
                中
              </text>
              <text
                class="history-drawer__lang-text"
                :class="{ 'history-drawer__lang-text--on': isEnglishLocale }"
                @tap.stop="onSelectLanguage('en_US')"
              >
                EN
              </text>
            </view>
          </view>
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
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ai-chat-header {
  position: relative;
  flex: 0 0 auto;
  z-index: 10;
  // 顶部由实色自上而下渐隐到全透明：内容滚到头部下方时柔和淡出，不再是硬边切断
  background: linear-gradient(
    180deg,
    #fafafa 0%,
    rgba(250, 250, 250, 0.92) 45%,
    rgba(250, 250, 250, 0) 100%
  );
  // box-shadow: 0 8rpx 24rpx rgba(26, 26, 26, 0.06);
}

/* 悬浮头部（首页对话页）：底色交给页面顶部的毛玻璃渐隐层，
   这里完全透明，滚上来的消息才能透到图标下面，而不是被一层实底挡住 */
.ai-chat-header--plain {
  background: linear-gradient(180deg, #fafafa 0%, rgba(250, 250, 250, 0.92) 10%, rgba(250, 250, 250, 0) 100%);
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

.chat-header__bar {
  position: relative; // 灵动岛以这一行为定位基准做浮动
  height: 100rpx; // 50px
  display: flex;
  align-items: center;
  padding: 16rpx 40rpx; // 4px 20px
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
   不占布局、不撑高头部，也不改变两侧按钮的位置（pointer-events: none 不拦截点击） */
.chat-header__island-wrap {
  position: absolute;
  top: 0;
  left: 50%;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  transform: translateX(-50%);
  pointer-events: none;
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
  // 图片本身是透明背景 GIF（300×267，内容已裁到图案边界），这里再显式声明一次透明底，
  // 防止 image 组件/内核给它补上默认白底而露出方形
  background-color: transparent;
  border: 0;
  // 阴影必须跟随图案轮廓：box-shadow 会沿图片的方形盒子铺开，看起来就是一个「方图标」
  filter: drop-shadow(0 6rpx 18rpx rgba(0, 0, 0, 0.14)); // 0 3 9 rgba(0,0,0,.14)
}

/* ===== 岛屿下方的状态胶囊 =====
   等待中 722:326：h32 / r20 / 白 / 内边距 6·20 / 文案 "SANI" 14px Medium
   思考中 / 回答中：同一尺寸，只把文案换成一行「思考中」/「正在回答」
   胶囊与圆形底部重叠 6px（722:2498 里胶囊 y=138，圆形 y=52~144） */
.chat-header__status-pill {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  margin-top: -12rpx; // 与圆形底部重叠 6px
  padding: 12rpx 40rpx; // 6 / 20
  border-radius: 40rpx; // 20px
  overflow: hidden; // clipsContent: true（描边环不溢出圆角）
  /* 纯白底 + 向下投影：靠投影从滚动内容里浮起来（白底不再需要背景模糊） */
  background: #ffffff;
  box-shadow: 0 8rpx 24rpx rgba(0, 0, 0, 0.08); // 0 4px 12px rgba(0,0,0,.08)
}

/**
 * 描边：去掉彩色渐变，改为与圆形灵动岛一致的 1px 纯白描边。
 * 渐变无法直接作用于 border，仍沿用 mask 挖空法，只保留 2rpx 的环。
 */
.chat-header__status-pill-border {
  position: absolute;
  z-index: 0;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  padding: 2rpx; // 1px 描边宽度，与圆形 1px 白描边对齐
  border-radius: 40rpx; // 跟随胶囊 20px
  background: #ffffff;
  /* 先写标准属性、再用 -webkit- 兜底：老 WebView 只认前缀版本 */
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  pointer-events: none;
}

// 胶囊文案：设计稿 722:327 / 722:337（Source Han Sans CN Medium 14px / #0D0D0D / 行盒 20px）
.chat-header__status-text {
  position: relative;
  z-index: 1; // 压在描边之上
  color: #0d0d0d;
  font-family:
    "Source Han Sans CN",
    "PingFang SC",
    "Noto Sans SC",
    "Microsoft YaHei",
    sans-serif;
  font-size: 28rpx; // 14px
  font-weight: 500; // Medium
  line-height: 40rpx; // 20px
  letter-spacing: 0;
  text-align: center;
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

.history-drawer__group {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
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

.history-drawer__empty {
  display: flex;
  min-height: 360rpx;
  align-items: center;
  justify-content: center;
  padding: 0 32rpx;
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
.history-drawer_item {
  height: 92rpx;
  padding: 0 32rpx;
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
}
.history-drawer_item-label {
  overflow: hidden;
  min-width: 0;
  flex: 1;
  color: #1a1a1a;
  font-size: 28rpx;
  line-height: 40rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 历史列表每条只保留标题，不再展示「任务 / 指导 / 问答」这类场景标签 */
.history-drawer_item-tag {
  display: none;
  flex-shrink: 0;
  height: 36rpx;
  margin-left: 16rpx;
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
.history-drawer_item_active {
  border-radius: 16rpx;
  background: #f5f5f5;
}
.history-drawer_item_active .history-drawer_item-label {
  color: #1a1a1a;
}

.history-drawer_item_current {
  border-radius: 16rpx;
  background: #f3f4f6;
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

.history-drawer__empty {
  margin-top: 32rpx;
  font-size: 24rpx;
  color: #bbc0c9;
}
/* 设计稿 309:3058 / 309:3088：搜索框 203px（406rpx）+ 间距 17px（34rpx）+ 语言切换 66px（132rpx） */
.history-drawer__toolbar {
  display: flex;
  align-items: center;
  gap: 34rpx;
  margin-bottom: 32rpx;
}
/* 设计稿 309:3059：203×44 / 圆角 10px（20rpx）/ 描边 1px（2rpx）#E0E0E0 / 内边距 12px（24rpx） */
.history-drawer__search {
  display: flex;
  width: 406rpx;
  flex: 0 0 406rpx;
  height: 88rpx;
  align-items: center;
  gap: 6rpx;
  padding: 0 24rpx;
  border: 2rpx solid #e0e0e0;
  border-radius: 20rpx;
  box-sizing: border-box;
  background: #ffffff;
}
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
.history-drawer__new-conversation {
  padding: 0;
}
.history-drawer--batch-delete .history-drawer__toolbar,
.history-drawer--batch-delete .history-drawer__new-conversation {
  display: none;
}
.history-drawer__new-conversation-item {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10rpx;
  border-radius: 20rpx;
  background: #f3f3f3;
  padding: 26rpx 0;
}
.history-drawer__new-conversation-item-label {
  font-size: 32rpx;
  color: #1a1a1a;
  line-height: 44rpx;
}
.history-drawer__new-conversation-item-icon {
  width: 36rpx;
  height: 36rpx;
}
.history-drawer__session-history {
  padding: 32rpx 0;
  margin: 0;
}
.history-drawer--batch-delete .history-drawer__session-history {
  padding-top: 0;
}
.history-drawer__session-history-label {
  font-size: 28rpx;
  color: #666666;
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

.history-drawer__multi-btn-text {
  color: #5f6775;
  font-size: 32rpx;
  font-weight: 600;
}

.history-drawer__multi-btn-text--danger {
  color: #e60000;
  font-size: 32rpx;
  font-weight: 600;
}

.history-action-menu-mask {
  position: fixed;
  inset: 0;
  z-index: 1199;
}

.history-action-menu {
  position: fixed;
  left: 36rpx;
  z-index: 1200;
  width: 336rpx;
  height: 274rpx;
  box-sizing: border-box;
  border: 0;
  border-radius: 16rpx;
  background: #ffffff;
  box-shadow: 0 -4rpx 42rpx rgba(0, 0, 0, 0.06);
  padding: 36rpx 32rpx;
}

.history-action-menu__item {
  display: flex;
  align-items: center;
  height: 44rpx;
  gap: 16rpx;
}
.history-action-menu__item + .history-action-menu__item {
  margin-top: 34rpx;
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
</style>
