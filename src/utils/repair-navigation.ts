const PENDING_REPAIR_NAVIGATION_CONTEXT_KEY = "pending-repair-navigation-context";

export function stashPendingRepairNavigationContext(context: Record<string, unknown>) {
  try {
    uni.setStorageSync(PENDING_REPAIR_NAVIGATION_CONTEXT_KEY, context);
  }
  catch {
    // 本地存储不可用时仍允许进入维修助手，只是不携带 AI 建议上下文。
  }
}

export function consumePendingRepairNavigationContext() {
  try {
    const context = uni.getStorageSync(PENDING_REPAIR_NAVIGATION_CONTEXT_KEY);
    uni.removeStorageSync(PENDING_REPAIR_NAVIGATION_CONTEXT_KEY);
    return context && typeof context === "object" && !Array.isArray(context)
      ? context as Record<string, unknown>
      : {};
  }
  catch {
    return {};
  }
}
