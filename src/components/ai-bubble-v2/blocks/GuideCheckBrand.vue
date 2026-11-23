<script setup lang="ts">
import iconRadioOn from "@/assets/img/icon-action-radio-on.svg";
import saniIcon from "@/assets/img/icon-sani.png";

defineOptions({
  name: "GuideCheckBrand",
});

/**
 * 步骤卡左上角的品牌署名行：SANY Neo logo + 「SANY Neo」+ 语音播报按钮。
 *
 * 从 GuideCheckBlock 里抽出来、由消息列表放在卡片容器的固定层：
 * 切一步 = 换一个 block.id = 下面的内容卡整块重挂载，品牌行留在卡片里就会跟着重建
 * （图标重插、播放态跳回静止、入场动画连它一起平移）。这里只做展示和点击，
 * 播报文案由消息列表按「当前展示的那张卡」组装，组件本身不认识 payload。
 */
const props = defineProps<{
  /** 深色主题：文字转白、声波用亮蓝 */
  dark?: boolean;
  /** 语音播报总开关（关掉时连按钮都不出现） */
  ttsEnabled?: boolean;
  /** 播报请求中：按钮位置显示转圈 */
  ttsLoading?: boolean;
  /** 正在播报：按钮位置显示跳动的声波 */
  ttsPlaying?: boolean;
}>();

const emit = defineEmits<{
  (e: "tts-click"): void;
}>();

function onTtsTap() {
  if (!props.ttsEnabled) return;
  emit("tts-click");
}
</script>

<template>
  <view class="guide-check-brand" :class="{ 'guide-check-brand--dark': dark }">
    <image class="guide-check-brand__icon" :src="saniIcon" mode="aspectFit" aria-hidden="true" />
    <text class="guide-check-brand__text">
      SANY Neo
    </text>
    <view
      v-if="ttsEnabled"
      class="guide-check-brand__tts"
      data-share-poster-ignore
      @tap.stop="onTtsTap"
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
/* 左上角品牌署名：SANY Neo logo + SANY Neo + 播报按钮（与气泡完成态同一套观感） */
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

/* ===== 深色：与气泡内其它块同一套材质 ===== */
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
}
</style>
