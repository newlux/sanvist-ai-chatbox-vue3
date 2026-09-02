<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, ref, watch } from "vue";
import feedbackGoodIcon from "@/assets/img/report-broadcast/feedback-good.svg";
import feedbackHistoryIcon from "@/assets/img/report-broadcast/feedback-history.svg";
import ReportWaveform from "@/components/report-waveform/index.vue";

const props = defineProps<{
  portrait: string;
  playing: boolean;
  loading: boolean;
  currentSeq: number | null;
  nextText: string;
  transcriptSegments: Array<{ seq: number; text: string }>;
}>();

const emit = defineEmits<{ "open-history": [] }>();
const instance = getCurrentInstance();
const transcriptScrollTop = ref(0);
const leftWaveBars = [2, 2, 18, 4, 10, 4, 16, 8, 4, 16, 4, 30, 12, 20, 2, 1, 1];
const rightWaveBars = [2, 2, 18, 10, 18, 4, 8, 8, 10, 2, 4, 8, 22, 6, 2, 1, 1];
const showTranscriptSkeleton = computed(() => props.loading && props.transcriptSegments.length === 0);
const transcriptItems = computed(() => {
  const items = props.transcriptSegments.map(segment => ({
    key: `segment-${segment.seq}`,
    role: (segment.seq === props.currentSeq ? "current" : segment.seq < (props.currentSeq ?? Infinity) ? "previous" : "next") as "previous" | "current" | "next",
    text: segment.text,
  }));
  if (props.nextText && props.currentSeq !== null && !items.some(item => item.key === `segment-${props.currentSeq + 1}`)) {
    items.push({ key: `segment-${props.currentSeq + 1}`, role: "next", text: props.nextText });
  }
  return items;
});

function updateTranscriptScroll() {
  if (!props.playing || props.currentSeq === null) return;
  void nextTick(() => {
    const query = uni.createSelectorQuery().in(instance?.proxy);
    query.select(".report-broadcast-content__transcript-content").boundingClientRect();
    query.select(`#segment-${props.currentSeq}`).boundingClientRect();
    query.exec((rects) => {
      const viewport = rects?.[0] as UniApp.NodeInfo | undefined;
      const current = rects?.[1] as UniApp.NodeInfo | undefined;
      if (!viewport || !current || typeof viewport.bottom !== "number" || typeof current.bottom !== "number") return;
      const overflow = current.bottom - viewport.bottom;
      if (overflow > 0) transcriptScrollTop.value += Math.ceil(overflow);
    });
  });
}
watch(() => props.currentSeq, updateTranscriptScroll);
</script>

<template>
  <!-- Broadcast Content -->
  <view class="report-broadcast-content">
    <view class="report-broadcast-content__portrait-gap" />
    <view class="report-broadcast-content__portrait-stage">
      <view class="report-broadcast-content__wave report-broadcast-content__wave--left">
        <ReportWaveform :active="playing" :bars="leftWaveBars" />
      </view>
      <view class="report-broadcast-content__glow report-broadcast-content__glow--blue" />
      <view class="report-broadcast-content__glow report-broadcast-content__glow--red" />
      <view class="report-broadcast-content__portrait-wrap">
        <image class="report-broadcast-content__portrait" :src="portrait" mode="aspectFit" />
      </view>
      <view class="report-broadcast-content__wave report-broadcast-content__wave--right">
        <ReportWaveform :active="playing" :bars="rightWaveBars" />
      </view>
    </view>
    <view class="report-broadcast-content__transcript">
      <view v-show="showTranscriptSkeleton" class="report-broadcast-content__skeleton">
        <view v-for="index in 5" :key="index" class="report-broadcast-content__skeleton-segment">
          <view class="report-broadcast-content__skeleton-line" /><view class="report-broadcast-content__skeleton-line" /><view class="report-broadcast-content__skeleton-line report-broadcast-content__skeleton-line--short" />
        </view>
      </view>
      <scroll-view v-show="!showTranscriptSkeleton" class="report-broadcast-content__transcript-content" scroll-y :scroll-top="transcriptScrollTop" :scroll-with-animation="playing">
        <view class="report-broadcast-content__transcript-track">
          <text v-for="item in transcriptItems" :id="item.key" :key="item.key" class="report-broadcast-content__segment" :class="`report-broadcast-content__segment--${item.role}`">
            {{ item.text }}
          </text>
        </view>
      </scroll-view>
      <view v-if="!showTranscriptSkeleton" class="report-broadcast-content__bottom-fade" />
      <view v-if="!showTranscriptSkeleton" class="report-broadcast-content__feedback-mask">
        <view class="report-broadcast-content__feedback">
          <image class="report-broadcast-content__feedback-icon" :src="feedbackHistoryIcon" mode="aspectFit" @tap="emit('open-history')" /><image class="report-broadcast-content__feedback-icon" :src="feedbackGoodIcon" mode="aspectFit" />
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.report-broadcast-content { display: flex; min-height: 0; flex: 1 1 auto; flex-direction: column; overflow: hidden; }
.report-broadcast-content__portrait-gap { height: 34rpx; flex: 0 0 34rpx; }
.report-broadcast-content__portrait-stage { position: relative; display: flex; width: 100%; height: 510rpx; flex: 0 0 510rpx; align-items: center; justify-content: center; overflow: hidden; }
.report-broadcast-content__wave { position: absolute; z-index: 2; top: 243.707rpx; width: 140rpx; height: 140rpx; }.report-broadcast-content__wave--left { left: 52rpx; }.report-broadcast-content__wave--right { right: 52rpx; }
.report-broadcast-content__portrait-wrap { position: relative; display: flex; width: 470rpx; height: 470rpx; flex: 0 0 470rpx; align-items: flex-end; justify-content: center; }.report-broadcast-content__portrait { position: relative; z-index: 1; width: 470rpx; height: 470rpx; }
.report-broadcast-content__glow { position: absolute; z-index: 0; border-radius: 50%; filter: blur(92rpx); }.report-broadcast-content__glow--blue { top: 90rpx; left: 86rpx; width: 282rpx; height: 350rpx; background: rgb(229 242 255 / 30%); }.report-broadcast-content__glow--red { top: 40rpx; left: 303.714rpx; width: 362.571rpx; height: 450rpx; background: rgb(255 216 216 / 40%); }
.report-broadcast-content__transcript { position: relative; width: 100%; min-height: 0; flex: 1 1 auto; padding: 32rpx 88rpx 0; box-sizing: border-box; overflow: hidden; }.report-broadcast-content__transcript-content { width: 100%; height: 100%; }.report-broadcast-content__transcript-track { display: flex; min-height: 100%; padding-bottom: 180rpx; box-sizing: border-box; flex-direction: column; gap: 12rpx; }
.report-broadcast-content__skeleton { display: flex; flex-direction: column; gap: 12rpx; }.report-broadcast-content__skeleton-segment { display: flex; height: 152rpx; flex-direction: column; gap: 12rpx; }.report-broadcast-content__skeleton-line { width: 100%; height: 24rpx; border-radius: 8rpx; background: linear-gradient(90deg, #f2f3f5 25%, #e5e7eb 50%, #f2f3f5 75%); background-size: 200% 100%; animation: shimmer 1.4s ease-in-out infinite; }.report-broadcast-content__skeleton-line--short { width: 68%; }
.report-broadcast-content__segment { display: block; color: #e0e0e0; font-size: 38rpx; font-weight: 500; line-height: 48rpx; white-space: normal; }.report-broadcast-content__segment--current { color: #211b1b; font-size: 36rpx; font-weight: 700; line-height: 50rpx; }
.report-broadcast-content__bottom-fade { position: absolute; z-index: 2; right: 0; bottom: 0; left: 0; height: 180rpx; pointer-events: none; background: linear-gradient(180deg, rgb(255 255 255 / 0%) 0%, rgb(255 255 255 / 86%) 58%, #fff 100%); }.report-broadcast-content__feedback-mask { position: absolute; z-index: 2; right: 0; bottom: 48rpx; left: 0; display: flex; height: 112rpx; align-items: center; justify-content: flex-end; padding-right: 60rpx; box-sizing: border-box; background: #fff; }.report-broadcast-content__feedback { display: flex; gap: 16rpx; }.report-broadcast-content__feedback-icon { width: 48rpx; height: 48rpx; }
@keyframes shimmer { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }
</style>
