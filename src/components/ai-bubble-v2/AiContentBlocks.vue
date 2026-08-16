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
  // 分享海报场景：不将 answer/chart 分组为 answer-group，避免渲染「输出结果」标题和分隔线
  noAnswerGroup: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["suggestion-tap"]);

const renderItems = computed(() => {
  // 海报模式（noAnswerGroup）：answer/chart 逐块渲染，不使用 answer-group 分组，
  // 避免展示「输出结果」标题和分隔线；chart 内容本身仍由 AiBlockRenderer 渲染
  if (props.noAnswerGroup) return props.blocks || [];

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
.ai-content-blocks { display: flex; flex-direction: column; gap: 0; }
</style>
