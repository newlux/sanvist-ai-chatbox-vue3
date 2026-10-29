<script setup lang="ts">
import AiTaskInit from "@/components/ai-task-init/index.vue";

defineOptions({ name: "AiTaskInitPage" });

/**
 * 任务协同初始化页（薄壳）。
 * 引导流程（唤醒 → 自我介绍 → 选择身份 → 身份信息 → 进任务协同）全部收在
 * AiTaskInit 组件里，本页只负责收尾跳转；接口与数据流不变。
 */
function onFinish(url: string) {
  uni.redirectTo({ url });
}
</script>

<template>
  <AiTaskInit @finish="onFinish" />
</template>
