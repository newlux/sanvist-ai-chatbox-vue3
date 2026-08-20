<script setup lang="ts">
defineOptions({ name: "StatusBlock" });

defineProps({
  payload: { type: Object, default: () => ({}) },
});
</script>

<template>
  <view class="status-block">
    <text class="status-block__stage">
      {{ payload.stage || '处理中' }}
    </text>
    <text class="status-block__message">
      {{ payload.message || '正在处理请求...' }}
    </text>
  </view>
</template>

<style lang="scss" scoped>
.status-block {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 18rpx 20rpx;
  border-radius: 18rpx;
  background: #f3f6fa;
  color: #5f6775;
}

.status-block__stage {
  padding: 4rpx 12rpx;
  border-radius: 999rpx;
  background: #e7edf5;
  color: #637083;
  font-size: 20rpx;
  font-weight: 700;
}

.status-block__message {
  color: #4b5565;
  font-size: 24rpx;
}
</style>
