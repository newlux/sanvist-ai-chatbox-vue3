import { LISTEN_REPORT_CURRENT_DATE_KEY, LISTEN_REPORT_DATE_KEY } from "@/config";
import { useUserStore } from "@/stores";
import { createLogger } from "@/utils/logger";
import { closeWebview, isMpaasReady } from "@/utils/platform/mpaas";

const logger = createLogger("exit-mini-program");

/**
 * 关闭当前小程序（把 webview 交回宿主）。
 *
 * 首页右上角那颗房子按钮的完整行为，作业指导 / 任务协同页的退出按钮共用同一份：
 * 1) 游客态先清掉听播的临时存储与身份，下次进来重新走初始化（与首页口径一致）；
 * 2) 有 mPaaS 容器时走 `popWindow`，由宿主收掉当前 webview；
 * 3) 没有 bridge（浏览器 / 直接用 url 打开）时退栈兜底，栈里只有本页就什么都不做。
 */
export function exitMiniProgram() {
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
    void closeWebview().catch(error => logger.warn("popWindow failed", error));
    return;
  }
  if (getCurrentPages().length > 1) uni.navigateBack({ delta: 1 });
}
