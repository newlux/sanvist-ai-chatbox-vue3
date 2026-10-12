/**
 * 任务详情窗口的数据结构（设计稿 6832:464「计划详情-司机」）。
 *
 * 单独放在 .ts 里：`<script setup>` 不能导出类型，页面与组件都要用到同一套结构。
 */

/** 任务条状态：已完成 / 执行中 / 待执行 / 已取消（设计稿四态） */
export type TaskDetailStatus = "done" | "running" | "pending" | "canceled";

export const TASK_DETAIL_STATUS_LABEL: Record<TaskDetailStatus, string> = {
  done: "已完成",
  running: "执行中",
  pending: "待执行",
  canceled: "已取消",
};

export interface TaskDetailItem {
  /** 开始时间 HH:MM */
  start: string;
  /** 结束时间 HH:MM */
  end: string;
  /** 任务内容，如「C30混凝土12方」 */
  name: string;
  status: TaskDetailStatus;
}

export interface TaskDetailGroup {
  /** 路线标题，如「从1 号站→A3 基地」 */
  route: string;
  items: TaskDetailItem[];
}

export interface TaskDetailPayload {
  /** 司机姓名 */
  driverName: string;
  /** 日期文案，如「2026-09-16  今天」 */
  dateText: string;
  /** 车辆班组，如「13号车（湘A65578）白班」 */
  vehicleText: string;
  groups: TaskDetailGroup[];
  /** 底部备注（可空） */
  note?: string;
}
