<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, ref, watch } from "vue";
import feedbackGoodFilledIcon from "@/assets/img/report-broadcast/feedback-good-filled.svg";
import feedbackGoodIcon from "@/assets/img/report-broadcast/feedback-good.svg";
import iconVoicePause from "@/assets/img/report-broadcast/pause-control.png";
import iconVoicePlay from "@/assets/img/report-broadcast/play-control.png";
import MarkdownRenderer from "@/components/markdown-renderer/index.vue";
import ReportWaveform from "@/components/report-waveform/index.vue";

const props = defineProps<{
  portrait: string;
  playing: boolean;
  loading: boolean;
  currentSeq: number | null;
  nextText: string;
  transcriptSegments: Array<{ seq: number; text: string }>;
  liked: boolean;
  likeLoading: boolean;
  /** 归一化播报进度（0~1），由播放器周期估算。 */
  progress: number;
  /** 按住说话后的识别中状态：与回答结果一起占用字幕区，播报文字隐藏。 */
  qaLoading?: boolean;
  /** 问答返回的结果文本，渲染在字幕区内。 */
  qaAnswer?: string;
  /** 按住说话录音中：先隐藏播报文字，等识别态接管字幕区。 */
  voiceRecording?: boolean;
}>();

const emit = defineEmits<{ "play-pause": []; like: []; seek: [seq: number] }>();
const instance = getCurrentInstance();
const transcriptScrollTop = ref(0);
const leftWaveBars = [2, 2, 18, 4, 10, 4, 16, 8, 4, 16, 4, 30, 12, 20, 2, 1, 1];
const rightWaveBars = [2, 2, 18, 10, 18, 4, 8, 8, 10, 2, 4, 8, 22, 6, 2, 1, 1];
const showTranscriptSkeleton = computed(
  () => props.loading && props.transcriptSegments.length === 0,
);
/** 按住说话的识别/问答态：字幕区让位给「正在理解」与回答结果。 */
const qaVisible = computed(() => Boolean(props.qaLoading || props.qaAnswer));
const transcriptItems = computed(() => {
  const items = props.transcriptSegments.map(segment => ({
    key: `segment-${segment.seq}`,
    role: (segment.seq === props.currentSeq
      ? "current"
      : segment.seq < (props.currentSeq ?? Infinity)
        ? "previous"
        : "next") as "previous" | "current" | "next",
    text: segment.text,
  }));
  if (
    props.nextText &&
    props.currentSeq !== null &&
    !items.some(item => item.key === `segment-${props.currentSeq + 1}`)
  ) {
    items.push({ key: `segment-${props.currentSeq + 1}`, role: "next", text: props.nextText });
  }
  return items;
});

function updateTranscriptScroll() {
  if (!props.playing || props.currentSeq === null) return;
  const targetSeq = props.currentSeq;
  void nextTick(() => {
    if (!props.playing || props.currentSeq !== targetSeq) return;
    const query = uni.createSelectorQuery().in(instance?.proxy);
    query.select(".report-broadcast-content__transcript-content").boundingClientRect();
    query.select(`#segment-${targetSeq}`).boundingClientRect();
    query.exec((rects) => {
      if (!props.playing || props.currentSeq !== targetSeq) return;
      const viewport = rects?.[0] as UniApp.NodeInfo | undefined;
      const current = rects?.[1] as UniApp.NodeInfo | undefined;
      if (
        !viewport
        || !current
        || typeof viewport.top !== "number"
        || typeof viewport.bottom !== "number"
        || typeof current.top !== "number"
        || typeof current.bottom !== "number"
      ) {
        return;
      }

      // 预留上下渐隐和底部反馈区，当前播报段落只在中间阅读带内定位。
      const safeTop = viewport.top + Math.min(80, (viewport.bottom - viewport.top) * 0.25);
      const safeBottom = viewport.bottom - Math.min(112, (viewport.bottom - viewport.top) * 0.35);
      const currentHeight = current.bottom - current.top;
      const targetTop = currentHeight >= safeBottom - safeTop
        ? safeTop
        : safeTop + (safeBottom - safeTop - currentHeight) / 2;
      const offset = current.top - targetTop;
      if (Math.abs(offset) > 1) transcriptScrollTop.value = Math.max(0, transcriptScrollTop.value + Math.round(offset));
    });
  });
}
watch(() => props.currentSeq, updateTranscriptScroll);

/* —— 播报进度条：随播放进度走，拖动换算到分句后上抛 seek —— */
const progressDragging = ref(false);
const progressDragRatio = ref(0);
/** 轨道在视口中的位置缓存：touchstart 时刷新，move 期间视图不动可直接复用。 */
let progressTrackRect: { left: number; width: number } | null = null;

const displayProgress = computed(() =>
  progressDragging.value ? progressDragRatio.value : props.progress,
);
const progressPercent = computed(
  () => `${Math.min(1, Math.max(0, displayProgress.value)) * 100}%`,
);

function measureProgressTrack() {
  const query = uni.createSelectorQuery().in(instance?.proxy);
  query.select(".report-broadcast-content__progress-hit").boundingClientRect();
  query.exec((rects) => {
    const rect = rects?.[0] as UniApp.NodeInfo | undefined;
    if (rect && typeof rect.left === "number" && typeof rect.width === "number" && rect.width > 0) {
      progressTrackRect = { left: rect.left, width: rect.width };
    }
  });
}

function ratioFromClientX(clientX: number): number | null {
  if (!progressTrackRect) return null;
  return Math.min(1, Math.max(0, (clientX - progressTrackRect.left) / progressTrackRect.width));
}

function onProgressTouchStart(event: TouchEvent) {
  if (!props.transcriptSegments.length) return;
  progressDragging.value = true;
  progressTrackRect = null;
  measureProgressTrack();
  const touch = event?.touches?.[0];
  if (touch) {
    // rect 异步测回来前保持原值，move 里会立即跟上
    progressDragRatio.value = ratioFromClientX(touch.clientX) ?? progressDragRatio.value;
  }
}

function onProgressTouchMove(event: TouchEvent) {
  if (!progressDragging.value) return;
  const touch = event?.touches?.[0];
  if (!touch) return;
  const ratio = ratioFromClientX(touch.clientX);
  if (ratio != null) progressDragRatio.value = ratio;
}

function onProgressTouchEnd() {
  if (!progressDragging.value) return;
  progressDragging.value = false;
  const total = props.transcriptSegments.length;
  if (!total) return;
  const index = Math.min(total - 1, Math.max(0, Math.floor(progressDragRatio.value * total)));
  const seq = props.transcriptSegments[index]?.seq;
  if (typeof seq === "number") emit("seek", seq);
}
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
      <view class="report-broadcast-content__play-control" @tap="emit('play-pause')">
        <image
          class="report-broadcast-content__play-control-icon"
          :src="playing ? iconVoicePlay : iconVoicePause"
          mode="aspectFit"
        />
      </view>
    </view>
    <!-- 头像下方播报进度条：随播放进度走，拖动跳到对应分句 -->
    <view v-if="transcriptSegments.length" class="report-broadcast-content__progress">
      <view
        class="report-broadcast-content__progress-hit"
        :class="{ 'report-broadcast-content__progress-hit--dragging': progressDragging }"
        @touchstart.stop="onProgressTouchStart"
        @touchmove.stop.prevent="onProgressTouchMove"
        @touchend.stop="onProgressTouchEnd"
        @touchcancel.stop="onProgressTouchEnd"
      >
        <view class="report-broadcast-content__progress-rail">
          <view class="report-broadcast-content__progress-fill" :style="{ width: progressPercent }" />
          <view class="report-broadcast-content__progress-thumb" :style="{ left: progressPercent }" />
        </view>
      </view>
    </view>
    <view class="report-broadcast-content__transcript">
      <view v-show="showTranscriptSkeleton" class="report-broadcast-content__skeleton">
        <view v-for="index in 5" :key="index" class="report-broadcast-content__skeleton-segment">
          <view class="report-broadcast-content__skeleton-line" /><view
            class="report-broadcast-content__skeleton-line"
          /><view
            class="report-broadcast-content__skeleton-line report-broadcast-content__skeleton-line--short"
          />
        </view>
      </view>
      <scroll-view
        v-show="!showTranscriptSkeleton && !qaVisible && !voiceRecording"
        class="report-broadcast-content__transcript-content"
        scroll-y
        :scroll-top="transcriptScrollTop"
        :scroll-with-animation="playing"
      >
        <view class="report-broadcast-content__transcript-track">
          <text
            v-for="item in transcriptItems"
            :id="item.key"
            :key="item.key"
            class="report-broadcast-content__segment"
            :class="`report-broadcast-content__segment--${item.role}`"
          >
            {{ item.text }}
          </text>
        </view>
      </scroll-view>
      <!-- 按住说话：识别中/回答结果直接占用字幕区，头像与播放控制保持不动 -->
      <view v-if="!showTranscriptSkeleton && qaLoading" class="report-broadcast-content__qa-loading">
        <text class="report-broadcast-content__qa-title">
          正在理解你的内容
        </text>
        <text class="report-broadcast-content__qa-subtitle">
          我会结合当前听播内容直接回答
        </text>
      </view>
      <scroll-view
        v-else-if="!showTranscriptSkeleton && qaAnswer"
        class="report-broadcast-content__qa-scroll"
        scroll-y
      >
        <!-- 与首页问答同一套富文本渲染：Markdown 的标题/列表/加粗等原样呈现 -->
        <MarkdownRenderer class="report-broadcast-content__qa-answer" :content="qaAnswer" />
      </scroll-view>
      <view
        v-if="!showTranscriptSkeleton && !qaVisible && !voiceRecording"
        class="report-broadcast-content__top-fade"
      />
      <view
        v-if="!showTranscriptSkeleton && !qaVisible && !voiceRecording"
        class="report-broadcast-content__bottom-fade"
      />
      <view
        v-if="!showTranscriptSkeleton && !qaVisible && !voiceRecording"
        class="report-broadcast-content__feedback-mask"
      >
        <view
          class="report-broadcast-content__feedback-button"
          :class="{
            'report-broadcast-content__feedback-button--liked': liked,
            'report-broadcast-content__feedback-button--loading': likeLoading,
          }"
          :aria-disabled="likeLoading"
          @tap.stop="!likeLoading && emit('like')"
        >
          <image
            class="report-broadcast-content__feedback-icon"
            :src="liked ? feedbackGoodFilledIcon : feedbackGoodIcon"
            mode="aspectFit"
          />
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.report-broadcast-content {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  overflow: hidden;
}
.report-broadcast-content__portrait-gap {
  height: 34rpx;
  flex: 0 0 34rpx;
}
.report-broadcast-content__portrait-stage {
  position: relative;
  display: flex;
  width: 100%;
  height: 510rpx;
  flex: 0 0 510rpx;
  align-items: center;
  justify-content: center;
  overflow: visible;
}
.report-broadcast-content__wave {
  position: absolute;
  z-index: 2;
  top: 243.707rpx;
  width: 140rpx;
  height: 140rpx;
}
.report-broadcast-content__wave--left {
  left: 52rpx;
}
.report-broadcast-content__wave--right {
  right: 52rpx;
}
.report-broadcast-content__portrait-wrap {
  position: relative;
  display: flex;
  width: 470rpx;
  height: 470rpx;
  flex: 0 0 470rpx;
  align-items: flex-end;
  justify-content: center;
}
.report-broadcast-content__portrait {
  position: relative;
  z-index: 1;
  width: 470rpx;
  height: 470rpx;
}
.report-broadcast-content__glow {
  position: absolute;
  z-index: 0;
  border-radius: 50%;
  filter: blur(92rpx);
}
.report-broadcast-content__glow--blue {
  top: 90rpx;
  left: 86rpx;
  width: 282rpx;
  height: 350rpx;
  background: rgb(229 242 255 / 30%);
}
.report-broadcast-content__glow--red {
  top: 40rpx;
  left: 303.714rpx;
  width: 362.571rpx;
  height: 450rpx;
  background: rgb(255 216 216 / 40%);
}
/* —— 头像下方进度条 ——
   容器 80rpx（上 48 留白让开头像底部的播放按钮，其底缘伸入 stage 下方 24rpx），
   热区 32rpx 放底部，视觉轨道 6rpx 居中；左右 88rpx 与字幕区对齐。 */
.report-broadcast-content__progress {
  display: flex;
  width: 100%;
  height: 80rpx;
  flex: 0 0 80rpx;
  align-items: flex-end;
  padding: 0 88rpx;
  box-sizing: border-box;
}
.report-broadcast-content__progress-hit {
  display: flex;
  width: 100%;
  height: 32rpx;
  align-items: center;
  cursor: pointer;
  touch-action: none;
}
.report-broadcast-content__progress-rail {
  position: relative;
  width: 100%;
  height: 6rpx;
  border-radius: 3rpx;
  background: #ececec;
}
.report-broadcast-content__progress-fill {
  height: 100%;
  border-radius: 3rpx;
  background: linear-gradient(90deg, #6e9fd8 0%, #c8201e 100%);
}
.report-broadcast-content__progress-thumb {
  position: absolute;
  top: 50%;
  width: 18rpx;
  height: 18rpx;
  border-radius: 50%;
  background: #c8201e;
  transform: translate(-50%, -50%);
  transition: transform 0.15s ease;
}
.report-broadcast-content__progress-hit--dragging .report-broadcast-content__progress-thumb {
  transform: translate(-50%, -50%) scale(1.35);
}
.report-broadcast-content__transcript {
  position: relative;
  width: 100%;
  min-height: 0;
  flex: 1 1 auto;
  padding: 32rpx 88rpx 0;
  box-sizing: border-box;
  overflow: hidden;
}
.report-broadcast-content__transcript-content {
  width: 100%;
  height: 100%;
}
.report-broadcast-content__transcript-track {
  display: flex;
  min-height: 100%;
  padding-bottom: 180rpx;
  box-sizing: border-box;
  flex-direction: column;
  gap: 12rpx;
}
.report-broadcast-content__skeleton {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}
.report-broadcast-content__skeleton-segment {
  display: flex;
  height: 152rpx;
  flex-direction: column;
  gap: 12rpx;
}
.report-broadcast-content__skeleton-line {
  width: 100%;
  height: 24rpx;
  border-radius: 8rpx;
  background: linear-gradient(90deg, #f2f3f5 25%, #e5e7eb 50%, #f2f3f5 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}
.report-broadcast-content__skeleton-line--short {
  width: 68%;
}
.report-broadcast-content__segment {
  display: block;
  color: #e0e0e0;
  font-size: 38rpx;
  font-weight: 500;
  line-height: 48rpx;
  white-space: normal;
}
.report-broadcast-content__segment--current {
  color: #211b1b;
  font-size: 36rpx;
  font-weight: 700;
  line-height: 50rpx;
}
/* —— 按住说话的识别/问答态：占用字幕区 —— */
.report-broadcast-content__qa-loading {
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
}
.report-broadcast-content__qa-title {
  color: #1a1a1a;
  font-size: 36rpx;
  font-weight: 400;
}
.report-broadcast-content__qa-subtitle {
  color: #999;
  font-size: 26rpx;
  font-weight: 400;
}
.report-broadcast-content__qa-scroll {
  width: 100%;
  height: 100%;
  padding-bottom: 48rpx;
  box-sizing: border-box;
}
/* 正文排版交给 MarkdownRenderer，这里只负责留白 */
.report-broadcast-content__qa-answer {
  display: block;
  width: 100%;
}
.report-broadcast-content__top-fade {
  position: absolute;
  z-index: 2;
  top: 0;
  right: 0;
  left: 0;
  height: 160rpx;
  pointer-events: none;
  background: linear-gradient(180deg, #fff 0%, rgb(255 255 255 / 86%) 52%, rgb(255 255 255 / 0%) 100%);
}
.report-broadcast-content__play-control {
  position: absolute;
  z-index: 3;
  bottom: -24rpx;
  left: 50%;
  display: flex;
  width: 64rpx;
  height: 64rpx;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  box-shadow: 0 8rpx 20rpx rgb(0 0 0 / 18%);
  transform: translateX(-50%);
}
.report-broadcast-content__play-control-icon {
  width: 64rpx;
  height: 64rpx;
}
.report-broadcast-content__bottom-fade {
  position: absolute;
  z-index: 2;
  right: 0;
  bottom: 0;
  left: 0;
  height: 180rpx;
  pointer-events: none;
  background: linear-gradient(
    180deg,
    rgb(255 255 255 / 0%) 0%,
    rgb(255 255 255 / 86%) 58%,
    #fff 100%
  );
}
.report-broadcast-content__feedback-mask {
  position: absolute;
  z-index: 2;
  right: 0;
  bottom: 48rpx;
  left: 0;
  display: flex;
  height: 112rpx;
  align-items: center;
  justify-content: flex-end;
  padding-right: 68rpx;
  box-sizing: border-box;
  background: #fff;
}
.report-broadcast-content__feedback-button {
  display: flex;
  width: 72rpx;
  height: 72rpx;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: transform 0.16s ease, opacity 0.16s ease;
}
.report-broadcast-content__feedback-button:active {
  transform: scale(0.9);
}
.report-broadcast-content__feedback-button--loading {
  pointer-events: none;
  opacity: 0.45;
}
.report-broadcast-content__feedback-icon {
  width: 48rpx;
  height: 48rpx;
}
.report-broadcast-content__play-btn {
  display: flex;
  width: 48rpx;
  height: 48rpx;
  align-items: center;
  justify-content: center;
}
@keyframes shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}
</style>
