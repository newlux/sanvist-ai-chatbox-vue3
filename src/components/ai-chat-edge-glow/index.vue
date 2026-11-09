<script setup lang="ts">
defineOptions({ name: "AiChatEdgeGlow" });

/**
 * 问答回复期间的页面边缘流光（Ardot 77:10750）。
 *
 * 只还原设计稿里贴边的三处渐变装饰，不动页面其它任何元素：
 * - 左竖边 203:5920：#8F6DEB → #0F7EEE，13px 宽，blur 8px
 * - 右竖边 203:5926：#8F6DEB → #F0B5FD，13px 宽，blur 8px
 * - 底部光雾 203:5916：449×118px，x=-37.8、y=769（底边比画布低 75px），#295DC3 → #0D7ABA，blur 84px
 *
 * 三条边统一 13px（26rpx）厚；四角用 45° 斜切对接（clip-path），
 * 竖边与底部光雾在斜线上严丝合缝，不会叠成双倍浓度的色块。
 *
 * 显示时机由页面控制（生成中才出现）；深浅两套主题都保留，
 * 深色下不再由页面 .ai-page--dark 隐藏，色值 / 厚度 / 流动与浅色完全一致。
 */
defineProps<{
  /** 是否显示：问答回复（生成中）期间为 true */
  visible: boolean;
}>();
</script>

<template>
  <view v-if="visible" class="ai-chat-edge-glow" aria-hidden="true">
    <view class="ai-chat-edge-glow__side ai-chat-edge-glow__side--left" />
    <view class="ai-chat-edge-glow__side ai-chat-edge-glow__side--right" />
    <!-- 底部光雾只保留页面最底下一条 26rpx（与两侧竖边同厚）：
         外层裁切 + 上沿蒙版，模糊不会爬到输入栏上 -->
    <view class="ai-chat-edge-glow__bottom-clip">
      <view class="ai-chat-edge-glow__bottom" />
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* 铺满对话页：父级 .ai-page__chat 已是 position: relative + overflow: hidden，
   溢到画布外的部分会被自动裁掉；本层只放边上的光，不拦截任何点击。

   z-index 必须高于输入栏（.chat-input 是 fixed + z-index 1 + #fafafa 实底），
   否则输入栏那一段的左右竖边和底部光雾会被整块实底盖掉；
   仍低于悬浮头部（z-index 1010），不会压住导航按钮 */
.ai-chat-edge-glow {
  position: absolute;
  z-index: 2;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  overflow: hidden;
  pointer-events: none;
}

/* 左右竖边（设计稿 203:5920 / 203:5926）：宽 13px → 26rpx，高铺满，blur 8px → 16rpx。
   设计稿在彩色条上还叠了一层 #E4E4E4 0%→100% 的柔化层，这里用 mask 做等效的
   「边缘最亮、向内淡出」，避免直接叠灰把品牌色洗掉 */
.ai-chat-edge-glow__side {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 26rpx; // 13px
  filter: blur(16rpx); // 8px
  will-change: opacity;
}

/* 左竖边：紫 → 蓝。
   底部最后 26rpx 沿 45° 切给底部光雾（竖边只留斜线上方），两条边在斜线上对接。
   色值流动：渐变做成「紫 → 蓝 → 紫」的对称图案、背景高取 200%，
   再让 background-position 纵向滚过一个完整图案，这两个色值就会沿着竖边往上爬；
   位移正好一个图案周期，循环首尾同色，看不到接缝 */
.ai-chat-edge-glow__side--left {
  left: 0;
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 26rpx), 0 100%);
  background-image: linear-gradient(180deg, #8f6deb 0%, #0f7eee 50%, #8f6deb 100%);
  background-repeat: repeat-y;
  background-size: 100% 200%;
  -webkit-mask-image: linear-gradient(90deg, #000 0%, rgba(0, 0, 0, 0) 100%);
  mask-image: linear-gradient(90deg, #000 0%, rgba(0, 0, 0, 0) 100%);
  animation:
    ai-chat-edge-breathe 2600ms ease-in-out infinite,
    ai-chat-edge-flow-y 14000ms linear infinite;
}

/* 右竖边：紫 → 粉（斜切方向镜像，色值流动同左） */
.ai-chat-edge-glow__side--right {
  right: 0;
  clip-path: polygon(0 0, 100% 0, 100% 100%, 0 calc(100% - 26rpx));
  background-image: linear-gradient(180deg, #8f6deb 0%, #f0b5fd 50%, #8f6deb 100%);
  background-repeat: repeat-y;
  background-size: 100% 200%;
  -webkit-mask-image: linear-gradient(270deg, #000 0%, rgba(0, 0, 0, 0) 100%);
  mask-image: linear-gradient(270deg, #000 0%, rgba(0, 0, 0, 0) 100%);
  // 周期比左侧长一点，两个动画的相位都错开：一明一暗不同步、色带一快一慢
  animation:
    ai-chat-edge-breathe 2600ms ease-in-out infinite,
    ai-chat-edge-flow-y 18000ms linear infinite;
  animation-delay: -1300ms, -4500ms;
}

/* 底部光雾的可见窗口：厚度与左右竖边一致（13px → 26rpx），
   三条边看起来一样粗；超出这个高度的模糊全部裁掉 —— 输入栏及其上方不会再被染色。
   两端再做 45° 斜切，与竖边底部的斜切共用同一条斜线，既不留缝也不叠出双倍浓度。
   斜切是硬边，但光雾本身 blur 84px、上沿又有蒙版淡出，实际看不到折线 */
.ai-chat-edge-glow__bottom-clip {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 26rpx; // 13px，与两侧竖边同厚
  overflow: hidden;
  clip-path: polygon(0 100%, 26rpx 0, calc(100% - 26rpx) 0, 100% 100%);
  -webkit-mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0) 0%, #000 40%, #000 100%);
  mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0) 0%, #000 40%, #000 100%);
}

/* 底部光雾（设计稿 203:5916）：449×118px，模糊 84px；
   元素底边比画布低 75px（设计稿 y=769、画布高 812），在 clip 内只露出最下面一段。
   色值流动同理：横向做「#295DC3 → #0D7ABA → #295DC3」的对称图案、背景宽取 200%，
   再横向滚过一个周期，光雾里深浅两种蓝会缓慢左右游动 */
.ai-chat-edge-glow__bottom {
  position: absolute;
  left: -76rpx; // -37.8px
  bottom: -150rpx; // 底边溢出 75px
  width: 898rpx; // 449px
  height: 236rpx; // 118px
  background-image: linear-gradient(90deg, #295dc3 0%, #0d7aba 50%, #295dc3 100%);
  background-repeat: repeat-x;
  background-size: 200% 100%;
  filter: blur(168rpx); // 84px
  animation:
    ai-chat-edge-wave 3200ms ease-in-out infinite,
    ai-chat-edge-flow-x 10000ms linear infinite;
  will-change: opacity, transform;
}

/* 律动：左右呼吸（透明度明暗） */
@keyframes ai-chat-edge-breathe {
  0%,
  100% {
    opacity: 0.5;
  }

  50% {
    opacity: 0.95;
  }
}

/* 律动：底部光雾左右轻移 + 微胀，比两侧慢半拍 */
@keyframes ai-chat-edge-wave {
  0%,
  100% {
    opacity: 0.55;
    transform: translateX(-3%) scaleX(1);
  }

  50% {
    opacity: 0.95;
    transform: translateX(3%) scaleX(1.04);
  }
}

/* 律动：色值沿竖边纵向流动。背景图高 200%（图案高 = 2 个自身高度），
   y 位移 200% 恰好等于一个图案高度，滚完一圈首尾同色，循环处不会跳色 */
@keyframes ai-chat-edge-flow-y {
  0% {
    background-position: 0 0;
  }

  100% {
    background-position: 0 200%;
  }
}

/* 律动：底部光雾色值横向流动（横位移 200% 同样是一个完整图案宽） */
@keyframes ai-chat-edge-flow-x {
  0% {
    background-position: 0 0;
  }

  100% {
    background-position: 200% 0;
  }
}

/* 无障碍：系统开启「减少动态」时只保留静态流光 */
@media (prefers-reduced-motion: reduce) {
  .ai-chat-edge-glow__side,
  .ai-chat-edge-glow__bottom {
    opacity: 0.75;
    animation: none;
  }
}
</style>
