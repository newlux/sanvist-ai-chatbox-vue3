<script setup lang="ts">
import { useI18n } from "vue-i18n";
import actionBatchDeleteIcon from "@/assets/img/icon-history-action-batch-delete.svg";
import actionDeleteIcon from "@/assets/img/icon-history-action-delete.svg";
import actionEditIcon from "@/assets/img/icon-history-action-edit.svg";
import { useSafeArea } from "@/hooks/useSafeArea";
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
]);
const logger = createLogger("chat-header");
const { t } = useI18n();
const { safeTopPx } = useSafeArea();
const historyPopup = ref();
const sessionPaging = ref();
const historyLoading = ref(false);
const historySearchKeyword = ref("");
const showActionMenu = ref(false);
const actionSession = ref(null);
const editingMode = ref(false);
const selectedIds = ref([]);
const actionMenuTop = ref(220);
const renamingId = ref("");
const renameValue = ref("");
const ignoreNextLongPressReleaseTap = ref(false);
const isSessionListScrolling = ref(false);
let sessionScrollIdleTimer;

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
  if (!time) return { key: "unknown", title: "更早", order: 900 };
  const dayDiff = Math.floor((todayStart - startOfDay(new Date(time))) / 86400000);
  if (dayDiff <= 0) return { key: "today", title: "今天", order: 0 };
  if (dayDiff === 1) return { key: "yesterday", title: "昨天", order: 1 };
  if (dayDiff < 7) return { key: "week", title: "7 天内", order: 2 };
  if (dayDiff < 30) return { key: "month", title: "30 天内", order: 3 };
  const date = new Date(time);
  const label = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  // 月份分组按时间倒序排在固定分组之后
  return { key: `m-${label}`, title: label, order: 1000 - (date.getFullYear() * 12 + date.getMonth()) };
}

const groupedSessionList = computed(() => {
  const todayStart = startOfDay(new Date());
  const groups = new Map();
  filteredSessionList.value.forEach((session) => {
    const group = resolveSessionGroup(readSessionTime(session), todayStart);
    if (!groups.has(group.key)) {
      groups.set(group.key, { key: group.key, title: group.title, order: group.order, sessions: [] });
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
async function openHistoryDrawer() {
  historyLoading.value = true;
  historyPopup.value?.open?.("left");
  await nextTick();
  sessionPaging.value?.reload?.();
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
function deleteOne() {
  const session = actionSession.value;
  closeActionMenu();
  if (session && getSessionKey(session)) emit("session-delete", session);
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
  if (selectedIds.value.length) emit("session-delete-batch", [...selectedIds.value]);
  cancelMultiSelect();
}

onBeforeUnmount(() => {
  clearTimeout(sessionScrollIdleTimer);
});
</script>

<template>
  <view class="ai-chat-header">
    <view class="chat-header">
      <!-- 状态栏占位：动态读取真实机型状态栏高度 -->
      <view class="chat-header__statusbar" :style="statusbarStyle" />

      <!-- 头部（Figma: 50px, padding 13/16） -->
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

          <view
            class="chat-header__title-wrap"
            :class="{ 'chat-header__title-wrap--generating': props.generating }"
          >
            <view v-if="props.generating" class="chat-header__generating-border">
              <view class="chat-header__generating-border-inner" />
            </view>
            <view v-if="props.generating" class="chat-header__generating-mark">
              <view />
              <view />
            </view>
            <text class="chat-header__title">
              {{ props.generating ? '正在生成回答' : 'Noii 等待中..' }}
            </text>
          </view>

          <view v-if="!props.backOnly" class="chat-header__icon-btn" @tap="onBackTap">
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
              选中所有
            </text>
          </view>

          <view class="chat-header__share-title-wrap">
            <text class="chat-header__share-title">
              选中 {{ shareSelectedRoundCount }} 轮对话
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
          <view class="history-drawer__search">
            <image src="@/assets/img/icon-history-search.svg" mode="aspectFit" class="history-drawer__search-icon" />
            <input
              v-model="historySearchKeyword"
              class="history-drawer__search-input"
              placeholder="搜索历史记录"
              :maxlength="80"
            >
          </view>
          <view class="history-drawer__new-conversation">
            <view class="history-drawer__new-conversation-item" @tap.stop="onNewConversationTap">
              <image
                src="@/assets/img/icon-new-conversation.svg"
                mode="aspectFit"
                class="history-drawer__new-conversation-item-icon"
              />
              <text class="history-drawer__new-conversation-item-label">
                新建对话
              </text>
            </view>
          </view>
          <view class="history-drawer__session-history">
            <text class="history-drawer__session-history-label">
              历史对话
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
            empty-view-text="暂无历史会话"
            @query="onSessionQuery"
            @scroll="onSessionListScroll"
          >
            <view v-if="historyLoading" class="history-drawer__loading" aria-label="正在加载历史记录">
              <view class="history-drawer__loading-spinner" />
              <text class="history-drawer__loading-text">
                正在加载
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
                      {{ session.name || "新对话" }}
                    </text>
                    <text class="history-drawer_item-tag">
                      {{ getSessionSceneLabel(session) }}
                    </text>
                  </view>
                  <view v-if="editingMode" class="history-drawer__check">
                    <image
                      v-if="isSelected(getSessionKey(session))"
                      src="@/assets/img/icon-checked.svg"
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
                  暂无历史对话
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
                删除 {{ selectedIds.length }} 项
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
                删除
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
                修改标题
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
                批量删除
              </text>
            </view>
          </view>
        </view>
      </uni-popup>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ai-chat-header {
  position: relative;
  flex: 0 0 auto;
  z-index: 10;
  background: #fafafa;
  box-shadow: 0 8rpx 24rpx rgba(26, 26, 26, 0.06);
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

.chat-header__title-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 218rpx;
  height: 72rpx;
  padding: 0 24rpx;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 36rpx;
  backdrop-filter: blur(32rpx);
  -webkit-backdrop-filter: blur(32rpx);
  box-shadow: 0 4rpx 8rpx rgba(238, 26, 26, 0.09);
}

.chat-header__title-wrap--generating {
  position: relative;
  min-width: 260rpx;
  height: 72rpx;
  gap: 12rpx;
  padding: 0 28rpx;
  border: 0;
  border-radius: 36rpx;
  background: rgba(255, 255, 255, .9);
  box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, .08);
}

/**
 * 生成中的流光描边。
 * 小程序不支持 svg 元素（会直接报「元素不存在」），这里改用双层圆角视图模拟：
 * 外层跑渐变动画，内层用不透明底色盖住中间，只留下 2rpx 的环。
 */
.chat-header__generating-border {
  position: absolute;
  z-index: 0;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  border-radius: 36rpx;
  background: linear-gradient(90deg, #fff5f5, #ffd0d0, #ff9595, #ff5151, #d90000, #ff5151, #ff9595, #ffd0d0, #fff5f5);
  background-size: 300% 100%;
  animation: header-generating-border 2.4s linear infinite;
  pointer-events: none;
}

.chat-header__generating-border-inner {
  position: absolute;
  top: 2rpx;
  right: 2rpx;
  bottom: 2rpx;
  left: 2rpx;
  border-radius: 34rpx;
  background: #fff;
}

.chat-header__title-wrap--generating > *:not(.chat-header__generating-border) {
  position: relative;
  z-index: 1;
}

.chat-header__generating-mark {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.chat-header__generating-mark view {
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  background: #fe0000;
  animation: header-generating 1.2s ease-in-out infinite;
}

.chat-header__generating-mark view:nth-child(2) { animation-delay: .16s; }

.chat-header__title {
  font-size: 28rpx;
  font-weight: 500;
  color: #1a1a1a;
  line-height: 36rpx;
  letter-spacing: 0;
}

@keyframes header-generating {
  0%, 100% { opacity: .35; transform: scale(.84); }
  50% { opacity: 1; transform: scale(1); }
}

@keyframes header-generating-border {
  0% { background-position: 0 50%; }
  100% { background-position: 300% 50%; }
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

// 分组标题滚动到顶时吸住，盖住下方划过的会话
.history-drawer__group-title {
  position: sticky;
  top: 0;
  z-index: 2;
  padding: 8rpx 0 8rpx;
  background: #ffffff;
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

.history-drawer_item-tag {
  flex-shrink: 0;
  height: 36rpx;
  margin-left: 16rpx;
  padding: 0 12rpx;
  border-radius: 8rpx;
  background: #fff2f3;
  color: #fe0000;
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
.history-drawer__search {
  height: 88rpx;
  margin-bottom: 32rpx;
  padding: 0 24rpx;
  display: flex;
  align-items: center;
  gap: 6rpx;
  box-sizing: border-box;
  border: 2rpx solid #e0e0e0;
  border-radius: 20rpx;
  background: #ffffff;
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
.history-drawer--batch-delete .history-drawer__search,
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
  border-color: #f12832;
  background: #f12832;
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
</style>
