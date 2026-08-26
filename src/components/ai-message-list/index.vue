<script setup lang="ts">
import type { UiChatMessage } from "@/stores/chat-types";
import moment from "moment";
import { LISTEN_REPORT_DATE_KEY } from "@/config";
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
  awakening: {
    type: Object,
    default: null,
  },
  awakeningLoading: {
    type: Boolean,
    default: false,
  },
  /** 外部（发送、切会话）强制回到底部时会置回 true，组件内的跟随状态要跟着复位 */
  pinnedToBottom: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits([
  "scroll-top",
  "pinned-change",
  "quick-prompt",
  "suggestion-tap",
  "tts-click",
  "share-click",
  "feedback-change",
  "copy-click",
  "select-toggle",
  "listen-report",
]);

const FALLBACK_OVERVIEW = {
  greeting: "杜老板，你好。",
  summary: "7月28日至8月3日设备作业126小时，较前期增加12%，先看整体变化吧！",
};

const overview = computed(() => {
  const data = props.awakening;
  if (!data) return FALLBACK_OVERVIEW;
  const greeting = data.userName ? `${data.userName}，你好。` : FALLBACK_OVERVIEW.greeting;
  const summary = data.content || FALLBACK_OVERVIEW.summary;
  return { greeting, summary };
});
function resolvePositive(message: UiChatMessage) {
  if (typeof message?.positive === "boolean") return message.positive;
  if (message?.feedbackValue === "good") return true;
  if (message?.feedbackValue === "bad") return false;
  return null;
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
const UNPIN_SCROLL_UP_PX = 12;
let lastScrollTop = 0;

function setPinned(pinned: boolean) {
  if (pinned === props.pinnedToBottom) return;
  emit("pinned-change", pinned);
}

function onScroll(e: { detail?: { scrollTop?: number } }) {
  const scrollTop = Number(e?.detail?.scrollTop) || 0;
  if (scrollTop < lastScrollTop - UNPIN_SCROLL_UP_PX) setPinned(false);
  lastScrollTop = scrollTop;
}

function onScrollToLower() {
  setPinned(true);
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

function getListenReportDate() {
  try {
    return String(uni.getStorageSync(LISTEN_REPORT_DATE_KEY) || "");
  } catch {
    return "";
  }
}

function isListenedToday() {
  const listenedDate = getListenReportDate();
  if (!listenedDate) return false;

  const tomorrow = moment().add(1, "day").startOf("day");
  return moment(listenedDate, "YYYY-MM-DD", true).isSame(tomorrow, "day");
}

const listenedReport = ref(isListenedToday());

/** “去收听”：首次点击标记当天已收听，并跳转到汇报会话页。 */
function onListenReport() {
  if (!listenedReport.value) {
    try {
      uni.setStorageSync(LISTEN_REPORT_DATE_KEY, moment().add(1, "day").format("YYYY-MM-DD"));
    } catch {
      // 本地存储不可用时仍允许进入汇报会话。
    }
    listenedReport.value = true;
  }
  emit("listen-report");
}
</script>

<template>
  <view class="ai-message-list">
    <scroll-view
      class="msg-list"
      scroll-y
      :scroll-into-view="scrollIntoView"
      :scroll-with-animation="false"
      @scroll="onScroll"
      @scrolltolower="onScrollToLower"
      @scrolltoupper="onScrollTop"
    >
      <view v-if="showQuickPrompts" class="business-overview">
        <view v-if="awakeningLoading" class="business-overview__loading">
          <view class="business-overview__spinner" />
        </view>
        <template v-else>
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
            :tts-loading="!!msg.ttsLoading"
            :tts-playing="!!msg.ttsPlaying"
            :show-actions="msg.role === 'ai' && !msg.loading && !msg.interrupted"
            :waiting-text="msg.waitingText"
            :attachments="msg.attachments || []"
            :interrupted="!!msg.interrupted"
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
      <view v-if="bottomInset" :style="{ height: bottomInset }" />
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
.chat-box {
  padding: 40rpx 40rpx 0;
}
.business-overview {
  padding: 148rpx 40rpx 0;
}

.business-overview__loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 220rpx;
}

.business-overview__spinner {
  width: 56rpx;
  height: 56rpx;
  border: 6rpx solid rgb(95 103 117 / 20%);
  border-top-color: #c8201e;
  border-radius: 50%;
  animation: business-overview-spin 0.9s linear infinite;
}

@keyframes business-overview-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
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
