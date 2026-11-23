<script setup lang="ts">
import { computed } from "vue";
import MarkdownRenderer from "../../markdown-renderer/index.vue";

defineOptions({ name: "AnswerBlock" });

const props = defineProps({
  content: { type: String, default: "" },
  embedded: { type: Boolean, default: false },
  // 未结束的回答按流式处理，降低解析频率
  streaming: { type: Boolean, default: false },
  /**
   * 落定动效（文字停更后压淡再落定）开关：null（不传）= 开，正常正文照旧「写完落一下」。
   * tips 显式传 false —— 它是被后端整句覆盖的状态行，每换一句文案就整行重挂一次，
   * 落定动画跟着重放（opacity 0.7 → 1），看起来就是这行字在明暗闪烁。
   */
  settle: { type: Boolean, default: null },
});

/** 透传给渲染器的实值：null 不能直接往下传（Boolean prop 会被当成 false） */
const settleEnabled = computed(() => (props.settle === null ? true : props.settle));
</script>

<template>
  <view class="answer-block" :class="[{ 'answer-block--embedded': embedded }]">
    <MarkdownRenderer :content="content" :streaming="streaming" :settle="settleEnabled" />
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
