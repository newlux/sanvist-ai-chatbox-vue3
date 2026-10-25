<script setup lang="ts">
import type { GanttViewPayload } from "@/api/chat/types";

import { computed } from "vue";
import AiGanttEntryCard from "@/components/ai-gantt-entry-card/index.vue";
import { hasGanttCard, resolveGanttCardText } from "@/utils/gantt-card";

/**
 * 调度视图入口卡（COMPONENT scene=task / type=gantt）——设计稿 4708:743 的「任务协同-…甘特图」卡片。
 *
 * payload 是接口整包 data（viewType / viewId / entry / card / rows / stage …）：
 * - `card.visible === false` 时整张卡不渲染；
 * - 标题 / 状态 / 设备数 / 任务数的取值口径统一在 utils/gantt-card（与作业协同页的初始化卡片共用）；
 * - 数据项动态填充：没有数据（字段缺省且推导不出）就返回空串，由入口卡把该行整行隐藏；
 * - `cardOnly`：只认后端给的 `card` 字段，不从 rows / stage 推导（初始化对话接口的卡片用）；
 * - 点击把整包数据 emit 给页面：页面先落到本地存储，再跳横屏调度视图页渲染。
 */
defineOptions({ name: "GanttBlock" });

const props = defineProps({
  payload: { type: Object as () => GanttViewPayload | null, default: () => ({}) },
  /** 只取卡片数据渲染，缺省字段不推导 */
  cardOnly: { type: Boolean, default: false },
});

const emit = defineEmits<{ open: [payload: GanttViewPayload] }>();

const view = computed<GanttViewPayload>(() => props.payload || {});

/** card.visible 缺省当可见；只认卡片数据时，卡片没内容整卡不渲染 */
const visible = computed(() => {
  if (view.value.card?.visible === false) return false;
  return props.cardOnly ? hasGanttCard(view.value) : true;
});

const cardText = computed(() => resolveGanttCardText(view.value, { cardOnly: props.cardOnly }));

function onTap() {
  emit("open", view.value);
}
</script>

<template>
  <AiGanttEntryCard
    v-if="visible"
    :title="cardText.title"
    :status="cardText.status"
    :devices="cardText.devices"
    :task-count="cardText.taskCount"
    @tap="onTap"
  />
</template>
