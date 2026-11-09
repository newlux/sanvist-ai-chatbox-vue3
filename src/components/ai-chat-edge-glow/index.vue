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
 * 显示时机由页面控制（生成中才出现）；深色稿没有这三层，页面在 .ai-page--dark 里隐藏本组件。
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
    <!-- 底部光雾只保留页面最底下一条：外层裁切 + 上沿蒙版，模糊不会爬到输入栏上 -->
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

/* 左竖边：紫 → 蓝 */
.ai-chat-edge-glow__side--left {
  left: 0;
  background: linear-gradient(180deg, #8f6deb 0%, #0f7eee 100%);
  -webkit-mask-image: linear-gradient(90deg, #000 0%, rgba(0, 0, 0, 0) 100%);
  mask-image: linear-gradient(90deg, #000 0%, rgba(0, 0, 0, 0) 100%);
  animation: ai-chat-edge-breathe 2600ms ease-in-out infinite;
}

/* 右竖边：紫 → 粉 */
.ai-chat-edge-glow__side--right {
  right: 0;
  background: linear-gradient(180deg, #8f6deb 0%, #f0b5fd 100%);
  -webkit-mask-image: linear-gradient(270deg, #000 0%, rgba(0, 0, 0, 0) 100%);
  mask-image: linear-gradient(270deg, #000 0%, rgba(0, 0, 0, 0) 100%);
  animation: ai-chat-edge-breathe 2600ms ease-in-out infinite;
  // 与左侧错开半个周期，两侧不同步地一明一暗，形成流动感
  animation-delay: -1300ms;
}

/* 底部光雾的可见窗口：只占页面最底下 36px（= 画布 812 - 输入栏底 776），
   超出这个高度的模糊全部裁掉 —— 输入栏（设计稿 y=732→776）及其上方不会再被染色。
   上沿再用蒙版淡出，避免裁切出一条硬边 */
.ai-chat-edge-glow__bottom-clip {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 72rpx; // 36px
  overflow: hidden;
  -webkit-mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0) 0%, #000 60%, #000 100%);
  mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0) 0%, #000 60%, #000 100%);
}

/* 底部光雾（设计稿 203:5916）：449×118px，模糊 84px；
   元素底边比画布低 75px（设计稿 y=769、画布高 812），在 clip 内只露出最下面一段 */
.ai-chat-edge-glow__bottom {
  position: absolute;
  left: -76rpx; // -37.8px
  bottom: -150rpx; // 底边溢出 75px
  width: 898rpx; // 449px
  height: 236rpx; // 118px
  background: linear-gradient(90deg, #295dc3 0%, #0d7aba 100%);
  filter: blur(168rpx); // 84px
  animation: ai-chat-edge-wave 3200ms ease-in-out infinite;
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

/* 无障碍：系统开启「减少动态」时只保留静态流光 */
@media (prefers-reduced-motion: reduce) {
  .ai-chat-edge-glow__side,
  .ai-chat-edge-glow__bottom {
    opacity: 0.75;
    animation: none;
  }
}
</style>
