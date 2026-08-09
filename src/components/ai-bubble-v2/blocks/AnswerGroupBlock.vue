<script setup>
import AnswerBlock from "./AnswerBlock.vue";
import ChartBlock from "./ChartBlock.vue";

defineOptions({ name: "AnswerGroupBlock" });

defineProps({
  blocks: { type: Array, default: () => [] },
});
</script>

<template>
  <view class="answer-group-block">
    <template v-for="block in blocks">
      <AnswerBlock
        v-if="block.type === 'answer'"
        :key="`${block.id}-answer`"
        :content="block.payload.content || ''"
        embedded
      />
      <ChartBlock
        v-else-if="block.type === 'chart'"
        :key="`${block.id}-chart`"
        :block-id="block.id"
        :option="block.payload.option"
        embedded
      />
    </template>
  </view>
</template>

<style lang="scss" scoped>
.answer-group-block {
  display: flex;
  flex-direction: column;
  padding: 32rpx;
  border-radius: 20rpx;
  background: #f9f9f9;
}
</style>
