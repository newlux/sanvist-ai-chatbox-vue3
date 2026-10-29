import type { GanttViewPayload } from "@/api/chat/types";

import { isNativeLandscapeDevice, isWebEnvironment, peekPhoneInfo } from "@/utils/landscape-device";
import { createLogger } from "@/utils/logger";
import { setLandscapeFullscreen } from "@/utils/platform/mpaas";
import { navigateToScene } from "@/utils/scene-navigation";
import { stashPendingScheduleView } from "@/utils/schedule-view";
import { stashPendingTaskDetail } from "@/utils/task-detail-view";

const logger = createLogger("gantt-navigation");

/**
 * 甘特入口卡（COMPONENT scene=task / type=gantt）点击后的分流。
 *
 * 后端 `gantt_build` 产出 4 种 viewType，各对应一个页面：
 * - `schedule` 全量调度视图（横屏）→ pages/schedule-gantt
 * - `pre`      预排草案（横屏）    → pages/schedule-pre
 * - `replan`   重排对比（横屏）    → pages/schedule
 * - `personal` 个人排班（竖屏）    → pages/task-detail，明细挂在整包的 `payload` 字段里
 *
 * 数据传递一律「先写本地存储、再由目标页 onLoad 取走」：目标页可能是独立场景窗口
 * （nativeSceneWindow=1）里的新实例，只有存储 + onLoad 取出两条路径都稳。
 * viewType 缺省或认不出时按 `schedule` 走（历史行为）。
 */
const VIEW_TYPE_PAGE: Record<string, string> = {
  schedule: "/pages/schedule-gantt/index",
  pre: "/pages/schedule-pre/index",
  replan: "/pages/schedule/index",
  personal: "/pages/task-detail/index",
};

/** 个人排班（竖屏详情页）——明细在 payload 字段，走另一份存储 */
const PERSONAL_VIEW_TYPE = "personal";

/**
 * 打开卡片对应的页面（作业协同页与首页的甘特卡共用这一处分流，两边口径一致）。
 *
 * @param payload 接口整包 data（含 viewType / card / rows / payload …）
 */
export function openGanttView(payload?: GanttViewPayload | null) {
  const view = payload || {};
  const viewType = String(view.viewType || "").trim().toLowerCase();
  const url = VIEW_TYPE_PAGE[viewType] || VIEW_TYPE_PAGE.schedule;

  if (viewType === PERSONAL_VIEW_TYPE) {
    stashPendingTaskDetail(view);
  } else {
    stashPendingScheduleView(view);
    // 横屏页（schedule / pre / replan）：进页面前先让宿主转屏（landscapeFullscreen），
    // 目标页 mounted 时会再调一次兜底；退出横屏页时由 useLandscape 置回 false。
    // 网页环境（浏览器 / PC 内嵌）没有原生转屏能力，不预转，目标页也不会做 CSS 旋转兜底。
    // 智慧屏 / 电视这类本身是横屏画布的机器不预转屏（见 utils/landscape-device）：
    // 设备信息没回来时也不预转，交给目标页自己判断，避免先转了再撤。
    const cached = peekPhoneInfo();
    if (isWebEnvironment()) {
      logger.info("网页环境：跳转前不做预转屏");
    } else if (cached === undefined) {
      logger.info("设备信息未就绪，跳转前不做预转屏（由目标页判定）");
    } else if (isNativeLandscapeDevice(cached)) {
      logger.info("该机型本身就是横屏画布，跳过预转屏");
    } else {
      setLandscapeFullscreen(true);
    }
  }

  void navigateToScene(url);
}
