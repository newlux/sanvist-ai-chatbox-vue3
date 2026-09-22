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
