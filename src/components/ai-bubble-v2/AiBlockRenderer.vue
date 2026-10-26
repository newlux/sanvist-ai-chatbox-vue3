<script setup lang="ts">
import type {
  AssistantNavigationPayload,
  AskSlotPayload,
  GanttViewPayload,
  GuideStepPayload,
  GuideStepSelectEvent,
  GuideSuggestionPayload,
} from "@/api/chat/types";
import AnswerBlock from "./blocks/AnswerBlock.vue";
import AskSlotBlock from "./blocks/AskSlotBlock.vue";
import AssistantNavigationBlock from "./blocks/AssistantNavigationBlock.vue";
import ChartBlock from "./blocks/ChartBlock.vue";
import ErrorBlock from "./blocks/ErrorBlock.vue";
import GanttBlock from "./blocks/GanttBlock.vue";
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
  /**
   * 卡片在 DOM 上的 id 覆盖值（默认用 block.id）。
   * 核对卡由消息列表独立渲染，block id 只按内容生成、多轮之间会重复，
   * 消息列表会传入「并进消息 id」后的唯一 id，滚动定位才能指到是哪一轮的卡。
   */
  domId: {
    type: String,
    default: "",
  },
});

const emit = defineEmits([
  "suggestion-tap",
  "ask-slot-open",
  "assistant-navigation-open",
  "guide-step-open",
  "guide-suggestion-open",
  "guide-check-step-select",
  "gantt-open",
]);

function onSuggestionTap(suggestion: unknown) {
  emit("suggestion-tap", suggestion);
}

function onAskSlotOpen(payload: AskSlotPayload) {
  emit("ask-slot-open", payload);
}

/** 跳转确认块（维修助手）：块自身不占位，只在 auto_open 时把 payload 往上抛给页面开弹框 */
function onAssistantNavigationOpen(payload: AssistantNavigationPayload) {
  emit("assistant-navigation-open", payload);
}

/** 点调度视图入口卡：整包数据继续往上抛，由页面存数据并跳横屏调度视图 */
function onGanttOpen(payload: GanttViewPayload) {
  emit("gantt-open", payload);
}

function onGuideStepOpen(payload: GuideStepPayload, auto = false) {
  emit("guide-step-open", payload, auto);
}

function onGuideSuggestionOpen(payload: GuideSuggestionPayload, auto = false) {
  emit("guide-suggestion-open", payload, auto);
}

/** 点核对卡步骤条某一段：把步数（1 起）+ step_id 继续往上抛，由页面切步骤并打开底部白板 */
function onGuideCheckStepSelect(payload: GuideStepSelectEvent) {
  emit("guide-check-step-select", payload);
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
  <!-- 跳转确认块（navigation 积木）：只做 auto_open 触发，不占视觉位置 -->
  <AssistantNavigationBlock
    v-else-if="block.type === 'assistant-navigation'"
    :payload="block.payload"
    @open="onAssistantNavigationOpen"
  />
  <GuideStepBlock v-else-if="block.type === 'guide-step'" :payload="block.payload" @open="onGuideStepOpen" />
  <!-- 多轮追问卡：与步骤卡分开渲染（并行分支 vs 按序推进） -->
  <GuideSuggestionBlock
    v-else-if="block.type === 'guide-suggestion'"
    :payload="block.payload"
    @open="onGuideSuggestionOpen"
  />
  <!-- id 落在根节点上：步骤卡片翻页时按它做 scroll-into-view 定位 -->
  <GuideCheckBlock
    v-else-if="block.type === 'guide-check'"
    :id="domId || block.id"
    :payload="block.payload"
    @select-step="onGuideCheckStepSelect"
  />
  <TableBlock v-else-if="block.type === 'table'" :payload="block.payload" />
  <!-- 调度视图入口卡（COMPONENT scene=task / type=gantt）：点它跳横屏调度视图并带上整包数据 -->
  <GanttBlock v-else-if="block.type === 'gantt'" :payload="block.payload" @open="onGanttOpen" />
  <MetricBlock v-else-if="block.type === 'metric'" :payload="block.payload" />
  <GuideImageBlock v-else-if="block.type === 'image'" :payload="block.payload" />
  <GuideVideoBlock v-else-if="block.type === 'video'" :payload="block.payload" />
  <GuideSourceBlock v-else-if="block.type === 'source'" :payload="block.payload" />
  <ErrorBlock v-else-if="block.type === 'error'" :payload="block.payload" />
  <SuggestionBlock v-else-if="block.type === 'suggestion'" :payload="block.payload" @suggestion-tap="onSuggestionTap" />
</template>
