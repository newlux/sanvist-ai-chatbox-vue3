<script setup lang="ts">
import AnswerBlock from "./blocks/AnswerBlock.vue";
import ChartBlock from "./blocks/ChartBlock.vue";
import ErrorBlock from "./blocks/ErrorBlock.vue";
import GuideImageBlock from "./blocks/GuideImageBlock.vue";
import GuideSourceBlock from "./blocks/GuideSourceBlock.vue";
import GuideVideoBlock from "./blocks/GuideVideoBlock.vue";
import MetricBlock from "./blocks/MetricBlock.vue";
import StatusBlock from "./blocks/StatusBlock.vue";
import SuggestionBlock from "./blocks/SuggestionBlock.vue";
import TableBlock from "./blocks/TableBlock.vue";
import ThinkBlock from "./blocks/ThinkBlock.vue";
import ToolCallBlock from "./blocks/ToolCallBlock.vue";

defineOptions({
  name: "AiBlockRenderer",
});

defineProps({
  block: {
    type: Object,
    required: true,
  },
  forceThinkingExpanded: {
    type: Boolean,
    default: false,
  },
  embedded: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["suggestion-tap"]);

function onSuggestionTap(suggestion: unknown) {
  emit("suggestion-tap", suggestion);
}
</script>

<template>
  <AnswerBlock
    v-if="block.type === 'answer'"
    :content="block.payload.content || ''"
    :streaming="!block.complete"
    :embedded="embedded"
  />
  <ThinkBlock
    v-else-if="block.type === 'think'"
    :content="block.payload.content || ''"
    :steps="block.payload.steps || []"
    :complete="block.complete"
    :force-expanded="forceThinkingExpanded"
  />
  <StatusBlock v-else-if="block.type === 'status'" :payload="block.payload" />
  <ToolCallBlock v-else-if="block.type === 'tool_call'" :payload="block.payload" :complete="block.complete" />
  <ChartBlock
    v-else-if="block.type === 'chart'"
    :block-id="block.id"
    :option="block.payload.option"
    :layout="block.payload.layout"
    :embedded="embedded"
  />
  <TableBlock v-else-if="block.type === 'table'" :payload="block.payload" />
  <MetricBlock v-else-if="block.type === 'metric'" :payload="block.payload" />
  <GuideImageBlock v-else-if="block.type === 'image'" :payload="block.payload" />
  <GuideVideoBlock v-else-if="block.type === 'video'" :payload="block.payload" />
  <GuideSourceBlock v-else-if="block.type === 'source'" :payload="block.payload" />
  <ErrorBlock v-else-if="block.type === 'error'" :payload="block.payload" />
  <SuggestionBlock v-else-if="block.type === 'suggestion'" :payload="block.payload" @suggestion-tap="onSuggestionTap" />
</template>
