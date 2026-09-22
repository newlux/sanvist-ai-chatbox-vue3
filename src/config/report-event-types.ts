/**
 * 设备异常事件类型码（AI 下发 filter_list 与 /sanvist-event/list 过滤共用）。
 *
 * 码值与后端 / Dify agent 一致；中文名只用于展示，不参与接口传输。
 */
export const REPORT_EVENT_TYPE_CODES = [
  "OVERSPEED",
  "LOWSOC",
  "HIGH_MOTOR_TEMP",
  "LONG_STOP",
  "LONG_IDLE",
  "HIGH_ENGINE_SPEED",
  "HIGH_ENGINE_WATER_TEMP",
  "HIGH_HYDRAULIC_OIL_TEMP",
  "DEVICE_OFFLINE",
] as const;

export type ReportEventTypeCode = (typeof REPORT_EVENT_TYPE_CODES)[number];

/** 事件类型码 → 中文名。 */
export const REPORT_EVENT_TYPE_LABELS: Record<ReportEventTypeCode, string> = {
  OVERSPEED: "超速",
  LOWSOC: "SOC过低",
  HIGH_MOTOR_TEMP: "电机温度",
  LONG_STOP: "长时间停机",
  LONG_IDLE: "长时间怠速",
  HIGH_ENGINE_SPEED: "发动机转速",
  HIGH_ENGINE_WATER_TEMP: "冷却水温高",
  HIGH_HYDRAULIC_OIL_TEMP: "高液压油温",
  DEVICE_OFFLINE: "设备离线预警",
};

/**
 * 归一化事件类型码：AI 可能写成 "HIGH HYDRAULIC OIL TEMP"，后端约定是
 * "HIGH_HYDRAULIC_OIL_TEMP"，统一成「大写下划线」再比对。
 */
export function normalizeEventTypeCode(value: string) {
  return String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
}

export function isReportEventTypeCode(value: string): value is ReportEventTypeCode {
  return (REPORT_EVENT_TYPE_CODES as readonly string[]).includes(value);
}
