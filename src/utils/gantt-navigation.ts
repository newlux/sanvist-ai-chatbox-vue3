import type { GanttViewPayload } from "@/api/chat/types";

import { openOfflineGantt, resolveOfflineGanttDecision } from "@/utils/gantt-offline";
import { createLogger } from "@/utils/logger";
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
 * 出口按 viewType 分两类：
 * - `schedule` / `pre` / `replan`（三个横屏调度视图）：
 *   · **原生 mPaaS 容器**：打开甘特图离线包（openH5Container），数据经 saveDemoModeData 传递；
 *   · **H5 / 浏览器（以及离线包打开失败时）**：走主工程站内页面（pushWindow 或 uni.navigateTo），
 *     数据走本地存储 + 目标页 onLoad 取出。站内这套代码保留不删，用于回退。
 * - `personal`（竖屏个人任务详情）：**固定走站内 pages/task-detail，不进离线包**
 *   （离线包按 target 分流的排版只覆盖横屏那两个视图，竖屏详情在本工程里本来就有一份渲染）。
 *
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

/** 上一次甘特跳转的时间戳：用于忽略 bridge 等待窗口内的重复点击 */
let lastOpenAt = 0;
/** 重复点击的判定窗口（要大于等 bridge 的最长时间） */
const DUPLICATE_GUARD_MS = 800;

/**
 * 站内打开甘特页（H5 默认路径、离线包回退、以及 personal 的唯一路径）。
 *
 * 数据传递一律「先写本地存储、再由目标页 onLoad 取走」：目标页可能是独立场景窗口
 * （nativeSceneWindow=1）里的新实例，只有存储 + onLoad 取出两条路径都稳。
 */
function openInAppGantt(viewType: string, view: GanttViewPayload, url: string) {
  if (viewType === PERSONAL_VIEW_TYPE) {
    stashPendingTaskDetail(view);
  }
  else {
    stashPendingScheduleView(view);
    // 横屏页（schedule / pre / replan）的方向全部交给宿主：
    // 原生容器用 openH5Container 打开甘特图应用时本身就是全屏横屏，不需要前端再申请；
    // 站内回退路径（H5 / 离线包失败）由目标页 useLandscape 做 CSS 旋转兜底。
  }

  void navigateToScene(url);
}

/**
 * 打开卡片对应的页面（作业协同页与首页的甘特卡共用这一处分流，两边口径一致）。
 *
 * @param payload 接口整包 data（含 viewType / card / rows / payload …）
 */
export async function openGanttView(payload?: GanttViewPayload | null) {
  // 等 bridge 的这几百毫秒里用户可能连点：加一个短窗口去重，避免连开两个容器 / 两次 pushWindow
  const now = Date.now();
  if (now - lastOpenAt < DUPLICATE_GUARD_MS) {
    logger.info("甘特跳转：忽略重复点击", { gapMs: now - lastOpenAt });
    return;
  }
  lastOpenAt = now;

  const view = payload || {};
  const viewType = String(view.viewType || "").trim().toLowerCase();
  const url = VIEW_TYPE_PAGE[viewType] || VIEW_TYPE_PAGE.schedule;

  // personal 是竖屏详情页：固定走站内 pages/task-detail，不进离线包，也不等 bridge 判定。
  // （离线包只覆盖三个横屏调度视图的排版；竖屏详情在本工程里已有同款渲染，没必要再开容器。）
  if (viewType === PERSONAL_VIEW_TYPE) {
    logger.info("甘特跳转：personal 固定走站内详情页，不走离线包", { url });
    openInAppGantt(viewType, view, url);
    return;
  }

  // 判定明细一并打出来：移动端没进离线包时，看这条就知道是「网页环境」「bridge 等超时」
  // 还是「离线包自身打开失败」（后者的详细步骤日志在 utils/gantt-offline）。
  // 这里会等 bridge 最多 BRIDGE_WAIT_MS，避免刚启动那一下误判成网页。
  const decision = await resolveOfflineGanttDecision();

  // 原生容器：甘特走独立离线包（openH5Container）
  if (decision.useOffline) {
    logger.info("甘特跳转：走离线包容器（openH5Container）", { viewType, url, ...decision });
    try {
      await openOfflineGantt(viewType, view);
    }
    catch (error) {
      // 离线包不可用不能挡路：回退站内甘特页（此时横屏只能靠 useLandscape 的 CSS 旋转兜底）
      logger.error(
        "甘特跳转：离线包打开失败 → 回退站内甘特页（会走 CSS 旋转兜底）",
        { viewType, url, error: error instanceof Error ? error.message : String(error) },
        error,
      );
      openInAppGantt(viewType, view, url);
    }
    return;
  }

  logger.warn("甘特跳转：走站内甘特页，不调 openH5Container", {
    viewType,
    url,
    ...decision,
    reason: decision.webEnvironment ? "网页环境没有 mPaaS 容器" : "等 bridge 超时，按不可用处理",
  });
  openInAppGantt(viewType, view, url);
}
