<script setup>
import { computed } from "vue";

import iconBadFill from "@/assets/img/icon-bad-fill.svg";
import iconBad from "@/assets/img/icon-bad.svg";
import iconGoodFill from "@/assets/img/icon-good-fill.svg";
import iconGood from "@/assets/img/icon-good.svg";

import AiContentBlocks from "./AiContentBlocks.vue";

defineOptions({ name: "AiBubbleV2" });

const props = defineProps({
  role: { type: String, default: "ai" },
  content: { type: String, default: "" },
  blocks: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  ttsEnabled: { type: Boolean, default: false },
  ttsLoading: { type: Boolean, default: false },
  showActions: { type: Boolean, default: false },
  showRefresh: { type: Boolean, default: false },
  positive: { type: Boolean, default: null },
  selected: { type: Boolean, default: false },
  suppressHighlight: { type: Boolean, default: false },
  selectMode: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  forceThinkingExpanded: { type: Boolean, default: false },
  hideSuggestion: { type: Boolean, default: false },
});

const emit = defineEmits([
  "suggestion-tap",
  "tts-click",
  "share-click",
  "feedback-change",
  "refresh-click",
  "select-toggle",
]);

const isUser = computed(() => props.role === "user");
const visibleBlocks = computed(() => props.hideSuggestion
  ? props.blocks.filter(block => block && block.type !== "suggestion")
  : props.blocks);

function onSelectTap() {
  if (props.selectMode && !props.disabled) emit("select-toggle");
}

function onSuggestionTap(event) {
  emit("suggestion-tap", event);
}

function onTtsTap() {
  if (!props.ttsLoading) emit("tts-click");
}

function onShareTap() {
  emit("share-click");
}

function onRefreshTap() {
  emit("refresh-click");
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
      <text v-if="isUser" class="ai-bubble-v2__user-content">
        {{ props.content }}
      </text>

      <template v-else>
        <AiContentBlocks
          :blocks="visibleBlocks"
          :force-thinking-expanded="props.forceThinkingExpanded"
          @suggestion-tap="onSuggestionTap"
        />
        <!-- loading -->
        <view v-if="props.loading" class="ai-bubble-v2__streaming">
          <view class="ai-bubble-v2__typing">
            <view class="ai-bubble-v2__dot" />
            <view class="ai-bubble-v2__dot" />
            <view class="ai-bubble-v2__dot" />
          </view>
        </view>

        <view v-if="props.showActions && !props.loading" class="ai-bubble-v2__actions">
          <view class="ai-bubble-v2__actions-left">
            <view
              v-if="props.ttsEnabled"
              class="ai-bubble-v2__action-btn"
              :class="{ 'ai-bubble-v2__action-btn--disabled': props.ttsLoading }"
              @tap.stop="onTtsTap"
            >
              <image src="@/assets/img/icon-sound.svg" mode="aspectFit" class="ai-bubble-v2__action-icon" />
            </view>
            <view class="ai-bubble-v2__action-btn" @tap.stop="onShareTap">
              <image src="@/assets/img/icon-share.svg" mode="aspectFit" class="ai-bubble-v2__action-icon" />
            </view>
            <view v-if="props.showRefresh" class="ai-bubble-v2__action-btn" @tap.stop="onRefreshTap">
              <image src="@/assets/img/icon-refresh.svg" mode="aspectFit" class="ai-bubble-v2__action-icon" />
            </view>
          </view>
          <view class="ai-bubble-v2__actions-right">
            <view class="ai-bubble-v2__action-btn" @tap.stop="onPositiveFeedback">
              <image :src="props.positive === true ? iconGoodFill : iconGood" mode="aspectFit" class="ai-bubble-v2__action-icon" />
            </view>
            <view class="ai-bubble-v2__action-btn" @tap.stop="onNegativeFeedback">
              <image :src="props.positive === false ? iconBadFill : iconBad" mode="aspectFit" class="ai-bubble-v2__action-icon" />
            </view>
          </view>
        </view>
      </template>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ai-bubble-v2 {
  display: flex;
  margin-bottom: 32rpx;
}

.ai-bubble-v2--selected { justify-content: space-between; }
.ai-bubble-v2--user { justify-content: flex-end; }
.ai-bubble-v2__check { width: 40rpx; padding-left: 32rpx; display: flex; align-items: center; flex-shrink: 0; }
.ai-bubble-v2__check-img { width: 32rpx; height: 32rpx; }
.ai-bubble-v2__body { flex: 1; min-width: 0; overflow: hidden; box-sizing: border-box; }
.ai-bubble-v2--user .ai-bubble-v2__body { flex: 0 1 auto; max-width: calc(100% - 64rpx); padding: 24rpx 32rpx; border-radius: 20rpx; background: linear-gradient(98deg, #ffe7e7 -3.78%, #f0f3ff 118.21%); }
.ai-bubble-v2__body--highlighted { background: rgba(248, 49, 94, .06); }
.ai-bubble-v2__user-content { font-size: 28rpx; line-height: 1.75; color: #1f2937; white-space: pre-wrap; word-break: break-word; }
.ai-bubble-v2__typing { display: flex; gap: 8rpx; align-items: center; padding: 6rpx 4rpx; }
.ai-bubble-v2__dot { width: 12rpx; height: 12rpx; border-radius: 50%; background: #bbc0c9; animation: typing-blink 1.2s infinite; }
.ai-bubble-v2__dot:nth-child(2) { animation-delay: .2s; }
.ai-bubble-v2__dot:nth-child(3) { animation-delay: .4s; }
.ai-bubble-v2__streaming { padding-top: 24rpx; }
.ai-bubble-v2__actions { display: flex; justify-content: space-between; padding: 24rpx 0; }
.ai-bubble-v2__actions-left, .ai-bubble-v2__actions-right { display: flex; align-items: center; gap: 40rpx; }
.ai-bubble-v2__action-btn { width: 36rpx; height: 36rpx; display: flex; align-items: center; justify-content: center; }
.ai-bubble-v2__action-btn--disabled { opacity: .6; }
.ai-bubble-v2__action-icon { width: 36rpx; height: 36rpx; }

@keyframes typing-blink { 0%, 80%, 100% { opacity: .2; transform: scale(.8); } 40% { opacity: 1; transform: scale(1); } }
</style>
