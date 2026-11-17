<script setup lang="ts">
import { useI18n } from "vue-i18n";
import heySaniDark from "@/assets/img/hey-sani-dark.svg";
import saniLogoWebp from "@/assets/img/sani-logo.webp";

defineOptions({ name: "PcWelcome" });

const emit = defineEmits<{
  /** 点击 hero（logo / 文案区域）：页面收起待机页并开始一轮语音 */
  (e: "start"): void;
}>();

const { t } = useI18n();
</script>

<template>
  <!--
    PC 车机版待机页（Ardot 747340735267872「车机待机页面」）：
    居中「Hey, SANI」+ 254px 三角 logo +「随时为你而来」+ 一行说明，无按钮；
    整块 hero 可点击，点击后页面收起待机页并开始说话（与手机版「点击说话」同一条语音链路）。
    顶部状态栏 / 底部 Dock 由宿主绘制，页面只负责这组居中内容与底部蓝色氛围光。
  -->
  <view class="pc-welcome" @tap="emit('start')">
    <view class="pc-welcome__hero">
      <image class="pc-welcome__title" :src="heySaniDark" mode="aspectFit" />
      <image class="pc-welcome__logo" :src="saniLogoWebp" mode="aspectFit" />
      <text class="pc-welcome__slogan">
        {{ t("guide-pc-slogan") }}
      </text>
      <text class="pc-welcome__desc">
        {{ t("guide-pc-desc") }}
      </text>
    </view>
    <!-- 底部蓝色氛围光：三层椭圆径向渐变，被底部 Dock 覆盖（宿主绘制） -->
    <view class="pc-welcome__glow" aria-hidden="true" />
  </view>
</template>

<style lang="scss" scoped>
.pc-welcome {
  position: relative;
  width: 100%;
  height: 100%;
  background: #181a1e;
  overflow: hidden;
}

/* hero 居中：标题 → logo → 标语 → 说明，纵向按设计稿坐标堆叠 */
.pc-welcome__hero {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding-top: 276px;
  box-sizing: border-box;

  &:active {
    opacity: 0.92;
  }
}

/* 「Hey, SANI」30px 白（设计稿宽 122） */
.pc-welcome__title {
  width: 122px;
  height: 34px;
  display: block;
}

/* 三角 logo 254×254：紧贴标题底（y=310） */
.pc-welcome__logo {
  width: 254px;
  height: 254px;
  display: block;
  margin-top: 0;
}

/* 「随时为你而来」32px 白（logo 下 y=573，即 logo 底 564 → 573） */
.pc-welcome__slogan {
  display: block;
  margin-top: 9px;
  color: #ffffff;
  font-family: "Source Han Sans CN", "PingFang SC", sans-serif;
  font-size: 32px;
  font-weight: 500;
  line-height: 41px;
}

/* 说明 28px 白（标语下 19px，y=573+41 → 633） */
.pc-welcome__desc {
  display: block;
  margin-top: 19px;
  color: rgba(255, 255, 255, 0.8);
  font-family: "Source Han Sans CN", "PingFang SC", sans-serif;
  font-size: 28px;
  font-weight: 400;
  line-height: 41px;
}

/* 底部蓝色氛围光：y≈863 起三层椭圆（#1B72CF / #8ABFF8 / #F9FDFF），向下渐变，被 Dock 覆盖 */
.pc-welcome__glow {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 240px;
  pointer-events: none;
  background: radial-gradient(ellipse 100% 100% at 50% 100%, #1b72cfff, rgba(27, 114, 207, 0));
}
</style>
