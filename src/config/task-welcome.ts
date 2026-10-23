import type { GanttViewPayload } from "@/api/chat/types";

/**
 * 任务协同待机页文案（Ardot 350:2151「调度员收到异常情况」）。
 *
 * 版面 = 问候标题 + 说明 + 任务入口卡（AiGanttEntryCard）+「你还可以这么问」问题列表。
 * 文案是设计稿里的样例、入口卡数据是占位，等任务接口就绪后换成真实数据（或改成 getter 由接口注入），
 * 页面不用动。
 */
export interface TaskWelcomeCopy {
  /** 问候标题 */
  title: string;
  /** 问候说明 */
  content: string;
  /**
   * 入口卡整包数据：结构与 AI 下发的 gantt 积木一致（viewType / viewId / card / rows …），
   * 点击时按 `viewType` 分流到个人任务详情 / 预排 / 重排 / 甘特图，见 utils/gantt-view-route。
   */
  ganttEntry: GanttViewPayload;
  /** 「你还可以这么问」下的问题，点一条直接发问 */
  questions: string[];
}

export const TASK_WELCOME_COPY: TaskWelcomeCopy = {
  title: "调度员，你好。",
  content: "你昨天制定的5个订单任务计划，已在今日早上7点30分开始首个任务，请及时关注现场情况。",
  ganttEntry: {
    viewType: "personal",
    viewId: "task-personal-today",
    stage: "executing",
    card: {
      title: "任务协同-个人排班甘特图",
      status: "执行中",
      devices: "搅拌车 1 台",
      taskCount: 5,
    },
  },
  questions: [
    "车辆晚到应该怎么处理？",
    "搅拌车出现故障，会不会影响任务进度？",
    "现场浇筑计划比计划慢，会不会有退料风险？",
  ],
};
