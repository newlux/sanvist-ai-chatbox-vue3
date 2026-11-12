import type { RepairInformationPayload } from "@/api/repair/types";

const PENDING_REPAIR_CALLBACK_KEY = "pending-repair-callback";

export interface PendingRepairCallback {
  aiAskConversationId: string;
  aiAskSessionId: string;
}

function readPendingRepairCallback() {
  try {
    const value = uni.getStorageSync(PENDING_REPAIR_CALLBACK_KEY);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const task = value as Partial<PendingRepairCallback>;
    const aiAskConversationId = String(task.aiAskConversationId || "").trim();
    const aiAskSessionId = String(task.aiAskSessionId || "").trim();
    return aiAskConversationId && aiAskSessionId ? { aiAskConversationId, aiAskSessionId } : null;
  }
  catch {
    return null;
  }
}

export function stashPendingRepairCallback(task: PendingRepairCallback) {
  try {
    uni.setStorageSync(PENDING_REPAIR_CALLBACK_KEY, task);
  }
  catch {
    // 本地存储不可用时仍允许继续维修，只是不触发返回摘要。
  }
}

export function clearPendingRepairCallback() {
  try {
    uni.removeStorageSync(PENDING_REPAIR_CALLBACK_KEY);
  }
  catch {
    // 本地存储不可用时无需阻断维修页面跳转。
  }
}

export function consumePendingRepairCallback() {
  const task = readPendingRepairCallback();
  if (!task) return null;
  try {
    uni.removeStorageSync(PENDING_REPAIR_CALLBACK_KEY);
  }
  catch {
    // 已读取的任务仍可继续处理，删除失败只会在下次进入时重试。
  }
  return task;
}

/**
 * 回流卡片（AI 气泡里的 QA 卡片）文案与明细解析。
 * 回流数据整体是一段 JSON：故障诊断会带 status 字段，快速问答没有。
 */
export interface RepairCallbackSummary {
  /** 卡片标题 */
  title: string;
  /** 卡片副标题（标题下方那行状态文案） */
  statusText: string;
  /** 卡片明细：设备 / 问题 / 结论 / 处理，空值会被过滤 */
  details: Array<{ label: string; value: string }>;
  /** 维修助理侧会话 ID，有值时卡片可打开对应详情。 */
  repairConversationId: string;
}

/** 故障诊断（回流数据带 status） */
const DIAGNOSIS_TITLE = "维修助理-机型诊断";
const DIAGNOSIS_STATUS = "案例报告生成已完成";
/** 快速问答（回流数据没有 status） */
const QUICK_ANSWER_TITLE = "维修助理-快问快答";
const QUICK_ANSWER_STATUS = "答案回复已生成";

/** 从回流数据里取明细，空值不展示 */
function pickRepairCallbackDetails(data: Record<string, unknown>) {
  return [
    { label: "设备", value: [data.equipmentCategory, data.model, data.deviceId].filter(Boolean).join(" ") },
    { label: "问题", value: String(data.problem || "") },
    { label: "结论", value: String(data.conclusion || "") },
    { label: "处理", value: String(data.treatment || "") },
  ].filter(item => item.value);
}

export interface RepairCaseReport {
  /** 机型 / 故障现象 / 交互排查 / 交互维修四项都有值才算「案例报告生成完成」 */
  ready: boolean;
  /** 卡片明细：设备 / 问题 / 结论 / 处理，空值不展示 */
  details: Array<{ label: string; value: string }>;
}

/**
 * 从三方「案例报告状态」里取卡片四行。
 *
 * 字段口径（三方约定）：
 * - 设备 = `state.device_model.model_name`
 * - 问题 = `state.fault_symptoms[0].text`
 * - 结论 = `state.troubleshooting_steps[0].text`
 * - 处理 = `state.repair_steps[0].text`
 *
 * 四项齐了才算报告生成完成 —— 这条判断取代了原来「后端 status=Completed」的口径，
 * 因为后者会在结论还是占位文案、四项还没填全的时候就到 Completed。
 */
export function parseRepairCaseReport(payload?: RepairInformationPayload | null): RepairCaseReport {
  const state = payload?.state;
  const device = String(state?.device_model?.model_name || "").trim();
  const problem = String(state?.fault_symptoms?.[0]?.text || "").trim();
  const conclusion = String(state?.troubleshooting_steps?.[0]?.text || "").trim();
  const treatment = String(state?.repair_steps?.[0]?.text || "").trim();
  return {
    ready: Boolean(device && problem && conclusion && treatment),
    details: [
      { label: "设备", value: device },
      { label: "问题", value: problem },
      { label: "结论", value: conclusion },
      { label: "处理", value: treatment },
    ].filter(item => item.value),
  };
}

/** 解析回流数据，得到卡片标题、副标题与明细 */
export function parseRepairCallbackSummary(query: string): RepairCallbackSummary {
  const fallback: RepairCallbackSummary = {
    title: DIAGNOSIS_TITLE,
    statusText: DIAGNOSIS_STATUS,
    details: [],
    repairConversationId: "",
  };
  if (!query) return fallback;

  try {
    const data = JSON.parse(query) as Record<string, unknown>;
    // 快速问答没有 status 字段，只有故障诊断才有。
    const isDiagnosis = Boolean(data.status);
    return {
      title: isDiagnosis ? DIAGNOSIS_TITLE : QUICK_ANSWER_TITLE,
      statusText: isDiagnosis ? DIAGNOSIS_STATUS : QUICK_ANSWER_STATUS,
      details: pickRepairCallbackDetails(data),
      repairConversationId: String(data.repairConversationId || data.repair_conversation_id || "").trim(),
    };
  }
  catch {
    return fallback;
  }
}
