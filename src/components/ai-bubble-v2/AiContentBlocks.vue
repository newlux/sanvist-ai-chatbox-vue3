<script setup lang="ts">
import type { GuideStepSelectEvent } from "@/api/chat/types";
import type { Ref } from "vue";
import type { AiBlock } from "@/utils/ai-stream/chatStreamParser";
import { computed, ref, inject, watch } from "vue";
import { useChatScope } from "@/stores";
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
 * 任务协同（scope=task）：`<COMPONENT scene=guide type=voice>` 只是这一轮的播报稿，
 * 不能进回答流程，渲染前直接摘掉；作业指导 / 首页仍保留老师傅导语的展示（VoiceBlock）。
 *
 * 只在渲染层过滤：store 里的 voice 块照旧保留，播报链（useRealtimeTts / collectAnswerText
 * 按块取文本，且有 speechText 时优先用它）不受影响。
 */
const renderVoiceBlock = useChatScope() !== "task";

/**
 * 正文是不是还没结束（还在逐字，或本轮还在生成）。
 *
 * 选项类块（追问卡 / 推荐问题 / 跳转卡）的数据常常和正文同一帧到达，不压的话
 * 就是「正文才吐两行，下面选项已经摆好」，用户没读完就能点，顺序和节奏都断了。
 *
 * 只看「正在逐字」的计数不够：打字机把**已到达的那部分**追平就会立刻停下（见 useTypewriter
 * 的 tick → stop），而 SSE 后面的正文可能过几十毫秒才到 —— 这个空档里计数回到 0，
 * 选项就被放出来，等下一段正文到达再被摘掉，表现正是「选项在正文中途冒出来又消失」。
 * 所以叠上 loading：本轮没收尾之前，正文都还没算「说完」。
 *
 * 历史回看消息 loading 为 false、计数恒为 0，选项照旧立即显示。
 */
const answerTypingCount = inject<Ref<number> | null>("ai-bubble-answer-typing", null);
const bodyTyping = computed(() => Boolean(answerTypingCount?.value));
/** 正文未收尾：生成中（loading）或正在逐字（bodyTyping）都算 */
const bodyPending = computed(() => Boolean(props.loading) || bodyTyping.value);

/** 需要等正文打完才出现的选项类块 */
const OPTION_BLOCK_TYPES = new Set(["ask-slot", "suggestion", "guide-suggestion", "assistant-navigation"]);

/**
 * 正文里的参考图（image）：与参考资料一样压到正文收尾后再挂载。
 *
 * 图片事件往往紧跟在正文后面到达（见 tests/test.log：answer 分段 → image → source），
 * 但图片一旦挂载就会立刻撑高容器、并且自己还会异步加载完 —— 打字机还在一个字一个字
 * 吐正文时，图已经稳稳摆在下面了，观感就是「文字还在长、图先好了」。
 * 压到正文打完再挂载，顺序才是「正文 → 图片 → 参考资料 → 选项」。
 */
const MEDIA_BLOCK_TYPES = new Set(["image"]);

/**
 * 参考资料（source）：正文打完后再接在正文下方。
 * 它在气泡内、位置紧挨正文，所以比气泡外的选项 / 独立卡早一步浮现（见样式里的延迟阶梯）。
 */
const REFERENCE_BLOCK_TYPES = new Set(["source"]);

function isOptionBlock(block: AiBlock) {
  return OPTION_BLOCK_TYPES.has(block.type);
}

function isMediaBlock(block: AiBlock) {
  return MEDIA_BLOCK_TYPES.has(block.type);
}

function isReferenceBlock(block: AiBlock) {
  return REFERENCE_BLOCK_TYPES.has(block.type);
}

/** 正文收尾前要压住的块：选项类 + 正文里的图片 + 参考资料 */
function isDeferredBlock(block: AiBlock) {
  return isOptionBlock(block) || isMediaBlock(block) || isReferenceBlock(block);
}

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
  // 任务协同不渲染 voice 块，但它们仍先用上面的 stripVoiceFromAnswers 把正文里重复的导语剔掉
  const visibleVoiceBlocks = renderVoiceBlock ? voiceBlocks : [];
  const slotBlocks = rest.filter(block => block.type === "ask-slot");
  /**
   * 正文逐字 / 本轮生成期间先摘掉选项类块（追问卡 / 推荐问题 / 跳转卡）、正文里的图片
   * 与参考资料，正文收尾后再按「图片 → 参考资料 → 选项」的顺序放回来。
   * 只影响渲染：store 里的块序不变，播报 / 分享按块取内容不受影响。
   */
  const contentBlocks = rest.filter(block => block.type !== "ask-slot"
    && !(bodyPending.value && isDeferredBlock(block)));
  const trailingSlots = bodyPending.value ? [] : slotBlocks;

  // 海报模式（noAnswerGroup）：answer/chart 逐块渲染，不使用 answer-group 分组，
  // 避免展示「输出结果」标题和分隔线；chart 内容本身仍由 AiBlockRenderer 渲染
  if (props.noAnswerGroup) return [...visibleVoiceBlocks, ...contentBlocks, ...trailingSlots];

  const items: any[] = [...visibleVoiceBlocks];
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

  /**
   * 只追加 trailingSlots（= 正文收尾后才放出来的 ask-slot），**不能**再拼一次 slotBlocks：
   * 它是 trailingSlots 的来源，bodyPending 为 false 时两者是同一批块 —— 欢迎语那种
   * 既不打字也没有 loading 的消息，追问卡会被渲染两遍（任务协同开场选身份最典型）。
   */
  return [...items, ...trailingSlots];
});

/**
 * 各正文块是否还在逐字揭示（block.id → typing），由 AnswerBlock 逐块上报、这里汇总。
 *
 * 用途是给表格 / 图表压一道顺序闸门：流式时后端先推正文、再推表格事件，
 * 打字机还落后一大截，表格却已经渲染到正文下方 —— 用户看到的是
 * 「文字还在一个字一个字往外长，表格（图表）已经摆好了」。
 */
const typingMap = ref<Record<string, boolean>>({});

function onBlockTyping(payload?: { id?: string; typing?: boolean }) {
  const id = String(payload?.id || "");
  if (!id) return;
  const typing = Boolean(payload?.typing);
  if (Boolean(typingMap.value[id]) === typing) return;
  typingMap.value = { ...typingMap.value, [id]: typing };
}

/** 这一项里还有没有正文在打字：answer-group 看组内每个 answer */
function itemTyping(item: any) {
  if (item?.type === "answer-group") {
    return (item.blocks || []).some((block: AiBlock) => Boolean(typingMap.value[block.id]));
  }
  return Boolean(typingMap.value[item?.id]);
}

/**
 * 顺序闸门：第一个「前面还有正文在打字」的表格 / 图表，连同它后面的一切先不渲染，
 * 等文字打完再一次性放出来。后面的段落此时才挂载、才开始自己的打字机，
 * 顺序不会错（不会出现「表格还没出、表格后的文字先冒出来」再被顶下去）。
 *
 * 组内的图表由 AnswerGroupBlock 用同一套规则处理（组本身不在这里被压住）。
 */
const visibleItems = computed(() => {
  // 海报模式是静态快照（逐块平铺，等打完字再截图就来不及了）：不做顺序闸门，
  // 否则表格 / 图表会被压住，导出的海报里直接缺一块
  if (props.noAnswerGroup) return renderItems.value;
  const items = renderItems.value;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const isMedia = item?.type === "table" || item?.type === "chart";
    if (!isMedia) continue;
    if (items.slice(0, index).some(prev => itemTyping(prev))) return items.slice(0, index);
  }
  return items;
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
 * tips → 正文交接时的「高度保持」。
 *
 * 后端吐第一条正文时，解析层会一次性把 tips 块摘掉（见 chatStreamParser 的 applyEventToBlocks），
 * 而正文是打字机从 0 个字开始吐的 —— 交接这一帧气泡里只剩「品牌行 + 空正文」，
 * 原来 tips 那一行（连同它下面那行过程副标题）的高度整块消失，几百毫秒后正文追上才长回来。
 * 视觉上就是「快要出正文的时候气泡和正文一起上下闪一下」。
 *
 * 处理：在 tips 被摘掉的那一拍（pre-flush，DOM 还是移除前那一帧）量一下容器当前高度，作为 min-height 兜住。
 * 正文随后在自己的槽位里逐字长出来，长过这个高度后 min-height 自然失效（不会再跳第二次）；
 * 本轮收尾时清掉，避免影响下一轮。
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
    // 只在「这一拍把 tips 摘掉」时兜高度：tips 还在、或本来就没有，都不用管
    if (!hasTipsBlock(previous) || hasTipsBlock(next)) return;
    const root = rootElement();
    const height = root ? Math.round(root.getBoundingClientRect().height) : 0;
    if (height > 0) holdMinHeight.value = height;
  },
  { flush: "pre" },
);

/** 本轮结束就放开：此时正文早已长过兜底高度，收回不产生位移 */
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
    <template v-for="item in visibleItems" :key="item.id">
      <AnswerGroupBlock
        v-if="item.type === 'answer-group'"
        :blocks="item.blocks"
        :typing-map="typingMap"
        @typing="onBlockTyping"
      />
      <AiBlockRenderer
        v-else
        :block="item"
        :class="{
          'ai-content-blocks__option': isOptionBlock(item),
          'ai-content-blocks__media': isMediaBlock(item),
          'ai-content-blocks__reference': isReferenceBlock(item),
        }"
        :force-thinking-expanded="forceThinkingExpanded"
        :embedded="noAnswerGroup"
        :loading="loading"
        @typing="onBlockTyping"
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

/* 正文打完那一刻才挂载（见 renderItems）：补一次淡入上移，
   否则会整块「啪」地出现在正文末尾，像是被硬塞进来的。
   四档延迟形成「正文 → 图片 → 参考资料 → 选项 → 气泡外独立卡」的浮现顺序：
   图片紧随正文（0s），参考资料让一拍（0.08s），选项再让一拍（0.16s），
   独立卡最后一档（见 ai-bubble-v2 的 .ai-bubble-v2__suggestions 与 ai-message-list 的甘特卡）。 */
.ai-content-blocks__media {
  animation: ai-block-in 0.26s cubic-bezier(0.22, 0.61, 0.36, 1) both;
}

.ai-content-blocks__reference {
  animation: ai-block-in 0.26s cubic-bezier(0.22, 0.61, 0.36, 1) 0.08s both;
}

.ai-content-blocks__option {
  animation: ai-block-in 0.26s cubic-bezier(0.22, 0.61, 0.36, 1) 0.16s both;
}

@keyframes ai-block-in {
  from {
    opacity: 0;
    transform: translateY(8rpx);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
