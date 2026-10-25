import type { VisitorRole } from "@/stores/modules/user";

/**
 * 任务协同待机页文案（Ardot 350:2151「调度员收到异常情况」）。
 *
 * 版面 = 问候标题 + 说明 + 任务入口卡（AiGanttEntryCard）+「你还可以这么问」问题列表。
 * 标题/说明取设计稿样例，存 i18n key；入口卡数据只来自页面初始化静默对话（「今天任务有哪些」）
 * 回复里的 gantt 卡片（见 pages/task 的 applyInitialCards），
 * 没有卡片数据时整卡不渲染，这里不提供占位数据。
 *
 * 建议问题按身份区分，存 i18n key（与 config/quick-prompts 同一套做法），
 * 由页面按当前语言翻译后再展示、发送。
 */
export interface TaskWelcomeCopy {
  /** 问候标题的 i18n key */
  titleKey: string;
  /** 问候说明的 i18n key */
  contentKey: string;
}

/** 标题 / 说明同样走 i18n（与建议问题一致），由页面按当前语言翻译 */
export const TASK_WELCOME_COPY: TaskWelcomeCopy = {
  titleKey: "task-welcome-title",
  contentKey: "task-welcome-desc",
};

/** 调度员（OWNER）：关注订单与当天任务进度 */
export const OWNER_WELCOME_QUESTIONS = [
  "task-welcome-question-owner-orders-tomorrow",
  "task-welcome-question-owner-progress-today",
];

/** 操作手（OPERATOR）：只关心明天自己有什么任务 */
export const OPERATOR_WELCOME_QUESTIONS = [
  "task-welcome-question-operator-jobs-tomorrow",
];

/** 按身份取待机页建议问题的 i18n key；非操作手一律按调度员处理 */
export function pickTaskWelcomeQuestions(role: VisitorRole | null): string[] {
  return role === "OPERATOR" ? OPERATOR_WELCOME_QUESTIONS : OWNER_WELCOME_QUESTIONS;
}
