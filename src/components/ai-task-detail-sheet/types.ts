/**
 * 任务详情窗口的数据结构（设计稿 6832:464「计划详情-司机」）。
 *
 * 单独放在 .ts 里：`<script setup>` 不能导出类型，页面与组件都要用到同一套结构。
 *
 * 字段都是可选的：接口按 `COMPONENT scene=task / type=gantt` 的 `payload` 下发，
 * 司机信息 / 路线 / 起止时间 / 备注 都可能缺省，渲染端**没有的值就不渲染对应元素**。
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
  /** 开始时间 HH:MM（可能为空） */
  start?: string;
  /** 结束时间 HH:MM（可能为空） */
  end?: string;
  /** 任务内容，如「C30混凝土12方」 */
  name?: string;
  /** 任务状态；缺省或认不出的值时不显示状态文案 */
  status?: TaskDetailStatus | string;
}

export interface TaskDetailGroup {
  /** 路线标题，如「从1 号站→A3 基地」 */
  route?: string;
  items?: TaskDetailItem[];
}

export interface TaskDetailPayload {
  /** 司机姓名 */
  driverName?: string;
  /** 日期文案，如「2026-09-16  今天」 */
  dateText?: string;
  /** 车辆班组，如「13号车（湘A65578）白班」 */
  vehicleText?: string;
  groups?: TaskDetailGroup[];
  /** 底部备注（可空） */
  note?: string;
}

/** 状态 → 文案；接口没给或给了认不出的值返回空串（调用方据此不渲染） */
export function taskDetailStatusLabel(status?: string) {
  if (!status) return "";
  return TASK_DETAIL_STATUS_LABEL[status as TaskDetailStatus] || "";
}
