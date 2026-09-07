<script setup lang="ts">
import historyIcon from "@/assets/img/report-broadcast/feedback-history.svg";
import closeIcon from "@/assets/img/voice-assistant/voice-back.svg";

defineProps<{
  status: string;
  qaVisible: boolean;
  active: boolean;
}>();

const emit = defineEmits<{
  "dismiss-qa": [];
  "exit-report": [];
  "open-history": [];
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
      <text v-if="active" class="report-broadcast-header__status-dots">
        <text>.</text><text>.</text><text>.</text>
      </text>
    </view>
    <view class="report-broadcast-header__history" @tap="emit('open-history')">
      <image class="report-broadcast-header__history-icon" :src="historyIcon" mode="aspectFit" />
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
.report-broadcast-header__history {
  display: flex;
  width: 48rpx;
  height: 48rpx;
  flex: 0 0 48rpx;
  align-items: center;
  justify-content: center;
}
.report-broadcast-header__icon,
.report-broadcast-header__history-icon {
  width: 48rpx;
  height: 48rpx;
}
.report-broadcast-header__history-icon {
  width: 40rpx;
  height: 40rpx;
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
.report-broadcast-header__status-dots {
  display: inline-flex;
  margin-left: 2rpx;
}
.report-broadcast-header__status-dots text {
  display: inline-block;
  animation: report-broadcast-status-dot 1.2s infinite ease-in-out;
}
.report-broadcast-header__status-dots text:nth-child(2) {
  animation-delay: 0.16s;
}
.report-broadcast-header__status-dots text:nth-child(3) {
  animation-delay: 0.32s;
}
@keyframes report-broadcast-status-dot {
  0%, 60%, 100% {
    opacity: 0.25;
    transform: translateY(0);
  }
  30% {
    opacity: 1;
    transform: translateY(-3rpx);
  }
}
</style>
