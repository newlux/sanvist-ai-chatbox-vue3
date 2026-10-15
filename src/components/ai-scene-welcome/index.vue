<script setup lang="ts">
defineOptions({ name: "AiSceneWelcome" });

defineProps({
  title: {
    type: String,
    required: true,
  },
  subtitle: {
    type: String,
    default: "",
  },
  icon: {
    type: String,
    default: "",
  },
});
</script>

<template>
  <view class="scene-welcome">
    <view class="scene-welcome__card">
      <view class="scene-welcome__glow" />
      <view v-if="icon" class="scene-welcome__icon-wrap">
        <image class="scene-welcome__icon" :src="icon" mode="aspectFit" />
      </view>
      <view class="scene-welcome__copy">
        <text class="scene-welcome__title">
          {{ title }}
        </text>
        <text v-if="subtitle" class="scene-welcome__subtitle">
          {{ subtitle }}
        </text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.scene-welcome {
  position: relative;
  /* 层叠：必须低于底部输入栏的层叠上下文（.chat-input 是 position: fixed + z-index: 1）。
     附件来源弹窗挂在输入栏内部（遮罩 z-index 1010 只在输入栏内部有效），
     卡片只要压过输入栏的 1 就会浮在蒙层上面；同时还要高于页面氛围光
     （.ai-chat-glow z-index: 0 且在它之前渲染）。 */
  z-index: 0;
  margin: 32rpx 40rpx 0;
  pointer-events: none;
}

.scene-welcome__card {
  position: relative;
  display: flex;
  overflow: hidden;
  align-items: center;
  gap: 24rpx;
  padding: 32rpx 36rpx;
  border: 1px solid #efefef;
  border-radius: 32rpx;
  background: #fff;
  box-shadow: 0 8rpx 32rpx rgb(26 26 26 / 4%);
}

.scene-welcome__glow {
  position: absolute;
  top: -48rpx;
  right: -24rpx;
  width: 220rpx;
  height: 160rpx;
  pointer-events: none;
  background: radial-gradient(
    ellipse 110rpx 80rpx at 70% 40%,
    rgb(254 0 0 / 8%) 0%,
    rgb(254 0 0 / 0%) 72%
  );
}

.scene-welcome__icon-wrap {
  display: flex;
  width: 64rpx;
  height: 64rpx;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 20rpx;
  background: #fff2f3;
}

.scene-welcome__icon {
  width: 32rpx;
  height: 32rpx;
  filter: brightness(0) saturate(100%) invert(11%) sepia(99%) saturate(6668%) hue-rotate(358deg) brightness(105%) contrast(113%);
}

.scene-welcome__copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 8rpx;
}

.scene-welcome__title {
  overflow: hidden;
  color: #1a1a1a;
  font-size: 32rpx;
  font-weight: 700;
  line-height: 44rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scene-welcome__subtitle {
  overflow: hidden;
  color: #6b6b6b;
  font-size: 24rpx;
  font-weight: 400;
  line-height: 36rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
