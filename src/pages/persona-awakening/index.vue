<script setup lang="ts">
import { onHide, onShow } from "@dcloudio/uni-app";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import heySani from "@/assets/img/hey-sani.svg";
import enlargeIcon from "@/assets/img/icon-enlarge.svg";
import reduceIcon from "@/assets/img/icon-reduce.svg";
import glowMaskBottom from "@/assets/img/persona-awakening/glow-mask-bottom.png";
import saniLogo from "@/assets/img/sani-logo.webp";
import tellDark from "@/assets/img/tell-dark.webp";
import AudioRipple from "@/components/audio-ripple/index.vue";
import PushNoticePanel from "@/components/push-notice-panel/index.vue";
import { createLogger } from "@/utils/logger";
import { pushNoticeSoundPlaying } from "@/utils/push/push-sound";

/**
 * 「老板屏-个性觉醒」大屏页（Ardot 291:7285「老板屏页面」，设计基准 1920 × 1080）。
 *
 * 完整画面由 291:7285 下的 5 个子节点叠出来（291:7291 只是底层「黑底 + 标题」）：
 *
 * | 节点 | 名称 | 内容 | 尺寸 | 位置 |
 * |---|---|---|---|---|
 * | 291:7291 | 个性觉醒 | 黑底 #0D0D0D + 标题「随时为你而来」 | 1920 × 1080.889 | (0, 0) |
 * | 291:7290 | 微信图片… | 中间的 SANI 图标（图片填充） | 254 × 254 | (833, 359) |
 * | 291:7298 | Desc 1 | 底部一段话 | 672 × 41 | (624, 682) |
 * | 291:18734 | Mask group | 底部叠加光效，整体 10% 透明 | 2464.165 × 552.15 | (-234.377, 947.176) |
 * | 291:18735 | Group 192 | 顶部「Hey，SANI」 | 176.962 × 47 | (871, 312) |
 * | 291:7293 / 291:7297 | Plus Icon / Label 2 | 设计稿中 visible = false | — | — |
 *
 * 291:7286「Frame 85」底部渐变光晕按需求整层移除（素材 glow-bottom.png 与 pulse 动画一并去掉）。
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
 * 底部叠加光效按设计稿宽度居中并超出画面，因此任何宽高比（16:9 / 21:9 / 4:3）都不会出现左右黑边。
 * 1920 × 1080 视口下 --u = --uw = --uh = 1px，与设计稿 1:1。
 *
 * 单位说明：大屏用 px 基准（uni-app 的 rpx 按「750rpx = 视口宽」换算，1920 画布会被放大 5.12 倍）。
 */
defineOptions({ name: "PersonaAwakening" });

const logger = createLogger("persona-awakening");

const pageVisible = ref(false);
const debugPanelOpen = ref(false);

/**
 * 播报声纹的弧段端点（0 = 右中，90 = 顶中，180 = 左中，270 = 底中，角度递增即沿边绕行）。
 * 与首页 pages/index 的 TTS_RIPPLE_APPEARANCE 同一套参数：
 * 120 → 60 走 3/4 圈（左 → 底 → 右，顶部留 60° 缺口）；colorSpeed 归零让
 * 「左紫 → 蓝 → 蓝紫 → 右粉」固定不旋转，不跟着动画转圈。改这里记得同步首页那份。
 */
const TTS_RIPPLE_APPEARANCE = { startAngle: 120, endAngle: 60, colorSpeed: 0 };
/**
 * 只在「推送语音播报中」点亮声纹：与下面 logo / 底部光晕的 breathing 动画同一个触发条件
 * （`pushNoticeSoundPlaying` 是推送提示音的播放状态），页面上没有其它播报源。
 */
const rippleVisible = computed(() => pageVisible.value && pushNoticeSoundPlaying.value);

/**
 * 中间图标：平时是 sani-logo.webp，推送语音播报期间换成 tell-dark.webp，播完自动切回。
 * 切换条件与上面声纹、`.persona-awakening__screen--playing` 的呼吸动画完全一致。
 */
const logoPlaying = computed(() => pageVisible.value && pushNoticeSoundPlaying.value);
const logoSource = computed(() => (logoPlaying.value ? tellDark : saniLogo));

/**
 * tell-dark.webp 是 600 × 600 动图、约 6.6MB，第一次切 src 会先白一帧。
 * 页面可见后预取一次，之后切 source 走浏览器缓存，基本无感。模块级标记避免重复预取。
 */
let tellDarkPreloaded = false;
function preloadTellDark() {
  if (tellDarkPreloaded || typeof Image === "undefined") return;
  tellDarkPreloaded = true;
  const image = new Image();
  image.src = tellDark;
}

onShow(() => {
  pageVisible.value = true;
  preloadTellDark();
});

onHide(() => {
  pageVisible.value = false;
  debugPanelOpen.value = false;
});

/**
 * 右上角全屏切换（大屏机型常用的「放大看」入口）。
 *
 * 走浏览器全屏 API，标准与 `webkit` 前缀两条都试：Android WebView / 部分大屏容器
 * 只实现了带前缀的那套。状态以 `fullscreenchange` 为准 —— 用户用 Esc / 系统手势退出时，
 * 图标也要跟着切回「放大」。
 *
 * 容器没实现全屏 API（部分内嵌 WebView 会拒绝）时只记一条日志，不弹窗打断页面。
 */
const isFullscreen = ref(false);
const fullscreenIcon = computed(() => (isFullscreen.value ? reduceIcon : enlargeIcon));

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

function syncFullscreenState() {
  const doc = document as FullscreenDocument;
  isFullscreen.value = Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
}

async function toggleFullscreen() {
  const doc = document as FullscreenDocument;
  const root = document.documentElement as FullscreenElement;
  try {
    if (isFullscreen.value) {
      const exit = doc.exitFullscreen?.bind(doc) || doc.webkitExitFullscreen?.bind(doc);
      await exit?.();
    }
    else {
      const enter = root.requestFullscreen?.bind(root) || root.webkitRequestFullscreen?.bind(root);
      await enter?.();
    }
    syncFullscreenState();
  }
  catch (error) {
    logger.warn("全屏切换失败", error);
    // 退出全屏没成功时保持原图标，避免 UI 与真实状态不一致
    syncFullscreenState();
  }
}

if (typeof document !== "undefined") {
  onMounted(() => {
    syncFullscreenState();
    document.addEventListener("fullscreenchange", syncFullscreenState);
    document.addEventListener("webkitfullscreenchange", syncFullscreenState);
  });
  onBeforeUnmount(() => {
    document.removeEventListener("fullscreenchange", syncFullscreenState);
    document.removeEventListener("webkitfullscreenchange", syncFullscreenState);
  });
}
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

      <!-- 291:7290 中间图标 254 × 254：平时 sani-logo.webp，语音播报期间换 tell-dark.webp -->
      <view class="persona-awakening__logo-frame">
        <image class="persona-awakening__logo" :src="logoSource" mode="aspectFit" />
      </view>

      <!-- 291:7298 底部一段话（672 × 41，80% 白色） -->
      <!-- eslint-disable-next-line vue/singleline-html-element-content-newline -->
      <text class="persona-awakening__desc">你的三一设备伙伴。把问题交给我，把时间留给工作。</text>

      <!-- 291:18734 底部叠加光效，opacity 0.1 -->
      <image class="persona-awakening__glow-mask" :src="glowMaskBottom" />

      <!-- 291:18735 顶部「Hey，SANI」176.962 × 47：素材改用 src/assets/img/hey-sani.svg -->
      <button
        type="button"
        class="persona-awakening__hey-trigger"
        aria-label="打开通知调试面板"
        :aria-expanded="debugPanelOpen"
        @click.stop="debugPanelOpen = true"
      >
        <image class="persona-awakening__hey" :src="heySani" mode="aspectFit" />
      </button>

      <!-- 右上角全屏切换：默认 icon-enlarge.svg，全屏后切 icon-reduce.svg -->
      <button
        type="button"
        class="persona-awakening__fullscreen"
        :aria-label="isFullscreen ? '退出全屏' : '全屏'"
        @click.stop="toggleFullscreen"
      >
        <image class="persona-awakening__fullscreen-icon" :src="fullscreenIcon" />
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

    <!-- 语音播报声纹（迁移自 audio-ripple，与首页同一套动效）：播报期间沿屏幕左、底、右三边
         走渐变光带，纯装饰层不吃点击；pixel-ratio 压到 1 是因为大屏逐像素运算开销大 -->
    <AudioRipple
      v-if="rippleVisible"
      class="persona-awakening__ripple"
      variant="output"
      preview="speech"
      :dark="true"
      :pixel-ratio="1"
      :output-appearance="TTS_RIPPLE_APPEARANCE"
    />
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

/* 语音播报声纹（AudioRipple）：全屏铺满、只走左 / 底 / 右三边，压在内容之上但不吃点击
   （与首页 .ai-page__tts-ripple 同口径，只是这里固定深色底，dark 恒为 true） */
.persona-awakening__ripple {
  position: fixed;
  inset: 0;
  z-index: 1025;
  pointer-events: none;
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
 * 素材两张动图，按播放态切源（见 logoSource）：
 * - 平时：src/assets/img/sani-logo.webp（280 × 260）；
 * - 语音播报中：src/assets/img/tell-dark.webp（600 × 600）。
 *
 * 两张图的「画布留白」差很多（透明像素包围盒实测）：
 * - sani：内容 252 × 216 / 画布 280 × 260（占宽 90%、占高 83%）；
 * - tell：内容 242 × 208 / 画布 600 × 600（占宽 40%、占高 35%）。
 * 直接按同一个盒子渲染，tell 的图形只有平时的 1/3 多一点，看着明显偏小。
 * 所以两边都按「**可见图形等大**」反算渲染尺寸：
 * - 平时 254 × 236（sani 内容可见 228.6 × 196）；
 * - 播报 566 × 566（tell 内容可见 228.3 × 196.2）。
 * 宽高同用 --u 保证正方形；水平居中，距顶 359 用纵向基准
 * 设计稿 DROP_SHADOW 为 visible: false，故不写 box-shadow；无边框
 */
.persona-awakening__logo-frame {
  position: absolute;
  z-index: 1;
  top: calc(359 * var(--uh));
  left: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  width: calc(254 * var(--u));
  height: calc(254 * var(--u));
  transform: translateX(-50%);
}

/* 高度取 sani-logo 在 254 宽下的等比高度（280 × 260 → 236），平时那张正好铺满 */
.persona-awakening__logo {
  display: block;
  width: 100%;
  height: calc(236 * var(--u));
  pointer-events: none;
}

/**
 * 播报态的 tell-dark.webp：内容只占画布 40%，按 236 渲染图形会小一大圈。
 * 反算到「可见图形与平时等大」的渲染尺寸：228.6 / 0.4033 ≈ 566（宽）、196 / 0.3467 ≈ 566（高），
 * 恰好是正方形。图比 254 的框大，靠 frame 的 flex 居中溢出显示，透明边不会撑开布局。
 */
.persona-awakening__screen--playing .persona-awakening__logo {
  width: calc(566 * var(--u));
  height: calc(566 * var(--u));
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

/**
 * 291:18735 顶部「Hey，SANI」：设计 176.962 × 47 @ (871, 312)，水平居中、距顶用纵向基准
 * 素材改用 hey-sani.svg（106 × 24，比例 4.42 比按钮的 3.77 更扁），
 * `mode="aspectFit"` 等比装入按钮，宽度贴满、上下各留一点空白，字形不被拉伸
 */
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

/**
 * 右上角全屏按钮（设计稿里没有这个元素，尺寸取图标原始 40 × 40）。
 * z-index 压过通知调试面板，面板展开时按钮仍可点。
 */
.persona-awakening__fullscreen {
  position: absolute;
  z-index: 3;
  top: max(24px, calc(48 * var(--uh)));
  right: max(24px, calc(48 * var(--uw)));
  display: flex;
  align-items: center;
  justify-content: center;
  width: calc(40 * var(--u));
  height: calc(40 * var(--u));
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  touch-action: manipulation;
}

.persona-awakening__fullscreen::after {
  border: 0;
}

.persona-awakening__fullscreen-icon {
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
