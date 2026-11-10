import { AI_ASK_WELCOME_DONE_KEY } from "@/config";
import { createLogger } from "@/utils/logger";

const logger = createLogger("welcome-done");

/**
 * 是否已完成过 SANI 唤醒。
 *
 * 与首页 syncPageStage（pages/index）同一口径：首页初始页起飞进对话态时置位，
 * 内页（作业指导 / 任务协同）欢迎层起飞时也会补标记。已完成过的用户再从任何
 * 入口进来都直接进对话态，不再铺整屏欢迎层。
 */
export function isWelcomeDone(): boolean {
  try {
    return Boolean(uni.getStorageSync(AI_ASK_WELCOME_DONE_KEY));
  } catch (error) {
    logger.error("failed to read welcome flag", error);
    return false;
  }
}

/** 标记「已完成 SANI 唤醒」：欢迎层起飞进对话态时调用，清掉后重载首页会回到初始页。 */
export function markWelcomeDone() {
  try {
    uni.setStorageSync(AI_ASK_WELCOME_DONE_KEY, true);
  } catch (error) {
    logger.error("failed to mark welcome done", error);
  }
}