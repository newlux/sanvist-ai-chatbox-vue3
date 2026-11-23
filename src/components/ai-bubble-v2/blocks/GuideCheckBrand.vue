<script setup lang="ts">
import iconRadioOn from "@/assets/img/icon-action-radio-on.svg";
import saniIcon from "@/assets/img/icon-sani.png";

defineOptions({ name: "GuideCheckBrand" });

/**
 * 步骤卡的品牌署名行：SANY Neo 图标 + SANY Neo + 语音播报控制。
 *
 * 从 GuideCheckBlock 里独立出来，由消息列表渲染在卡片容器的固定层（见 ai-message-list 的
 * standaloneBlocks 那一层）：步骤卡每切一步都会整块重挂载（key 是 block.id，一步一块），
 * 品牌行留在卡片内就会跟着一起重建 —— 图标重新插一次、播报按钮的播放态跳回静止、
 * 滑动切步的入场动画还会把它连内容一起平移，看上去就是「SANY Neo 那行在闪」。
 * 放在容器层后，切步只有下面的内容卡重挂载，这一行纹丝不动。
 *
 * 只负责 UI：播报文案由外层按当前展示的那张卡组装（见 ai-message-list 的 onStepCardTts）。
 */
defineProps({
  /** 深色：与卡片内容同一套（#FFF 文字） */
  dark: { type: Boolean, default: false },
  /** 这一轮是否支持语音播报：不支持时不画按钮 */
  ttsEnabled: { type: Boolean, default: false },
  /** 拉流中（spinner） */
  ttsLoading: { type: Boolean, default: false },
  /** 播放中（蓝色声波） */
  ttsPlaying: { type: Boolean, default: false },
});

const emit = defineEmits<{
  (e: "tts-click"): void;
}>();
</script>

<template>
  <view class="guide-check-brand" :class="{ 'guide-check-brand--dark': dark }">
    <image class="guide-check-brand__icon" :src="saniIcon" mode="aspectFit" />
    <text class="guide-check-brand__text">
      SANY Neo
    </text>
    <view
      v-if="ttsEnabled"
      class="guide-check-brand__tts"
      @tap.stop="emit('tts-click')"
    >
      <view v-if="ttsLoading" class="guide-check-brand__spinner" />
      <view v-else-if="ttsPlaying" class="guide-check-brand__wave">
        <view
          v-for="index in 4"
          :key="index"
          class="guide-check-brand__wave-bar"
          :class="`guide-check-brand__wave-bar--${index}`"
        />
      </view>
      <image v-else :src="iconRadioOn" mode="aspectFit" class="guide-check-brand__action-icon" />
    </view>
  </view>
</template>

<style lang="scss" scoped>
.guide-check-brand {
  display: flex;
  align-items: center;
  margin-bottom: 20rpx;
}

.guide-check-brand__icon {
  flex-shrink: 0;
  width: 52rpx;
  height: 52rpx;
}

.guide-check-brand__text {
  margin-left: 12rpx;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 26rpx;
  font-weight: 500;
  line-height: 36rpx;
  color: #1a1a1a;
}

.guide-check-brand__tts {
  display: flex;
  width: 32rpx;
  height: 32rpx;
  align-items: center;
  justify-content: center;
  margin-left: 12rpx;
}

.guide-check-brand__action-icon {
  width: 32rpx;
  height: 32rpx;
}

.guide-check-brand__spinner {
  box-sizing: border-box;
  width: 24rpx;
  height: 24rpx;
  border: 3rpx solid rgba(136, 136, 136, 0.22);
  border-top-color: #888888;
  border-radius: 50%;
  animation: guide-check-brand-spin 0.8s linear infinite;
}

/* 播放中的语音图标：蓝色声波，四根条错峰起伏，视觉上从左往右推进 */
.guide-check-brand__wave {
  display: flex;
  width: 32rpx;
  height: 32rpx;
  align-items: center;
  justify-content: center;
  gap: 4rpx;
}

.guide-check-brand__wave-bar {
  width: 4rpx;
  height: 24rpx;
  border-radius: 4rpx;
  background: #1a6dff;
  transform-origin: center center;
  animation: guide-check-brand-wave 0.9s ease-in-out infinite;
}

.guide-check-brand__wave-bar--1 { animation-delay: 0s; }
.guide-check-brand__wave-bar--2 { animation-delay: 0.12s; }
.guide-check-brand__wave-bar--3 { animation-delay: 0.24s; }
.guide-check-brand__wave-bar--4 { animation-delay: 0.36s; }

@keyframes guide-check-brand-spin {
  to { transform: rotate(360deg); }
}

@keyframes guide-check-brand-wave {
  0%,
  100% {
    transform: scaleY(0.35);
    opacity: 0.6;
  }

  50% {
    transform: scaleY(1);
    opacity: 1;
  }
}

/* ===== 深色：与卡片其它块同一套材质 ===== */
.guide-check-brand--dark {
  .guide-check-brand__text {
    color: #fff;
  }

  .guide-check-brand__spinner {
    border-color: rgba(255, 255, 255, 0.22);
    border-top-color: rgba(255, 255, 255, 0.72);
  }

  .guide-check-brand__wave-bar {
    background: #4c8dff;
  }

  /* 播报图标的 svg 在深底上偏暗，整体提亮一档（与卡片动作区同做法） */
  .guide-check-brand__action-icon {
    filter: brightness(1.7);
  }
}
</style>
