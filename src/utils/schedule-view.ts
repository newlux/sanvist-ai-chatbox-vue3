import type { GanttViewPayload } from "@/api/chat/types";

import { createLogger } from "@/utils/logger";

/**
 * 调度视图数据（AI 下发的 gantt 组件整包 data）在「气泡入口卡 → 横屏调度视图页」之间传递。
 *
 * 为什么不走 url 参数：rows / bars 动辄几十条，塞进 query 会被长度与编码坑到；
 * 也不走事件总线：横屏页可能是独立场景窗口（nativeSceneWindow=1）里的新实例，
 * 只有本地存储 + 页面 onLoad 取出才两条路径都稳。写法参考 utils/schedule-ask.ts。
 *
 * 读写口径：**读不删、离开页面再删**（read + clear）。
 * 之前是「读完即清」，横屏页一刷新（H5 重新加载 / 宿主重建 webview）就取不到数据、只剩空视图；
 * 现在数据留到页面卸载时才清，刷新 / 重进同一个页面仍能渲染同一份；
 * 下次从卡片进来时 stash 会直接覆盖，所以也不会串上一份数据。
 */
const PENDING_SCHEDULE_VIEW_KEY = "pending-schedule-view";

const logger = createLogger("schedule-view");

/** 记下一份调度视图数据（点入口卡时调用，覆盖上一份） */
export function stashPendingScheduleView(payload: GanttViewPayload | Record<string, unknown>) {
  try {
    uni.setStorageSync(PENDING_SCHEDULE_VIEW_KEY, JSON.stringify(payload || {}));
  }
  catch (error) {
    // 存储不可用时仍然放行跳转，页内没有数据就渲染空视图
    logger.warn("调度视图数据写入失败，页面将渲染空视图", error);
  }
}

/** 读当前调度视图数据（横屏页 onLoad 调用；**不删除**，刷新页面还能再读到） */
export function readPendingScheduleView(): GanttViewPayload | null {
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
    const parsed = JSON.parse(raw) as GanttViewPayload;
    return parsed && typeof parsed === "object" ? parsed : null;
  }
  catch (error) {
    logger.warn("调度视图数据不是合法 JSON，已忽略", error);
    return null;
  }
}

/** 清掉本地这份数据（横屏页卸载时调用，避免旧数据长期留在存储里） */
export function clearPendingScheduleView() {
  try {
    uni.removeStorageSync(PENDING_SCHEDULE_VIEW_KEY);
  }
  catch (error) {
    // 删不掉只会让下一份数据被覆盖时一起替换，不影响渲染
    logger.warn("调度视图数据清理失败", error);
  }
}
