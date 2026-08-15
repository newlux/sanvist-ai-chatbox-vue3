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
    <text class="answer-group-block__title">
      输出结果
    </text>
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
  gap: 32rpx;
  margin-top: 32rpx;
  padding-top: 32rpx;
  border-top: 2rpx solid #f0f0f2;
}
.answer-group-block__title {
  color: #b0b0b0;
  font-family: "PingFang SC";
  font-size: 24rpx;
  font-weight: 400;
  line-height: 30rpx;
}
</style>
