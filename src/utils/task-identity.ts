import { TASK_IDENTITY_CACHE_KEY } from "@/config";

/**
 * 任务协同里选中的身份 —— 取 /flow/steps?module=TASK 的 IDENTITY 选项（hitValue + label）。
 *
 * 注意它和本地 `VisitorRole`（OWNER / OPERATOR / …）不是一套码：
 * 身份码是业务身份（DISPATCH-01 工地调度员 / DISPATCH-02 商混站调度员 / DISPATCH-03 泵送公司调度主管），
 * 只作为对话 inputs.user_id 透传给后端，不用来切本地账号。
 *
 * 任务协同页靠「有没有这个身份」判断首屏是问「查异常」还是拉甘特图入口卡，
 * 所以它必须是**选过就一定在**的：写进 uni storage，跨页跳转 / 独立场景窗口都能取到。
 */
export interface TaskIdentity {
  /** 身份码：接口选项的 hitValue，直接作为对话 inputs.user_id 下发 */
  code: string;
  /** 身份文案（接口 label）：只用于日志与兜底展示 */
  label: string;
}

/** 记下本次选择的身份；传 null 清空（例如接口没下发身份选项时） */
export function setTaskIdentity(value: TaskIdentity | null) {
  const code = String(value?.code || "").trim();
  if (!code) {
    uni.removeStorageSync(TASK_IDENTITY_CACHE_KEY);
    return;
  }
  uni.setStorageSync(TASK_IDENTITY_CACHE_KEY, { code, label: String(value?.label || "").trim() });
}

/** 取当前身份；没选过（或缓存被破坏）时返回 null */
export function getTaskIdentity(): TaskIdentity | null {
  const cached = uni.getStorageSync(TASK_IDENTITY_CACHE_KEY) as Partial<TaskIdentity> | string | null;
  if (!cached) return null;
  if (typeof cached === "string") return cached.trim() ? { code: cached.trim(), label: "" } : null;
  const code = String(cached.code || "").trim();
  if (!code) return null;
  return { code, label: String(cached.label || "").trim() };
}
