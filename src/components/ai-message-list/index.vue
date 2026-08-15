<script setup>
import { computed } from "vue";

import AiBubbleV2 from "../ai-bubble-v2/index.vue";

defineOptions({
  name: "AiMessageList",
});

const props = defineProps({
  messages: {
    type: Array,
    default: () => [],
  },
  scrollTop: {
    type: Number,
    default: 0,
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
  keyboardHeightPx: {
    type: Number,
    default: 0,
  },
});

const emit = defineEmits([
  "scroll-top",
  "quick-prompt",
  "suggestion-tap",
  "tts-click",
  "share-click",
  "feedback-change",
  "copy-click",
  "select-toggle",
]);

const keyboardSpacerPx = computed(() => 0);
function resolvePositive(message) {
  if (typeof message?.positive === "boolean") return message.positive;
  if (message?.feedbackValue === "good") return true;
  if (message?.feedbackValue === "bad") return false;
  return null;
}

function isMessageDisabled(index, message) {
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
function onScrollTop() {
  emit("scroll-top");
}

function onQuickPrompt(prompt) {
  emit("quick-prompt", prompt);
}

function onSuggestionTap(suggestion) {
  emit("suggestion-tap", suggestion);
}

function onTtsClick(index) {
  emit("tts-click", index);
}

function onSelectToggle(index) {
  const list = Array.isArray(props.messages) ? props.messages : [];
  const message = list[index] || {};
  if (isMessageDisabled(index, message)) return;

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
</script>

<template>
  <view class="ai-message-list">
    <scroll-view
      class="msg-list"
      scroll-y
      :scroll-top="scrollTop"
      :scroll-into-view="scrollIntoView"
      :scroll-with-animation="false"
      @scrolltoupper="onScrollTop"
    >
      <view v-if="showQuickPrompts" class="business-overview">
        <text class="business-overview__title">
          杜老板，你好。
        </text>
        <text class="business-overview__summary">
          7月28日至8月3日设备作业126小时，较前期增加12%，先看整体变化吧！
        </text>

        <view
          v-if="showQuickList"
          class="business-overview__report"
        >
          <view class="business-overview__sound" aria-hidden="true">
            <text class="business-overview__sound-bar business-overview__sound-bar--short" />
            <text class="business-overview__sound-bar business-overview__sound-bar--tall" />
            <text class="business-overview__sound-bar business-overview__sound-bar--middle" />
          </view>
          <view class="business-overview__report-info">
            <text class="business-overview__report-title">
              经营概览
            </text>
            <text class="business-overview__report-date">
              （0806 年报）
            </text>
          </view>
          <view class="business-overview__listen">
            去收听
          </view>
        </view>

        <view v-if="showQuickList" class="business-overview__questions">
          <view
            v-for="(prompt, index) in quickPrompts"
            :key="`${index}-${prompt}`"
            class="business-overview__question"
            @tap="onQuickPrompt(prompt)"
          >
            {{ prompt }}
          </view>
        </view>
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
            :tts-loading="!!msg.ttsLoading"
            :show-actions="msg.role === 'ai' && !msg.loading && !msg.interrupted"
            :waiting-text="msg.loading ? msg.waitingText : ''"
            :duration-ms="msg.durationMs"
            :positive="resolvePositive(msg)"
            :selected="selectedIndexes.includes(index)"
            :suppress-highlight="suppressHighlight"
            :select-mode="selectMode"
            :disabled="isMessageDisabled(index, msg)"
            @suggestion-tap="onSuggestionTap"
            @tts-click="onTtsClick(index)"
            @share-click="onShareClick(index, msg)"
            @select-toggle="onSelectToggle(index)"
            @feedback-change="onFeedbackChange(index, msg, $event)"
            @copy-click="onCopyClick(index, msg)"
          />
        </view>
      </view>
      <!-- 底部占位，防止被输入框遮挡 -->
      <view style="height: 32rpx" />
      <!-- 键盘占位：防止键盘弹起时底部出现空白/按钮遮挡 -->
      <view
        v-if="keyboardSpacerPx > 0"
        :style="{ height: `${keyboardSpacerPx}px` }"
      />
      <!-- 底部锚点必须位于所有占位元素之后，才能真正滚到底 -->
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
.chat-box {
  padding: 40rpx 40rpx 0;
}
.business-overview {
  padding: 112rpx 40rpx 0;
}

.business-overview__title {
  display: block;
  color: #1a1a1a;
  font-size: 56rpx;
  font-weight: 700;
  line-height: 68rpx;
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
  margin-top: 40rpx;
  padding: 28rpx 32rpx;
  background: #fff;
  border-radius: 22rpx;
  box-shadow: 0 6rpx 22rpx rgb(0 0 0 / 8%);
  gap: 24rpx;
}

.business-overview__sound {
  display: flex;
  align-items: center;
  gap: 5rpx;
  width: 40rpx;
}

.business-overview__sound-bar {
  display: block;
  width: 3rpx;
  background: #363636;
  border-radius: 4rpx;
}

.business-overview__sound-bar--short { height: 14rpx; }
.business-overview__sound-bar--middle { height: 20rpx; }
.business-overview__sound-bar--tall { height: 28rpx; }

.business-overview__report-info {
  display: flex;
  align-items: baseline;
  flex: 1;
  gap: 14rpx;
}

.business-overview__report-title {
  color: #262626;
  font-size: 30rpx;
  font-weight: 600;
}

.business-overview__report-date {
  color: #868686;
  font-size: 22rpx;
}

.business-overview__listen {
  padding: 12rpx 20rpx;
  color: #fff;
  font-size: 26rpx;
  font-weight: 600;
  line-height: 28rpx;
  background: #f11;
  border-radius: 28rpx;
}

.business-overview__questions {
  margin-top: 32rpx;
  border-top: 1px solid #eee;
}

.business-overview__question {
  padding: 24rpx 0;
  color: #343434;
  font-size: 30rpx;
  line-height: 34rpx;
  border-bottom: 1px solid #eee;
}

.business-overview__report:active,
.business-overview__question:active {
  opacity: 0.72;
}
</style>
