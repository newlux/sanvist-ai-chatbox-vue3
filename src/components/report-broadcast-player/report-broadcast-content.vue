<script setup lang="ts">
import type { ThinkStep } from "@/utils/ai-stream";
import { computed, getCurrentInstance, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import feedbackGoodFilledIcon from "@/assets/img/report-broadcast/feedback-good-filled.svg";
import feedbackGoodIcon from "@/assets/img/report-broadcast/feedback-good.svg";
import MarkdownRenderer from "@/components/markdown-renderer/index.vue";
import ReportWaveform from "@/components/report-waveform/index.vue";

const props = defineProps<{
  portrait: string;
  playing: boolean;
  loading: boolean;
  currentSeq: number | null;
  nextText: string;
  transcriptSegments: Array<{ seq: number; text: string }>;
  /** 归一化播报进度（0~1），由播放器周期估算。 */
  progress: number;
  /** 按住说话后的识别中状态：与回答结果一起占用字幕区，播报文字隐藏。 */
  qaLoading?: boolean;
  /** 思考中的过程小标题：接口 chat-messages 的 subtitle 事件下发（如「目标 Dify 工作流已开始。」）。 */
  qaSubtitle?: string;
  /** 问答返回的结果文本，渲染在字幕区内。 */
  qaAnswer?: string;
  /** 按住说话录音中：先隐藏播报文字，等识别态接管字幕区。 */
  voiceRecording?: boolean;
}>();

const emit = defineEmits<{ "play-pause": []; seek: [seq: number] }>();
const { t } = useI18n();
const instance = getCurrentInstance();
const transcriptScrollTop = ref(0);
/**
 * 滚动视图的真实位置。transcriptScrollTop 是单向受控值，用户手动滚动时不会同步，
 * 一旦两者脱节，切句时以受控值为基数算出的目标位置就是错的，高亮回不到中间。
 */
let transcriptRealScrollTop = 0;
/** 自动居中滚动进行中：动画中间态不回写受控值，否则会自己打断自己。 */
let transcriptAutoCentering = false;
let transcriptAutoCenterTimer: ReturnType<typeof setTimeout> | null = null;
/** 手动滚动停手后延迟这么久，若无新滚动就把当前高亮段拉回中间（不等下一句切句）。 */
const TRANSCRIPT_RECENTER_DELAY_MS = 3000;
let transcriptRecenterTimer: ReturnType<typeof setTimeout> | null = null;

/** 取消已排定的「停手回中」，避免用户继续滚动时半路被打断。 */
function cancelTranscriptRecenter() {
  if (!transcriptRecenterTimer) return;
  clearTimeout(transcriptRecenterTimer);
  transcriptRecenterTimer = null;
}

/** 每次手动滚动都重新计时：只有真正停下来 TRANSCRIPT_RECENTER_DELAY_MS 才回中。 */
function scheduleTranscriptRecenter() {
  cancelTranscriptRecenter();
  // 暂停时用户通常在看文字，不打扰；恢复播放后由切句逻辑接管回中
  if (!props.playing) return;
  transcriptRecenterTimer = setTimeout(() => {
    transcriptRecenterTimer = null;
    updateTranscriptScroll();
  }, TRANSCRIPT_RECENTER_DELAY_MS);
}

/**
 * 记录真实滚动位置；手动滚动时同步受控值到真实位置，
 * 保证下次自动居中的目标值与旧值不同，scroll-view 才会真正滚动。
 */
function onTranscriptScroll(e: { detail?: { scrollTop?: number } }) {
  const top = Number(e?.detail?.scrollTop ?? 0);
  if (!Number.isFinite(top)) return;
  transcriptRealScrollTop = top;
  if (transcriptAutoCentering) return;
  transcriptScrollTop.value = Math.max(0, top);
  // 手动滚动：排定停手后回中，高亮段重新回到中间阅读带
  scheduleTranscriptRecenter();
}
// 与「偏好设置」音色选择页同一套声波参数（设计稿 309:2117 / 309:2155）
const leftWaveBars = [2, 2, 18, 4, 10, 4, 16, 8, 4, 16, 4, 30, 12, 20, 2, 1, 1];
const rightWaveBars = [2, 2, 18, 10, 18, 4, 8, 8, 10, 2, 4, 8, 22, 6, 2, 1, 1];
// 左右声波共用同一套横向渐变：0% #3D21CD → 48.72% #1999FE → 76% #C067FA → 100% #FD90C4
const waveGradient = [
  { color: "#3D21CD", offset: 0 },
  { color: "#1999FE", offset: 48.72 },
  { color: "#C067FA", offset: 76 },
  { color: "#FD90C4", offset: 100 },
];
/** 播放/暂停图标与声波同色系，多实例同页时渐变 id 需唯一 */
const playIconGradientId = `report-broadcast-play-gradient-${Math.random().toString(36).slice(2, 9)}`;
const showTranscriptSkeleton = computed(
  () => props.loading && props.transcriptSegments.length === 0,
);
/** 按住说话的识别/问答态：字幕区让位给「正在理解」与回答结果。 */
const qaVisible = computed(() => Boolean(props.qaLoading || props.qaAnswer));
/**
 * 识别中标题下方的文字：全部来自 chat-messages 流——
 * 先放后端下发的当前过程文案，再补上 think 步骤里的执行说明（同文去重）。
 */
const qaTextLines = computed(() => {
  const lines: string[] = [];
  const push = (text: unknown) => {
    const value = String(text || "").trim();
    if (!value || lines.includes(value)) return;
    lines.push(value);
  };
  push(props.qaSubtitle);
  (props.qaSteps || []).forEach(step => push(step?.message));
  return lines;
});
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
      if (Math.abs(offset) > 1) {
        // 已经在自动回中，取消可能残留的停手排定，避免重复触发
        cancelTranscriptRecenter();
        // 以「真实滚动位置」为基数校正：受控值可能因用户手动滚动而与真实位置脱节，
        // 用脱节的受控值做基数会把高亮滚偏，甚至新旧值相同导致 scroll-view 不滚动（表现为不复原）。
        const nextTop = Math.max(0, Math.round(transcriptRealScrollTop + offset));
        transcriptAutoCentering = true;
        transcriptScrollTop.value = nextTop;
        transcriptRealScrollTop = nextTop;
        if (transcriptAutoCenterTimer) clearTimeout(transcriptAutoCenterTimer);
        // 与 scroll-with-animation 的动画时长同量级，动画结束后恢复手动滚动回写
        transcriptAutoCenterTimer = setTimeout(() => {
          transcriptAutoCentering = false;
        }, 360);
      }
    });
  });
}
watch(() => props.currentSeq, updateTranscriptScroll);

onBeforeUnmount(() => {
  if (transcriptAutoCenterTimer) clearTimeout(transcriptAutoCenterTimer);
  cancelTranscriptRecenter();
});

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
        <ReportWaveform
          :active="playing"
          :bars="leftWaveBars"
          :gradient="waveGradient"
          :box-width="70"
          :box-height="70"
          :bar-width="2"
          :spacing="4"
          :origin-x="3"
        />
      </view>
      <view class="report-broadcast-content__glow report-broadcast-content__glow--blue" />
      <view class="report-broadcast-content__glow report-broadcast-content__glow--red" />
      <view class="report-broadcast-content__portrait-wrap">
        <image class="report-broadcast-content__portrait" :src="portrait" mode="aspectFit" />
      </view>
      <view class="report-broadcast-content__wave report-broadcast-content__wave--right">
        <ReportWaveform
          :active="playing"
          :bars="rightWaveBars"
          :gradient="waveGradient"
          :box-width="70"
          :box-height="70"
          :bar-width="2"
          :spacing="4"
          :origin-x="3"
        />
      </view>
      <!-- 播放按钮（设计稿 339:1359）：白底圆形 + 同色系渐变图标 -->
      <view class="report-broadcast-content__play-control" @tap="emit('play-pause')">
        <svg class="report-broadcast-content__play-control-icon" viewBox="0 0 22 22" aria-hidden="true">
          <defs>
            <linearGradient
              :id="playIconGradientId"
              x1="0"
              y1="0"
              x2="22"
              y2="0"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stop-color="#3D21CD" />
              <stop offset="48.72%" stop-color="#1999FE" />
              <stop offset="76%" stop-color="#C067FA" />
              <stop offset="100%" stop-color="#FD90C4" />
            </linearGradient>
          </defs>
          <!-- 播放中显示暂停双条，暂停时显示播放三角 -->
          <g v-if="playing" :fill="`url(#${playIconGradientId})`">
            <rect x="6.4" y="4.6" width="3.4" height="12.8" rx="1.7" />
            <rect x="12.2" y="4.6" width="3.4" height="12.8" rx="1.7" />
          </g>
          <polygon
            v-else
            points="7.2,4.4 17,11 7.2,17.6"
            fill="none"
            :stroke="`url(#${playIconGradientId})`"
            stroke-width="1.6"
            stroke-linejoin="round"
          />
        </svg>
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
        @scroll="onTranscriptScroll"
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
        <!-- 思考态背景：设计稿光斑，缓慢明暗起伏做呼吸灯 -->
        <image
          class="report-broadcast-content__qa-loading-glow"
          :src="thinkingGlow"
          mode="aspectFill"
        />
        <view class="report-broadcast-content__qa-loading-copy">
          <text class="report-broadcast-content__qa-title">
            {{ t("broadcast-understanding") }}
          </text>
          <!-- 标题位置固定：小标题始终占位，有文案才显示，不推动标题 -->
          <text class="report-broadcast-content__qa-subtitle">
            {{ qaSubtitle || "" }}
          </text>
        </view>
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
  // background: rgb(255 216 216 / 40%);
}
/* —— 头像下方进度条（设计稿 339:1247）——
   容器 80rpx（上 48 留白让开头像底部的播放按钮，其底缘伸入 stage 下方 24rpx），
   热区 32rpx 放底部，视觉轨道 4rpx 居中；左右 88rpx 与字幕区对齐。 */
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
  height: 4rpx;
  border-radius: 2rpx;
  background: #e7e7e7;
}
/* 已播部分：与声波同一套渐变，渐变随填充宽度整体铺开 */
.report-broadcast-content__progress-fill {
  height: 100%;
  border-radius: 2rpx;
  background: linear-gradient(90deg, #3d21cd 0%, #1999fe 48.72%, #c067fa 76%, #fd90c4 100%);
}
.report-broadcast-content__progress-thumb {
  position: absolute;
  top: 50%;
  box-sizing: border-box;
  width: 16rpx;
  height: 16rpx;
  border: 2rpx solid #fff;
  border-radius: 50%;
  background: #1166d6;
  box-shadow: 0 2rpx 4rpx rgb(0 0 0 / 11%);
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
/* —— 按住说话的识别/问答态：占用字幕区，文案与呼吸灯光晕整体居中 —— */
.report-broadcast-content__qa-loading {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
/* 思考态背景：设计稿光斑铺满字幕区，明暗配合轻微缩放做呼吸灯 */
.report-broadcast-content__qa-loading-glow {
  position: absolute;
  z-index: 0;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  animation: qa-loading-breathe 3.6s ease-in-out infinite;
}
.report-broadcast-content__qa-loading-copy {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
}
.report-broadcast-content__qa-title {
  color: #1a1a1a;
  font-size: 38rpx;
  font-weight: 500;
  line-height: 54rpx;
  text-align: center;
}
/* 小标题无论有没有接口文案都占住这一行，标题位置保持不变 */
.report-broadcast-content__qa-subtitle {
  min-height: 36rpx;
  color: #999;
  font-size: 26rpx;
  font-weight: 400;
  line-height: 36rpx;
}
@keyframes qa-loading-breathe {
  0%,
  100% {
    opacity: 0.55;
    transform: scale(1);
  }

  50% {
    opacity: 1;
    transform: scale(1.04);
  }
}
/* 答案卡片：白底圆角卡，高度随内容自适应，超长时在卡片内滚动 */
.report-broadcast-content__qa-scroll {
  flex: 0 1 auto;
  width: 100%;
  max-height: calc(100% - 48rpx);
  margin-bottom: 48rpx;
  padding: 36rpx 36rpx 40rpx;
  border: 1px solid #f0f1f3;
  border-radius: 24rpx;
  box-sizing: border-box;
  background: #fff;
  box-shadow: 0 6rpx 20rpx rgb(21 27 38 / 4%);
}
/* 正文排版交给 MarkdownRenderer，这里只补齐卡片内的字号与行距 */
.report-broadcast-content__qa-answer {
  display: block;
  width: 100%;
}
.report-broadcast-content__qa-answer :deep(p) {
  margin-bottom: 14rpx !important;
  color: #2f323c !important;
  font-size: 30rpx !important;
  line-height: 46rpx !important;
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
/* 播放按钮（设计稿 339:1359）：32×32 外框内 28×28 白底圆 + 1px 描边 + 柔和投影 */
.report-broadcast-content__play-control {
  position: absolute;
  z-index: 3;
  bottom: -24rpx;
  left: 50%;
  display: flex;
  box-sizing: border-box;
  width: 64rpx;
  height: 64rpx;
  align-items: center;
  justify-content: center;
  border: 1px solid #e4e4e4;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2rpx 22rpx rgb(0 0 0 / 10%);
  transform: translateX(-50%);
}
.report-broadcast-content__play-control-icon {
  width: 48rpx;
  height: 48rpx;
  opacity: 0.6;
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
