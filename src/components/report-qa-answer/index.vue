<script setup lang="ts">
defineProps<{
  loading: boolean;
  answer: string;
}>();
</script>

<template>
  <!-- QA Answer Area -->
  <view class="report-qa-answer">
    <view class="report-qa-answer__glow report-qa-answer__glow--blue" />
    <view class="report-qa-answer__glow report-qa-answer__glow--pink" />
    <view v-if="loading" class="report-qa-answer__loading-copy">
      <text class="report-qa-answer__title">
        正在理解你的内容
      </text>
      <text class="report-qa-answer__subtitle">
        我会结合当前听播内容直接回答
      </text>
    </view>
    <text v-else class="report-qa-answer__answer">
      {{ answer }}
    </text>
  </view>
</template>

<style scoped lang="scss">
.report-qa-answer { position: relative; display: flex; width: 100%; min-height: 0; flex: 1 1 auto; overflow: hidden; box-sizing: border-box; }
.report-qa-answer__glow { position: absolute; border-radius: 50%; filter: blur(92rpx); pointer-events: none; }
.report-qa-answer__glow--blue { top: 124rpx; left: 86rpx; width: 282rpx; height: 350rpx; background: rgb(229 242 255 / 70%); }
.report-qa-answer__glow--pink { top: 74rpx; left: 303.714rpx; width: 362.571rpx; height: 450rpx; background: rgb(255 216 216 / 60.31%); }
.report-qa-answer__loading-copy { position: relative; z-index: 1; display: flex; width: 100%; flex-direction: column; align-items: center; gap: 8rpx; padding-top: 286rpx; box-sizing: border-box; }
.report-qa-answer__title, .report-qa-answer__answer { color: #1a1a1a; font-family: 'Sarasa Gothic SC', 'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei', sans-serif; font-size: 36rpx; font-weight: 400; line-height: normal; letter-spacing: 0; }
.report-qa-answer__subtitle { color: #999; font-family: Inter, 'Sarasa Gothic SC', 'PingFang SC', sans-serif; font-size: 26rpx; font-weight: 400; line-height: normal; }
.report-qa-answer__answer { position: relative; z-index: 1; width: 100%; min-height: 156rpx; padding: 186rpx 84rpx 0; box-sizing: border-box; white-space: normal; }
</style>
