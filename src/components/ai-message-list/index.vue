<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";

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
  "refresh-click",
  "select-toggle",
]);

const { t } = useI18n();

const keyboardSpacerPx = computed(() => 0);
const promptRowsBase = computed(() => {
  const rows = [[], [], []];
  const prompts = Array.isArray(props.quickPrompts) ? props.quickPrompts : [];
  prompts.forEach((prompt, index) => rows[index % 3].push(prompt));
  for (let index = 0; index < 3; index += 1) {
    if (rows[index].length === 0) rows[index] = prompts.slice(0, 1);
  }
  return rows;
});
const lastAiIndex = computed(() => {
  const list = Array.isArray(props.messages) ? props.messages : [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (list[index]?.role === "ai") return index;
  }
  return -1;
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

function onRefreshClick(index, message) {
  emit("refresh-click", { index, msg: message });
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
      <!-- 顶部 logo + 标题（Figma: 40808:20） -->
      <view v-if="showQuickPrompts" class="chat-hero">
        <view class="chat-hero__logo">
          <image src="@/assets/img/icon-ai.png" mode="aspectFit" class="chat-hero__logo-img" />
        </view>
        <text class="chat-hero__title">
          你好，我是你的AI助手
        </text>
      </view>

      <!-- AI 欢迎气泡 -->
      <!-- <view class="msg-list__welcome">
      <ai-bubble role="ai" :content="t('ai-chat-welcome-bubble')" />
    </view> -->

      <!-- 快捷提示词 -->
      <view v-if="showQuickPrompts" class="quick-prompts">
        <template v-if="showQuickList">
          <text class="quick-prompts__label">
            {{ t("ai-ask-example-title") }}
          </text>
          <view class="quick-prompts__marquee">
            <!-- 第 1 行：向右滚动 -->
            <view class="quick-prompts__row quick-prompts__row--right">
              <view class="quick-prompts__track quick-prompts__track--right">
                <view class="quick-prompts__group">
                  <view
                    v-for="(prompt, idx) in promptRowsBase[0]"
                    :key="`r0-a-${idx}-${prompt}`"
                    class="quick-prompts__chip"
                    @tap="onQuickPrompt(prompt)"
                  >
                    {{ prompt }}
                  </view>
                </view>
                <view class="quick-prompts__group" aria-hidden="true">
                  <view
                    v-for="(prompt, idx) in promptRowsBase[0]"
                    :key="`r0-b-${idx}-${prompt}`"
                    class="quick-prompts__chip"
                    @tap="onQuickPrompt(prompt)"
                  >
                    {{ prompt }}
                  </view>
                </view>
              </view>
            </view>

            <!-- 第 2 行：向左滚动 -->
            <view class="quick-prompts__row quick-prompts__row--left">
              <view class="quick-prompts__track quick-prompts__track--left">
                <view class="quick-prompts__group">
                  <view
                    v-for="(prompt, idx) in promptRowsBase[1]"
                    :key="`r1-a-${idx}-${prompt}`"
                    class="quick-prompts__chip"
                    @tap="onQuickPrompt(prompt)"
                  >
                    {{ prompt }}
                  </view>
                </view>
                <view class="quick-prompts__group" aria-hidden="true">
                  <view
                    v-for="(prompt, idx) in promptRowsBase[1]"
                    :key="`r1-b-${idx}-${prompt}`"
                    class="quick-prompts__chip"
                    @tap="onQuickPrompt(prompt)"
                  >
                    {{ prompt }}
                  </view>
                </view>
              </view>
            </view>

            <!-- 第 3 行：向右滚动 -->
            <view class="quick-prompts__row quick-prompts__row--right">
              <view class="quick-prompts__track quick-prompts__track--right">
                <view class="quick-prompts__group">
                  <view
                    v-for="(prompt, idx) in promptRowsBase[2]"
                    :key="`r2-a-${idx}-${prompt}`"
                    class="quick-prompts__chip"
                    @tap="onQuickPrompt(prompt)"
                  >
                    {{ prompt }}
                  </view>
                </view>
                <view class="quick-prompts__group" aria-hidden="true">
                  <view
                    v-for="(prompt, idx) in promptRowsBase[2]"
                    :key="`r2-b-${idx}-${prompt}`"
                    class="quick-prompts__chip"
                    @tap="onQuickPrompt(prompt)"
                  >
                    {{ prompt }}
                  </view>
                </view>
              </view>
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
            :show-actions="msg.role === 'ai' && !msg.loading && !msg.interrupted"
            :show-refresh="
              index === lastAiIndex
                && msg.role === 'ai'
                && !msg.loading
                && !msg.interrupted
            "
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
            @refresh-click="onRefreshClick(index, msg)"
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
  padding: 0 32rpx;
}
.chat-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24rpx;
  padding: 40rpx 0 16rpx;
}

.chat-hero__logo {
  display: flex;
  align-items: center;
  justify-content: center;
}

.chat-hero__logo-img {
  width: 166rpx;
  height: 166rpx;
}

.chat-hero__title {
  font-size: 48rpx; // 24px
  font-weight: 600;
  line-height: 68rpx;
  color: #492e2e;
  text-align: center;
}

.msg-list__welcome {
  margin-bottom: 8rpx;
}

// ---- 快捷提示词 ----
.quick-prompts {
  margin-bottom: 32rpx;
  // Figma: 文案与 chips 左对齐（约 58px）
}

.quick-prompts__label {
  display: block;
  font-size: 28rpx; // 14px
  line-height: 54rpx; // 27px
  color: #bbc0c9;
  margin-bottom: 12rpx;
  text-align: center;
  padding: 0 40rpx;
  margin-top: 96rpx;
}

.quick-prompts__marquee {
  display: flex;
  flex-direction: column;
  gap: 14rpx;
}

.quick-prompts__row {
  width: 100%;
  white-space: nowrap;
  overflow: hidden;
}

.quick-prompts__track {
  display: inline-flex;
  align-items: center;
  width: max-content;
  will-change: transform;
}

.quick-prompts__group {
  display: inline-flex;
  align-items: center;
  gap: 24rpx; // 12px
  padding-right: 24rpx;
}

.quick-prompts__track--left {
  animation: marquee-left 30s linear infinite;
}

.quick-prompts__track--right {
  animation: marquee-right 30s linear infinite;
}

.quick-prompts__chip {
  flex: 0 0 auto;
  background: transparent;
  color: #f8315e;
  border-radius: 66rpx; // 33px
  padding: 28rpx 44rpx; // 14px 22px
  font-size: 28rpx; // 14px
  line-height: 28rpx;
  border: 2rpx solid #f8315e;

  &:active {
    opacity: 0.75;
  }
}

@keyframes marquee-left {
  0% {
    transform: translateX(0);
  }
  100% {
    transform: translateX(-50%);
  }
}

@keyframes marquee-right {
  0% {
    transform: translateX(-50%);
  }
  100% {
    transform: translateX(0);
  }
}
</style>
