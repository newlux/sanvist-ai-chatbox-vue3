<script setup lang="ts">
import { computed } from "vue";
import { useUserStore } from "@/stores";
import { resolveChatBackdrop } from "@/utils/chat-backdrop";

/**
 * 对话框设备背景图（Ardot 7297:145 履带吊 / 7297:278 混凝土泵车）。
 *
 * 跟着用户在作业指导页选的机型走：机型决定设备类型，类型决定用哪张线稿背景。
 * - 宽度：左右各留 40rpx，高度按图片比例自适应（mode="widthFix"）；
 * - 位置：稿里两类图高低不同，按设计稿的距顶百分比放；
 * - 透明度 20%，压在页面内容之下（z-index: -1，盖在页面底色之上、正文之下）。
 */
defineOptions({ name: "AiChatBackdrop" });

const userStore = useUserStore();

const backdrop = computed(() => {
  const modelKey = userStore.selectedDeviceModelKey;
  if (!modelKey) return null;
  const modelName = userStore.deviceModels.find(item => item.modelKey === modelKey)?.modelName || "";
  return resolveChatBackdrop(modelKey, modelName);
});

const backdropStyle = computed(() => (
  backdrop.value ? { top: `${backdrop.value.topPercent}%` } : undefined
));
</script>

<template>
  <image
    v-if="backdrop"
    class="chat-backdrop"
    :style="backdropStyle"
    :src="backdrop.src"
    mode="widthFix"
  />
</template>

<style lang="scss" scoped>
.chat-backdrop {
  position: absolute;
  z-index: 0;
  left: 40rpx;
  width: calc(100% - 80rpx);
  opacity: 0.2;
  pointer-events: none;
}
</style>
