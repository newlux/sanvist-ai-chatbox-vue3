import type { RepairInformationPayload } from "@/api/repair/types";
import { i18n } from "@/i18n";

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
 * 卡片形态统一：标题都只写「维修助理」，四项固定四行，没值的那行写「待识别」。
 */
export interface RepairCallbackSummary {
  /** 卡片标题 */
  title: string;
  /** 卡片副标题（标题下方那行状态文案）；空串表示案例报告还没填全，卡片不显示这行 */
  statusText: string;
  /** 卡片明细：设备 / 问题 / 结论 / 处理，缺值的行是「待识别」 */
  details: Array<{ label: string; value: string }>;
  /** 维修助理侧会话 ID，有值时卡片可打开对应详情。 */
  repairConversationId: string;
}

/** 词条随当前语言取：卡片文案在生成那一刻定稿，已落到消息里的不再随切语言变 */
function t(key: string) {
  return i18n.global.t(key);
}

/** 卡片标题：不再区分「快问快答 / 机型诊断」，统一只写「维修助理」 */
function callbackTitle() {
  return t("repair-callback-title");
}
/** 案例报告四项齐全时的副标题 */
function diagnosisStatusText() {
  return t("repair-callback-done");
}
/** 快速问答（回流数据没有 status）的副标题 */
function quickAnswerStatusText() {
  return t("repair-callback-answer-done");
}
/** 四项里某一项还没值时，该行显示的占位文案 */
function pendingValueText() {
  return t("repair-callback-pending");
}

/** 从回流数据里取明细：四项固定四行，没值的那行是「待识别」 */
function pickRepairCallbackDetails(data: Record<string, unknown>) {
  const pending = pendingValueText();
  return [
    { label: t("repair-callback-label-device"), value: [data.equipmentCategory, data.model, data.deviceId].filter(Boolean).join(" ") },
    { label: t("repair-callback-label-problem"), value: String(data.problem || "") },
    { label: t("repair-callback-label-conclusion"), value: String(data.conclusion || "") },
    { label: t("repair-callback-label-treatment"), value: String(data.treatment || "") },
  ].map(item => ({ label: item.label, value: item.value.trim() || pending }));
}

export interface RepairCaseReport {
  /** 机型 / 故障现象 / 交互排查 / 交互维修四项都有值才算「案例报告生成完成」 */
  ready: boolean;
  /** 卡片明细：固定设备 / 问题 / 结论 / 处理四行，没值的那行是「待识别」 */
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
 * 四行恒定展示：接口没回值（或压根没拿到 state）的那行写「待识别」，
 * 不用空行或整块隐藏，用户能看出是哪一项还缺。
 * `ready` 只决定副标题「案例报告生成已完成」显不显示 —— 四项没齐就不许说已完成。
 */
export function parseRepairCaseReport(payload?: RepairInformationPayload | null): RepairCaseReport {
  const state = payload?.state;
  const pending = pendingValueText();
  const device = String(state?.device_model?.model_name || "").trim();
  const problem = String(state?.fault_symptoms?.[0]?.text || "").trim();
  const conclusion = String(state?.troubleshooting_steps?.[0]?.text || "").trim();
  const treatment = String(state?.repair_steps?.[0]?.text || "").trim();
  return {
    ready: Boolean(device && problem && conclusion && treatment),
    details: [
      { label: t("repair-callback-label-device"), value: device || pending },
      { label: t("repair-callback-label-problem"), value: problem || pending },
      { label: t("repair-callback-label-conclusion"), value: conclusion || pending },
      { label: t("repair-callback-label-treatment"), value: treatment || pending },
    ],
  };
}

/**
 * 案例报告的副标题文案：四项齐全才是「案例报告生成已完成」，缺任意一项返回空串。
 * 空串在上层会被当成「这行不渲染」，避免出现「已完成 + 待识别」自相矛盾的卡片。
 */
export function repairCaseReportStatusText(report: RepairCaseReport) {
  return report.ready ? diagnosisStatusText() : "";
}

/** 解析回流数据，得到卡片标题、副标题与明细 */
export function parseRepairCallbackSummary(query: string): RepairCallbackSummary {
  const fallback: RepairCallbackSummary = {
    title: callbackTitle(),
    // 解析不出数据等于四项全空：不给「已完成」，四行照留
    statusText: "",
    details: parseRepairCaseReport(null).details,
    repairConversationId: "",
  };
  if (!query) return fallback;

  try {
    const data = JSON.parse(query) as Record<string, unknown>;
    // 快速问答没有 status 字段，只有故障诊断才有；标题两种都只写「维修助理」，差异只落在副标题。
    const isDiagnosis = Boolean(data.status);
    const details = pickRepairCallbackDetails(data);
    // 四项没齐就不说「已完成」：副标题留空，气泡那边整行不渲染
    const ready = details.every(item => item.value !== pendingValueText());
    return {
      title: callbackTitle(),
      statusText: isDiagnosis ? (ready ? diagnosisStatusText() : "") : quickAnswerStatusText(),
      details,
      repairConversationId: String(data.repairConversationId || data.repair_conversation_id || "").trim(),
    };
  }
  catch {
    return fallback;
  }
}
