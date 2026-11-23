<script setup lang="ts">
import type { GuideStepSelectEvent } from "@/api/chat/types";
import type { AiBlock } from "@/utils/ai-stream/chatStreamParser";
import { computed, ref, watch } from "vue";
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
  /**
   * voice 导语（`<COMPONENT type="voice" data.text>`）：老师傅（非分步骤）模式下的开场白，
   * 固定排在回答内容最顶部并参与播报。新手（分步骤）模式不会走到这里 ——
   * useChatSend 的 filterNoviceVoice / 历史映射已把 voice 块在进入渲染前丢弃。
   *
   * 另一半用途：同一句导语后端可能既下发 voice 块、又写进 answer 开头，
   * 这里先从正文里剔掉重复那段，免得显示两遍。
   */
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

/**
 * tips → 正文交接时的「高度保持」：解析层把 tips 摘掉的那一拍，正文还在打字机里从 0 个字吐，
 * 气泡会先丢掉 tips 那一行（含过程副标题）的高度、几百毫秒后再长回来 —— 视觉上是「上下闪一下」。
 * 这里在移除前那一帧（pre-flush）量容器高度兜成 min-height，正文长过它之后自然失效，收尾时清掉。
 */
const rootRef = ref<unknown>(null);
const holdMinHeight = ref(0);
const holdStyle = computed(() => (holdMinHeight.value > 0 ? { minHeight: `${holdMinHeight.value}px` } : undefined));

/** view 的 ref 在 H5 下可能是组件实例（取 $el）也可能是元素本身，两种都兜住 */
function rootElement(): HTMLElement | null {
  if (typeof HTMLElement === "undefined") return null;
  const value = rootRef.value as HTMLElement | { $el?: unknown } | null;
  if (value instanceof HTMLElement) return value;
  const element = (value as { $el?: unknown } | null)?.$el;
  return element instanceof HTMLElement ? element : null;
}

function hasTipsBlock(list: AiBlock[] | undefined) {
  return (list || []).some(block => block?.type === "tips");
}

watch(
  () => props.blocks,
  (next, previous) => {
    if (!hasTipsBlock(previous) || hasTipsBlock(next)) return;
    const root = rootElement();
    const height = root ? Math.round(root.getBoundingClientRect().height) : 0;
    if (height > 0) holdMinHeight.value = height;
  },
  { flush: "pre" },
);

watch(
  () => props.loading,
  (loading) => {
    if (!loading) holdMinHeight.value = 0;
  },
);
</script>

<template>
  <view ref="rootRef" class="ai-content-blocks" :style="holdStyle">
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
