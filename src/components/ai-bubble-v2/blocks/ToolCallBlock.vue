<script setup>
import { computed, ref, watch } from "vue";

defineOptions({ name: "ToolCallBlock" });

const props = defineProps({
  payload: { type: Object, default: () => ({}) },
  complete: { type: Boolean, default: false },
});

const expanded = ref(!props.complete);
const isComplete = computed(() => props.complete);
const argsText = computed(() => {
  if (props.payload.args === undefined || props.payload.args === null) return "";
  try {
    return JSON.stringify(props.payload.args, null, 2);
  } catch {
    return String(props.payload.args);
  }
});

watch(isComplete, (value) => {
  expanded.value = !value;
});

function toggleExpanded() {
  expanded.value = !expanded.value;
}
</script>

<template>
  <view class="tool-call-block">
    <view class="tool-call-block__head" @tap="toggleExpanded">
      <text class="tool-call-block__title">
        工具调用
      </text>
      <image
        v-if="expanded"
        src="@/assets/img/icon-collapsed.svg"
        class="tool-call-block__toggle-icon"
        mode="aspectFit"
      />
      <image
        v-else
        src="@/assets/img/icon-expand.svg"
        class="tool-call-block__toggle-icon"
        mode="aspectFit"
      />
    </view>
    <text v-if="expanded && payload.name" class="tool-call-block__name">
      {{ payload.name }}
    </text>
    <text v-if="expanded && argsText" class="tool-call-block__args">
      {{ argsText }}
    </text>
  </view>
</template>

<style lang="scss" scoped>
.tool-call-block { padding: 24rpx 32rpx; border: 1px solid #e4e9f0; border-radius: 20rpx; background: #fff; }
.tool-call-block__head { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; }
.tool-call-block__title { color: #b8b8b8; font-family: 'PingFang SC'; font-size: 28rpx; line-height: 44rpx; font-weight: 400; }
.tool-call-block__name { display: block; margin-top: 12rpx; margin-bottom: 12rpx; font-size: 28rpx; font-family: monospace; color: #5f6775; }
.tool-call-block__toggle-icon { width: 30rpx; height: 30rpx; flex: 0 0 30rpx; }
.tool-call-block__args { display: block; margin-top: 12rpx; color: #5f6775; font-family: monospace; font-size: 22rpx; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
</style>
