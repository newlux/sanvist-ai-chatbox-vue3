<script setup lang="ts">
import { onHide, onShow } from "@dcloudio/uni-app";
import { ref } from "vue";
import headerIslandLogo from "@/assets/img/header-island-logo.png";
import glowBottom from "@/assets/img/persona-awakening/glow-bottom.png";
import glowMaskBottom from "@/assets/img/persona-awakening/glow-mask-bottom.png";
import heySani from "@/assets/img/persona-awakening/hey-sani.png";
import PushNoticePanel from "@/components/push-notice-panel/index.vue";
import { pushNoticeSoundPlaying } from "@/utils/push/push-sound";

/**
 * 「老板屏-个性觉醒」大屏页（Ardot 291:7285「老板屏页面」，设计基准 1920 × 1080）。
 *
 * 完整画面由 291:7285 下的 6 个子节点叠出来（291:7291 只是底层「黑底 + 标题」）：
 *
 * | 节点 | 名称 | 内容 | 尺寸 | 位置 |
 * |---|---|---|---|---|
 * | 291:7291 | 个性觉醒 | 黑底 #0D0D0D + 标题「随时为你而来」 | 1920 × 1080.889 | (0, 0) |
 * | 291:7290 | 微信图片… | 中间的 SANI 图标（图片填充） | 254 × 254 | (833, 359) |
 * | 291:7298 | Desc 1 | 底部一段话 | 672 × 41 | (624, 682) |
 * | 291:7286 | Frame 85 | 底部渐变光晕（3 个模糊椭圆） | 1923 × 233 | (-3, 848) |
 * | 291:18734 | Mask group | 底部叠加光效，整体 10% 透明 | 2464.165 × 552.15 | (-234.377, 947.176) |
 * | 291:18735 | Group 192 | 顶部「Hey，SANI」 | 176.962 × 47 | (871, 312) |
 * | 291:7293 / 291:7297 | Plus Icon / Label 2 | 设计稿中 visible = false | — | — |
 *
 * 文案：标题 32px / 副标题 28px，均为 Source Han Sans CN Medium（font-weight 500）、#FFFFFF，
 * 副标题整体 opacity 0.8；行高 = 设计稿文本盒高（46 / 41）。
 *
 * ── 自适应口径（不锁 1920 宽度）──────────────────────────────────────────────
 * 页面与画布宽度都取 100%，铺满视口；设计稿数值只作为比例基准：
 * - `--uw = 100vw / 1920`：横向 1 设计 px；
 * - `--uh = 100vh / 1080`：纵向 1 设计 px（所有 top / bottom 距离用它，垂直留白随视口高度变）；
 * - `--u  = min(--uw, --uh)`：元素自身尺寸用它，图标永远保持 254:254 的正方形、文字不因
 *   单方向拉伸而变形。
 * 水平方向一律 `left: 50% + translateX(-50%)` 居中（设计稿里图标 / 文案 / Hey，SANI 本就居中），
 * 底部光晕宽度 100% 贴底，因此任何宽高比（16:9 / 21:9 / 4:3）都不会出现左右黑边或固定宽度。
 * 1920 × 1080 视口下 --u = --uw = --uh = 1px，与设计稿 1:1。
 *
 * 单位说明：大屏用 px 基准（uni-app 的 rpx 按「750rpx = 视口宽」换算，1920 画布会被放大 5.12 倍）。
 */
defineOptions({ name: "PersonaAwakening" });

const pageVisible = ref(false);
const debugPanelOpen = ref(false);

onShow(() => {
  pageVisible.value = true;
});

onHide(() => {
  pageVisible.value = false;
  debugPanelOpen.value = false;
});
</script>

<template>
  <!-- 291:7285「老板屏页面」：铺满视口，clipsContent -->
  <view class="persona-awakening">
    <view
      class="persona-awakening__screen"
      :class="{ 'persona-awakening__screen--playing': pageVisible && pushNoticeSoundPlaying }"
      @click="debugPanelOpen = false"
    >
      <!-- 291:7291 个性觉醒：黑底 + 标题（底层） -->
      <view class="persona-awakening__backdrop">
        <!-- 291:7292 随时为你而来 -->
        <!-- eslint-disable-next-line vue/singleline-html-element-content-newline -->
        <text class="persona-awakening__title">随时为你而来</text>
      </view>

      <!-- 291:7290 中间图标 254 × 254：素材改用 src/assets/img/header-island-logo.png -->
      <view class="persona-awakening__logo-frame">
        <image class="persona-awakening__logo" :src="headerIslandLogo" />
      </view>

      <!-- 291:7298 底部一段话（672 × 41，80% 白色） -->
      <!-- eslint-disable-next-line vue/singleline-html-element-content-newline -->
      <text class="persona-awakening__desc">你的三一设备伙伴。把问题交给我，把时间留给工作。</text>

      <!-- 291:7286 底部渐变光晕 1923 × 233（图层模糊已烘焙） -->
      <image class="persona-awakening__glow" :src="glowBottom" />

      <!-- 291:18734 底部叠加光效，opacity 0.1 -->
      <image class="persona-awakening__glow-mask" :src="glowMaskBottom" />

      <!-- 291:18735 顶部「Hey，SANI」176.962 × 47 -->
      <button
        type="button"
        class="persona-awakening__hey-trigger"
        aria-label="打开通知调试面板"
        :aria-expanded="debugPanelOpen"
        @click.stop="debugPanelOpen = true"
      >
        <image class="persona-awakening__hey" :src="heySani" />
      </button>

      <view
        v-if="pageVisible"
        v-show="debugPanelOpen"
        class="persona-awakening__push"
        @click.stop
      >
        <PushNoticePanel dark />
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
/**
 * 页面视口容器：宽度 100%、高度 100vh，铺满窗口
 * 背景 #0D0D0D 与设计稿黑底同色，任何缝隙都不会透出浅色边（无边框、无描边）
 */
.persona-awakening {
  /* 横向 / 纵向 / 尺寸三个基准单位（设计稿 1px 对应的实际尺寸） */
  --uw: calc(100vw / 1920);
  --uh: calc(100vh / 1080);
  --u: min(var(--uw), var(--uh));

  position: relative;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  background: #0d0d0d;
  border: 0;
}

/**
 * 291:7285 老板屏页面：原设计 1920 × 1080，这里宽高都取 100%（自适应，不锁宽度）
 * 背景直接用 #0D0D0D（设计稿白底被 291:7291 整屏覆盖，视觉一致）
 */
.persona-awakening__screen {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #0d0d0d;
}

/**
 * 291:7291 个性觉醒：设计稿 1920 × 1080.889，纯色 #0D0D0D
 * 四边贴齐画布，避免 0.889px 高度差产生接缝线
 */
.persona-awakening__backdrop {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  overflow: hidden;
  background: #0d0d0d;
}

/**
 * 291:7292 随时为你而来：设计稿文本盒 192 × 46 @ (870, 622)
 * 32px / Source Han Sans CN Medium / 行高 AUTO（盒高 46）/ #FFFFFF / 字距 0%
 * 自适应：水平居中，距顶 622（纵向基准），宽度由内容撑开，不再固定 192
 */
.persona-awakening__title {
  position: absolute;
  top: calc(622 * var(--uh));
  left: 50%;
  display: block;
  overflow: hidden;
  color: #ffffff;
  font-family:
    "Source Han Sans CN",
    "Source Han Sans SC",
    "Noto Sans CJK SC",
    "PingFang SC",
    "Microsoft YaHei",
    sans-serif;
  font-size: calc(32 * var(--u));
  font-weight: 500;
  line-height: calc(46 * var(--u));
  letter-spacing: 0;
  text-align: center;
  white-space: nowrap;
  transform: translateX(-50%);
}

/**
 * 291:7290 中间图标：设计尺寸 254 × 254 @ (833, 359)
 * 素材改用 src/assets/img/header-island-logo.png（220 × 220 方图，等比铺满 254 的盒子不变形）
 * 宽高同用 --u 保证正方形；水平居中，距顶 359 用纵向基准
 * 设计稿 DROP_SHADOW 为 visible: false，故不写 box-shadow；无边框
 */
.persona-awakening__logo-frame {
  position: absolute;
  z-index: 1;
  top: calc(359 * var(--uh));
  left: 50%;
  display: block;
  width: calc(254 * var(--u));
  height: calc(254 * var(--u));
  transform: translateX(-50%);
}

.persona-awakening__logo {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

/**
 * 291:7298 底部一段话：设计文本盒 672 × 41 @ (624, 682)
 * 28px / Medium / 行高 AUTO（盒高 41）/ #FFFFFF、整体 opacity 0.8
 * 自适应：水平居中，宽度由内容撑开（设计稿 24 字 × 28px = 672，与内容宽一致）
 */
.persona-awakening__desc {
  position: absolute;
  top: calc(682 * var(--uh));
  left: 50%;
  display: block;
  overflow: hidden;
  color: #ffffff;
  font-family:
    "Source Han Sans CN",
    "Source Han Sans SC",
    "Noto Sans CJK SC",
    "PingFang SC",
    "Microsoft YaHei",
    sans-serif;
  font-size: calc(28 * var(--u));
  font-weight: 500;
  line-height: calc(41 * var(--u));
  letter-spacing: 0;
  text-align: center;
  white-space: nowrap;
  opacity: 0.8;
  transform: translateX(-50%);
}

/**
 * 291:7286 底部渐变光晕：设计 1923 × 233 @ (-3, 848)，底边比画面多 1px
 * 自适应：宽度铺满 100%，高度按纵向基准，底边贴住画面（不再有固定宽度）
 */
.persona-awakening__glow {
  position: absolute;
  right: 0;
  bottom: calc(-1 * var(--uh));
  left: 0;
  display: block;
  width: 100%;
  height: calc(233 * var(--uh));
  border: 0;
}

/** 291:18734 底部叠加光效：设计 2464.165 × 552.15 @ (-234.377, 947.176)，opacity 0.1、底边超出画面 419.326 */
.persona-awakening__glow-mask {
  position: absolute;
  bottom: calc(-419.326 * var(--uh));
  left: 50%;
  display: block;
  width: calc(2464.165 * var(--uw));
  height: calc(552.15 * var(--uh));
  opacity: 0.1;
  transform: translateX(-50%);
}

@media (prefers-reduced-motion: no-preference) {
  .persona-awakening__screen--playing {
    .persona-awakening__logo {
      animation: persona-logo-breathe 2s ease-in-out infinite;
    }

    .persona-awakening__glow {
      transform-origin: center bottom;
      animation: persona-glow-pulse 2s ease-in-out infinite;
    }

    .persona-awakening__glow-mask {
      animation: persona-glow-ripple 2s ease-in-out infinite;
    }
  }
}

@keyframes persona-logo-breathe {
  0%,
  100% {
    transform: scale(1);
  }

  50% {
    transform: scale(1.08);
  }
}

@keyframes persona-glow-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scaleY(1);
  }

  50% {
    opacity: 0.86;
    transform: scaleY(1.22);
  }
}

@keyframes persona-glow-ripple {
  0%,
  100% {
    opacity: 0.1;
    transform: translateX(-50%) scale(1);
  }

  65% {
    opacity: 0.27;
    transform: translate(-50%, calc(-42 * var(--uh))) scale(1.13);
  }
}

/** 291:18735 顶部「Hey，SANI」：设计 176.962 × 47 @ (871, 312)，水平居中、距顶用纵向基准 */
.persona-awakening__hey-trigger {
  position: absolute;
  z-index: 1;
  top: calc(312 * var(--uh));
  left: 50%;
  display: block;
  width: calc(176.962 * var(--u));
  height: calc(47 * var(--u));
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  transform: translateX(-50%);
  touch-action: manipulation;
}

.persona-awakening__hey-trigger::after {
  border: 0;
}

.persona-awakening__hey {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.persona-awakening__push {
  position: absolute;
  z-index: 2;
  top: max(16px, env(safe-area-inset-top));
  right: max(16px, env(safe-area-inset-right));
  width: min(29vw, 420px);
  max-height: 75%;
  overflow-y: auto;
}

@media (max-width: 760px) {
  .persona-awakening__push {
    left: max(16px, env(safe-area-inset-left));
    width: auto;
    max-height: calc(31% - 16px);
  }
}
</style>
