/**
 * 三方维修助理（maix-bm）「案例报告」相关类型。
 *
 * 只声明卡片真正用到的字段，其余字段保底允许存在（三方还在迭代）。
 */

/** 列表项：故障现象 / 交互排查 / 交互维修都是这种结构，正文在 text */
export interface RepairInformationItem {
  text?: string;
  [key: string]: unknown;
}

export interface RepairInformationState {
  /** 机型：`device_model.model_name` 就是卡片上的「设备」 */
  device_model?: {
    model_name?: string;
    [key: string]: unknown;
  };
  /** 故障现象：第一条的 text 是卡片上的「问题」 */
  fault_symptoms?: RepairInformationItem[];
  /** 停工提示 */
  stop_work_notices?: unknown[];
  /** 交互排查：第一条的 text 是卡片上的「结论」 */
  troubleshooting_steps?: RepairInformationItem[];
  /** 交互维修：第一条的 text 是卡片上的「处理」 */
  repair_steps?: RepairInformationItem[];
  /** 配件信息（markdown） */
  parts_info_markdown?: string;
  [key: string]: unknown;
}

/** `GET /v1/conversations/{id}/repair-information/state` 的响应体 */
export interface RepairInformationPayload {
  updatedAt?: number;
  state?: RepairInformationState;
  clues?: unknown[];
  caseReport?: unknown;
  [key: string]: unknown;
}
