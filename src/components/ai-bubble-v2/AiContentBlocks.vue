<script setup>
import { computed } from "vue";
import AiBlockRenderer from "./AiBlockRenderer.vue";
import AnswerGroupBlock from "./blocks/AnswerGroupBlock.vue";

defineOptions({
  name: "AiContentBlocks",
});

const props = defineProps({
  blocks: {
    type: Array,
    default: () => [],
  },
  forceThinkingExpanded: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["suggestion-tap"]);

const renderItems = computed(() => {
  const items = [];
  let group = [];

  function appendGroup() {
    if (!group.length) return;
    items.push({
      id: `answer-group-${group[0].id}`,
      type: "answer-group",
      blocks: group,
    });
    group = [];
  }

  props.blocks.forEach((block) => {
    if (block.type === "answer" || block.type === "chart") {
      group.push(block);
      return;
    }
    appendGroup();
    items.push(block);
  });
  appendGroup();

  return items;
});

function onSuggestionTap(suggestion) {
  emit("suggestion-tap", suggestion);
}
</script>

<template>
  <view class="ai-content-blocks">
    <template v-for="item in renderItems">
      <AnswerGroupBlock
        v-if="item.type === 'answer-group'"
        :key="`${item.id}-group`"
        :blocks="item.blocks"
      />
      <AiBlockRenderer
        v-else
        :key="`${item.id}-block`"
        :block="item"
        :force-thinking-expanded="forceThinkingExpanded"
        @suggestion-tap="onSuggestionTap"
      />
    </template>
  </view>
</template>

<style lang="scss" scoped>
.ai-content-blocks { display: flex; flex-direction: column; gap: 24rpx; border-radius: 20rpx; }
</style>
