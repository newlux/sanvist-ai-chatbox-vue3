<script setup lang="ts">
import { computed } from "vue";

/**
 * 语音提问的底部条（稿子 Frame 114）：
 * 左侧圆形 ×（取消）→ 中间声纹（随音量长短浮动）→ 右侧秒数 + 上箭头（说完发送）。
 *
 * 只在「初始页点击说话飞进问答页」这段录音期间顶替输入栏，
 * 和「按住说话」那套整屏水面面板是两条独立的动线，互不影响。
 */
defineOptions({
  name: "AiVoiceQueryBar",
});

const props = defineProps({
  /** 实时音量 0~1（已平滑）：驱动中间声纹的长短 */
  level: { type: Number, default: 0 },
  /** 已录秒数：右上角那枚 4s */
  seconds: { type: Number, default: 0 },
  /** 已发过 finish、在等定稿：按钮降透明度，避免重复点 */
  busy: { type: Boolean, default: false },
  /** 深色外观：胶囊与图标一起反色 */
  dark: { type: Boolean, default: false },
});

const emit = defineEmits<{
  (e: "cancel"): void;
  (e: "submit"): void;
}>();

/** 声纹根数：取奇数，正中间那根最高，向两侧对称收短 */
const BAR_COUNT = 31;
const CENTER = (BAR_COUNT - 1) / 2;

/**
 * 每根的响应权重：中心 1、两端 0.35。
 * 用固定的钟形而不是随机系数 —— 这里要的是「一排电平表」，不是抖动噪点。
 */
const BAR_WEIGHTS = Array.from({ length: BAR_COUNT }, (_, index) => {
  const distance = Math.abs(index - CENTER) / CENTER;
  return 1 - distance * 0.65;
});

/** 6rpx 静态底 + 音量放大，中间那根最高到 56rpx */
const barHeights = computed(() => {
  const level = Math.min(1, Math.max(0, props.level));
  return BAR_WEIGHTS.map((weight) => {
    const height = 6 + level * 50 * weight;
    return `${height.toFixed(1)}rpx`;
  });
});

const secondsText = computed(() => `${props.seconds}s`);
</script>

<template>
  <view class="voice-query" :class="{ 'voice-query--dark': dark }">
    <!-- 左：取消，直接断开这一轮识别，不发送 -->
    <view class="voice-query__btn" @tap="emit('cancel')">
      <view class="voice-query__cross" />
    </view>

    <!-- 中：声纹，高度由 level 实时驱动（height 过渡 90ms，跟得上 100ms 的采样节奏） -->
    <view class="voice-query__wave">
      <view
        v-for="(height, index) in barHeights"
        :key="index"
        class="voice-query__bar"
        :style="{ height }"
      />
    </view>

    <text class="voice-query__time">
      {{ secondsText }}
    </text>

    <!-- 右：说完了，收尾并落成气泡 -->
    <view
      class="voice-query__btn voice-query__btn--send"
      :class="{ 'voice-query__btn--busy': busy }"
      @tap="emit('submit')"
    >
      <view class="voice-query__arrow" />
    </view>
  </view>
</template>

<style scoped lang="scss">
/* 与输入栏同一条基线：左右 20px（40rpx）、底部 20px + 安全区，高度 44px（88rpx） */
.voice-query {
  position: fixed;
  right: 40rpx;
  bottom: calc(40rpx + env(safe-area-inset-bottom));
  left: 40rpx;
  z-index: 1001;
  display: flex;
  align-items: center;
  box-sizing: border-box;
  height: 88rpx;
  padding: 0 8rpx;
  border-radius: 44rpx;
  background: rgba(242, 242, 242, 0.96);
  box-shadow: 0 8rpx 32rpx rgba(13, 13, 13, 0.08);
}

.voice-query__btn {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  background: #fff;
}

.voice-query__btn--busy {
  opacity: 0.45;
}

/* 细线 ×：两条 2rpx 的线交叉 45°，比字符更接近稿子 */
.voice-query__cross {
  position: relative;
  width: 24rpx;
  height: 24rpx;

  &::before,
  &::after {
    position: absolute;
    top: 50%;
    left: 0;
    width: 100%;
    height: 2rpx;
    background: #8a8a8a;
    content: "";
  }

  &::before {
    transform: rotate(45deg);
  }

  &::after {
    transform: rotate(-45deg);
  }
}

.voice-query__wave {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  gap: 4rpx;
  height: 64rpx;
  padding: 0 16rpx;
  overflow: hidden;
}

.voice-query__bar {
  flex: 0 0 auto;
  width: 2rpx;
  min-height: 6rpx;
  border-radius: 2rpx;
  background: #b9b9b9;
  transition: height 90ms linear;
}

.voice-query__time {
  flex: 0 0 auto;
  margin-right: 8rpx;
  color: #8a8a8a;
  font-size: 24rpx;
  line-height: 32rpx;
}

/* 上箭头：左上两条边转 45°，就是一根细箭头 */
.voice-query__arrow {
  width: 18rpx;
  height: 18rpx;
  border-top: 3rpx solid #0d0d0d;
  border-left: 3rpx solid #0d0d0d;
  transform: rotate(45deg) translate(2rpx, 2rpx);
}

/* 深色外观 */
.voice-query--dark {
  background: rgba(28, 28, 30, 0.96);
  box-shadow: 0 8rpx 32rpx rgba(0, 0, 0, 0.4);
}

.voice-query--dark .voice-query__btn {
  background: #3a3a3c;
}

.voice-query--dark .voice-query__cross::before,
.voice-query--dark .voice-query__cross::after {
  background: #d0d0d0;
}

.voice-query--dark .voice-query__bar {
  background: #7c7c80;
}

.voice-query--dark .voice-query__time {
  color: #9a9a9e;
}

.voice-query--dark .voice-query__arrow {
  border-color: #f2f3f5;
}
</style>
