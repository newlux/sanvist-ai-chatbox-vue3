<script setup lang="ts">
import { computed, ref, watch } from "vue";

defineOptions({ name: "ThinkBlock" });

const props = defineProps({
  content: { type: String, default: "" },
  steps: { type: Array, default: () => [] },
  complete: { type: Boolean, default: false },
  forceExpanded: { type: Boolean, default: false },
});

const expanded = ref(props.forceExpanded || !props.complete);
const normalizedSteps = computed(() => {
  if (props.steps.length) return props.steps;
  if (!props.content) return [];
  return [{ node: "思考", message: props.content, complete: props.complete }];
});

watch(
  () => props.complete,
  (value) => {
    if (!props.forceExpanded) expanded.value = !value;
  },
);

watch(
  () => props.forceExpanded,
  (value) => {
    expanded.value = value || !props.complete;
  },
);

function toggleExpanded() {
  if (!props.forceExpanded) expanded.value = !expanded.value;
}
</script>

<template>
  <view v-if="normalizedSteps.length" class="think-block">
    <view class="think-block__header" @tap="toggleExpanded">
      <view class="think-block__heading">
        <view class="think-block__pulse" :class="{ 'think-block__pulse--complete': complete }" />
        <text class="think-block__title">
          深度思考
        </text>
      </view>
      <view
        class="think-block__toggle-icon"
        :class="{ 'think-block__toggle-icon--expanded': expanded }"
      />
    </view>
    <view v-if="expanded" class="think-block__body">
      <view
        v-for="(step, index) in normalizedSteps"
        :key="`${step.node}-${index}`"
        class="think-block__step"
      >
        <text class="think-block__node">
          {{ step.node }}：
        </text>
        <text class="think-block__message">
          {{ step.message }}
        </text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.think-block {
  overflow: hidden;
  border-radius: 0;
  background: transparent;
  padding-bottom: 16px;
  border-bottom: 1px solid #f0f0f2;
}
.think-block__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 40rpx;
  gap: 12rpx;
  padding: 0;
  box-sizing: border-box;
}
.think-block__heading {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.think-block__pulse {
  width: 10rpx;
  height: 10rpx;
  border-radius: 50%;
  background: #f8315e;
  box-shadow: 0 0 0 4rpx rgba(248, 49, 94, 0.12);
  animation: think-pulse 1.8s ease-in-out infinite;
}
.think-block__pulse--complete {
  background: #bababa;
  box-shadow: none;
  animation: none;
}
.think-block__title {
  color: #8c8c8c;
  font-family: "PingFang SC";
  font-size: 26rpx;
  line-height: 36rpx;
  font-weight: 400;
}
.think-block__toggle-icon {
  width: 16rpx;
  height: 16rpx;
  flex: 0 0 16rpx;
  margin-right: 8rpx;
  border-top: 3rpx solid #b0b0b0;
  border-left: 3rpx solid #b0b0b0;
  transform: translateY(-2rpx) rotate(225deg);
  box-sizing: border-box;
}
.think-block__toggle-icon--expanded {
  transform: translateY(0) rotate(45deg);
}
.think-block__body {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 8rpx 0 0;
}
.think-block__step {
  font-family: "PingFang SC";
  font-size: 26rpx;
  line-height: 40rpx;
}
.think-block__node {
  color: #a5a5a5;
  font-weight: 400;
}
.think-block__message {
  color: #a5a5a5;
  font-weight: 400;
}
@keyframes think-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.65;
    transform: scale(0.82);
  }
}
</style>
