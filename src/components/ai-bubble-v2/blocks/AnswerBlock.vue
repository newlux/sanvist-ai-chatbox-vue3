<script setup lang="ts">
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
/**
 * 回答正文直接铺在页面底上：不再给灰底卡片 / 圆角 / 内边距。
 * 之前这里是 #F9F9F9 + 20rpx 圆角 + 24/32rpx padding，气泡里就多出一块
 * 与正文不等高的底色块（浅色下白底、深色下暗底），文字还会被 padding 往里推、
 * 与同一条回答的其它块（角色列表、追问卡）左边缘对不齐。
 * 嵌入态（answer-group 内 / 无 answer-group）与独立态保持完全一致。
 */
.answer-block {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  background: transparent;
  border-radius: 0;
  padding: 0;
}
</style>
