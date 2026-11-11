import type { CloseContainerPrefer } from "@/utils/platform/mpaas";
import { LISTEN_REPORT_CURRENT_DATE_KEY, LISTEN_REPORT_DATE_KEY } from "@/config";
import { useUserStore } from "@/stores";
import { createLogger } from "@/utils/logger";
import { closeContainer, isMpaasReady } from "@/utils/platform/mpaas";

const logger = createLogger("exit-mini-program");

/**
 * 关闭当前小程序（把 webview 交回宿主），作业指导 / 任务协同页右上角的退出按钮共用这一份。
 *
 * 退出流程对齐甘特离线包的「返回宿主」（见 `closeContainer`），顺序可按页面指定：
 * - `"popWindow"`（默认，首页口径）：popWindow → closeMiniPro → history.back；
 * - `"closeMiniPro"`（作业指导 / 任务协同口径）：强制先走 closeMiniPro → popWindow → history.back。
 *
 * 关容器之前先做游客态清理：清掉听播的临时存储与身份，下次进来重新走初始化（与首页口径一致）。
 * 没有 bridge（浏览器 / 直接用 url 打开）时先退 uni 页面栈，栈里只有本页再走 history.back。
 */
export function exitMiniProgram(prefer: CloseContainerPrefer = "popWindow") {
  const userStore = useUserStore();
  if (userStore.isVisitor) {
    try {
      uni.removeStorageSync(LISTEN_REPORT_DATE_KEY);
      uni.removeStorageSync(LISTEN_REPORT_CURRENT_DATE_KEY);
    } catch (error) {
      logger.warn("failed to reset visitor listen report state", error);
    }
    userStore.setVisitorRole(null);
    userStore.setUserId("");
  }
  if (isMpaasReady()) {
    void closeContainer(prefer);
    return;
  }
  if (getCurrentPages().length > 1) {
    uni.navigateBack({ delta: 1 });
    return;
  }
  if (typeof history !== "undefined") history.back();
}
