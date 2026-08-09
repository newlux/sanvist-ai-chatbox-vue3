<script setup>
defineOptions({ name: "ErrorBlock" });

defineProps({
  payload: { type: Object, default: () => ({}) },
});
</script>

<template>
  <view class="error-block">
    <text class="error-block__title">
      请求异常
    </text>
    <text class="error-block__message">
      {{ payload.msg || payload.message || '服务暂时不可用，请稍后重试。' }}
    </text>
  </view>
</template>

<style lang="scss" scoped>
.error-block { padding: 32rpx; border: 1px solid #e4e9f0; border-radius: 20rpx; background: #fff; color: #2f323c; }
.error-block__title { display: block; font-size: 24rpx; font-weight: 700; }
.error-block__message { display: block; margin-top: 8rpx; color: #5f6775; font-size: 24rpx; line-height: 36rpx; }
</style>
