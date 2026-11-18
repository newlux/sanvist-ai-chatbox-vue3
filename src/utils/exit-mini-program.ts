import type { CloseContainerPrefer } from "@/utils/platform/mpaas";
import { LISTEN_REPORT_CURRENT_DATE_KEY, LISTEN_REPORT_DATE_KEY } from "@/config";
import { useUserStore } from "@/stores";
import { createLogger } from "@/utils/logger";
import { closeContainer, isMpaasReady } from "@/utils/platform/mpaas";

const logger = createLogger("exit-mini-program");

/** 离开前清游客态（听播临时存储 + 身份）：下次进来重新走初始化（与首页口径一致） */
function resetVisitorState() {
  const userStore = useUserStore();
  if (!userStore.isVisitor) return;
  try {
    uni.removeStorageSync(LISTEN_REPORT_DATE_KEY);
    uni.removeStorageSync(LISTEN_REPORT_CURRENT_DATE_KEY);
  }
  catch (error) {
    logger.warn("failed to reset visitor listen report state", error);
  }
  userStore.setVisitorRole(null);
  userStore.setUserId("");
}

/**
 * 原生出口全部没成功时的 Web 兜底。
 *
 * **不能用 `history.back()`**：H5 是单页 WebView，栈里往往只有本页，
 * back 会落到宿主容器造出来的那条空白历史记录上 —— 表现就是「点了房子停在白屏、退不回来」。
 * 有页面栈就退一页；只剩本页就回首页（重新挂载会落回初始页），至少还有一个能点的界面。
 */
function fallbackWebExit() {
  if (getCurrentPages().length > 1) {
    uni.navigateBack({ delta: 1 });
    return;
  }
  uni.reLaunch({ url: "/pages/index/index" });
}

/**
 * 关闭当前小程序 / 回宿主首页，首页、作业指导、任务协同右上角那颗房子按钮共用这一份。
 *
 * 出口流程对齐甘特离线包的「返回宿主」（见 `closeContainer`），顺序可按页面指定：
 * - `"goHome"`（推荐，房子图标口径）：调原生 goHome 回 App 首页，没有这个 JSAPI 时退到 popWindow；
 * - `"popWindow"`：popWindow → closeMiniPro；
 * - `"closeMiniPro"`（退出小程序口径）：closeMiniPro → popWindow。
 *
 * 原生出口都不可用时不再 history.back，改走 `fallbackWebExit`（退栈 / 回首页），
 * 避免停在白屏。没有 bridge（浏览器 / 直接用 url 打开）时同样走这条兜底。
 */
export function exitMiniProgram(prefer: CloseContainerPrefer = "goHome") {
  resetVisitorState();

  if (isMpaasReady()) {
    void closeContainer(prefer).then((closed) => {
      if (!closed) fallbackWebExit();
    });
    return;
  }

  fallbackWebExit();
}
