<script setup lang="ts">
import type { SaniStageBubble } from "./types";
import { computed } from "vue";

/**
 * 中心 SANI 图标 + 环绕气泡的「舞台」。
 *
 * 与首页 ai-welcome/visitor.vue 的 welcome-visitor__content > __hero > __logo 同一套思路：
 *   - logo 用 CSS flex 在整块画布里「上下左右居中」（不再用 JS 算 top），
 *     容器是 Ardot 306:2783 的 134×134、内边距 12px、perspective 800px；
 *   - 气泡 / 装饰球直接挂在图标容器内，外部给「球心相对容器中心的偏移」（cx / cy），
 *     组件用「容器中心 + 偏移 − 半尺寸」反推 left/top，入场动画从容器中心翻折展开；
 *     容器本身由 flex 居中，屏高变化时 logo 和球群一起走（不依赖 JS 量高度）。
 *
 * 目前 task-init / guide-init 复用它；首页欢迎页仍内置同一套实现（样式同源）。
 */

const props = withDefaults(defineProps<{
  /** 中心图标（显示 110×110 / 220rpx） */
  logo: string;
  bubbles: SaniStageBubble[];
  /** 当前选中 / 命中的球 key */
  selectedKey?: string;
}>(), {
  selectedKey: "",
});

const emit = defineEmits<{ select: [key: string] }>();

/** 图标容器（268rpx）的一半：气泡坐标以容器左上为原点，容器由 flex 居中，随屏高变化 */
const CORE_HALF = 134;

/** 换个入场节奏：每颗球错峰 90ms，单颗 1200ms */
const HOLO_DURATION_MS = 1200;
const HOLO_STAGGER_MS = 90;

const items = computed(() => props.bubbles.map((bubble, index) => {
  // 球心锚在图标容器中心 + (cx, cy)，左上角 = 容器中心 + 偏移 − 半尺寸；
  // 容器由 flex 居中，屏高变化时球跟着走；翻折起飞点在容器中心（--holo-dx/dy = −cx/−cy）
  const left = CORE_HALF + bubble.cx - bubble.size / 2;
  const top = CORE_HALF + bubble.cy - bubble.size / 2;
  return {
    ...bubble,
    style: {
      left: `${left}rpx`,
      top: `${top}rpx`,
      width: `${bubble.size}rpx`,
      height: `${bubble.size}rpx`,
      fontSize: `${bubble.fontSize ?? 0}rpx`,
      backgroundImage: bubble.fill
        ? `linear-gradient(180deg, ${bubble.fill[0]} 0%, ${bubble.fill[1]} 100%)`
        : undefined,
      "--holo-dx": `${-bubble.cx}rpx`,
      "--holo-dy": `${-bubble.cy}rpx`,
      "--holo-rx": bubble.cy < 0 ? "85deg" : "-85deg",
      "--holo-ry": bubble.cx > 0 ? "45deg" : "-45deg",
      "--holo-delay": `${index * HOLO_STAGGER_MS}ms`,
      "--holo-duration": `${HOLO_DURATION_MS}ms`,
    },
  };
}));
</script>

<template>
  <!-- 画布铺满内容区：logo 靠 flex 居中，气泡挂在 logo 容器内、以容器左上为原点相对定位，
       屏高变化时 logo 和气泡一起走（与首页 welcome-visitor 同构）。
       pointer-events 只在气泡上放开，整块画布不拦截页面根级的长按 / 点按手势 -->
  <view class="sani-stage">
    <view class="sani-stage__core">
      <image class="sani-stage__logo" :src="logo" mode="aspectFit" />
      <view
        v-for="bubble in items"
        :key="bubble.key"
        class="sani-stage__bubble"
        :class="{
          'sani-stage__bubble--role': bubble.glass,
          'sani-stage__bubble--ghost': !bubble.glass,
          'sani-stage__bubble--active': Boolean(selectedKey) && selectedKey === bubble.key,
        }"
        :style="bubble.style"
        @tap.stop="emit('select', bubble.key)"
      >
        <!-- 身份球内部（Ardot 1006:3 / 1006:16 的 Mask group 1204:224 / 1204:218）：
             Vector 111（蓝 #0063E5 斜带）+ Vector 112（粉 #FF70F9 月牙）两团高斯模糊色斑，
             由 export_nodes 导出的真实路径 SVG 渲染（含 feGaussianBlur 14.5 / 12 与圆形裁切） -->
        <image
          v-if="bubble.glass"
          class="sani-stage__bubble-aurora"
          src="@/assets/img/bubble-role-aurora.svg"
          mode="aspectFit"
        />
        <text v-if="bubble.label" class="sani-stage__bubble-text">{{ bubble.label }}</text>
      </view>
    </view>
    <slot />
  </view>
</template>

<style lang="scss" scoped>
/* 画布铺满内容区：logo 用 flex 居中（不再用 JS 算 top），
   perspective 由 core 承载，翻折以图标中心为灭点 */
.sani-stage {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

/* 306:2783：134×134 容器，图 110×110 居中（内边距 12） */
.sani-stage__core {
  position: relative;
  box-sizing: border-box;
  flex: none;
  width: 268rpx; // 134px
  height: 268rpx;
  padding: 24rpx; // 12px
  pointer-events: none;
  perspective: 1600rpx; // 800px
  perspective-origin: 50% 50%;
}

.sani-stage__logo {
  width: 220rpx; // 110px
  height: 220rpx;
  // 设计稿阴影 0 3px 9px rgba(0,0,0,.14)：图片是透明 PNG，
  // 用 drop-shadow 才能沿三角轮廓投影（box-shadow 会沿方框铺开，出现方形光晕）
  filter: drop-shadow(0 6rpx 18rpx rgba(0, 0, 0, 0.14));
}

/* 气泡基座：绝对定位（相对画布，即内容区原点），落位后接着漂浮。
   入场用 backwards —— 延迟期间停在 0% 帧（不可见），动画播完样式交回 CSS，不影响后续状态 */
.sani-stage__bubble {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  overflow: hidden;
  border-radius: 50%;
  color: #0d0d0d;
  font-weight: 500;
  text-align: center;
  opacity: 1;
  transform: translateY(0) scale(1);
  will-change: transform, opacity;
  pointer-events: auto;
  // 翻折瞬间的高光提亮：原稿是彩色 drop-shadow，这里收白，避免引入设计稿外的色值
  --holo-glow: brightness(2);
  --holo-glow-dim: brightness(1.2);
  --holo-glow-off: brightness(1);
  animation:
    sani-stage-holo var(--holo-duration, 1200ms) cubic-bezier(0.16, 1, 0.3, 1) var(--holo-delay, 0ms) backwards,
    sani-stage-float var(--float-duration, 7.6s) ease-in-out
      calc(var(--holo-delay, 0ms) + var(--holo-duration, 1200ms))
      infinite alternate;
}

/* 每颗球的漂浮周期错开，避免整屏一起上下动 */
.sani-stage__bubble:nth-child(2n) {
  --float-duration: 8.6s;
}

.sani-stage__bubble:nth-child(3n) {
  --float-duration: 9.8s;
}

/* 身份球：Ardot 1006:3（操作手）/ 1006:16（设备管理员），80×80，自下而上两层：
   ① 1204:228 / 1204:222 Ellipse 69：填充 #FAFAFA；
      INNER_SHADOW rgba(54,191,255,0.2966) offset 1 / 5、radius 14、spread −1
      DROP_SHADOW  rgba(84,152,168,0.2163) offset 2 / 4、radius 12、spread 0
      （strokes 里那圈渐变环 visible:false，不还原）
   ② 1204:224 / 1204:218「Mask group」：虹彩色斑（见 __bubble-aurora）
   ③ 球名：16px / Medium / #0D0D0D / 居中（见 __bubble-text） */
.sani-stage__bubble--role {
  background: #fafafa;
  box-shadow:
    inset 2rpx 10rpx 28rpx -2rpx rgba(54, 191, 255, 0.297),
    4rpx 8rpx 24rpx 0 rgba(84, 152, 168, 0.216);
}

/* 选中 / 按下：沿用 722:3064 的高亮玻璃底色（Ellipse 59 #D1E9FF 79%），
   与首页 index 的 welcome-visitor__bubble--role:active 一致；漂浮动画不受影响 */
.sani-stage__bubble--role:active,
.sani-stage__bubble--role.sani-stage__bubble--active {
  background: rgba(209, 233, 255, 0.79);
}

/* 命中态额外给一圈白色柔光（首页把光晕放在 choose 层，这里没有那层，就近挂在球上） */
.sani-stage__bubble--role.sani-stage__bubble--active {
  z-index: 2;
  box-shadow:
    0 0 12rpx 2rpx rgba(255, 255, 255, 0.8),
    0 0 20rpx 4rpx rgba(158, 199, 255, 0.35),
    0 10rpx 24rpx rgba(88, 138, 220, 0.24);
}

/* 动效方案 4「全息升维翻展」：以图标圆心为轴心 3D 翻折展开成饱满球体，
   60% 处先亮到 1.2 再回落到 1，做全息扫描的高光扫过感 */
@keyframes sani-stage-holo {
  0% {
    transform: translate(var(--holo-dx, 0), var(--holo-dy, 0)) rotateX(var(--holo-rx, 85deg))
      rotateY(var(--holo-ry, 45deg)) scale(0);
    opacity: 0;
    filter: var(--holo-glow, brightness(2));
  }

  60% {
    opacity: 1;
    filter: var(--holo-glow-dim, brightness(1.2));
  }

  100% {
    transform: translate(0, 0) rotateX(0deg) rotateY(0deg) scale(1);
    opacity: 1;
    filter: var(--holo-glow-off, brightness(1));
  }
}

/* 漂浮只动 5px，direction: alternate 让它自己上下折返 */
@keyframes sani-stage-float {
  0% {
    transform: translate3d(0, 0, 0);
  }

  100% {
    transform: translate3d(0, -10rpx, 0);
  }
}

/* 装饰玻璃球（722:2720 / 722:2717 / 722:2714 / 722:2665）：
   1px、60% 白描边 + LAYER_BLUR 8 的整体虚化，且没有投影 */
.sani-stage__bubble--ghost {
  border: 1px solid rgba(255, 255, 255, 0.6);
  box-shadow: none;
  filter: blur(16rpx); // 8px
  // 翻折动画会覆盖 filter，虚化值必须跟着一起带上，否则装饰球会被「擦亮」
  --holo-glow: blur(16rpx) brightness(2);
  --holo-glow-dim: blur(16rpx) brightness(1.2);
  --holo-glow-off: blur(16rpx);
  pointer-events: none;
}

/* 装饰球球面高光（各球内的 Vector 80）：占球体 72.3% × 24.1%、起点约 (14.5%, 7.4%)，
   填充白色 100% → 26%，LAYER_BLUR 5 → blur(10rpx) */
.sani-stage__bubble--ghost::after {
  position: absolute;
  top: 7.4%;
  left: 14.5%;
  width: 72.3%;
  height: 24.1%;
  border-radius: 50%;
  background-image: linear-gradient(180deg, #ffffff 0%, rgba(255, 255, 255, 0.263) 100%);
  filter: blur(10rpx); // 5px
  content: "";
}

/* 虹彩色斑图层（1204:224 导出 SVG，80×80，铺满球体） */
.sani-stage__bubble-aurora {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

/* 气泡文字：16px / 行高 23px / Medium / #0D0D0D（行高按 1.44 走，英文 14px 时自动变 20px）；
   换行由调用方在 label 里写 \n */
.sani-stage__bubble-text {
  position: relative;
  z-index: 1;
  line-height: 1.44;
  white-space: pre-line;
  word-break: break-word;
}
</style>
