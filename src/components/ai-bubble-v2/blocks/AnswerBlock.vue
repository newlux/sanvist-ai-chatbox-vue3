<script setup>
import MarkdownRenderer from "@/components/markdown-renderer/index.vue";

defineOptions({ name: "AnswerBlock" });

defineProps({
  content: { type: String, default: "" },
  embedded: { type: Boolean, default: false },
  // 未结束的回答按流式处理，降低解析频率
  streaming: { type: Boolean, default: false },
});
</script>

<template>
  <view class="answer-block" :class="[{ 'answer-block--embedded': embedded }]">
    <MarkdownRenderer :content="content" :streaming="streaming" />
  </view>
</template>

<style lang="scss" scoped>
.answer-block {
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
