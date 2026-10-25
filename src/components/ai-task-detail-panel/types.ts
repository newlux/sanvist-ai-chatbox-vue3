/**
 * 任务详情面板（横屏右侧）的数据结构。
 * 设计稿：6832:292「查看任务详情」+ 6832:283 的四态样本
 * （样本 1 执行中 / 样本 2 执行中·长时段 / 样本 3 待执行 / 样本 4 逾期未开始）。
 *
 * 面板内容随任务状态动态变化：
 * - 「逾期未开始」会出现警告块（warning），且不再显示「当前进度」；
 * - 顶部状态胶囊的文案与配色按 status 切换；
 * - 「现场配合」可带一个前置小图标（supportIcon，可选）。
 */

/** 任务状态：已完成 / 执行中 / 待执行 / 已取消 / 逾期未开始（稿子四态 + 逾期） */
export type TaskDetailPanelStatus = "done" | "running" | "pending" | "canceled" | "overdue";

/** 状态 → i18n key；文案由组件按当前语言翻译 */
export const TASK_DETAIL_PANEL_STATUS_KEY: Record<TaskDetailPanelStatus, string> = {
  done: "task-status-done",
  running: "task-status-running",
  pending: "task-status-pending",
  canceled: "task-status-canceled",
  overdue: "task-status-overdue",
};

/** 「逾期未开始」的警告块（样本 4：「计划未开始（逾期 5 分钟）」+ 说明） */
export interface TaskDetailPanelWarning {
  /** 粗体标题，如「计划未开始（逾期 5 分钟）」 */
  title: string;
  /** 说明文案 */
  text: string;
}

export interface TaskDetailPanelPayload {
  /** 状态：决定胶囊配色与是否显示警告块 / 当前进度 */
  status: TaskDetailPanelStatus;
  /** 车辆文案（可选，如「13号车|运输|郑文斌」），有则显示在站点下方一行小字 */
  title?: string;
  /** 站点名，如「凤凰新城安置房」（14px Medium，面板第一行） */
  site: string;
  /** 作业内容，如「混凝土运输」「混凝土浇筑」（12px） */
  workType: string;
  /** 规格，如「C35」（12px，与方量拼成「C35 12方」） */
  spec?: string;
  /** 方量，如「12方」（12px #999） */
  volume: string;
  /** 右上角补充，如「共 6 车 / 共 8 车」「预计 7 车次送料」（12px，右对齐） */
  supplyNote: string;
  /** 计划时段，如「10:03 - 11:32（89分钟）」 */
  planTime: string;
  /** 当前进度，如「重车在途（距现场3.2km）」（逾期时由警告块替代，可不传） */
  progress: string;
  /** 现场配合一句话，如「首车 13号车 07:15 到场，车队连续送料」 */
  support: string;
  /** 现场配合的前置小图标（可选，如「⏱」「🚚」） */
  supportIcon?: string;
  /** 上一程，如「08:58 结束巡查二期（间歇 5分）」 */
  previous: string;
  /** 下一程，如「11:43 经开区厂房（间歇 11分）」 */
  next: string;
  /** 逾期警告（仅有「逾期未开始」时给） */
  warning?: TaskDetailPanelWarning;
}
