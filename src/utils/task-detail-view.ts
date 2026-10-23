import type { GanttViewPayload } from "@/api/chat/types";
import type { TaskDetailPayload } from "@/components/ai-task-detail-sheet/types";

import { createLogger } from "@/utils/logger";

/**
 * 个人任务详情数据在「入口卡 → 竖屏任务详情页」之间传递。
 *
 * 接口下发的是 gantt 整包 data（COMPONENT scene=task / type=gantt，viewType=personal），
 * 详情内容挂在整包的 `payload` 字段里（driverName / dateText / vehicleText / groups / note）。
 * 与调度视图同一套理由：数据量不小、目标页可能是独立场景窗口，
 * 所以走本地存储 + 页面 onLoad 取出，写法参考 utils/schedule-view.ts。
 */
const PENDING_TASK_DETAIL_KEY = "pending-task-detail";

const logger = createLogger("task-detail-view");

/** 从整包数据里取详情内容（没有 `payload` 字段时返回 null，页面据此不渲染任何详情元素） */
export function pickTaskDetailPayload(view?: GanttViewPayload | Record<string, unknown> | null): TaskDetailPayload | null {
  const payload = (view as GanttViewPayload | undefined)?.payload;
  if (!payload || typeof payload !== "object") return null;
  return payload as TaskDetailPayload;
}

/** 记下一份任务详情数据（点入口卡时调用） */
export function stashPendingTaskDetail(view: GanttViewPayload | Record<string, unknown>) {
  try {
    uni.setStorageSync(PENDING_TASK_DETAIL_KEY, JSON.stringify(view || {}));
  }
  catch (error) {
    // 存储不可用时仍然放行跳转，页面会渲染成没有详情内容的空页
    logger.warn("任务详情数据写入失败", error);
  }
}

/** 取走任务详情数据（详情页 onLoad 调用，取完即清） */
export function consumePendingTaskDetail(): TaskDetailPayload | null {
  let raw = "";
  try {
    raw = String(uni.getStorageSync(PENDING_TASK_DETAIL_KEY) || "");
  }
  catch (error) {
    logger.warn("任务详情数据读取失败", error);
    return null;
  }
  if (!raw) return null;
  try {
    uni.removeStorageSync(PENDING_TASK_DETAIL_KEY);
  }
  catch {
    // 删除失败只会在下次进入时复用同一份数据，这里不改返回值
  }
  try {
    return pickTaskDetailPayload(JSON.parse(raw) as GanttViewPayload);
  }
  catch (error) {
    logger.warn("任务详情数据不是合法 JSON，已忽略", error);
    return null;
  }
}
