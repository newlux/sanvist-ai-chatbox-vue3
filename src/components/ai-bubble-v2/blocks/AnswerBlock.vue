<script setup lang="ts">
import type { Ref } from "vue";
import { computed, inject } from "vue";
import MarkdownRenderer from "@/components/markdown-renderer/index.vue";
import { useTypewriter } from "@/hooks/useTypewriter";

defineOptions({ name: "AnswerBlock" });

const props = defineProps({
  content: { type: String, default: "" },
  embedded: { type: Boolean, default: false },
  // 未结束的回答按流式处理，降低解析频率
  streaming: { type: Boolean, default: false },
});

/**
 * 打字机（首页 / 作业指导页 / 任务协同页打开，见 ai-bubble-v2 的 provide）：
 * 把已到达的正文逐字放出，避免整段回答一次刷出、列表高度一次撑高导致整屏跳动。
 * 没拿到开关（听汇报 / guide-pc 等）时 visible 恒等于 content，行为不变。
 */
const typewriterOn = inject<Ref<boolean> | null>("ai-bubble-typewriter", null);
const typewriterEnabled = computed(() => Boolean(typewriterOn?.value));
const { visible, typing } = useTypewriter(() => props.content, {
  enabled: () => typewriterEnabled.value,
});
</script>

<template>
  <view class="answer-block" :class="[{ 'answer-block--embedded': embedded }]">
    <!-- 打字机还在吐字时按流式交给 markdown：走它自己的节流，不会每帧重排。
         打字机开着就关掉落定动效（settle）：逐字揭示时可见文本每 40ms 变一次，
         落定动画会被反复打断重启，观感就是文字出现后还在抖 -->
    <MarkdownRenderer
      :content="visible"
      :streaming="streaming || typing"
      :settle="!typewriterEnabled"
    />
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
