<script setup lang="ts">
import AiGuideInit from "@/components/ai-guide-init/index.vue";

defineOptions({ name: "AiGuideInitPage" });

/**
 * 作业指导初始化页（薄壳）。
 * 引导流程（唤醒 → 自我介绍 → 机型 → 设备 → 经验 → 进作业指导）全部收在
 * AiGuideInit 组件里，本页只负责收尾跳转；接口与数据流不变。
 *
 * 入口：当前 ai-chat-nav 的「作业指导」已直连 /pages/guide/index，本页暂无代码引用
 * （保留引导流程；需要时把入口 url 改回本页即可）。
 * 终点：组件 emit("finish", "/pages/guide/index?deviceModel=..&experience=..&modelExperience=..")，
 * 本页 uni.redirectTo 过去，不留在页面栈里。
 */
function onFinish(url: string) {
  uni.redirectTo({ url });
}
</script>

<template>
  <AiGuideInit @finish="onFinish" />
</template>
