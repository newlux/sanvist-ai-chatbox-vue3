<script setup lang="ts">
import type { AiBlock } from "@/utils/ai-stream";
import { computed } from "vue";
import AnswerBlock from "./AnswerBlock.vue";
import ChartBlock from "./ChartBlock.vue";

defineOptions({ name: "AnswerGroupBlock" });

const props = defineProps({
  blocks: { type: Array as () => AiBlock[], default: () => [] },
});

/**
 * 组内只渲染 answer / chart，两者都没实际内容时整组不渲染：
 * 否则会留下一个只有 32rpx 间距的空盒子（流式刚开始、或这一组里只有 think/status 时最常见）。
 */
const visibleBlocks = computed(() => (Array.isArray(props.blocks) ? props.blocks : []).filter((block) => {
  if (!block) return false;
  if (block.type === "answer") return String(block.payload?.content || "").trim().length > 0;
  if (block.type === "chart") return Boolean(block.payload?.option);
  return false;
}));
</script>

<template>
  <view v-if="visibleBlocks.length" class="answer-group-block">
    <!-- key 必须落在 template 上：放到分支子节点上编译到小程序会丢掉 a:key，只能按下标 diff -->
    <template v-for="block in visibleBlocks" :key="block.id">
      <AnswerBlock
        v-if="block.type === 'answer'"
        :content="String(block.payload.content || '')"
        :streaming="!block.complete"
        embedded
      />
      <ChartBlock
        v-else-if="block.type === 'chart'"
        :block-id="block.id"
        :option="block.payload.option"
        :layout="block.payload.layout"
        embedded
      />
    </template>
  </view>
</template>

<style lang="scss" scoped>
.answer-group-block {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  gap: 32rpx;
}
</style>
