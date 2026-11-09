<script setup lang="ts">
import AiTaskInit from "@/components/ai-task-init/index.vue";

defineOptions({ name: "AiTaskInitPage" });

/**
 * 任务协同初始化页（薄壳）。
 * 引导流程（唤醒 → 自我介绍 → 选择身份 → 身份信息 → 进任务协同）全部收在
 * AiTaskInit 组件里，本页只负责收尾跳转；接口与数据流不变。
 *
 * 入口：当前 ai-chat-nav 的「任务协同」已直连 /pages/task/index，本页暂无代码引用
 * （保留引导流程；需要时把入口 url 改回本页即可）。
 * 终点：组件 emit("finish", "/pages/task/index?from=init")，本页 uni.redirectTo 过去，
 * 不留在页面栈里；身份码另经 setTaskIdentity 落本地存储（当前任务页尚未读取）。
 */
function onFinish(url: string) {
  uni.redirectTo({ url });
}
</script>

<template>
  <AiTaskInit @finish="onFinish" />
</template>
