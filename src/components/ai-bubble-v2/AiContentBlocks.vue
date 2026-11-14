<script setup lang="ts">
import type { GuideStepSelectEvent } from "@/api/chat/types";
import type { AiBlock } from "@/utils/ai-stream/chatStreamParser";
import { computed } from "vue";
import { expandChartFences, expandMarkdownTables } from "@/utils/ai-stream";
import AiBlockRenderer from "./AiBlockRenderer.vue";
import AnswerGroupBlock from "./blocks/AnswerGroupBlock.vue";

defineOptions({
  name: "AiContentBlocks",
});

const props = defineProps({
  blocks: {
    type: Array as () => AiBlock[],
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
  loading: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits([
  "suggestion-tap",
  "ask-slot-open",
  "ask-slot-pick",
  "ask-slot-submit",
  "assistant-navigation-open",
  "assistant-navigation-confirm",
  "guide-step-open",
  "guide-suggestion-open",
  "guide-check-step-select",
  "gantt-open",
]);

// 回答正文里的 Markdown 表格与 ECharts 围栏都在此转换为独立 block，统一走专用组件。
const normalizedBlocks = computed(() => expandChartFences(expandMarkdownTables((props.blocks || []) as AiBlock[])));

/**
 * 从 answer 正文里剔除 voice 导语：同一句导语后端会既下发给 voice 块，
 * 又可能重复写进正文 answer 开头。导语由 voice 块（VoiceBlock）渲染，
 * answer 里再保留一段就会显示两次——这里在渲染前剔掉那段导语。
 * 逐块用 indexOf 精确匹配，导语后面的换行一并去掉。
 */
function stripVoiceFromAnswers(blocks: AiBlock[], voiceTexts: string[]) {
  const texts = voiceTexts.map(value => String(value || "").trim()).filter(Boolean);
  if (!texts.length) return blocks;
  return blocks.map((block) => {
    if (block.type !== "answer") return block;
    let content = String(block.payload?.content || "");
    texts.forEach((voiceText) => {
      const index = content.indexOf(voiceText);
      if (index < 0) return;
      const after = content.slice(index + voiceText.length).replace(/^\n+/, "");
      content = `${content.slice(0, index)}${after}`.trim();
    });
    return { ...block, payload: { ...block.payload, content } };
  });
}

const lastTipId = computed(() => {
  const tips = props.blocks.filter(block => block.type === "tips");
  return tips[tips.length - 1]?.id;
});

/**
 * 追问卡（ask-slot）固定排在回答最底部。
 *
 * 块顺序来自流式事件顺序：后端有时先推 ask_slot、再吐正文，blocks 里就成了
 * [ask-slot, answer-1] —— 选项被摆在正文中间，后半段正文又掉到选项下面。
 * 这里先把 ask-slot 从流里摘出来，渲染序列末尾再统一追加，保证「正文 → 选项」的阅读顺序，
 * 与 AskSlotBlock 的定位说明（内联排在回答正文下方）一致。
 * 摘出来还有一层好处：被选项隔开的两段 answer 会重新变成相邻块、落进同一个 answer-group，
 * 不会渲染成两个「输出结果」分组。
 * 只调整展示顺序，不动 store 里的 blocks，播报 / 分享等按块序取内容的逻辑不受影响。
 */
const renderItems = computed(() => {
  // voice 导语固定排在内容最顶部（AnswerGroup 无涉及），并先从 answer 剔除重复导语
  const voiceBlocks = normalizedBlocks.value.filter(block => block.type === "voice");
  const voiceTexts = voiceBlocks.map(block => String((block.payload?.text as string) || ""));
  const rest = stripVoiceFromAnswers(
    normalizedBlocks.value.filter(block => block.type !== "voice"),
    voiceTexts,
  );
  const slotBlocks = rest.filter(block => block.type === "ask-slot");
  const contentBlocks = rest.filter(block => block.type !== "ask-slot");

  // 海报模式（noAnswerGroup）：answer/chart 逐块渲染，不使用 answer-group 分组，
  // 避免展示「输出结果」标题和分隔线；chart 内容本身仍由 AiBlockRenderer 渲染
  if (props.noAnswerGroup) return [...voiceBlocks, ...contentBlocks, ...slotBlocks];

  const items: any[] = [...voiceBlocks];
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

  contentBlocks.forEach((block) => {
    if (block.type === "answer" || block.type === "chart") {
      group.push(block);
      return;
    }
    appendGroup();
    items.push(block);
  });
  appendGroup();

  return [...items, ...slotBlocks];
});

function onSuggestionTap(suggestion) {
  emit("suggestion-tap", suggestion);
}

function onAskSlotOpen(payload) {
  emit("ask-slot-open", payload);
}

function onAskSlotPick(payload) {
  emit("ask-slot-pick", payload);
}

/** 内联追问卡（多选）确认提交：继续上抛给页面拼提问 */
function onAskSlotSubmit(payload) {
  emit("ask-slot-submit", payload);
}

function onAssistantNavigationOpen(payload) {
  emit("assistant-navigation-open", payload);
}

/** 内联跳转卡（维修助理）选了进入方式：继续上抛给页面 */
function onAssistantNavigationConfirm(payload, action) {
  emit("assistant-navigation-confirm", payload, action);
}

function onGuideStepOpen(payload, auto = false) {
  emit("guide-step-open", payload, auto);
}

function onGuideSuggestionOpen(payload, auto = false) {
  emit("guide-suggestion-open", payload, auto);
}

function onGuideCheckStepSelect(payload: GuideStepSelectEvent) {
  emit("guide-check-step-select", payload);
}

/** 点调度视图入口卡：整包数据继续上抛给页面 */
function onGanttOpen(payload) {
  emit("gantt-open", payload);
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
        :loading="loading"
        @suggestion-tap="onSuggestionTap"
        @ask-slot-open="onAskSlotOpen"
        @ask-slot-pick="onAskSlotPick"
        @ask-slot-submit="onAskSlotSubmit"
        @assistant-navigation-open="onAssistantNavigationOpen"
        @assistant-navigation-confirm="onAssistantNavigationConfirm"
        @guide-step-open="onGuideStepOpen"
        @guide-suggestion-open="onGuideSuggestionOpen"
        @guide-check-step-select="onGuideCheckStepSelect"
        @gantt-open="onGanttOpen"
      />
      <slot
        v-if="item.type === 'tips' && item.id === lastTipId && item.payload.processSubtitle"
        name="tip-status"
        :status="item.payload.processSubtitle"
      />
    </template>
  </view>
</template>

<style lang="scss" scoped>
.ai-content-blocks { display: flex; flex-direction: column; width: 100%; min-width: 0; gap: 0; }
</style>
