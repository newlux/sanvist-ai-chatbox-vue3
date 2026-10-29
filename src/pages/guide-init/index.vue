<script setup lang="ts">
import AiGuideInit from "@/components/ai-guide-init/index.vue";

defineOptions({ name: "AiGuideInitPage" });

/**
 * 作业指导初始化页（薄壳）。
 * 引导流程（唤醒 → 自我介绍 → 机型 → 设备 → 经验 → 进作业指导）全部收在
 * AiGuideInit 组件里，本页只负责收尾跳转；接口与数据流不变。
 */
function onFinish(url: string) {
  uni.redirectTo({ url });
}
</script>

<template>
  <AiGuideInit @finish="onFinish" />
</template>
