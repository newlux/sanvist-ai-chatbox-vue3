<script setup lang="ts">
import type { ReportPlaybackRate } from "@/config/report-playback-rate";
import { onBeforeUnmount, onMounted } from "vue";
import { formatReportPlaybackRate, REPORT_PLAYBACK_RATES } from "@/config/report-playback-rate";

defineProps<{
  currentRate: number;
}>();

const emit = defineEmits<{
  close: [];
  select: [rate: ReportPlaybackRate];
}>();

/** 打开后没选倍速，10 秒自动收起。 */
const AUTO_CLOSE_MS = 10_000;
let autoCloseTimer: ReturnType<typeof setTimeout> | null = null;

function clearAutoClose() {
  if (!autoCloseTimer) return;
  clearTimeout(autoCloseTimer);
  autoCloseTimer = null;
}

function close() {
  clearAutoClose();
  emit("close");
}

function onSelect(rate: ReportPlaybackRate) {
  clearAutoClose();
  emit("select", rate);
}

onMounted(() => {
  autoCloseTimer = setTimeout(close, AUTO_CLOSE_MS);
});

onBeforeUnmount(clearAutoClose);
</script>

<template>
  <Teleport to="body">
    <view class="report-broadcast-rate-mask" @tap="close">
      <view class="report-broadcast-rate" @tap.stop>
        <view
          v-for="rate in REPORT_PLAYBACK_RATES"
          :key="rate"
          class="report-broadcast-rate__item"
          :class="{ 'report-broadcast-rate__item--active': rate === currentRate }"
          @tap.stop="onSelect(rate)"
        >
          <text class="report-broadcast-rate__label">
            {{ formatReportPlaybackRate(rate) }}
          </text>
        </view>
      </view>
    </view>
  </Teleport>
</template>

<style scoped lang="scss">
.report-broadcast-rate-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
}
.report-broadcast-rate {
  position: absolute;
  top: calc(var(--safe-top-px, 0px) + 112rpx);
  right: 38rpx;
  box-sizing: border-box;
  width: 240rpx;
  padding: 12rpx;
  overflow: hidden;
  background: #ffffff;
  border-radius: 16rpx;
  box-shadow: 0 8rpx 24rpx rgb(0 0 0 / 8%);
}
.report-broadcast-rate__item {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 76rpx;
  padding: 0 28rpx;
  border-radius: 12rpx;
}
.report-broadcast-rate__item--active {
  background: #f6f6f6;
}
.report-broadcast-rate__label {
  font-size: 28rpx;
  line-height: 1;
  color: #1a1a1a;
}
</style>
