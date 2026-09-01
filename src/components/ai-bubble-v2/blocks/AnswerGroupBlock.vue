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
  gap: 32rpx;
}
</style>
