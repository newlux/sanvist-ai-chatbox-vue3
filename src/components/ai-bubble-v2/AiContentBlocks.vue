<script setup lang="ts">
import { computed } from "vue";
import { expandChartFences } from "@/utils/ai-stream";
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

// 正文里内联的 ```echarts 围栏在这里展开成 chart 块，与后端单独推的 chart 事件同路渲染
const normalizedBlocks = computed(() => expandChartFences(props.blocks || []));

const renderItems = computed(() => {
  // 海报模式（noAnswerGroup）：answer/chart 逐块渲染，不使用 answer-group 分组，
  // 避免展示「输出结果」标题和分隔线；chart 内容本身仍由 AiBlockRenderer 渲染
  if (props.noAnswerGroup) return normalizedBlocks.value;

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

  normalizedBlocks.value.forEach((block) => {
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
    <!-- key 必须落在 template 上：放到分支子节点上编译到小程序会丢掉 a:key，只能按下标 diff -->
    <template v-for="item in renderItems" :key="item.id">
      <AnswerGroupBlock
        v-if="item.type === 'answer-group'"
        :blocks="item.blocks"
      />
      <AiBlockRenderer
        v-else
        :block="item"
        :force-thinking-expanded="forceThinkingExpanded"
        :embedded="noAnswerGroup"
        @suggestion-tap="onSuggestionTap"
      />
    </template>
  </view>
</template>

<style lang="scss" scoped>
.ai-content-blocks { display: flex; flex-direction: column; gap: 0; }
</style>
