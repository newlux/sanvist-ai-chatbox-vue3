<script setup lang="ts">
import { computed } from "vue";
import MarkdownRenderer from "@/components/markdown-renderer/index.vue";

defineOptions({ name: "VoiceBlock" });

const props = defineProps({
  payload: { type: Object, default: () => ({}) },
  embedded: { type: Boolean, default: false },
});

const text = computed(() => String(props.payload?.text || "").trim());

</script>

<template>
  <view class="voice-block" :class="{ 'voice-block--embedded': embedded }">
    <MarkdownRenderer :content="text" />
  </view>
</template>

<style lang="scss" scoped>
/**
 * 老师傅导语（voice 块）：一句普通正文，显示在回答内容顶部。
 * 与回答正文（answer-block）同一套排版：直接铺在页面上，不给灰底 / 圆角 / 内边距。
 */
.voice-block {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  background: transparent;
  border-radius: 0;
  padding: 0;
}
</style>
