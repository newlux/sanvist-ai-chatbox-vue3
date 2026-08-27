<script setup lang="ts">
import type { AiBlock } from "@/utils/ai-stream";
import { computed, nextTick, ref } from "vue";

import iconCopy from "@/assets/img/icon-action-copy.svg";
import iconRadioOff from "@/assets/img/icon-action-radio-off.svg";
import iconRadioOn from "@/assets/img/icon-action-radio-on.svg";
import iconShare from "@/assets/img/icon-action-share.svg";
import iconBadFilled from "@/assets/img/icon-bad-fill.svg";
import iconBad from "@/assets/img/icon-bad.svg";
import iconGoodFilled from "@/assets/img/icon-good-fill.svg";
import iconGood from "@/assets/img/icon-good.svg";

import { formatFileSize } from "@/hooks/useComposerAttachments";
import AiContentBlocks from "./AiContentBlocks.vue";

defineOptions({ name: "AiBubbleV2" });

const props = defineProps({
  role: { type: String, default: "ai" },
  content: { type: String, default: "" },
  blocks: { type: Array as () => AiBlock[], default: () => [] },
  loading: { type: Boolean, default: false },
  ttsEnabled: { type: Boolean, default: false },
  ttsLoading: { type: Boolean, default: false },
  ttsPlaying: { type: Boolean, default: false },
  showActions: { type: Boolean, default: false },
  waitingText: { type: String, default: "" },
  /** 用户消息随行的附件：图片直接出图，其它文件出卡片 */
  attachments: { type: Array, default: () => [] },
  interrupted: { type: Boolean, default: false },
  durationMs: { type: Number, default: null },
  positive: { type: Boolean, default: null },
  selected: { type: Boolean, default: false },
  suppressHighlight: { type: Boolean, default: false },
  selectMode: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  forceThinkingExpanded: { type: Boolean, default: false },
  hideSuggestion: { type: Boolean, default: false },
  // 分享海报场景：不渲染「输出结果」分组标题
  noAnswerGroup: { type: Boolean, default: false },
  /** 语音已松手、ASR 尚未返回：展示「识别中...」占位 */
  asrPending: { type: Boolean, default: false },
});

const emit = defineEmits([
  "suggestion-tap",
  "tts-click",
  "share-click",
  "feedback-change",
  "copy-click",
  "select-toggle",
  "longpress-copy",
]);

async function copyText(text) {
  const value = String(text || "").trim();
  if (!value) return false;

  try {
    if (typeof uni !== "undefined" && typeof uni.setClipboardData === "function") {
      await new Promise((resolve, reject) => {
        uni.setClipboardData({
          data: value,
          success: resolve,
          fail: reject,
        });
      });
      return true;
    }
  } catch {
    // 回退到浏览器剪贴板 API
  }

  try {
    if (typeof navigator !== "undefined" && navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // 忽略
  }

  return false;
}

/** 点开大图。同一条消息里的图片一起进预览，可以左右翻 */
function onPreviewImage(url) {
  const urls = props.attachments
    .filter(item => item?.type === "image" && item?.url)
    .map(item => item.url);
  if (!urls.length) return;
  uni.previewImage({ current: url, urls });
}

const USER_MENU_GAP_PX = 12;
const showUserMenu = ref(false);
const userMenuRef = ref<HTMLElement | { $el?: HTMLElement } | null>(null);
const userMenuPos = ref({ left: USER_MENU_GAP_PX, top: USER_MENU_GAP_PX });

function clampUserMenuPosition(x: number, y: number, width: number, height: number) {
  const maxLeft = Math.max(USER_MENU_GAP_PX, window.innerWidth - width - USER_MENU_GAP_PX);
  const maxTop = Math.max(USER_MENU_GAP_PX, window.innerHeight - height - USER_MENU_GAP_PX);
  userMenuPos.value = {
    left: Math.max(USER_MENU_GAP_PX, Math.min(x, maxLeft)),
    top: Math.max(USER_MENU_GAP_PX, Math.min(y, maxTop)),
  };
}

async function onUserLongpress(event: any) {
  if (props.selectMode || props.disabled) return;

  const touch = event?.changedTouches?.[0] || event?.touches?.[0] || event?.detail;
  const x = Number(touch?.clientX ?? touch?.pageX ?? USER_MENU_GAP_PX);
  const y = Number(touch?.clientY ?? touch?.pageY ?? USER_MENU_GAP_PX);
  showUserMenu.value = true;
  await nextTick();
  const menuRef = userMenuRef.value;
  const menuEl = menuRef instanceof HTMLElement ? menuRef : menuRef?.$el;
  const rect = menuEl?.getBoundingClientRect();
  clampUserMenuPosition(x, y, rect?.width || 100, rect?.height || 56);
}

function closeUserMenu() {
  showUserMenu.value = false;
}

async function onUserMenuCopy() {
  const copied = await copyText(props.content);
  if (typeof uni !== "undefined" && typeof uni.showToast === "function") {
    uni.showToast({
      title: copied ? "已复制" : "复制失败",
      icon: "none",
    });
  }
  closeUserMenu();
}

const isUser = computed(() => props.role === "user");
const visibleBlocks = computed(() =>
  props.hideSuggestion
    ? props.blocks.filter(block => block && block.type !== "suggestion")
    : props.blocks,
);

/**
 * 等待条：模型还没吐出内容时的占位。
 * 被中断后不撤掉，只把状态字改成「已停止」——否则没来得及出内容的那一轮
 * 会变成一个空气泡，用户看不出这轮发生了什么。
 */
const showWaiting = computed(
  () => Boolean(props.waitingText) && (props.loading || props.interrupted),
);

function onSelectTap() {
  if (props.selectMode && !props.disabled) emit("select-toggle");
}

function onSuggestionTap(event) {
  emit("suggestion-tap", event);
}

function onShareTap() {
  emit("share-click");
}

function onCopyTap() {
  emit("copy-click");
}

function onTtsTap() {
  if (!props.ttsEnabled) return;
  emit("tts-click");
}

function onFeedbackChange(value) {
  emit("feedback-change", value);
}

function onPositiveFeedback() {
  onFeedbackChange(props.positive === true ? "" : "good");
}

function onNegativeFeedback() {
  onFeedbackChange(props.positive === false ? "" : "bad");
}
</script>

<template>
  <view
    class="ai-bubble-v2"
    :class="{
      'ai-bubble-v2--selected': props.selectMode,
      'ai-bubble-v2--disabled': props.disabled,
      'ai-bubble-v2--user': isUser,
      'ai-bubble-v2--no-answer-group': props.noAnswerGroup,
    }"
    @tap="onSelectTap"
  >
    <!-- 长按用户消息弹出的跟随菜单（复制，后续可扩展删除） -->
    <Teleport to="body">
      <view v-if="showUserMenu" class="ai-bubble-v2-menu-mask" @tap="closeUserMenu" />
      <view
        v-if="showUserMenu"
        ref="userMenuRef"
        class="ai-bubble-v2-menu"
        :style="{ left: `${userMenuPos.left}px`, top: `${userMenuPos.top}px` }"
        @tap.stop
      >
        <view class="ai-bubble-v2-menu__item" @tap="onUserMenuCopy">
          <view class="ai-bubble-v2-menu__icon">
            <image :src="iconCopy" mode="aspectFit" class="ai-bubble-v2-menu__icon-img" />
          </view>
          <text class="ai-bubble-v2-menu__text">
            复制
          </text>
        </view>
      </view>
    </Teleport>
    <view v-if="props.selectMode" class="ai-bubble-v2__check">
      <image
        v-if="props.disabled"
        src="@/assets/img/icon-checkDisabled.svg"
        mode="aspectFit"
        class="ai-bubble-v2__check-img"
      />
      <image
        v-else-if="props.selected"
        src="@/assets/img/icon-checked.svg"
        mode="aspectFit"
        class="ai-bubble-v2__check-img"
      />
      <image
        v-else
        src="@/assets/img/icon-check.svg"
        mode="aspectFit"
        class="ai-bubble-v2__check-img"
      />
    </view>

    <!-- 附件独立成条，不塞进文字气泡里 -->
    <view v-if="isUser && props.attachments.length" class="ai-bubble-v2__files">
      <template v-for="(file, fileIndex) in props.attachments" :key="fileIndex">
        <image
          v-if="file.type === 'image'"
          class="ai-bubble-v2__file-image"
          mode="aspectFill"
          :src="file.url"
          @tap.stop="onPreviewImage(file.url)"
        />
        <view v-else class="ai-bubble-v2__file-card">
          <image
            class="ai-bubble-v2__file-icon"
            src="@/assets/img/icon-form.svg"
            mode="aspectFit"
          />
          <view class="ai-bubble-v2__file-info">
            <text class="ai-bubble-v2__file-name">
              {{ file.name || "附件" }}
            </text>
            <text v-if="formatFileSize(file.size)" class="ai-bubble-v2__file-size">
              {{ formatFileSize(file.size) }}
            </text>
          </view>
        </view>
      </template>
    </view>

    <view v-if="!isUser || props.content" class="ai-bubble-v2__body">
      <template v-if="isUser">
        <view v-if="props.asrPending" class="ai-bubble-v2__asr" aria-label="识别中">
          <text class="ai-bubble-v2__asr-label">
            {{ props.content }}
          </text>
          <text class="ai-bubble-v2__asr-dot">
            .
          </text>
          <text class="ai-bubble-v2__asr-dot">
            .
          </text>
          <text class="ai-bubble-v2__asr-dot">
            .
          </text>
        </view>
        <text
          v-else
          class="ai-bubble-v2__user-content"
          :selectable="true"
          :user-select="true"
          @longpress="onUserLongpress"
        >
          {{ props.content }}
        </text>
      </template>

      <template v-else>
        <view
          v-if="showWaiting"
          class="ai-bubble-v2__waiting"
          :class="{ 'ai-bubble-v2__waiting--stopped': props.interrupted }"
        >
          <text class="ai-bubble-v2__waiting-mark">
            ✓
          </text>
          <text class="ai-bubble-v2__waiting-label">
            {{ props.interrupted ? "已停止：" : "等待模型响应：" }}
          </text>
          <text class="ai-bubble-v2__waiting-query">
            {{ props.waitingText }}
          </text>
          <text v-if="!props.interrupted" class="ai-bubble-v2__waiting-suffix">
            努力链接中
          </text>
        </view>
        <!-- 流式失败等场景只有纯文本没有 blocks，不兜住就是一个空气泡 -->
        <text v-if="!visibleBlocks.length && props.content" class="ai-bubble-v2__ai-content">
          {{ props.content }}
        </text>
        <AiContentBlocks
          :blocks="visibleBlocks"
          :force-thinking-expanded="props.forceThinkingExpanded"
          :no-answer-group="props.noAnswerGroup"
          @suggestion-tap="onSuggestionTap"
        />
        <view v-if="props.showActions && !props.loading" class="ai-bubble-v2__actions">
          <view
            v-if="props.ttsEnabled"
            class="ai-bubble-v2__action-btn"
            @tap.stop="onTtsTap"
          >
            <view v-if="props.ttsLoading" class="ai-bubble-v2__tts-spinner" />
            <image
              v-else
              :src="props.ttsPlaying ? iconRadioOff : iconRadioOn"
              mode="aspectFit"
              class="ai-bubble-v2__action-icon"
            />
          </view>
          <view class="ai-bubble-v2__action-btn" @tap.stop="onCopyTap">
            <image :src="iconCopy" mode="aspectFit" class="ai-bubble-v2__action-icon" />
          </view>
          <view class="ai-bubble-v2__action-btn" @tap.stop="onShareTap">
            <image :src="iconShare" mode="aspectFit" class="ai-bubble-v2__action-icon" />
          </view>
          <view
            class="ai-bubble-v2__action-btn"
            :class="{ 'ai-bubble-v2__action-btn--liked': props.positive === true }"
            @tap.stop="onPositiveFeedback"
          >
            <image
              :src="props.positive === true ? iconGoodFilled : iconGood"
              mode="aspectFit"
              class="ai-bubble-v2__action-icon"
            />
          </view>
          <view
            class="ai-bubble-v2__action-btn"
            :class="{ 'ai-bubble-v2__action-btn--disliked': props.positive === false }"
            @tap.stop="onNegativeFeedback"
          >
            <image
              :src="props.positive === false ? iconBadFilled : iconBad"
              mode="aspectFit"
              class="ai-bubble-v2__action-icon"
            />
          </view>
          <text v-if="props.durationMs !== null" class="ai-bubble-v2__duration">
            已消耗 {{ props.durationMs }} ms
          </text>
        </view>
      </template>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ai-bubble-v2 {
  display: flex;
  margin-bottom: 40rpx;
  gap: 16rpx;
}

.ai-bubble-v2--selected {
  justify-content: space-between;
}
.ai-bubble-v2--user {
  flex-direction: column;
  align-items: flex-end;
  justify-content: flex-end;
}
.ai-bubble-v2--user.ai-bubble-v2--selected {
  flex-direction: row;
  align-items: center;
}
.ai-bubble-v2__check {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.ai-bubble-v2--user.ai-bubble-v2--selected .ai-bubble-v2__check {
  order: 1;
}
.ai-bubble-v2__check-img {
  width: 32rpx;
  height: 32rpx;
}
.ai-bubble-v2__body {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  box-sizing: border-box;
  // 气泡内所有文字都可以划词复制：表格、指标、图表降级清单里的 text 也一并放开
  -webkit-user-select: text;
  user-select: text;
}

.ai-bubble-v2__body text,
.ai-bubble-v2__body uni-text {
  -webkit-user-select: text;
  user-select: text;
}
.ai-bubble-v2:not(.ai-bubble-v2--user) .ai-bubble-v2__body {
  padding: 40rpx;
  border: 1rpx solid #eeeeee;
  border-radius: 32rpx;
  background: #ffffff;
  box-shadow: 0 8rpx 20rpx rgba(0, 0, 0, 0.04);
}
.ai-bubble-v2--no-answer-group:not(.ai-bubble-v2--user) .ai-bubble-v2__body {
  padding: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.ai-bubble-v2--user .ai-bubble-v2__body {
  flex: 0 1 auto;
  max-width: calc(100% - 64rpx);
  padding: 22rpx 32rpx;
  border-radius: 28rpx;
  background: #c8201e;
}
.ai-bubble-v2__body--highlighted {
  background: rgba(248, 49, 94, 0.06);
}
.ai-bubble-v2--user .ai-bubble-v2__user-content {
  font-size: 28rpx;
  line-height: 40rpx;
  color: #ffffff;
  white-space: pre-wrap;
  word-break: break-word;
  // 允许划词选中复制；长按仍走整条复制
  -webkit-user-select: text;
  user-select: text;
}

.ai-bubble-v2__asr {
  display: flex;
  align-items: baseline;
  font-size: 28rpx;
  line-height: 40rpx;
  color: #ffffff;
}

.ai-bubble-v2__asr-dot {
  opacity: 0.25;
  animation: asr-dot-blink 1.2s ease-in-out infinite;
}

.ai-bubble-v2__asr-dot:nth-child(2) { animation-delay: 0s; }
.ai-bubble-v2__asr-dot:nth-child(3) { animation-delay: 0.2s; }
.ai-bubble-v2__asr-dot:nth-child(4) { animation-delay: 0.4s; }

@keyframes asr-dot-blink {
  0%, 20% { opacity: 0.2; }
  40% { opacity: 1; }
  100% { opacity: 0.2; }
}

/* 长按用户消息弹出的跟随菜单 */
.ai-bubble-v2-menu-mask {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 2000;
}
.ai-bubble-v2-menu {
  position: fixed;
  z-index: 2001;
  display: flex;
  flex-direction: column;
  min-width: 200rpx;
  padding: 12rpx 0;
  border-radius: 20rpx;
  background: #ffffff;
  box-shadow: 0 8rpx 32rpx rgba(0, 0, 0, 0.12);
}
.ai-bubble-v2-menu__item {
  display: flex;
  align-items: center;
  gap: 16rpx;
  height: 88rpx;
  padding: 0 28rpx;
}
.ai-bubble-v2-menu__item:active {
  background: #f5f5f5;
}
.ai-bubble-v2-menu__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36rpx;
  height: 36rpx;
}
.ai-bubble-v2-menu__icon-img {
  width: 36rpx;
  height: 36rpx;
}
.ai-bubble-v2-menu__text {
  font-size: 28rpx;
  color: #333333;
}
.ai-bubble-v2__ai-content {
  display: block;
  color: #2f323c;
  font-size: 28rpx;
  line-height: 42rpx;
  white-space: pre-wrap;
  word-break: break-word;
}
.ai-bubble-v2__files {
  max-width: calc(100% - 64rpx);
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12rpx;
  // 与下方文字气泡之间的间距；没有文字时这条留白也不碍事
  margin-bottom: 16rpx;
}

.ai-bubble-v2__file-image {
  width: 320rpx;
  height: 320rpx;
  border-radius: 20rpx;
  background: #f1f2f4;
}

.ai-bubble-v2__file-card {
  max-width: 460rpx;
  display: flex;
  align-items: center;
  box-sizing: border-box;
  padding: 20rpx 24rpx;
  border: 1rpx solid #eeeeee;
  border-radius: 20rpx;
  background: #ffffff;
  box-shadow: 0 8rpx 20rpx rgba(0, 0, 0, 0.04);
}

.ai-bubble-v2__file-icon {
  width: 44rpx;
  height: 44rpx;
  flex-shrink: 0;
}

.ai-bubble-v2__file-info {
  min-width: 0;
  margin-left: 16rpx;
  display: flex;
  flex-direction: column;
}

.ai-bubble-v2__file-name,
.ai-bubble-v2__file-size {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ai-bubble-v2__file-name {
  color: #1a1a1a;
  font-size: 26rpx;
  line-height: 36rpx;
}

.ai-bubble-v2__file-size {
  margin-top: 2rpx;
  color: #999999;
  font-size: 22rpx;
  line-height: 30rpx;
}

.ai-bubble-v2__waiting {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8rpx;
  margin-bottom: 24rpx;
  color: #a5a5a5;
  font-family: "PingFang SC";
  font-size: 26rpx;
  line-height: 36rpx;
}
.ai-bubble-v2__waiting-mark {
  color: #a5a5a5;
  font-size: 24rpx;
  line-height: 36rpx;
}
.ai-bubble-v2__waiting-label,
.ai-bubble-v2__waiting-query,
.ai-bubble-v2__waiting-suffix {
  color: #a5a5a5;
  font-weight: 400;
}
// 已停止：和「等待响应」用同一行样式，只把状态字加深一点区分出来
.ai-bubble-v2__waiting--stopped .ai-bubble-v2__waiting-mark,
.ai-bubble-v2__waiting--stopped .ai-bubble-v2__waiting-label {
  color: #7b7b7b;
}
.ai-bubble-v2__duration {
  color: #bababa;
  font-size: 22rpx;
  line-height: 32rpx;
  white-space: nowrap;
}
.ai-bubble-v2__typing {
  display: flex;
  gap: 8rpx;
  align-items: center;
  padding: 6rpx 4rpx;
}
.ai-bubble-v2__dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  background: #bbc0c9;
  animation: typing-blink 1.2s infinite;
}
.ai-bubble-v2__dot:nth-child(2) {
  animation-delay: 0.2s;
}
.ai-bubble-v2__dot:nth-child(3) {
  animation-delay: 0.4s;
}
.ai-bubble-v2__streaming {
  padding-top: 24rpx;
}
.ai-bubble-v2__actions {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 28rpx;
  margin-top: 32rpx;
  padding-top: 28rpx;
  border-top: 2rpx solid #f0f0f2;
}
.ai-bubble-v2__action-btn {
  width: 32rpx;
  height: 32rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ai-bubble-v2__action-icon {
  width: 32rpx;
  height: 32rpx;
}
.ai-bubble-v2__tts-spinner {
  width: 24rpx;
  height: 24rpx;
  box-sizing: border-box;
  border: 3rpx solid rgba(136, 136, 136, 0.22);
  border-top-color: #888888;
  border-radius: 50%;
  animation: ai-bubble-tts-spin 0.8s linear infinite;
}
.ai-bubble-v2__duration {
  margin-left: 8rpx;
}

@keyframes ai-bubble-tts-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes typing-blink {
  0%,
  80%,
  100% {
    opacity: 0.2;
    transform: scale(0.8);
  }
  40% {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
