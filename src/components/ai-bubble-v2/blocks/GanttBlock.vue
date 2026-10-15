<script setup lang="ts">
import type { GanttViewPayload, GanttViewRow } from "@/api/chat/types";

import { computed } from "vue";
import AiGanttEntryCard from "@/components/ai-gantt-entry-card/index.vue";

/**
 * 调度视图入口卡（COMPONENT scene=task / type=gantt）——设计稿 4708:743 的「任务协同-…甘特图」卡片。
 *
 * payload 是接口整包 data（viewType / viewId / entry / card / rows / stage …）：
 * - 标题取 `card.title`（如「调度视图（执行中）」），`card.visible === false` 时整张卡不渲染；
 * - 「状态」取 `card.status`，缺省按 `stage` 映射；「设备数」取 `card.devices`，缺省按 rows 类别归并
 * - 「任务数」取 `card.taskCount`，缺省为所有行任务条之和；
 * - 点击把整包数据 emit 给页面：页面先落到本地存储，再跳横屏调度视图页渲染。
 */
defineOptions({ name: "GanttBlock" });

const props = defineProps({
  payload: { type: Object as () => GanttViewPayload, default: () => ({}) },
});

const emit = defineEmits<{ open: [payload: GanttViewPayload] }>();

/** 阶段 → 卡片「状态」文案（接口给新词时按语义就近映射，认不出就原样展示） */
const STAGE_LABEL: Record<string, string> = {
  planning: "计划中",
  planned: "已下发",
  published: "已下发",
  issued: "已下发",
  executing: "执行中",
  running: "执行中",
  finished: "已完成",
  done: "已完成",
  canceled: "已取消",
  cancelled: "已取消",
};

/** 类别 → 设备名（与卡片默认文案「搅拌车 4 台｜泵车 1 台」同一套说法） */
const CATEGORY_DEVICE: Record<string, string> = {
  运输: "搅拌车",
  泵车: "泵车",
  供料: "搅拌站",
};

const view = computed<GanttViewPayload>(() => props.payload || {});
const rows = computed<GanttViewRow[]>(() => (Array.isArray(view.value.rows) ? view.value.rows : []));

/** card.visible 缺省当可见 */
const visible = computed(() => view.value.card?.visible !== false);

const title = computed(() => String(view.value.card?.title || "").trim() || "任务协同-当天任务甘特图");

const statusText = computed(() => {
  const cardStatus = String(view.value.card?.status || "").trim();
  if (cardStatus) return STAGE_LABEL[cardStatus.toLowerCase()] || cardStatus;
  const stage = String(view.value.stage || "").trim();
  if (!stage) return "已下发";
  return STAGE_LABEL[stage.toLowerCase()] || stage;
});

/** 设备数：优先 `card.devices`，缺省按 rows 的类别归并计数（如「搅拌车 4 台｜泵车 1 台」） */
const devicesText = computed(() => {
  const cardDevices = view.value.card?.devices;
  if (typeof cardDevices === "string") {
    const text = cardDevices.trim();
    if (text) return text;
  }
  if (Array.isArray(cardDevices) && cardDevices.length > 0) {
    const parts = cardDevices
      .map((device) => {
        const type = String(device?.type || "").trim();
        if (!type) return "";
        const count = Number(device?.count ?? 0);
        return Number.isFinite(count) ? `${type} ${count} 台` : type;
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join("｜");
  }
  const counts = new Map<string, number>();
  rows.value.forEach((row) => {
    const category = String(row?.category || "").trim();
    if (!category) return;
    counts.set(category, (counts.get(category) || 0) + 1);
  });
  const fallback: string[] = [];
  counts.forEach((count, category) => {
    fallback.push(`${CATEGORY_DEVICE[category] || category} ${count} 台`);
  });
  return fallback.join("｜");
});

/** 任务数：优先 `card.taskCount`，缺省按 rows 的任务条求和 */
const taskCountText = computed(() => {
  const cardCount = Number(view.value.card?.taskCount);
  const total = Number.isFinite(cardCount)
    ? cardCount
    : rows.value.reduce((sum, row) => sum + (Array.isArray(row?.bars) ? row.bars.length : 0), 0);
  return `${total} 个`;
});

function onTap() {
  emit("open", view.value);
}
</script>

<template>
  <AiGanttEntryCard
    v-if="visible"
    :title="title"
    :status="statusText"
    :devices="devicesText"
    :task-count="taskCountText"
    @tap="onTap"
  />
</template>
