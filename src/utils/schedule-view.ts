import type { GanttViewPayload } from "@/api/chat/types";

import { createLogger } from "@/utils/logger";

/**
 * 调度视图数据（AI 下发的 gantt 组件整包 data）在「气泡入口卡 → 横屏调度视图页」之间传递。
 *
 * 为什么不走 url 参数：rows / bars 动辄几十条，塞进 query 会被长度与编码坑到；
 * 也不走事件总线：横屏页可能是独立场景窗口（nativeSceneWindow=1）里的新实例，
 * 只有本地存储 + 页面 onLoad 取出才两条路径都稳。写法参考 utils/schedule-ask.ts。
 */
const PENDING_SCHEDULE_VIEW_KEY = "pending-schedule-view";

const logger = createLogger("schedule-view");

/** 记下一份调度视图数据（点入口卡时调用） */
export function stashPendingScheduleView(payload: GanttViewPayload | Record<string, unknown>) {
  try {
    uni.setStorageSync(PENDING_SCHEDULE_VIEW_KEY, JSON.stringify(payload || {}));
  }
  catch (error) {
    // 存储不可用时仍然放行跳转，页内会退回 mock 数据渲染
    logger.warn("调度视图数据写入失败，页面将退回 mock", error);
  }
}

/** 取走调度视图数据（横屏页 onLoad 调用，取完即清） */
export function consumePendingScheduleView(): GanttViewPayload | null {
  let raw = "";
  try {
    raw = String(uni.getStorageSync(PENDING_SCHEDULE_VIEW_KEY) || "");
  }
  catch (error) {
    logger.warn("调度视图数据读取失败", error);
    return null;
  }
  if (!raw) return null;
  try {
    uni.removeStorageSync(PENDING_SCHEDULE_VIEW_KEY);
  }
  catch {
    // 删除失败只会在下次进入时复用同一份数据，这里不改返回值
  }
  try {
    const parsed = JSON.parse(raw) as GanttViewPayload;
    return parsed && typeof parsed === "object" ? parsed : null;
  }
  catch (error) {
    logger.warn("调度视图数据不是合法 JSON，已忽略", error);
    return null;
  }
}
