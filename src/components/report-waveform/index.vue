<script setup lang="ts">
const props = withDefaults(defineProps<{
  /** 每根柱高(px)，与设计稿 940:3 / 940:110 逐根对应 */
  bars?: number[];
  color?: string;
  /**
   * 横向多段渐变（从左到右），传入后覆盖 color。
   * offset 为百分比，与设计稿 stops 一一对应（如 309:2117）。
   */
  gradient?: Array<{ color: string; offset: number }>;
  /** 设计稿 box：70×70 */
  boxWidth?: number;
  boxHeight?: number;
  /** 柱宽与间距 */
  barWidth?: number;
  spacing?: number;
  originX?: number;
  /** 播放中：每根柱做错相的音波脉动动画 */
  active?: boolean;
}>(), {
  bars: () => [2, 2, 18, 4, 10, 4, 16, 8, 4, 16, 4, 30, 12, 20, 2, 1, 1],
  color: "#c8201e",
  boxWidth: 70,
  boxHeight: 70,
  barWidth: 2,
  spacing: 4,
  originX: 3,
  active: false,
});

const centerY = props.boxHeight / 2;

/** 多实例同页（左右两组声波）时渐变 id 必须唯一，避免互相覆盖 */
const gradientId = `report-waveform-gradient-${Math.random().toString(36).slice(2, 9)}`;

/** 有渐变用渐变，否则回退到单色（默认 #c8201e，播放页沿用） */
function barFill() {
  return props.gradient?.length ? `url(#${gradientId})` : props.color;
}

/** 设计稿末端包含 1px 细柱，必须原样保留。 */
function heightAt(index: number) {
  return Math.max(1, props.bars[index] ?? 1);
}

function rectX(index: number) {
  return props.originX + index * props.spacing - props.barWidth / 2;
}

function rectY(index: number) {
  return centerY - heightAt(index) / 2;
}
</script>

<template>
  <!-- 内联 SVG：每根柱子独立 rect，可逐根动画；视觉严格按设计稿柱高 -->
  <svg
    class="report-waveform"
    :class="{ 'report-waveform--active': active }"
    :viewBox="`0 0 ${boxWidth} ${boxHeight}`"
    :style="{ width: `${boxWidth * 2}rpx`, height: `${boxHeight * 2}rpx` }"
  >
    <!-- 横向渐变（userSpaceOnUse 让整组柱子共用同一条渐变，逐柱不会各自重来） -->
    <defs v-if="gradient?.length">
      <linearGradient
        :id="gradientId"
        gradientUnits="userSpaceOnUse"
        x1="0"
        y1="0"
        :x2="boxWidth"
        y2="0"
      >
        <stop
          v-for="(stop, index) in gradient"
          :key="index"
          :offset="`${stop.offset}%`"
          :stop-color="stop.color"
        />
      </linearGradient>
    </defs>
    <rect
      v-for="(bar, index) in bars"
      :key="index"
      :x="rectX(index)"
      :y="rectY(index)"
      :width="barWidth"
      :height="heightAt(index)"
      :rx="barWidth / 2"
      :fill="barFill()"
      :style="{ animationDelay: `${index * 0.08}s` }"
    />
  </svg>
</template>

<style scoped>
.report-waveform {
  display: block;
  flex-shrink: 0;
}

/* 播放中：每根柱以自身中心为原点做 scaleY 上下脉动 */
.report-waveform--active rect {
  transform-box: fill-box;
  transform-origin: center;
  animation: report-waveform-pulse 0.55s ease-in-out infinite;
}

@keyframes report-waveform-pulse {
  0%,
  100% {
    transform: scaleY(0.4);
  }
  50% {
    transform: scaleY(1);
  }
}
</style>
