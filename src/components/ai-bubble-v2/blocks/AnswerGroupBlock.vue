<script setup lang="ts">
import type { AiBlock } from "@/utils/ai-stream";
import { computed } from "vue";
import AnswerBlock from "./AnswerBlock.vue";
import ChartBlock from "./ChartBlock.vue";

defineOptions({ name: "AnswerGroupBlock" });

const props = defineProps({
  blocks: { type: Array as () => AiBlock[], default: () => [] },
  /**
   * 各正文块是否还在逐字揭示（block.id → typing），由 AiContentBlocks 汇总后传下来。
   * 组内图表要等它前面的正文打完再出现，与组间表格的闸门是同一套规则。
   */
  typingMap: { type: Object as () => Record<string, boolean>, default: () => ({}) },
});
const emit = defineEmits(["typing"]);

/**
 * 组内只渲染 answer / chart，两者都没实际内容时整组不渲染：
 * 否则会留下一个只有 32rpx 间距的空盒子（流式刚开始、或这一组里只有 think/status 时最常见）。
 *
 * 另外按顺序压一道闸：图表要等它前面的正文打完字再出现 —— 第一个「前面还有正文在打字」
 * 的图表连同它后面的块先不渲染，避免文字还在逐字长、图表已经提前摆出来。
 */
const visibleBlocks = computed(() => {
  const list = (Array.isArray(props.blocks) ? props.blocks : []).filter((block) => {
    if (!block) return false;
    if (block.type === "answer") return String(block.payload?.content || "").trim().length > 0;
    if (block.type === "chart") return Boolean(block.payload?.option);
    return false;
  });
  const gateIndex = list.findIndex((block, index) =>
    block.type === "chart" && list.slice(0, index).some(prev => props.typingMap[prev.id]));
  return gateIndex < 0 ? list : list.slice(0, gateIndex);
});
</script>

<template>
  <view v-if="visibleBlocks.length" class="answer-group-block">
    <!-- key 必须落在 template 上：放到分支子节点上编译到小程序会丢掉 a:key，只能按下标 diff -->
    <template v-for="block in visibleBlocks" :key="block.id">
      <AnswerBlock
        v-if="block.type === 'answer'"
        :content="String(block.payload.content || '')"
        :streaming="!block.complete"
        :replayed="Boolean(block.payload.replayed)"
        embedded
        @typing="emit('typing', { id: block.id, typing: $event })"
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
