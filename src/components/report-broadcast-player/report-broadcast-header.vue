<script setup lang="ts">
import aiChatIcon from "@/assets/img/report-broadcast/ai-chat.png";
import closeIcon from "@/assets/img/voice-assistant/voice-back.svg";

defineProps<{
  status: string;
  qaVisible: boolean;
}>();

const emit = defineEmits<{
  "dismiss-qa": [];
  "exit-report": [];
}>();

function onClose() {
  emit("dismiss-qa");
}
</script>

<template>
  <!-- Top Nav -->
  <view class="report-broadcast-header">
    <view class="report-broadcast-header__close" @tap="qaVisible ? onClose() : emit('exit-report')">
      <image class="report-broadcast-header__icon" :src="closeIcon" mode="aspectFit" />
    </view>
    <view class="report-broadcast-header__status">
      <text>{{ status }}</text>
    </view>
    <view class="report-broadcast-header__ai-entry">
      <image class="report-broadcast-header__icon" :src="aiChatIcon" mode="aspectFit" />
    </view>
  </view>
</template>

<style scoped lang="scss">
.report-broadcast-header {
  display: flex;
  width: 100%;
  height: 100rpx;
  flex: 0 0 100rpx;
  align-items: center;
  justify-content: space-between;
  padding: 0 38rpx;
  box-sizing: border-box;
}
.report-broadcast-header__close,
.report-broadcast-header__ai-entry {
  display: flex;
  width: 48rpx;
  height: 48rpx;
  flex: 0 0 48rpx;
  align-items: center;
  justify-content: center;
}
.report-broadcast-header__icon {
  width: 48rpx;
  height: 48rpx;
}
.report-broadcast-header__status {
  display: flex;
  width: 158rpx;
  height: 72rpx;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 36rpx;
  background: rgb(255 255 255 / 90%);
  box-shadow: 0 4rpx 16rpx rgb(237 26 26 / 9%);
  color: #1a1a1a;
  font-size: 28rpx;
  font-weight: 500;
  backdrop-filter: blur(32rpx);
}
</style>
