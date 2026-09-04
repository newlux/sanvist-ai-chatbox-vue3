<script setup lang="ts">
import { computed } from "vue";
import MarkdownRenderer from "@/components/markdown-renderer/index.vue";
import { resolveAnswerText } from "@/utils/ai-stream/answerEnvelope";

defineOptions({ name: "AnswerBlock" });

const props = defineProps({
  content: { type: String, default: "" },
  embedded: { type: Boolean, default: false },
  // 未结束的回答按流式处理，降低解析频率
  streaming: { type: Boolean, default: false },
});

/**
 * 幂等剥壳：流式链路已解包时这里原样返回；历史消息回放 / 非流式落地的
 * answer 若仍是整包 JSON（后端把 answer+evidence 序列化下发），在这里兜底
 * 解一次，保证 markdown 渲染拿到的是真正的正文而不是一坨 JSON。
 */
const renderedContent = computed(() => resolveAnswerText(props.content).content);
</script>

<template>
  <view class="answer-block" :class="[{ 'answer-block--embedded': embedded }]">
    <MarkdownRenderer :content="renderedContent" :streaming="streaming" />
  </view>
</template>

<style lang="scss" scoped>
.answer-block {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  background: #F9F9F9;
  border-radius: 20rpx;
  padding: 24rpx 32rpx;
}
.answer-block--embedded {
  padding: 0;
  border-radius: 0;
  background: transparent;
}
</style>
