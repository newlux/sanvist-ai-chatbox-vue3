<script setup lang="ts">
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
    <!-- key 必须落在 template 上：放到分支子节点上编译到小程序会丢掉 a:key，只能按下标 diff -->
    <template v-for="block in blocks" :key="block.id">
      <AnswerBlock
        v-if="block.type === 'answer'"
        :content="block.payload.content || ''"
        :streaming="!block.complete"
        embedded
      />
      <ChartBlock
        v-else-if="block.type === 'chart'"
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
  padding-top: 32rpx;
}
.answer-group-block__title {
  color: #b0b0b0;
  font-family: "PingFang SC";
  font-size: 24rpx;
  font-weight: 400;
  line-height: 30rpx;
}
</style>
