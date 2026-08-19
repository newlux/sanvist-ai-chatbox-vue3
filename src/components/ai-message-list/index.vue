<script setup>
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
  awakening: {
    type: Object,
    default: null,
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

const FALLBACK_OVERVIEW = {
  greeting: "杜老板，你好。",
  summary: "7月28日至8月3日设备作业126小时，较前期增加12%，先看整体变化吧！",
};

// 键盘占位：键盘弹起时给消息列表底部留出键盘高度空间，
// 防止 scroll-view 滚到底时最后一条消息/底部按钮被键盘遮住。
const keyboardSpacerPx = computed(() => Math.max(0, Number(props.keyboardHeightPx) || 0));

const overview = computed(() => {
  const data = props.awakening;
  if (!data) return FALLBACK_OVERVIEW;
  const greeting = data.userName ? `${data.userName}，你好。` : FALLBACK_OVERVIEW.greeting;
  const summary = data.content || FALLBACK_OVERVIEW.summary;
  return { greeting, summary };
});
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
          {{ overview.greeting }}
        </text>
        <text class="business-overview__summary">
          {{ overview.summary }}
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
              （0806 早报）
            </text>
          </view>
          <view class="business-overview__listen">
            去收听
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
            :no-answer-group="!!msg.noAnswerGroup"
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
  padding: 0 40rpx;
}
.business-overview {
  padding: 148rpx 40rpx 0;
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
}

.business-overview__report {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 40rpx;
  padding: 24rpx 32rpx;
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
  gap: 28rpx;
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
