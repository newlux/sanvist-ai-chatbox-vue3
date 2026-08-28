<script setup lang="ts">
import type { PlayListenBroadcastParams } from "@/api/listen-broadcast/types";
import { computed, getCurrentInstance, nextTick, onMounted, ref, watch } from "vue";
import aiChatIcon from "@/assets/img/report-broadcast/ai-chat.png";
import feedbackGoodIcon from "@/assets/img/report-broadcast/feedback-good.svg";
import feedbackHistoryIcon from "@/assets/img/report-broadcast/feedback-history.svg";
import closeIcon from "@/assets/img/voice-assistant/voice-close.svg";
import ReportWaveform from "@/components/report-waveform/index.vue";
import { useListenBroadcastPlayer } from "@/hooks/useListenBroadcastPlayer";

const props = defineProps<{
  params: PlayListenBroadcastParams;
  portrait: string;
  dockOffset: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

// 设计稿 940:3 / 940:110：左右声波逐柱高度（px）。
const leftWaveBars = [2, 2, 18, 4, 10, 4, 16, 8, 4, 16, 4, 30, 12, 20, 2, 1, 1];
const rightWaveBars = [2, 2, 18, 10, 18, 4, 8, 8, 10, 2, 4, 8, 22, 6, 2, 1, 1];

const {
  play,
  stop,
  loading,
  playing,
  currentSeq,
  nextText,
  transcriptSegments,
  error,
} = useListenBroadcastPlayer();

const statusText = computed(() => {
  if (loading.value) return "准备中...";
  if (playing.value) return "播报中...";
  if (error.value) return "播报失败";
  return "播报完成";
});

interface TranscriptItem {
  key: string;
  role: "previous" | "current" | "next";
  text: string;
}

const transcriptItems = computed<TranscriptItem[]>(() => {
  const segments = transcriptSegments.value.map(segment => ({
    key: `segment-${segment.seq}`,
    role: (segment.seq === currentSeq.value ? "current" : segment.seq < (currentSeq.value ?? Infinity) ? "previous" : "next") as TranscriptItem["role"],
    text: segment.text,
  }));
  if (nextText.value && currentSeq.value !== null && !segments.some(item => item.key === `segment-${currentSeq.value + 1}`)) {
    segments.push({ key: `segment-${currentSeq.value + 1}`, role: "next" as const, text: nextText.value });
  }
  return segments;
});

const showTranscriptSkeleton = computed(() => loading.value && transcriptSegments.value.length === 0);
const transcriptScrollTop = ref(0);
const instance = getCurrentInstance();

function updateTranscriptScroll() {
  if (!playing.value || currentSeq.value === null) return;
  void nextTick(() => {
    const query = uni.createSelectorQuery().in(instance?.proxy);
    query.select(".report-broadcast-player__transcript-content").boundingClientRect();
    query.select(`#segment-${currentSeq.value}`).boundingClientRect();
    query.exec((rects) => {
      const viewport = rects?.[0] as UniApp.NodeInfo | undefined;
      const current = rects?.[1] as UniApp.NodeInfo | undefined;
      if (!viewport || !current || typeof viewport.bottom !== "number" || typeof current.bottom !== "number") return;
      const overflow = current.bottom - viewport.bottom;
      if (overflow > 0) transcriptScrollTop.value += Math.ceil(overflow);
    });
  });
}

watch(currentSeq, updateTranscriptScroll);

function close() {
  stop();
  emit("close");
}

onMounted(() => play(props.params));
</script>

<template>
  <view class="report-broadcast-player" :style="{ height: `calc(100% - ${dockOffset})` }">
    <!-- 设计稿：安全区基准 44px 后，Top Nav 从 y=48px 开始 -->
    <view class="report-broadcast-player__safe-gap" />

    <!-- 设计稿：顶部导航与播报状态 -->
    <view class="report-broadcast-player__header">
      <view class="report-broadcast-player__close" @tap="close">
        <image class="report-broadcast-player__close-icon" :src="closeIcon" mode="aspectFit" />
      </view>
      <view class="report-broadcast-player__status">
        <text>{{ statusText }}</text>
      </view>
      <!-- 设计稿 2525:184：右上角 AI 聊天入口 24×24px -->
      <view class="report-broadcast-player__ai-entry" @tap="close">
        <image class="report-broadcast-player__ai-icon" :src="aiChatIcon" mode="aspectFit" />
      </view>
    </view>

    <!-- 设计稿：Top Nav 底部 y=98px → 人物区域顶部 y=115px -->
    <view class="report-broadcast-player__portrait-gap" />

    <!-- 设计稿：人物、左右实时声波与背景光晕 -->
    <view class="report-broadcast-player__portrait-stage">
      <view class="report-broadcast-player__wave report-broadcast-player__wave--left">
        <ReportWaveform :active="playing" :bars="leftWaveBars" />
      </view>
      <!-- 设计稿 2525:122 / 2525:123：人物背景红蓝椭圆光晕 -->
      <view class="report-broadcast-player__glow report-broadcast-player__glow--blue" />
      <view class="report-broadcast-player__glow report-broadcast-player__glow--red" />
      <view class="report-broadcast-player__portrait-wrap">
        <image class="report-broadcast-player__portrait" :src="portrait" mode="aspectFit" />
      </view>
      <view class="report-broadcast-player__wave report-broadcast-player__wave--right">
        <ReportWaveform :active="playing" :bars="rightWaveBars" />
      </view>
    </view>

    <!-- 设计稿 2525:114：上一段淡出、当前段强调、下一段淡出 -->
    <view class="report-broadcast-player__transcript">
      <!-- 准备中：用五段文字槽位铺满视口，首个文字分片到达后替换。 -->
      <view v-show="showTranscriptSkeleton" class="report-broadcast-player__skeleton">
        <view v-for="index in 5" :key="index" class="report-broadcast-player__skeleton-segment">
          <view class="report-broadcast-player__skeleton-line" />
          <view class="report-broadcast-player__skeleton-line" />
          <view class="report-broadcast-player__skeleton-line report-broadcast-player__skeleton-line--short" />
        </view>
      </view>
      <scroll-view
        v-show="!showTranscriptSkeleton"
        class="report-broadcast-player__transcript-content"
        scroll-y
        :scroll-top="transcriptScrollTop"
        :scroll-with-animation="playing"
      >
        <view class="report-broadcast-player__transcript-track">
          <text
            v-for="item in transcriptItems"
            :id="item.key"
            :key="item.key"
            class="report-broadcast-player__segment"
            :class="`report-broadcast-player__segment--${item.role}`"
          >
            {{ item.text }}
          </text>
        </view>
      </scroll-view>
      <!-- 文字区底部渐变：淡化滚动文字，避免遮挡反馈操作。 -->
      <view v-if="!showTranscriptSkeleton" class="report-broadcast-player__bottom-fade" />
      <!-- 设计稿 2525:212：点赞与历史操作，24×24px，间距 16px -->
      <view v-if="!showTranscriptSkeleton" class="report-broadcast-player__feedback">
        <image class="report-broadcast-player__feedback-icon" :src="feedbackHistoryIcon" mode="aspectFit" />
        <image class="report-broadcast-player__feedback-icon" :src="feedbackGoodIcon" mode="aspectFit" />
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.report-broadcast-player {
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
  padding-top: var(--safe-top-px, 0px);
  background: #fff;
}

/* 设计稿：安全区 44px → Top Nav y=48px，间距 4px。 */
.report-broadcast-player__safe-gap {
  width: 100%;
  height: 8rpx;
  flex: 0 0 8rpx;
}

/* 设计稿：50px 顶部导航 */
.report-broadcast-player__header {
  display: flex;
  width: 100%;
  height: 100rpx;
  flex: 0 0 100rpx;
  align-items: center;
  justify-content: space-between;
  padding: 0 38rpx;
  box-sizing: border-box;
}

/* 设计稿：Top Nav 底部 y=98px → 人物区域顶部 y=115px，间距 17px。 */
.report-broadcast-player__portrait-gap {
  width: 100%;
  height: 34rpx;
  flex: 0 0 34rpx;
}

/* 设计稿 2525:108 / 2525:184：左右导航操作均为 24×24px。 */
.report-broadcast-player__close,
.report-broadcast-player__ai-entry {
  display: flex;
  width: 48rpx;
  height: 48rpx;
  flex: 0 0 48rpx;
  align-items: center;
  justify-content: center;
}

.report-broadcast-player__close-icon,
.report-broadcast-player__ai-icon {
  width: 48rpx;
  height: 48rpx;
}

.report-broadcast-player__status {
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

/* 设计稿：255px 人物与声波区域 */
.report-broadcast-player__portrait-stage {
  position: relative;
  display: flex;
  width: 100%;
  height: 510rpx;
  flex: 0 0 510rpx;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

/* 设计稿：左右音波保持 70×70px，并与 235px 人物图叠层。 */
.report-broadcast-player__wave {
  position: absolute;
  z-index: 2;
  top: 243.707rpx;
  width: 140rpx;
  height: 140rpx;
}

.report-broadcast-player__wave--left {
  left: 52rpx;
}

.report-broadcast-player__wave--right {
  right: 52rpx;
}

.report-broadcast-player__portrait-wrap {
  position: relative;
  display: flex;
  width: 470rpx;
  height: 470rpx;
  flex: 0 0 470rpx;
  align-items: flex-end;
  justify-content: center;
}

/* 设计稿 2525:122 / 2525:123：人物背后椭圆光晕，blur 46px。 */
.report-broadcast-player__glow {
  position: absolute;
  z-index: 0;
  border-radius: 50%;
  filter: blur(92rpx);
}

.report-broadcast-player__glow--blue {
  top: 90rpx;
  left: 86rpx;
  width: 282rpx;
  height: 350rpx;
  background: rgb(229 242 255 / 30%);
}

.report-broadcast-player__glow--red {
  top: 40rpx;
  left: 303.714rpx;
  width: 362.571rpx;
  height: 450rpx;
  background: rgb(255 216 216 / 40%);
}

.report-broadcast-player__portrait {
  position: relative;
  z-index: 1;
  width: 470rpx;
  height: 470rpx;
}

/* 文字滚动区域：左右各 46px，底边止于 AiChatInput 顶部。 */
.report-broadcast-player__transcript {
  position: relative;
  width: 100%;
  height: calc(100% - 652rpx);
  padding: 32rpx 88rpx 0;
  box-sizing: border-box;
  overflow: hidden;
}

/* 固定文字视口：播放完成后可在区域内滚动查看全部内容。 */
.report-broadcast-player__transcript-content {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
}

.report-broadcast-player__transcript-track {
  display: flex;
  width: 100%;
  min-height: 100%;
  padding-bottom: 180rpx;
  box-sizing: border-box;
  flex-direction: column;
  gap: 12rpx;
}

@keyframes report-broadcast-skeleton-shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}

.report-broadcast-player__skeleton {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 12rpx;
}

.report-broadcast-player__skeleton-segment {
  display: flex;
  height: 152rpx;
  flex: 0 0 152rpx;
  flex-direction: column;
  gap: 12rpx;
}

.report-broadcast-player__skeleton-line {
  width: 100%;
  height: 24rpx;
  flex: 0 0 24rpx;
  border-radius: 8rpx;
  background: linear-gradient(90deg, #f2f3f5 25%, #e5e7eb 50%, #f2f3f5 75%);
  background-size: 200% 100%;
  animation: report-broadcast-skeleton-shimmer 1.4s ease-in-out infinite;
}

.report-broadcast-player__skeleton-line--short {
  width: 68%;
}

.report-broadcast-player__segment {
  display: block;
  width: 100%;
  min-height: 0;
  color: #e0e0e0;
  font-size: 38rpx;
  font-weight: 500;
  line-height: 48rpx;
  white-space: normal;
  transition: color 220ms ease, font-size 220ms ease, font-weight 220ms ease, opacity 180ms ease;
}

/* 设计稿 2525:115：当前文字 283px 宽，18px/25px，700，#211B1B。 */
.report-broadcast-player__segment--current {
  color: #211b1b;
  font-size: 36rpx;
  font-weight: 700;
  line-height: 50rpx;
}

/* 文字区底部 90px 渐变，避免滚动文字穿过点赞和历史图标。 */
.report-broadcast-player__bottom-fade {
  position: absolute;
  z-index: 2;
  right: 0;
  bottom: 0;
  left: 0;
  height: 180rpx;
  pointer-events: none;
  background: linear-gradient(180deg, rgb(255 255 255 / 0%) 0%, rgb(255 255 255 / 86%) 58%, #ffffff 100%);
}

/* 设计稿 2525:212：点赞 x=281px、历史 x=321px，尺寸均为 24px。 */
.report-broadcast-player__feedback {
  position: absolute;
  z-index: 3;
  right: 60rpx;
  display: flex;
  align-items: center;
  gap: 16rpx;
  bottom: 100rpx;
}

.report-broadcast-player__feedback-icon {
  width: 48rpx;
  height: 48rpx;
  flex: 0 0 48rpx;
}
</style>
