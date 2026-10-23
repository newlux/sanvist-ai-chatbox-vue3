import type { GanttViewPayload } from "@/api/chat/types";

import { createLogger } from "@/utils/logger";
import { navigateToScene } from "@/utils/scene-navigation";
import { stashPendingScheduleView } from "@/utils/schedule-view";

const logger = createLogger("gantt-route");

/**
 * 任务协同入口卡（AiGanttEntryCard / gantt 积木）的 `viewType` → 落地页面。
 *
 * 后端同一张卡会下发不同视图，点进去的页面也不一样：
 * - personal / driver（个人排班）→ 竖屏个人任务详情 `pages/task-detail`
 * - pre / preplan（预排草案）→ 横屏预排视图 `pages/schedule-pre`
 * - replan（重排草案）→ 横屏重排视图 `pages/schedule`
 * - schedule / gantt / 缺省 → 横屏当天任务甘特图 `pages/schedule-gantt`
 */
const VIEW_TYPE_PAGES: Record<string, string> = {
  personal: "/pages/task-detail/index",
  driver: "/pages/task-detail/index",
  pre: "/pages/schedule-pre/index",
  preplan: "/pages/schedule-pre/index",
  replan: "/pages/schedule/index",
  schedule: "/pages/schedule-gantt/index",
  gantt: "/pages/schedule-gantt/index",
};

/** 命中不了精确值时按关键词兜底（后端可能给 personal_schedule / 预排 这类变体） */
export function resolveGanttViewPage(viewType?: string): string {
  const key = String(viewType || "").trim().toLowerCase();
  if (VIEW_TYPE_PAGES[key]) return VIEW_TYPE_PAGES[key];
  if (/personal|driver|个人/.test(key)) return "/pages/task-detail/index";
  if (/replan|重排/.test(key)) return "/pages/schedule/index";
  if (/pre|预排/.test(key)) return "/pages/schedule-pre/index";
  return "/pages/schedule-gantt/index";
}

/**
 * 打开调度视图：整包数据先落本地存储（横屏页 / 独立窗口的 onLoad 取走渲染），
 * 再按 viewType 分流到具体页面。
 */
export function openGanttView(payload?: GanttViewPayload | Record<string, unknown> | null) {
  const view = (payload || {}) as GanttViewPayload;
  const url = resolveGanttViewPage(view.viewType);
  logger.info("open gantt view", { viewType: view.viewType, url });
  stashPendingScheduleView(view);
  void navigateToScene(url);
}
