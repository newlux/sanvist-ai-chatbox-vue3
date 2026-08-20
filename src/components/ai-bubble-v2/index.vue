<script setup lang="ts">
import type { AiBlock } from "@/utils/ai-stream";
import { computed } from "vue";

import iconCopy from "@/assets/img/icon-action-copy.svg";
import iconShare from "@/assets/img/icon-action-share.svg";
import iconBadFilled from "@/assets/img/icon-bad-fill.svg";
import iconBad from "@/assets/img/icon-bad.svg";
import iconGoodFilled from "@/assets/img/icon-good-fill.svg";
import iconGood from "@/assets/img/icon-good.svg";

import AiContentBlocks from "./AiContentBlocks.vue";

defineOptions({ name: "AiBubbleV2" });

const props = defineProps({
  role: { type: String, default: "ai" },
  content: { type: String, default: "" },
  blocks: { type: Array as () => AiBlock[], default: () => [] },
  loading: { type: Boolean, default: false },
  ttsEnabled: { type: Boolean, default: false },
  ttsLoading: { type: Boolean, default: false },
  showActions: { type: Boolean, default: false },
  waitingText: { type: String, default: "" },
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
    // 忽略，走下方失败返回
  }

  return false;
}

function onUserLongpress() {
  if (props.selectMode || props.disabled) return;

  copyText(props.content).then((copied) => {
    if (typeof uni !== "undefined" && typeof uni.showToast === "function") {
      uni.showToast({
        title: copied ? "已复制" : "复制失败",
        icon: "none",
      });
    }
  });
}

const isUser = computed(() => props.role === "user");
const visibleBlocks = computed(() => props.hideSuggestion
  ? props.blocks.filter(block => block && block.type !== "suggestion")
  : props.blocks);

/**
 * 等待条：模型还没吐出内容时的占位。
 * 被中断后不撤掉，只把状态字改成「已停止」——否则没来得及出内容的那一轮
 * 会变成一个空气泡，用户看不出这轮发生了什么。
 */
const showWaiting = computed(() =>
  Boolean(props.waitingText) && (props.loading || props.interrupted),
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

    <view class="ai-bubble-v2__body">
      <text
        v-if="isUser"
        class="ai-bubble-v2__user-content"
        :selectable="false"
        :user-select="false"
        @longpress="onUserLongpress"
      >
        {{ props.content }}
      </text>

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
            {{ props.interrupted ? '已停止：' : '等待模型响应：' }}
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
}

.ai-bubble-v2--selected { justify-content: space-between; }
.ai-bubble-v2--user { justify-content: flex-end; }
.ai-bubble-v2__check { width: 40rpx; padding-left: 32rpx; display: flex; align-items: center; flex-shrink: 0; }
.ai-bubble-v2__check-img { width: 32rpx; height: 32rpx; }
.ai-bubble-v2__body { flex: 1; min-width: 0; overflow: hidden; box-sizing: border-box; }
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
.ai-bubble-v2__body--highlighted { background: rgba(248, 49, 94, .06); }
.ai-bubble-v2--user .ai-bubble-v2__user-content {
  font-size: 28rpx;
  line-height: 40rpx;
  color: #ffffff;
  white-space: pre-wrap;
  word-break: break-word;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
}
.ai-bubble-v2__ai-content {
  display: block;
  color: #2f323c;
  font-size: 28rpx;
  line-height: 42rpx;
  white-space: pre-wrap;
  word-break: break-word;
}
.ai-bubble-v2__waiting { display: flex; align-items: center; flex-wrap: wrap; gap: 8rpx; margin-bottom: 24rpx; color: #a5a5a5; font-family: "PingFang SC"; font-size: 26rpx; line-height: 36rpx; }
.ai-bubble-v2__waiting-mark { color: #a5a5a5; font-size: 24rpx; line-height: 36rpx; }
.ai-bubble-v2__waiting-label, .ai-bubble-v2__waiting-query, .ai-bubble-v2__waiting-suffix { color: #a5a5a5; font-weight: 400; }
// 已停止：和「等待响应」用同一行样式，只把状态字加深一点区分出来
.ai-bubble-v2__waiting--stopped .ai-bubble-v2__waiting-mark,
.ai-bubble-v2__waiting--stopped .ai-bubble-v2__waiting-label { color: #7b7b7b; }
.ai-bubble-v2__duration { color: #bababa; font-size: 22rpx; line-height: 32rpx; white-space: nowrap; }
.ai-bubble-v2__typing { display: flex; gap: 8rpx; align-items: center; padding: 6rpx 4rpx; }
.ai-bubble-v2__dot { width: 12rpx; height: 12rpx; border-radius: 50%; background: #bbc0c9; animation: typing-blink 1.2s infinite; }
.ai-bubble-v2__dot:nth-child(2) { animation-delay: .2s; }
.ai-bubble-v2__dot:nth-child(3) { animation-delay: .4s; }
.ai-bubble-v2__streaming { padding-top: 24rpx; }
.ai-bubble-v2__actions {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 28rpx;
  margin-top: 32rpx;
  padding-top: 28rpx;
  border-top: 2rpx solid #f0f0f2;
}
.ai-bubble-v2__action-btn { width: 32rpx; height: 32rpx; display: flex; align-items: center; justify-content: center; }
.ai-bubble-v2__action-btn--disabled { opacity: .6; }
.ai-bubble-v2__action-icon { width: 32rpx; height: 32rpx; }
.ai-bubble-v2__duration { margin-left: 8rpx; }

@keyframes typing-blink { 0%, 80%, 100% { opacity: .2; transform: scale(.8); } 40% { opacity: 1; transform: scale(1); } }
</style>
