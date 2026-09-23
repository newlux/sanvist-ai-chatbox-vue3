<script setup lang="ts">
import type { AssistantNavigationPayload } from "@/api/chat/types";
import { computed } from "vue";
import CloseIcon from "/src/assets/icons/slot-drawer/slot-drawer-close.svg";

defineOptions({ name: "AiAssistantNavigationSheet" });

const props = withDefaults(defineProps<{
  payload?: AssistantNavigationPayload | null;
  visible?: boolean;
}>(), {
  payload: null,
  visible: false,
});

const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  (e: "confirm", payload: AssistantNavigationPayload): void;
}>();

const title = computed(() => String(props.payload?.title || "").trim() || "是否进入维修助手");
const confirmText = computed(() => String(props.payload?.confirm_text || "").trim() || "确定，进入维修助手");
const cancelText = computed(() => String(props.payload?.cancel_text || "").trim() || "暂不进入");

function close() {
  emit("update:visible", false);
}

function confirm() {
  if (!props.payload) return;
  emit("confirm", props.payload);
  close();
}
</script>

<template>
  <view v-if="visible && payload" class="assistant-navigation-sheet">
    <view class="assistant-navigation-sheet__close" @tap="close">
      <image class="assistant-navigation-sheet__close-icon" :src="CloseIcon" mode="aspectFit" />
    </view>
    <text class="assistant-navigation-sheet__title">
      {{ title }}
    </text>
    <view class="assistant-navigation-sheet__actions">
      <view class="assistant-navigation-sheet__action" @tap="confirm">
        <text>{{ confirmText }}</text>
      </view>
      <view class="assistant-navigation-sheet__action" @tap="close">
        <text>{{ cancelText }}</text>
      </view>
    </view>
    <text class="assistant-navigation-sheet__hint">
      内容由AI生成，请核实重要信息
    </text>
  </view>
</template>

<style lang="scss" scoped>
.assistant-navigation-sheet {
  position: fixed;
  z-index: 1002;
  right: 0;
  bottom: 0;
  left: 0;
  box-sizing: border-box;
  padding: 42rpx 80rpx 24rpx;
  padding-bottom: calc(24rpx + constant(safe-area-inset-bottom));
  padding-bottom: calc(24rpx + env(safe-area-inset-bottom));
  border-radius: 22px 22px 0 0;
  background: #fff;
  box-shadow: 0 -4rpx 42rpx rgba(0, 0, 0, 0.06);
}

.assistant-navigation-sheet__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52rpx;
  height: 52rpx;
  margin-left: auto;
  margin-right: -30rpx;
}

.assistant-navigation-sheet__close-icon {
  width: 100%;
  height: 100%;
}

.assistant-navigation-sheet__title {
  display: block;
  margin-top: 32rpx;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  line-height: 40rpx;
  color: #1a1a1e;
}

.assistant-navigation-sheet__actions {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  margin-top: 32rpx;
}

.assistant-navigation-sheet__action {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  min-height: 72rpx;
  padding: 16rpx 32rpx;
  border-radius: 16rpx;
  background: #f6f6f6;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  line-height: 40rpx;
  color: #000;
}

.assistant-navigation-sheet__action:active {
  opacity: 0.7;
}

.assistant-navigation-sheet__hint {
  display: block;
  margin-top: 24rpx;
  text-align: center;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 24rpx;
  line-height: 30rpx;
  color: #bababa;
}
</style>
