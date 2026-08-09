<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";

defineOptions({
  name: "AiWelcome",
});

const emit = defineEmits(["chip-tap", "start-chat"]);
const { t } = useI18n();

const chips = computed(() => [
  t("ai-voice-or-text"),
  t("ai-features-description"),
]);

function onChipTap(chip) {
  emit("chip-tap", chip);
}

function onStartChat() {
  emit("start-chat");
}
</script>

<template>
  <view class="welcome">
    <!-- 状态栏占位 -->
    <view class="welcome__statusbar" />

    <!-- 装饰椭圆光晕（对应 Figma Ellipse 1 径向渐变） -->
    <view class="welcome__glow" />

    <!-- 主体内容 -->
    <view class="welcome__body">
      <!-- AI Logo + 标题 + 副标题 -->
      <view class="welcome__hero">
        <view class="welcome__logo">
          <!-- <text class="welcome__logo-text">AI</text> -->
          <image
            src="@/assets/img/icon-ai.png"
            mode="aspectFit"
            class="welcome__logo-img"
          />
        </view>
        <view class="welcome__text-group">
          <text class="welcome__title">
            {{ t("ai-welcome-title") }}
          </text>
          <text class="welcome__subtitle">
            {{ t("ai-welcome-subtitle") }}
          </text>
        </view>
      </view>

      <!-- 快捷提示胶囊 -->
      <view class="welcome__chips">
        <view
          v-for="(chip, i) in chips"
          :key="i"
          class="welcome__chip"
          @tap="onChipTap(chip)"
        >
          <text class="welcome__chip-text">
            {{ chip }}
          </text>
        </view>
      </view>
    </view>

    <!-- Get started 按钮 -->
    <view class="welcome__footer">
      <view class="welcome__btn" @tap="onStartChat">
        <text class="welcome__btn-text">
          {{ t("ai-start-experience") }}
        </text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
$bg: #232323;
$logo-grad-start: #ff5454;
$logo-grad-end: #ef2125;
$title-color: #ffffff;
$subtitle-color: #e8c5d6;
$chip-bg: #635070;
$chip-text: #f8e2ed;
$btn-text: #fa456e;

.welcome {
  position: relative;
  width: 100%;
  min-height: 100vh;
  background: $bg;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
  font-family: PingFang SC;
}

.welcome__statusbar {
  height: 88rpx;
  height: calc(88rpx + constant(safe-area-inset-top));
  height: calc(88rpx + env(safe-area-inset-top, 0px));
  flex-shrink: 0;
}

.welcome__glow {
  position: absolute;
  top: -256rpx;
  left: -320rpx;
  width: 1380rpx;
  height: 1380rpx;
  border-radius: 50%;
  background: radial-gradient(
    50% 50% at 50% 50%,
    rgba(204, 19, 255, 0.31) 0%,
    rgba(135, 112, 255, 0) 100%
  );
  pointer-events: none;
  z-index: 0;
}

.welcome__body {
  flex: 1;
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 40rpx;
  gap: 80rpx;
}

.welcome__hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 60rpx;
}

.welcome__logo {
  display: flex;
  align-items: center;
  justify-content: center;
}
.welcome__logo-img {
  width: 166rpx;
  height: 166rpx;
}

.welcome__logo-text {
  font-size: 56rpx;
  font-weight: 700;
  color: #fff;
  letter-spacing: 4rpx;
}

.welcome__text-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24rpx;
}

.welcome__title {
  font-size: 48rpx;
  font-weight: 600;
  color: $title-color;
  text-align: center;
  letter-spacing: -0.6rpx;
  line-height: 1.4;
}

.welcome__subtitle {
  font-size: 28rpx;
  font-weight: 400;
  color: $subtitle-color;
  text-align: center;
  line-height: 52rpx;
}

.welcome__chips {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 42rpx;
}

.welcome__chip {
  width: 100%;
  background: $chip-bg;
  border-radius: 58rpx;
  padding: 34rpx 30rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;

  &:active {
    opacity: 0.8;
  }
}

.welcome__chip-text {
  font-size: 28rpx;
  font-weight: 400;
  color: $chip-text;
  text-align: center;
}

.welcome__footer {
  position: relative;
  z-index: 1;
  padding: 0 40rpx;
  padding-bottom: constant(safe-area-inset-bottom);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  margin-bottom: 160rpx;
}

.welcome__btn {
  width: 100%;
  height: 106rpx;
  border-radius: 66rpx;
  background: transparent;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;

  &::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 66rpx;
    padding: 4rpx;
    background: linear-gradient(150deg, #ff5454 0%, #ef2125 100%);
    -webkit-mask: linear-gradient(#fff 0 0) content-box,
      linear-gradient(#fff 0 0);
    mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    -webkit-mask-composite: destination-out;
    mask-composite: exclude;
    pointer-events: none;
  }

  &:active {
    opacity: 0.7;
  }
}

.welcome__btn-text {
  font-size: 32rpx;
  font-weight: 600;
  color: $btn-text;
}
</style>
