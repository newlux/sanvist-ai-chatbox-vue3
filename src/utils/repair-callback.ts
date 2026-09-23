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
}

/** 故障诊断（回流数据带 status） */
const DIAGNOSIS_TITLE = "维修助手-机型诊断";
const DIAGNOSIS_STATUS = "诊断报告生成已完成";
/** 快速问答（回流数据没有 status） */
const QUICK_ANSWER_TITLE = "维修助手-快问快答";
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

/** 解析回流数据，得到卡片标题、副标题与明细 */
export function parseRepairCallbackSummary(query: string): RepairCallbackSummary {
  const fallback: RepairCallbackSummary = {
    title: DIAGNOSIS_TITLE,
    statusText: DIAGNOSIS_STATUS,
    details: [],
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
    };
  }
  catch {
    return fallback;
  }
}
