<script setup lang="ts">
defineOptions({ name: "MetricBlock" });

defineProps({
  payload: { type: Object, default: () => ({}) },
});
</script>

<template>
  <view class="metric-block">
    <text class="metric-block__label">
      {{ payload.label }}
    </text>
    <view class="metric-block__value-row">
      <text class="metric-block__value">
        {{ payload.value }}
      </text>
      <text v-if="payload.unit" class="metric-block__unit">
        {{ payload.unit }}
      </text>
    </view>
    <text v-if="payload.trend" class="metric-block__trend">
      {{ payload.trend }}
    </text>
  </view>
</template>

<style lang="scss" scoped>
.metric-block { padding: 32rpx; border: 1px solid #e4e9f0; border-radius: 20rpx; background: #fff; }
.metric-block__label, .metric-block__unit, .metric-block__trend { color: #5f6775; font-size: 22rpx; }
.metric-block__value-row { display: flex; align-items: baseline; gap: 8rpx; margin: 12rpx 0; }
.metric-block__value { color: #2f323c; font-size: 48rpx; font-weight: 700; }
.metric-block__trend { display: block; color: #bbc0c9; }
</style>
