<script setup lang="ts">
import type { AskSlotPayload, GuideStepPayload, GuideSuggestionPayload } from "@/api/chat/types";
import AnswerBlock from "./blocks/AnswerBlock.vue";
import AskSlotBlock from "./blocks/AskSlotBlock.vue";
import ChartBlock from "./blocks/ChartBlock.vue";
import ErrorBlock from "./blocks/ErrorBlock.vue";
import GuideCheckBlock from "./blocks/GuideCheckBlock.vue";
import GuideImageBlock from "./blocks/GuideImageBlock.vue";
import GuideSourceBlock from "./blocks/GuideSourceBlock.vue";
import GuideStepBlock from "./blocks/GuideStepBlock.vue";
import GuideSuggestionBlock from "./blocks/GuideSuggestionBlock.vue";
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
  loading: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["suggestion-tap", "ask-slot-open", "guide-step-open", "guide-suggestion-open"]);

function onSuggestionTap(suggestion: unknown) {
  emit("suggestion-tap", suggestion);
}

function onAskSlotOpen(payload: AskSlotPayload) {
  emit("ask-slot-open", payload);
}

function onGuideStepOpen(payload: GuideStepPayload) {
  emit("guide-step-open", payload);
}

function onGuideSuggestionOpen(payload: GuideSuggestionPayload) {
  emit("guide-suggestion-open", payload);
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
  <AskSlotBlock v-else-if="block.type === 'ask-slot'" :payload="block.payload" @open="onAskSlotOpen" />
  <GuideStepBlock v-else-if="block.type === 'guide-step'" :payload="block.payload" @open="onGuideStepOpen" />
  <!-- 多轮追问卡：与步骤卡分开渲染（并行分支 vs 按序推进） -->
  <GuideSuggestionBlock
    v-else-if="block.type === 'guide-suggestion'"
    :payload="block.payload"
    @open="onGuideSuggestionOpen"
  />
  <!-- id 落在根节点上：步骤卡片翻页时按 block.id 做 scroll-into-view 定位 -->
  <GuideCheckBlock v-else-if="block.type === 'guide-check'" :id="block.id" :payload="block.payload" />
  <TableBlock v-else-if="block.type === 'table'" :payload="block.payload" />
  <MetricBlock v-else-if="block.type === 'metric'" :payload="block.payload" />
  <GuideImageBlock v-else-if="block.type === 'image'" :payload="block.payload" />
  <GuideVideoBlock v-else-if="block.type === 'video'" :payload="block.payload" />
  <GuideSourceBlock v-else-if="block.type === 'source'" :payload="block.payload" />
  <ErrorBlock v-else-if="block.type === 'error'" :payload="block.payload" />
  <SuggestionBlock v-else-if="block.type === 'suggestion'" :payload="block.payload" @suggestion-tap="onSuggestionTap" />
</template>
