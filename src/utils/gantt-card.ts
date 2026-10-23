import type { GanttViewPayload, GanttViewRow } from "@/api/chat/types";

/**
 * 调度视图入口卡的展示文案取值（AI 气泡里的 gantt 积木卡与作业协同页的初始化卡片共用一套）。
 *
 * 取值口径（字段缺省时逐级兜底，都拿不到就返回空串，由卡片把该行整行隐藏）：
 * - 标题：`card.title`，缺省给默认文案；
 * - 状态：`card.status`（枚举，过 STAGE_LABEL 映射，认不出原样展示）
 *   → `card.status_text` → 顶层 `statusText` / `status_text` → `stage` 映射；
 * - 设备数：`card.devices`（数组按「类型 N 台」拼、字符串原样）→ 按 rows 的类别归并；
 * - 任务数：`card.taskCount`（兼容 snake_case 的 `task_count`）→ 按 rows 的任务条求和。
 */
export interface GanttCardText {
  /** 卡片标题 */
  title: string;
  /** 状态文案；空 = 不显示该行 */
  status: string;
  /** 设备数文案；空 = 不显示该行 */
  devices: string;
  /** 任务数文案；空 = 不显示该行 */
  taskCount: string;
}

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

const DEFAULT_TITLE = "任务协同-当天任务甘特图";

/** 状态：card.status → card.status_text → 顶层 statusText / status_text → stage 映射 */
function resolveStatus(view: GanttViewPayload) {
  const cardStatus = String(view.card?.status || "").trim();
  if (cardStatus) return STAGE_LABEL[cardStatus.toLowerCase()] || cardStatus;

  const cardStatusText = String(view.card?.status_text || "").trim();
  if (cardStatusText) return cardStatusText;

  const payloadStatus = String(view.statusText || view.status_text || "").trim();
  if (payloadStatus) return payloadStatus;

  const stage = String(view.stage || "").trim();
  if (!stage) return "";
  return STAGE_LABEL[stage.toLowerCase()] || stage;
}

/** 设备数：card.devices 优先，缺省按 rows 的类别归并计数 */
function resolveDevices(view: GanttViewPayload, rows: GanttViewRow[]) {
  const cardDevices = view.card?.devices;
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
  rows.forEach((row) => {
    const category = String(row?.category || "").trim();
    if (!category) return;
    counts.set(category, (counts.get(category) || 0) + 1);
  });
  const fallback: string[] = [];
  counts.forEach((count, category) => {
    fallback.push(`${CATEGORY_DEVICE[category] || category} ${count} 台`);
  });
  return fallback.join("｜");
}

/** 任务数：card.taskCount（兼容 task_count）优先，缺省按 rows 的任务条求和 */
function resolveTaskCount(view: GanttViewPayload, rows: GanttViewRow[]) {
  const cardCount = view.card?.taskCount ?? view.card?.task_count;
  if (cardCount !== undefined && String(cardCount).trim() !== "" && Number.isFinite(Number(cardCount))) {
    return `${Number(cardCount)} 个`;
  }
  const total = rows.reduce((sum, row) => sum + (Array.isArray(row?.bars) ? row.bars.length : 0), 0);
  return total > 0 ? `${total} 个` : "";
}

export function resolveGanttCardText(payload?: GanttViewPayload | null): GanttCardText {
  const view: GanttViewPayload = payload || {};
  const rows = Array.isArray(view.rows) ? view.rows : [];
  return {
    title: String(view.card?.title || "").trim() || DEFAULT_TITLE,
    status: resolveStatus(view),
    devices: resolveDevices(view, rows),
    taskCount: resolveTaskCount(view, rows),
  };
}
