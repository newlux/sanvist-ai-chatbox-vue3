<script setup>
import { useI18n } from "vue-i18n";
import { useSystemStore } from "@/stores";

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

console.log("🚀 ~ shareMode:", props.shareMode.value);

const { t } = useI18n();
const systemStore = useSystemStore();
const historyPopup = ref();
const sessionPaging = ref();
const showActionMenu = ref(false);
const actionSession = ref(null);
const editingMode = ref(false);
const selectedIds = ref([]);
const actionMenuTop = ref(220);
const renamingId = ref("");
const renameValue = ref("");
const ignoreNextLongPressReleaseTap = ref(false);

const sessionList = computed({
  get: () => props.sessions,
  set: sessions => emit("update:sessions", sessions),
});
const actionMenuStyle = computed(() => ({ top: `${actionMenuTop.value}px` }));

const statusbarStyle = computed(() => {
  const height = Number(systemStore.statusBarHeight) || 0;
  return height > 0 ? { height: `${height}px` } : { height: "env(safe-area-inset-top, 0px)" };
});

function getSessionKey(session) {
  return session?.id || "";
}

function onBackTap() {
  emit("back");
}
function onShareSelectAllTap() {
  if (!props.shareSelectAllDisabled) emit("share-select-all");
}
function openHistoryDrawer() {
  historyPopup.value?.open?.("left");
  sessionPaging.value?.reload?.();
}
async function onSessionQuery(pageNo, pageSize) {
  try {
    const result = await props.loadSessions?.(pageNo, pageSize);
    sessionPaging.value?.completeByNoMore?.(result?.data || [], !result?.hasMore);
  } catch (error) {
    console.error("[AiChatHeader] load sessions failed", error);
    sessionPaging.value?.complete?.(false);
  }
}
function closeDrawer() {
  historyPopup.value?.close?.("left");
}
function resetDrawerState() {
  showActionMenu.value = false;
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

function onSessionLongPress(session, event) {
  if (editingMode.value) return;
  if (renamingId.value) commitRename();
  actionSession.value = session || null;
  ignoreNextLongPressReleaseTap.value = true;
  const point = event?.changedTouches?.[0] || event?.touches?.[0] || event?.detail || {};
  const y = Number(point.clientY || point.pageY || event?.clientY || 220);
  let top = y + 18;
  try {
    const info = uni.getSystemInfoSync();
    const windowHeight = info?.windowHeight || 667;
    const menuHeight = 190;
    const minTop = Math.max(Number(systemStore.statusBarHeight) || 0, 88);
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

function closeActionMenu() {
  if (consumeLongPressReleaseTap()) return;
  showActionMenu.value = false;
}
function onDrawerTap() {
  if (renamingId.value) commitRename();
}

function onRenameTap() {}

function onSessionTap(session) {
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
function isSelected(id) {
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

function onRenameInput(event) {
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
  showActionMenu.value = false;
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
</script>

<template>
  <view class="ai-chat-header">
    <view class="chat-header">
      <!-- 状态栏占位：动态读取真实机型状态栏高度 -->
      <view class="chat-header__statusbar" :style="statusbarStyle" />

      <!-- 头部（Figma: 50px, padding 13/16） -->
      <view class="chat-header__bar">
        <template v-if="!shareMode">
          <view class="chat-header__icon-btn" @tap="openHistoryDrawer">
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
            <svg
              v-if="props.generating"
              class="chat-header__generating-border"
              viewBox="0 0 260 72"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="generating-border-gradient" x1="0" y1="0" x2="260" y2="0" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stop-color="#fff5f5" />
                  <stop offset="26%" stop-color="#ffd0d0" />
                  <stop offset="50%" stop-color="#ff9595" />
                  <stop offset="74%" stop-color="#ff5151" />
                  <stop offset="100%" stop-color="#d90000" />
                  <animateTransform attributeName="gradientTransform" type="rotate" from="0 130 36" to="360 130 36" dur="2.4s" repeatCount="indefinite" />
                </linearGradient>
              </defs>
              <rect
                x="2" y="2" width="256" height="68" rx="34"
                fill="none"
                stroke="url(#generating-border-gradient)"
                stroke-width="2.4"
              >
                <animate attributeName="stroke-width" values="2.4;4;2.4" dur="1.8s" repeatCount="indefinite" />
                <animate attributeName="stroke-opacity" values=".76;1;.76" dur="1.8s" repeatCount="indefinite" />
              </rect>
            </svg>
            <view v-if="props.generating" class="chat-header__generating-mark">
              <view />
              <view />
            </view>
            <text class="chat-header__title">
              {{ props.generating ? '正在生成回答' : 'Noyi 休息中..' }}
            </text>
          </view>

          <view class="chat-header__icon-btn" @tap="onBackTap">
            <view class="chat-header__icon-atlas">
              <image
                src="@/assets/img/icon-home.svg"
                mode="aspectFit"
                class="chat-header__icon-atlas-img"
              />
            </view>
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
        :safe-area="true"
        :is-mask-click="true"
      >
        <view class="history-drawer" @tap.stop="onDrawerTap">
          <view class="history-drawer__top">
            <image
              src="@/assets/img/icon-ai.png"
              mode="aspectFit"
              class="history-drawer__icon-img"
            />
            <text class="history-drawer__title">
              AI 问问
            </text>
          </view>
          <view class="history-drawer__new-conversation">
            <view class="history-drawer__new-conversation-item" @tap.stop="onNewConversationTap">
              <image
                src="@/assets/img/icon-conversation.png"
                mode="aspectFit"
                class="history-drawer__new-conversation-item-icon"
              />
              <text class="history-drawer__new-conversation-item-label">
                新对话
              </text>
            </view>
          </view>
          <view class="history-drawer__session-history">
            <text class="history-drawer__session-history-label">
              历史回答
            </text>
          </view>
          <z-paging
            ref="sessionPaging"
            v-model="sessionList"
            class="history-drawer__list-wrap"
            :auto="false"
            :fixed="false"
            height="100%"
            :use-page-scroll="false"
            :default-page-size="20"
            :refresher-enabled="false"
            empty-view-text="暂无历史会话"
            @query="onSessionQuery"
          >
            <view class="history-drawer__list">
              <view
                v-for="session in sessionList"
                :key="getSessionKey(session)"
                class="history-drawer__row"
                :class="{ 'history-drawer__row--editing': editingMode }"
                @longpress="onSessionLongPress(session, $event)"
                @tap="onSessionTap(session)"
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
        </view>
      </uni-popup>

      <view v-if="showActionMenu" class="history-action-mask" @tap="closeActionMenu">
        <view class="history-action-menu" :style="actionMenuStyle" @tap.stop>
          <view class="history-action-menu__item" @tap="deleteOne">
            <view class="history-action-menu__icon-delete">
              <image
                src="@/assets/img/icon-delete.svg"
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
                src="@/assets/img/icon-edit.svg"
                mode="aspectFit"
                class="history-action-menu__icon-img"
              />
            </view>
            <text class="history-action-menu__text">
              重命名
            </text>
          </view>
          <view class="history-action-menu__item" @tap="enterMultiSelect">
            <view class="history-action-menu__icon-multiple">
              <image
                src="@/assets/img/icon-multiple.svg"
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
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ai-chat-header {
  position: relative;
}

.chat-header {
  position: sticky;
  top: 0;
  z-index: 10;
}

.chat-header__statusbar {
  // 高度由 JS 动态注入（statusbarStyle computed）
  // 此处仅作渲染前的最小兜底，避免初始闪烁
  min-height: env(safe-area-inset-top, 0px);
}

.chat-header__bar {
  height: 100rpx; // 50px
  display: flex;
  align-items: center;
  padding: 8rpx 40rpx; // 4px 20px
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

.chat-header__generating-border {
  position: absolute;
  z-index: 0;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
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
  width: 520rpx;
  max-width: 80vw;
  height: 100vh;
  background: #ffffff;
  box-sizing: border-box;
  padding: 24rpx 32rpx calc(32rpx + constant(safe-area-inset-bottom));
  padding: 24rpx 32rpx calc(32rpx + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.history-drawer__top {
  display: flex;
  align-items: center;
  margin: 0 0 40rpx;
  gap: 16rpx;
}

.history-drawer__title {
  font-size: 32rpx;
  font-weight: 600;
  color: #232323;
}

.history-drawer__list {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  padding: 0 0 40px;
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
  padding: 28rpx 20rpx;
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}
.history-drawer_item-label {
  font-size: 28rpx;
  color: #111827;
  flex: 1;
  min-width: 0;
  font-weight: 400;
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
  border-radius: 16px;
  background: #f9f9f9;
}
.history-drawer_item_active .history-drawer_item-label {
  color: #111827;
  font-weight: 400;
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
.history-drawer__new-conversation {
  padding: 0;
}
.history-drawer__new-conversation-item {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16rpx;
  border-radius: 16rpx;
  background: #f9f9f9;
  padding: 24rpx 0;
}
.history-drawer__new-conversation-item-label {
  font-size: 28rpx;
  color: #232323;
  font-weight: 600;
}
.history-drawer__new-conversation-item-icon {
  width: 48rpx;
  height: 48rpx;
}
.history-drawer__session-history {
  padding: 24rpx 0;
  margin: 16rpx 0 0;
}
.history-drawer__session-history-label {
  font-size: 24rpx;
  color: #bbc0c9;
}
.history-drawer__list-wrap {
  flex: 1;
  min-height: 0;
  height: 0;
  overflow-y: auto;
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

.history-action-mask {
  position: fixed;
  inset: 0;
  z-index: 1200;
}

.history-action-menu {
  position: fixed;
  left: 32rpx;
  width: 280rpx;
  border-radius: 16rpx;
  background: #ffffff;
  box-shadow: 2rpx 2rpx 20rpx rgba(0, 0, 0, 0.1);
  padding: 32rpx;
  display: flex;
  flex-direction: column;
  gap: 48rpx;
}

.history-action-menu__item {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.history-action-menu__text {
  font-size: 28rpx;
  color: #1f2937;
}

.history-action-menu__text--danger {
  color: #e60000;
}
.history-action-menu__icon-img {
  width: 32rpx;
  height: 32rpx;
}
</style>
